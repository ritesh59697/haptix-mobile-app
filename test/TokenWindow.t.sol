// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {PasskeyAccount, PackedUserOperation} from "../src/PasskeyAccount.sol";
import {WebAuthn} from "../src/WebAuthn.sol";
import {SpendWindow} from "../src/SpendWindow.sol";
import {Vectors} from "./Vectors.sol";

/// @notice Per-asset rolling windows.
///
///         The ETH window closed the sequential drain for native value. Tokens
///         had the same hole: twenty separate under-threshold USDC transfers.
///         Each asset now gets its own window, and an op touching several
///         assets is authorized only where ALL of their windows agree.
contract TokenWindowTest is Test, Vectors {
    PasskeyAccount account;

    address constant ENTRYPOINT = address(0xE);
    address constant ATTACKER = address(0xdEaD);
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant DAI = 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb;

    uint256 constant WINDOW_SECS = 1 days;
    uint256 constant ETH_CAP = 2 ether;
    uint256 constant USDC_CAP = 1000e6;
    uint256 constant DAI_CAP = 1000e18;

    bytes32 constant H = 0x1111111111111111111111111111111111111111111111111111111111111111;

    function setUp() public {
        account = new PasskeyAccount(ENTRYPOINT, _signers2(K0_X, K0_Y, K1_X, K1_Y), 1 ether);
        vm.deal(address(account), 100 ether);
        vm.warp(1_700_000_000);

        vm.startPrank(address(account));
        // Per-op thresholds (so single transfers are allowed at all).
        account.setTokenThreshold(USDC, 500e6, 6);
        account.setTokenThreshold(DAI, 500e18, 18);
        // Rolling windows.
        account.setWindow(address(0), ETH_CAP, WINDOW_SECS, 18);
        account.setWindow(USDC, USDC_CAP, WINDOW_SECS, 6);
        account.setWindow(DAI, DAI_CAP, WINDOW_SECS, 18);
        vm.stopPrank();
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

    function _xfer(address token, uint256 amt)
        internal pure returns (bytes memory)
    {
        return abi.encodeCall(
            PasskeyAccount.execute,
            (token, 0, abi.encodeWithSignature(
                "transfer(address,uint256)", ATTACKER, amt))
        );
    }

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

    /// Validate, apply the EntryPoint's time-range check, then execute.
    function _submitToken(address token, uint256 amt, bytes memory sig)
        internal returns (bool)
    {
        bytes memory cd = _xfer(token, amt);
        uint256 vd = _validate(cd, sig);

        if (vd & ((1 << 160) - 1) != 0) return false;
        uint48 validUntil = uint48((vd >> 160) & ((1 << 48) - 1));
        uint48 validAfter = uint48((vd >> 208) & ((1 << 48) - 1));
        if (validUntil != 0 && block.timestamp > validUntil) return false;
        if (block.timestamp < validAfter) return false;

        vm.prank(ENTRYPOINT);
        account.execute(token, 0, abi.encodeWithSignature(
            "transfer(address,uint256)", ATTACKER, amt));
        return true;
    }

    function _spent(address asset) internal view returns (uint96 s) {
        (s, ) = account.window(asset);
    }

    function _expiry(address asset) internal view returns (uint48 e) {
        (, e) = account.window(asset);
    }

    // ------------------------------------------------------------- THE FIX

    /// The token form of the sequential drain: repeated under-threshold USDC
    /// transfers, each with one signature.
    function test_Attack_SequentialTokenDrain_Blocked() public {
        uint256 accepted;
        uint256 authorized;

        for (uint256 i = 0; i < 20; i++) {
            if (_submitToken(USDC, 400e6, _one())) {
                accepted++;
                authorized += 400e6;
            }
        }

        console.log("USDC transfers accepted:", accepted);
        console.log("total USDC authorized:", authorized);

        assertEq(accepted, 2, "1000 USDC cap / 400 per op -> 2 ops");
        assertLe(authorized, USDC_CAP, "never exceed the token window cap");
    }

    /// Each token has an independent window: exhausting USDC must not affect DAI.
    function test_TokenWindowsAreIndependent() public {
        assertTrue(_submitToken(USDC, 400e6, _one()));
        assertTrue(_submitToken(USDC, 400e6, _one()));
        assertFalse(_submitToken(USDC, 400e6, _one()), "USDC window is full");

        // DAI is untouched.
        assertTrue(_submitToken(DAI, 400e18, _one()), "DAI window is separate");
        assertEq(_spent(USDC), 800e6);
        assertEq(_spent(DAI), 400e18);
    }

    /// Spending a token must not consume the ETH window, and vice versa.
    function test_TokenSpendDoesNotConsumeEthWindow() public {
        assertTrue(_submitToken(USDC, 400e6, _one()));
        assertEq(_spent(address(0)), 0, "ETH window untouched by a token spend");
    }

    /// Token windows roll over like the ETH one.
    function test_TokenWindowRollsOver() public {
        assertTrue(_submitToken(USDC, 400e6, _one()));
        assertTrue(_submitToken(USDC, 400e6, _one()));
        assertFalse(_submitToken(USDC, 400e6, _one()));

        vm.warp(block.timestamp + WINDOW_SECS + 1);

        assertTrue(_submitToken(USDC, 400e6, _one()), "new window");
        assertEq(_spent(USDC), 400e6, "counter reset");
    }

    /// A token with no configured window has no rolling limit -- it is still
    /// bound by the per-op threshold, but does not accumulate.
    function test_UnwindowedToken_HasNoRollingLimit() public {
        address other = address(0xC0FFEE);
        vm.prank(address(account));
        account.setTokenThreshold(other, 500e6, 6);
        // deliberately no setWindow for `other`

        for (uint256 i = 0; i < 5; i++) {
            assertTrue(
                _submitToken(other, 400e6, _one()),
                "no window configured -> no accumulation"
            );
        }
        assertEq(_spent(other), 0, "nothing recorded for an unwindowed token");
    }

    // ------------------------------------------------- multi-asset batches

    /// A batch spending ETH and two tokens must be checked against all three
    /// windows, and the returned time range must be their intersection.
    function test_MultiAssetBatch_ChecksEveryWindow() public {
        address[] memory dests = new address[](3);
        uint256[] memory values = new uint256[](3);
        bytes[] memory funcs = new bytes[](3);

        dests[0] = ATTACKER; values[0] = 0.5 ether; funcs[0] = "";
        dests[1] = USDC; funcs[1] = abi.encodeWithSignature(
            "transfer(address,uint256)", ATTACKER, 400e6);
        dests[2] = DAI; funcs[2] = abi.encodeWithSignature(
            "transfer(address,uint256)", ATTACKER, 400e18);

        bytes memory cd = abi.encodeCall(
            PasskeyAccount.executeBatch, (dests, values, funcs));

        uint256 vd = _validate(cd, _one());
        assertEq(vd & ((1 << 160) - 1), 0, "all three assets under their caps");

        vm.prank(ENTRYPOINT);
        account.executeBatch(dests, values, funcs);

        assertEq(_spent(address(0)), 0.5 ether, "ETH recorded");
        assertEq(_spent(USDC), 400e6, "USDC recorded");
        assertEq(_spent(DAI), 400e18, "DAI recorded");
    }

    /// One over-cap asset defers the WHOLE batch, even if the others fit.
    function test_Attack_OneAssetOverCap_DefersWholeBatch() public {
        // Fill the USDC window.
        assertTrue(_submitToken(USDC, 400e6, _one()));
        assertTrue(_submitToken(USDC, 400e6, _one()));

        address[] memory dests = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory funcs = new bytes[](2);
        dests[0] = ATTACKER; values[0] = 0.1 ether; funcs[0] = ""; // ETH fine
        dests[1] = USDC; funcs[1] = abi.encodeWithSignature(
            "transfer(address,uint256)", ATTACKER, 400e6);         // USDC full

        bytes memory cd = abi.encodeCall(
            PasskeyAccount.executeBatch, (dests, values, funcs));

        uint256 vd = _validate(cd, _one());
        uint48 validAfter = uint48((vd >> 208) & ((1 << 48) - 1));
        assertGt(validAfter, block.timestamp,
            "USDC being full must defer the entire batch");
    }

    /// The time range returned for a multi-asset op is the INTERSECTION of the
    /// per-asset ranges: the tightest validUntil wins.
    function test_MultiAsset_TimeRangeIsIntersection() public {
        // Open the USDC window first...
        assertTrue(_submitToken(USDC, 100e6, _one()));
        uint48 usdcExpiry = _expiry(USDC);

        // ...then open the ETH window later, giving it a LATER expiry.
        vm.warp(block.timestamp + 1 hours);
        vm.prank(ENTRYPOINT);
        account.execute(ATTACKER, 0.1 ether, "");
        uint48 ethExpiry = _expiry(address(0));

        assertGt(ethExpiry, usdcExpiry, "ETH window should expire later");

        // A batch touching both must be bounded by the EARLIER expiry.
        address[] memory dests = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory funcs = new bytes[](2);
        dests[0] = ATTACKER; values[0] = 0.1 ether; funcs[0] = "";
        dests[1] = USDC; funcs[1] = abi.encodeWithSignature(
            "transfer(address,uint256)", ATTACKER, 100e6);

        bytes memory cd = abi.encodeCall(
            PasskeyAccount.executeBatch, (dests, values, funcs));

        uint256 vd = _validate(cd, _one());
        uint48 validUntil = uint48((vd >> 160) & ((1 << 48) - 1));

        assertEq(validUntil, usdcExpiry,
            "intersection must take the tightest (earliest) validUntil");
    }

    /// Splitting a token spend across a batch still sums into one window.
    ///
    /// @dev Note the two layers interacting here. The per-op `tokenThreshold`
    ///      (500 USDC) is checked FIRST by _requiredSignatures; only if the op
    ///      clears that does the rolling window get consulted. So this batch
    ///      uses 2 x 200 = 400, staying under the per-op threshold, to isolate
    ///      the window behaviour from the threshold behaviour.
    function test_Attack_SplitTokenAcrossBatchAndOps_Blocked() public {
        address[] memory dests = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory funcs = new bytes[](2);
        dests[0] = USDC; funcs[0] = abi.encodeWithSignature(
            "transfer(address,uint256)", ATTACKER, 200e6);
        dests[1] = USDC; funcs[1] = abi.encodeWithSignature(
            "transfer(address,uint256)", ATTACKER, 200e6);

        bytes memory cd = abi.encodeCall(
            PasskeyAccount.executeBatch, (dests, values, funcs));

        uint256 vd = _validate(cd, _one());
        assertEq(vd & ((1 << 160) - 1), 0,
            "400 USDC total is under both the per-op threshold and the cap");

        vm.prank(ENTRYPOINT);
        account.executeBatch(dests, values, funcs);
        assertEq(_spent(USDC), 400e6, "batch recorded into the token window");

        // 400 already spent. Another 400 fits (800). A third 400 would be
        // 1200 -- over the 1000 cap -- so it must be deferred.
        assertTrue(_submitToken(USDC, 400e6, _one()), "800 total still fits");
        assertFalse(_submitToken(USDC, 400e6, _one()),
            "1200 would exceed the 1000 USDC window");
    }

    /// The per-op threshold and the rolling window are independent layers: an
    /// op over the per-op threshold needs two signatures regardless of how
    /// empty the window is.
    function test_PerOpThresholdAppliesBeforeWindow() public {
        assertEq(_spent(USDC), 0, "window is completely empty");

        // 600 > the 500 per-op threshold, so one signature is not enough even
        // though the window has 1000 of room.
        uint256 vd = _validate(_xfer(USDC, 600e6), _one());
        assertEq(vd & ((1 << 160) - 1), 1,
            "per-op threshold rejects before the window is consulted");
    }

    /// Two signatures override token windows, same as ETH.
    function test_TwoSignatures_BypassTokenWindow() public {
        assertTrue(_submitToken(USDC, 400e6, _one()));
        assertTrue(_submitToken(USDC, 400e6, _one()));
        assertFalse(_submitToken(USDC, 400e6, _one()), "one sig is capped");

        uint256 vd = _validate(_xfer(USDC, 400e6), _two());
        assertEq(vd & ((1 << 160) - 1), 0, "quorum overrides the token window");
    }

    /// An op touching more distinct assets than the policy will price escalates
    /// to a full quorum rather than burning gas on a long dedup scan. Sixteen
    /// distinct tokens measured ~445k gas before this bail-out -- past common
    /// bundler verificationGasLimit defaults, which would have made such an op
    /// unusable rather than merely expensive.
    function test_Attack_TooManyDistinctAssets_Escalates() public {
        uint256 n = 8;
        address[] memory dests = new address[](n);
        uint256[] memory values = new uint256[](n);
        bytes[] memory funcs = new bytes[](n);

        vm.startPrank(address(account));
        for (uint256 i = 0; i < n; i++) {
            address t = address(uint160(0x2000 + i));
            account.setTokenThreshold(t, 1_000_000e6, 6);
            account.setWindow(t, 1_000_000e6, WINDOW_SECS, 6);
        }
        vm.stopPrank();

        for (uint256 i = 0; i < n; i++) {
            dests[i] = address(uint160(0x2000 + i));
            funcs[i] = abi.encodeWithSignature(
                "transfer(address,uint256)", ATTACKER, 1e6);
        }

        bytes memory cd = abi.encodeCall(
            PasskeyAccount.executeBatch, (dests, values, funcs));

        uint256 vd = _validate(cd, _one());
        assertEq(vd & ((1 << 160) - 1), 1,
            "more distinct assets than MAX_PRICED_ASSETS must need 2 sigs");
    }

    // ------------------------------------------------------------- fuzzing

    /// Across any sequence of single-signature token transfers, total
    /// authorized USDC never exceeds the window cap.
    function testFuzz_TokenWindowNeverExceeded(uint64[8] memory amounts)
        public
    {
        uint256 authorized;
        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 amt = bound(uint256(amounts[i]), 1, 499e6);
            if (_submitToken(USDC, amt, _one())) authorized += amt;
        }
        assertLe(authorized, USDC_CAP, "token window must hold");
    }

    /// ETH and token windows must not interfere: draining one never grants
    /// extra budget in the other.
    function testFuzz_AssetWindowsDoNotInterfere(uint64 a, uint64 b) public {
        uint256 usdcAmt = bound(uint256(a), 1, 499e6);
        uint256 ethAmt = bound(uint256(b), 1, 0.9 ether);

        uint256 usdcTotal;
        for (uint256 i = 0; i < 4; i++) {
            if (_submitToken(USDC, usdcAmt, _one())) usdcTotal += usdcAmt;
        }

        uint256 ethTotal;
        for (uint256 i = 0; i < 4; i++) {
            bytes memory cd = abi.encodeCall(
                PasskeyAccount.execute, (ATTACKER, ethAmt, ""));
            uint256 vd = _validate(cd, _one());
            if (vd & ((1 << 160) - 1) != 0) continue;
            uint48 va = uint48((vd >> 208) & ((1 << 48) - 1));
            if (block.timestamp < va) continue;
            vm.prank(ENTRYPOINT);
            account.execute(ATTACKER, ethAmt, "");
            ethTotal += ethAmt;
        }

        assertLe(usdcTotal, USDC_CAP, "USDC window held");
        assertLe(ethTotal, ETH_CAP, "ETH window held");
    }

    /// Verifies that 6-decimal USDC base units (1_000_000 = 1 USDC) are correctly evaluated
    /// against the 6-decimal threshold (500_000_000 = 500 USDC), not misinterpreted as 1e-12.
    function test_TokenDecimals_UsdcSixDecimals_TreatedAsBaseUnits() public {
        address baseSepoliaUsdc = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
        uint8 usdcDecimals = 6;
        uint256 usdcThreshold = 500 * 10 ** usdcDecimals; // 500_000_000 = 500 USDC
        uint256 usdcCap = 1000 * 10 ** usdcDecimals;       // 1_000_000_000 = 1000 USDC

        vm.startPrank(address(account));
        account.setTokenThreshold(baseSepoliaUsdc, usdcThreshold, usdcDecimals);
        account.setWindow(baseSepoliaUsdc, usdcCap, WINDOW_SECS, usdcDecimals);
        vm.stopPrank();

        assertEq(account.tokenDecimals(baseSepoliaUsdc), 6, "stored decimals is 6");
        assertEq(account.tokenThreshold(baseSepoliaUsdc), 500_000_000, "threshold is 500 USDC in base units");
        assertEq(account.windowCap(baseSepoliaUsdc), 1_000_000_000, "cap is 1000 USDC in base units");

        // 1 USDC (1_000_000 base units) < 500 USDC threshold -> requires 1 signature
        bytes memory cd1Usdc = _xfer(baseSepoliaUsdc, 1_000_000);
        uint256 vd1 = _validate(cd1Usdc, _one());
        assertEq(vd1 & ((1 << 160) - 1), 0, "1 USDC under 500 USDC threshold succeeds with 1 sig");

        // 600 USDC (600_000_000 base units) >= 500 USDC threshold -> requires 2 signatures
        bytes memory cd600Usdc = _xfer(baseSepoliaUsdc, 600_000_000);
        uint256 vd600Single = _validate(cd600Usdc, _one());
        assertEq(vd600Single & ((1 << 160) - 1), 1, "600 USDC over threshold fails with 1 sig");

        uint256 vd600Double = _validate(cd600Usdc, _two());
        assertEq(vd600Double & ((1 << 160) - 1), 0, "600 USDC over threshold succeeds with 2 sigs");
    }
}
