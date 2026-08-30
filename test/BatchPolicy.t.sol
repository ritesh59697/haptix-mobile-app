// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {PasskeyAccount, PackedUserOperation} from "../src/PasskeyAccount.sol";
import {WebAuthn} from "../src/WebAuthn.sol";
import {Vectors} from "./Vectors.sol";

/// @notice Batching is the natural way to reopen a spending-limit bypass: split
///         one large transfer into many small ones, each individually under the
///         threshold. These tests exist to prove the policy sums the batch
///         instead of pricing each entry on its own.
contract BatchPolicyTest is Test, Vectors {
    PasskeyAccount account;

    address constant ENTRYPOINT = address(0xE);
    address constant ATTACKER = address(0xdEaD);
    uint256 constant THRESHOLD = 1 ether;

    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant DAI = 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb;

    bytes32 constant H_BATCH =
        0x1111111111111111111111111111111111111111111111111111111111111111;

    function setUp() public {
        account = new PasskeyAccount(ENTRYPOINT, _signers2(K0_X, K0_Y, K1_X, K1_Y), THRESHOLD);
        vm.deal(address(account), 100 ether);

        vm.prank(address(account));
        account.setTokenThreshold(USDC, 1000e6, 6);

        vm.prank(address(account));
        account.setTokenThreshold(DAI, 1000e18, 18);
    }

    // ---------------------------------------------------------------- helpers

    function _one(uint256 id, WebAuthn.Signature memory s)
        internal pure returns (bytes memory)
    {
        uint256[] memory ids = new uint256[](1);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](1);
        ids[0] = id; sigs[0] = s;
        return abi.encode(ids, sigs);
    }

    function _two() internal pure returns (bytes memory) {
        uint256[] memory ids = new uint256[](2);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](2);
        // Both signed over H_BATCH -- a quorum only counts when every
        // signature covers the SAME UserOp hash.
        ids[0] = 0; sigs[0] = _v_small_k0();
        ids[1] = 1; sigs[1] = _v_small_k1();
        return abi.encode(ids, sigs);
    }

    function _validate(bytes memory callData, bytes memory sig)
        internal returns (uint256)
    {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = callData;
        op.signature = sig;
        vm.prank(ENTRYPOINT);
        return account.validateUserOp(op, H_BATCH, 0);
    }

    /// Build an executeBatch calldata of N identical ETH sends.
    function _ethBatch(uint256 count, uint256 each)
        internal pure returns (bytes memory)
    {
        address[] memory dests = new address[](count);
        uint256[] memory values = new uint256[](count);
        bytes[] memory funcs = new bytes[](count);
        for (uint256 i = 0; i < count; i++) {
            dests[i] = ATTACKER;
            values[i] = each;
            funcs[i] = "";
        }
        return abi.encodeCall(PasskeyAccount.executeBatch, (dests, values, funcs));
    }

    /// Build an executeBatch of N identical ERC-20 transfers of one token.
    function _tokenBatch(address token, uint256 count, uint256 each)
        internal pure returns (bytes memory)
    {
        address[] memory dests = new address[](count);
        uint256[] memory values = new uint256[](count);
        bytes[] memory funcs = new bytes[](count);
        for (uint256 i = 0; i < count; i++) {
            dests[i] = token;
            values[i] = 0;
            funcs[i] = abi.encodeWithSignature(
                "transfer(address,uint256)", ATTACKER, each
            );
        }
        return abi.encodeCall(PasskeyAccount.executeBatch, (dests, values, funcs));
    }

    // ------------------------------------------------------ THE CORE ATTACKS

    /// The attack this feature exists to stop: 11 x 0.9 ETH = 9.9 ETH, every
    /// entry individually below the 1 ETH threshold.
    function test_Attack_SplitETHAcrossBatch_Rejected() public {
        uint256 r = _validate(_ethBatch(11, 0.9 ether), _one(0, _v_small_k0()));
        assertEq(r, 1, "split ETH batch must be summed and rejected");
    }

    /// Same shape, ERC-20: 5 x 300 USDC = 1500 USDC, threshold 1000.
    function test_Attack_SplitERC20AcrossBatch_Rejected() public {
        uint256 r = _validate(_tokenBatch(USDC, 5, 300e6), _one(0, _v_small_k0()));
        assertEq(r, 1, "split token batch must be summed and rejected");
    }

    /// Dust-sized entries still sum. 16 x 100 USDC = 1600 USDC.
    function test_Attack_ManyDustTransfers_Rejected() public {
        uint256 r = _validate(_tokenBatch(USDC, 16, 100e6), _one(0, _v_small_k0()));
        assertEq(r, 1, "dust entries must still aggregate");
    }

    /// Two different tokens, each individually under its own threshold, must
    /// NOT mask each other -- but must also not be added together (different
    /// units). USDC 1500 alone is over; DAI 500 alone is under.
    function test_Attack_MixedTokens_OverOnOne_Rejected() public {
        address[] memory dests = new address[](3);
        uint256[] memory values = new uint256[](3);
        bytes[] memory funcs = new bytes[](3);

        dests[0] = USDC; funcs[0] = abi.encodeWithSignature("transfer(address,uint256)", ATTACKER, 800e6);
        dests[1] = USDC; funcs[1] = abi.encodeWithSignature("transfer(address,uint256)", ATTACKER, 700e6);
        dests[2] = DAI;  funcs[2] = abi.encodeWithSignature("transfer(address,uint256)", ATTACKER, 500e18);

        bytes memory cd = abi.encodeCall(
            PasskeyAccount.executeBatch, (dests, values, funcs)
        );
        uint256 r = _validate(cd, _one(0, _v_small_k0()));
        assertEq(r, 1, "USDC total 1500 exceeds its threshold");
    }

    /// ETH and tokens are summed SEPARATELY. 0.5 ETH + 500 USDC is under both
    /// thresholds and must clear with one signature -- proving we are not
    /// naively adding unrelated units into a single total.
    function test_MixedAssets_BothUnderThreshold_OneSignature() public {
        address[] memory dests = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory funcs = new bytes[](2);

        dests[0] = ATTACKER; values[0] = 0.5 ether; funcs[0] = "";
        dests[1] = USDC;     values[1] = 0;
        funcs[1] = abi.encodeWithSignature("transfer(address,uint256)", ATTACKER, 500e6);

        bytes memory cd = abi.encodeCall(
            PasskeyAccount.executeBatch, (dests, values, funcs)
        );
        uint256 r = _validate(cd, _one(0, _v_small_k0()));
        assertEq(r, 0, "different assets, both under threshold, should pass");
    }

    /// One opaque call anywhere in the batch escalates the WHOLE batch.
    function test_Attack_OneOpaqueCallInBatch_Escalates() public {
        address[] memory dests = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory funcs = new bytes[](2);

        dests[0] = ATTACKER; values[0] = 0.1 ether; funcs[0] = "";
        dests[1] = address(0xDEF1); values[1] = 0;
        funcs[1] = abi.encodeWithSignature("mystery(uint256)", 1);

        bytes memory cd = abi.encodeCall(
            PasskeyAccount.executeBatch, (dests, values, funcs)
        );
        uint256 r = _validate(cd, _one(0, _v_small_k0()));
        assertEq(r, 1, "an unpriceable entry must escalate the batch");
    }

    /// An approve hidden in an otherwise-small batch escalates it.
    function test_Attack_ApproveHiddenInBatch_Escalates() public {
        address[] memory dests = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory funcs = new bytes[](2);

        dests[0] = ATTACKER; values[0] = 0.01 ether; funcs[0] = "";
        dests[1] = USDC;     values[1] = 0;
        funcs[1] = abi.encodeWithSignature("approve(address,uint256)", ATTACKER, 1);

        bytes memory cd = abi.encodeCall(
            PasskeyAccount.executeBatch, (dests, values, funcs)
        );
        uint256 r = _validate(cd, _one(0, _v_small_k0()));
        assertEq(r, 1, "approve anywhere in a batch must escalate");
    }

    /// A batch longer than MAX_PRICED_BATCH cannot be summed under the 4337
    /// validation gas limit, so it escalates rather than being priced partially.
    function test_Attack_OversizedBatch_Escalates() public {
        uint256 r = _validate(_ethBatch(17, 0.001 ether), _one(0, _v_small_k0()));
        assertEq(r, 1, "batch over the priced limit must escalate");
    }

    /// An unconfigured token inside a batch escalates, same as standalone.
    function test_Attack_UnconfiguredTokenInBatch_Escalates() public {
        uint256 r = _validate(
            _tokenBatch(address(0xC0FFEE), 1, 1), _one(0, _v_small_k0())
        );
        assertEq(r, 1, "unconfigured token in batch must escalate");
    }

    // ------------------------------------------------------------ happy paths

    /// A genuinely small batch still clears with one signature.
    function test_SmallBatch_OneSignature() public {
        uint256 r = _validate(_ethBatch(3, 0.1 ether), _one(0, _v_small_k0()));
        assertEq(r, 0, "0.3 ETH total is under threshold");
    }

    /// An empty batch is a no-op and needs one signature.
    function test_EmptyBatch_OneSignature() public {
        uint256 r = _validate(_ethBatch(0, 0), _one(0, _v_small_k0()));
        assertEq(r, 0, "empty batch is harmless");
    }

    /// Exactly at the threshold escalates (>= is the boundary, consistent with
    /// the single-call path).
    function test_BatchExactlyAtThreshold_RequiresTwo() public {
        uint256 r = _validate(_ethBatch(2, 0.5 ether), _one(0, _v_small_k0()));
        assertEq(r, 1, "sum exactly equal to threshold must escalate");
    }

    /// Just under the threshold clears.
    function test_BatchJustUnderThreshold_OneSignature() public {
        uint256 r = _validate(
            _ethBatch(2, 0.5 ether - 1), _one(0, _v_small_k0())
        );
        assertEq(r, 0, "sum just under threshold should pass");
    }

    /// A large batch with two signatures executes.
    function test_LargeBatch_TwoSignatures() public {
        uint256 r = _validate(_ethBatch(11, 0.9 ether), _two());
        assertEq(r, 0, "large batch with 2 sigs should pass");
    }

    // ---------------------------------------------------------------- malformed

    /// Truncated executeBatch calldata must reject cleanly, not revert.
    function test_Attack_TruncatedBatchCalldata_Rejected() public {
        bytes memory cd = abi.encodePacked(
            PasskeyAccount.executeBatch.selector, bytes32(uint256(32))
        );
        uint256 r = _validate(cd, _one(0, _v_small_k0()));
        assertEq(r, 1, "truncated batch calldata must reject");
    }

    /// Wild array offsets must reject cleanly.
    function test_Attack_MalformedBatchOffsets_Rejected() public {
        bytes memory cd = abi.encodePacked(
            PasskeyAccount.executeBatch.selector,
            bytes32(type(uint256).max),
            bytes32(type(uint256).max),
            bytes32(type(uint256).max)
        );
        uint256 r = _validate(cd, _one(0, _v_small_k0()));
        assertEq(r, 1, "malformed batch offsets must reject");
    }

    /// executeBatch itself must reject mismatched array lengths at exec time.
    function test_ExecuteBatch_LengthMismatch_Reverts() public {
        address[] memory dests = new address[](2);
        uint256[] memory values = new uint256[](1);
        bytes[] memory funcs = new bytes[](2);

        vm.prank(ENTRYPOINT);
        vm.expectRevert(PasskeyAccount.LengthMismatch.selector);
        account.executeBatch(dests, values, funcs);
    }

    /// Only the EntryPoint may drive a batch.
    function test_Attack_DirectExecuteBatch_Reverts() public {
        address[] memory dests = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory funcs = new bytes[](1);

        vm.expectRevert(PasskeyAccount.NotEntryPoint.selector);
        account.executeBatch(dests, values, funcs);
    }

    /// A permit call hidden inside an otherwise small batch must escalate the entire batch.
    function test_Attack_PermitHiddenInBatch_Escalates() public {
        address[] memory dests = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory funcs = new bytes[](2);

        // Entry 0: small harmless transfer
        dests[0] = USDC;
        values[0] = 0;
        funcs[0] = abi.encodeWithSignature("transfer(address,uint256)", ATTACKER, 10e6);

        // Entry 1: EIP-2612 permit
        dests[1] = USDC;
        values[1] = 0;
        funcs[1] = abi.encodeWithSignature(
            "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
            address(account), ATTACKER, 1000e6, block.timestamp + 1000, 27, bytes32(0), bytes32(0)
        );

        bytes memory callData = abi.encodeCall(
            PasskeyAccount.executeBatch, (dests, values, funcs)
        );
        uint256 r = _validate(callData, _one(0, _v_small_k0()));
        assertEq(r, 1, "permit in batch must escalate entire batch");
    }

    /// decreaseAllowance hidden in batch must escalate the entire batch.
    function test_Attack_DecreaseAllowanceHiddenInBatch_Escalates() public {
        address[] memory dests = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory funcs = new bytes[](2);

        dests[0] = USDC;
        values[0] = 0;
        funcs[0] = abi.encodeWithSignature("transfer(address,uint256)", ATTACKER, 10e6);

        dests[1] = USDC;
        values[1] = 0;
        funcs[1] = abi.encodeWithSignature("decreaseAllowance(address,uint256)", ATTACKER, 10e6);

        bytes memory callData = abi.encodeCall(
            PasskeyAccount.executeBatch, (dests, values, funcs)
        );
        uint256 r = _validate(callData, _one(0, _v_small_k0()));
        assertEq(r, 1, "decreaseAllowance in batch must escalate entire batch");
    }

    /// Batch array offset smaller than 96 (pointing into static head) must reject.
    function test_Attack_BatchArrayOffset_TooSmall_Rejected() public {
        bytes memory callData = abi.encodePacked(
            PasskeyAccount.executeBatch.selector,
            bytes32(uint256(64)), // offset 1 < 96
            bytes32(uint256(128)),
            bytes32(uint256(192))
        );
        uint256 r = _validate(callData, _one(0, _v_small_k0()));
        assertEq(r, 1, "batch array offset pointing inside head must reject");
    }

    // ------------------------------------------------------------------- gas

    function test_Gas_BatchValidation() public {
        uint256 before = gasleft();
        _validate(_ethBatch(16, 0.001 ether), _one(0, _v_small_k0()));
        console.log("validateUserOp, 16-entry batch, gas:", before - gasleft());
    }

    // --------------------------------------------------------------- fuzzing

    /// No split of a total >= threshold may ever clear with one signature.
    function testFuzz_SplitETH_NeverBypasses(uint8 parts, uint96 each) public {
        parts = uint8(bound(parts, 1, 16));
        each = uint96(bound(each, 1, 1 ether));

        uint256 total = uint256(parts) * uint256(each);
        uint256 r = _validate(_ethBatch(parts, each), _one(0, _v_small_k0()));

        if (total >= THRESHOLD) {
            assertEq(r, 1, "any batch summing over threshold must escalate");
        } else {
            assertEq(r, 0, "batch under threshold should clear");
        }
    }

    /// Same invariant for tokens.
    function testFuzz_SplitERC20_NeverBypasses(uint8 parts, uint96 each) public {
        parts = uint8(bound(parts, 1, 16));
        each = uint96(bound(each, 1, 1000e6));

        uint256 total = uint256(parts) * uint256(each);
        uint256 r = _validate(_tokenBatch(USDC, parts, each), _one(0, _v_small_k0()));

        if (total >= 1000e6) {
            assertEq(r, 1, "token batch over threshold must escalate");
        } else {
            assertEq(r, 0, "token batch under threshold should clear");
        }
    }
}
