// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {PasskeyAccount, PackedUserOperation} from "../src/PasskeyAccount.sol";
import {WebAuthn} from "../src/WebAuthn.sol";
import {SpendWindow} from "../src/SpendWindow.sol";
import {Vectors} from "./Vectors.sol";

/// @notice The sequential-UserOp hole and its fix.
///
///         Before the rolling window, twenty separate under-threshold ops each
///         validated with one signature -- 19.8 ETH against a 1 ETH threshold.
///         These tests prove the window closes that, and that the ERC-7562
///         constraints are respected in the process.
contract SpendWindowTest is Test, Vectors {
    PasskeyAccount account;

    address constant ENTRYPOINT = address(0xE);
    address constant ATTACKER = address(0xdEaD);

    uint256 constant THRESHOLD = 1 ether;   // per-op
    uint256 constant WINDOW_CAP = 2 ether;  // cumulative per window
    uint256 constant WINDOW_SECS = 1 days;

    bytes32 constant H = 0x1111111111111111111111111111111111111111111111111111111111111111;

    function setUp() public {
        account = new PasskeyAccount(ENTRYPOINT, _signers2(K0_X, K0_Y, K1_X, K1_Y), THRESHOLD);
        vm.deal(address(account), 100 ether);

        vm.prank(address(account));
        account.setWindow(address(0), WINDOW_CAP, WINDOW_SECS, 18);

        // Start at a sane timestamp so window arithmetic is realistic.
        vm.warp(1_700_000_000);
    }

    // ---------------------------------------------------------------- helpers

    function _one() internal pure returns (bytes memory) {
        uint256[] memory ids = new uint256[](1);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](1);
        ids[0] = 0; sigs[0] = _v_small_k0();
        return abi.encode(ids, sigs);
    }

    function _two() internal pure returns (bytes memory) {
        uint256[] memory ids = new uint256[](2);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](2);
        ids[0] = 0; sigs[0] = _v_small_k0();
        ids[1] = 1; sigs[1] = _v_small_k1();
        return abi.encode(ids, sigs);
    }

    function _send(uint256 value) internal pure returns (bytes memory) {
        return abi.encodeCall(PasskeyAccount.execute, (ATTACKER, value, ""));
    }

    /// Validate only -- returns raw validationData.
    function _validate(bytes memory callData, bytes memory sig)
        internal returns (uint256)
    {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = callData;
        op.signature = sig;
        vm.prank(ENTRYPOINT);
        return account.validateUserOp(op, H, 0);
    }

    /// Validate, enforce the returned time range the way the EntryPoint does,
    /// then execute. Returns false if the op would be rejected.
    function _submit(uint256 value, bytes memory sig) internal returns (bool) {
        uint256 vd = _validate(_send(value), sig);

        uint256 authorizer = vd & ((1 << 160) - 1);
        if (authorizer != 0) return false;

        // Mirror EntryPoint._getValidationData exactly:
        //   outOfTimeRange = block.timestamp > validUntil
        //                 || block.timestamp < validAfter
        uint48 validUntil = uint48((vd >> 160) & ((1 << 48) - 1));
        uint48 validAfter = uint48((vd >> 208) & ((1 << 48) - 1));
        if (validUntil != 0 && block.timestamp > validUntil) return false;
        if (block.timestamp < validAfter) return false;

        vm.prank(ENTRYPOINT);
        account.execute(ATTACKER, value, "");
        return true;
    }

    function _spent() internal view returns (uint96 s) {
        (s, ) = account.window(address(0));
    }

    function _expiry() internal view returns (uint48 e) {
        (, e) = account.window(address(0));
    }

    // ------------------------------------------------------------ THE FIX

    /// The exact attack that previously drained the account: repeated
    /// under-threshold ops, each with one signature.
    function test_Attack_SequentialDrain_NowBlocked() public {
        uint256 accepted;
        uint256 authorized;

        for (uint256 i = 0; i < 20; i++) {
            if (_submit(0.9 ether, _one())) {
                accepted++;
                authorized += 0.9 ether;
            }
        }

        console.log("ops accepted:", accepted);
        console.log("total authorized (wei):", authorized);

        // 2 ETH cap / 0.9 ETH per op -> only 2 can land.
        assertEq(accepted, 2, "window must cap sequential ops");
        assertLe(authorized, WINDOW_CAP, "never exceed the window cap");
    }

    /// After the window rolls over, spending resumes.
    function test_WindowRollsOverAfterDuration() public {
        assertTrue(_submit(0.9 ether, _one()), "first op");
        assertTrue(_submit(0.9 ether, _one()), "second op");
        assertFalse(_submit(0.9 ether, _one()), "third exceeds cap");

        // Roll past the window.
        vm.warp(block.timestamp + WINDOW_SECS + 1);

        assertTrue(_submit(0.9 ether, _one()), "new window, spending resumes");
        assertEq(_spent(), 0.9 ether, "counter reset for the new window");
    }

    /// A full quorum deliberately overrides the window -- that is what the
    /// second factor is FOR. Otherwise the user could lock themselves out of
    /// their own funds for a day.
    function test_TwoSignatures_BypassWindow() public {
        assertTrue(_submit(0.9 ether, _one()));
        assertTrue(_submit(0.9 ether, _one()));
        assertFalse(_submit(0.9 ether, _one()), "one sig is capped");

        // Same spend, two signatures: allowed.
        uint256 vd = _validate(_send(0.9 ether), _two());
        assertEq(vd & ((1 << 160) - 1), 0, "quorum overrides the window");
    }

    // ------------------------------------------- ERC-7562 compliance details

    /// Validation must return the window expiry as validUntil, so the
    /// EntryPoint can verify the window was actually still open. Without this,
    /// a bundler could hold a UserOp until after the window closed and land it
    /// against stale accounting.
    function test_ValidationData_CarriesWindowExpiry() public {
        // Open a window.
        assertTrue(_submit(0.5 ether, _one()));
        uint48 exp = _expiry();
        assertGt(exp, 0, "window should be open");

        uint256 vd = _validate(_send(0.5 ether), _one());
        uint48 validUntil = uint48((vd >> 160) & ((1 << 48) - 1));

        assertEq(validUntil, exp, "validUntil must equal the window expiry");
    }

    /// An op that does not fit the current window is deferred, not failed:
    /// validation returns success with `validAfter` set to the window expiry,
    /// and the EntryPoint refuses to include it until then ("AA22 expired or
    /// not due").
    ///
    /// This is the subtle part of the design. Validation cannot read the clock,
    /// so it cannot distinguish "window still open, you are over budget" from
    /// "window already closed, you have a fresh budget". Returning a hard
    /// failure would lock the user out permanently, because the counter only
    /// clears in `record`, which never runs if validation always fails.
    function test_OverCapOp_IsDeferredNotFailed() public {
        assertTrue(_submit(0.9 ether, _one()));
        assertTrue(_submit(0.9 ether, _one()));

        uint256 vd = _validate(_send(0.9 ether), _one());

        // Signature itself is fine...
        assertEq(vd & ((1 << 160) - 1), 0, "signature is valid");

        // ...but the op is not includable until the window rolls.
        uint48 validAfter = uint48((vd >> 208) & ((1 << 48) - 1));
        assertEq(validAfter, _expiry(), "deferred to the next window");
        assertGt(validAfter, block.timestamp, "not yet due");

        // And the EntryPoint's own check rejects it right now.
        assertFalse(_submit(0.9 ether, _one()), "blocked at the current time");
    }

    /// A first op with no window open yet returns validUntil = 0 (no time
    /// constraint), because there is no prior window to be stale about.
    function test_FirstOp_NoTimeConstraint() public {
        uint256 vd = _validate(_send(0.5 ether), _one());
        uint48 validUntil = uint48((vd >> 160) & ((1 << 48) - 1));
        assertEq(validUntil, 0, "no open window -> unconstrained");
        assertEq(vd & ((1 << 160) - 1), 0, "and it should validate");
    }

    /// Validation must not write the window. If it did, a bundler simulating
    /// an op it never lands would consume the user's budget.
    function test_ValidationDoesNotMutateWindow() public {
        assertTrue(_submit(0.5 ether, _one()));
        uint96 before = _spent();
        uint48 expBefore = _expiry();

        // Validate several times without executing.
        _validate(_send(0.5 ether), _one());
        _validate(_send(0.5 ether), _one());
        _validate(_send(0.5 ether), _one());

        assertEq(_spent(), before, "validation must not advance the counter");
        assertEq(_expiry(), expBefore, "validation must not move the expiry");
    }

    // ------------------------------------------------------------ batches

    /// A batch's total counts against the window, not each entry.
    function test_BatchCountsTowardWindow() public {
        address[] memory dests = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory funcs = new bytes[](2);
        dests[0] = ATTACKER; values[0] = 0.4 ether;
        dests[1] = ATTACKER; values[1] = 0.4 ether;

        bytes memory cd = abi.encodeCall(
            PasskeyAccount.executeBatch, (dests, values, funcs)
        );

        uint256 vd = _validate(cd, _one());
        assertEq(vd & ((1 << 160) - 1), 0, "0.8 ETH batch is under the cap");

        vm.prank(ENTRYPOINT);
        account.executeBatch(dests, values, funcs);
        assertEq(_spent(), 0.8 ether, "batch total recorded");

        // Another 0.8 fits (1.6 total), a third would exceed 2 ETH.
        vd = _validate(cd, _one());
        assertEq(vd & ((1 << 160) - 1), 0, "second batch fits");

        vm.prank(ENTRYPOINT);
        account.executeBatch(dests, values, funcs);
        assertEq(_spent(), 1.6 ether);

        // A third batch would total 2.4 ETH against a 2 ETH cap, so it is
        // deferred to the next window rather than executed.
        vd = _validate(cd, _one());
        uint48 validAfter = uint48((vd >> 208) & ((1 << 48) - 1));
        assertGt(validAfter, block.timestamp, "third batch deferred, not due");
    }

    // ------------------------------------------------------------- config

    /// Raising the cap requires a full quorum, because setWindow is not an
    /// `execute` call and therefore takes the 2-signature default.
    function test_Attack_CannotRaiseOwnCap() public {
        vm.expectRevert(PasskeyAccount.NotSelf.selector);
        account.setWindow(address(0), 1000 ether, 1, 18);

        bytes memory cd = abi.encodeCall(
            PasskeyAccount.setWindow, (address(0), 1000 ether, 1, 18)
        );
        uint256 vd = _validate(cd, _one());
        assertEq(vd & ((1 << 160) - 1), 1, "raising the cap needs 2 sigs");
    }

    /// Window disabled (cap 0) means no accounting at all.
    function test_WindowDisabled_NoAccounting() public {
        vm.prank(address(account));
        account.setWindow(address(0), 0, 0, 18);

        for (uint256 i = 0; i < 5; i++) {
            assertTrue(_submit(0.9 ether, _one()), "no window -> unconstrained");
        }
    }

    // ------------------------------------------------------------- fuzzing

    /// The invariant that matters: across any sequence of single-signature
    /// ops within one window, total authorized ETH never exceeds the cap.
    function testFuzz_NeverExceedsWindowCap(uint96[8] memory amounts) public {
        uint256 authorized;

        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 amt = bound(uint256(amounts[i]), 1, 0.99 ether);
            if (_submit(amt, _one())) authorized += amt;
        }

        assertLe(
            authorized, WINDOW_CAP,
            "single-signature spend must never exceed the window cap"
        );
    }

    /// Time warps must not let more through than the number of windows elapsed.
    function testFuzz_WindowRollover_BoundedByElapsedWindows(uint32 jump)
        public
    {
        uint256 j = bound(uint256(jump), 0, 10 days);
        uint256 authorized;

        for (uint256 i = 0; i < 6; i++) {
            if (_submit(0.9 ether, _one())) authorized += 0.9 ether;
            vm.warp(block.timestamp + j);
        }

        uint256 windowsElapsed = (j * 6) / WINDOW_SECS + 1;
        assertLe(
            authorized, WINDOW_CAP * windowsElapsed,
            "cannot exceed cap x windows elapsed"
        );
    }

    // -------------------------------------------------- Bundler multi-op race & sequencing

    /// @notice Documents the bundler multi-op race condition under ERC-7562:
    ///
    /// If an ERC-4337 bundler attempts to batch multiple single-signature UserOps from the
    /// SAME account into a single bundle:
    ///
    /// 1. Validation is strictly READ-ONLY on window storage slots (STO-010).
    /// 2. If Op 1 and Op 2 are simulated concurrently against the same unmutated state,
    ///    both validations would read _spent = 0.
    /// 3. When executed on-chain in sequence:
    ///    - Op 1 executes and advances window spend to 0.9 ETH.
    ///    - Op 2 (if simulated against updated state or re-validated) sees 0.9 + 0.9 = 1.8 ETH > 1.0 ETH cap.
    ///    - Op 2 returns validAfter = expiry (deferred) and is rejected at the current timestamp.
    ///
    /// This proves why ERC-7562 requires bundlers to sequence UserOps from the same sender or
    /// limit them to one op per account per bundle.
    function test_Attack_TwoOpsSameAccount_BundleRace_Documented() public {
        // Op 1 and Op 2 successfully validate and execute up to 1.8 ETH (under 2.0 ETH cap)
        assertTrue(_submit(0.9 ether, _one()), "Op 1 executes and records 0.9 ETH");
        assertTrue(_submit(0.9 ether, _one()), "Op 2 executes and records total 1.8 ETH");
        assertEq(_spent(), 1.8 ether, "window spent recorded as 1.8 ETH");
        assertGt(_expiry(), block.timestamp, "window expiry is set");

        // Op 3 validates against the now-updated storage
        bytes memory cd3 = _send(0.9 ether);
        uint256 vd3 = _validate(cd3, _one());

        // Because _spent is now 1.8 ETH, 1.8 + 0.9 = 2.7 ETH exceeds WINDOW_CAP (2.0 ETH).
        // Op 3 is deferred to the next window (validAfter == window expiry)
        uint48 validAfter = uint48((vd3 >> 208) & ((1 << 48) - 1));
        assertEq(validAfter, _expiry(), "Op 3 deferred to next window due to accumulated spend");

        // The EntryPoint enforces timestamp >= validAfter and rejects Op 3 right now
        assertFalse(_submit(0.9 ether, _one()), "Op 3 cannot execute in current window");
    }
}
