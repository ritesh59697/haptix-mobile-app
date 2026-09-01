// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {PasskeyAccount, PackedUserOperation} from "../src/PasskeyAccount.sol";
import {WebAuthn} from "../src/WebAuthn.sol";
import {Vectors} from "./Vectors.sol";

contract SecurityHardeningTest is Test, Vectors {
    PasskeyAccount account;

    address constant ENTRYPOINT = address(0xE);
    address constant RECIPIENT = address(0xBEEF);
    address constant HACKER_DEST = address(0xDEAD);
    uint256 constant THRESHOLD = 1 ether;

    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    bytes32 constant H_SMALL = bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111));
    bytes32 constant H_LARGE = bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222));

    function setUp() public {
        account = new PasskeyAccount(ENTRYPOINT, _signers2(K0_X, K0_Y, K1_X, K1_Y), THRESHOLD);
        vm.deal(address(account), 100 ether);
    }

    function _one(uint256 id, WebAuthn.Signature memory s) internal pure returns (bytes memory) {
        uint256[] memory ids = new uint256[](1);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](1);
        ids[0] = id; sigs[0] = s;
        return abi.encode(ids, sigs);
    }

    function _two(
        uint256 a, WebAuthn.Signature memory sa,
        uint256 b, WebAuthn.Signature memory sb
    ) internal pure returns (bytes memory) {
        uint256[] memory ids = new uint256[](2);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](2);
        ids[0] = a; sigs[0] = sa;
        ids[1] = b; sigs[1] = sb;
        return abi.encode(ids, sigs);
    }

    function _buildOp(bytes memory callData, bytes memory signature)
        internal view returns (PackedUserOperation memory)
    {
        return PackedUserOperation({
            sender: address(account),
            nonce: 0,
            initCode: "",
            callData: callData,
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: "",
            signature: signature
        });
    }

    // =========================================================================
    // 1. Emergency 1-Signature Panic Freeze Switch
    // =========================================================================

    function test_EmergencyFreeze_OneSig_Success() public {
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute,
            (address(account), 0, abi.encodeCall(PasskeyAccount.freeze, ()))
        );

        PackedUserOperation memory op = _buildOp(callData, _one(0, _v_small_k0()));
        vm.prank(ENTRYPOINT);
        uint256 res = account.validateUserOp(op, H_SMALL, 0);
        assertEq(res, 0, "1-sig emergency freeze UserOp must validate successfully");

        vm.prank(ENTRYPOINT);
        account.execute(address(account), 0, abi.encodeCall(PasskeyAccount.freeze, ()));
        assertTrue(account.isFrozen(), "Account must be frozen");
    }

    function test_FrozenAccount_SmallTransfer_SingleSignature_Rejected() public {
        vm.prank(ENTRYPOINT);
        account.execute(address(account), 0, abi.encodeCall(PasskeyAccount.freeze, ()));
        assertTrue(account.isFrozen());

        bytes memory callData = abi.encodeCall(PasskeyAccount.execute, (RECIPIENT, 0.1 ether, ""));
        PackedUserOperation memory op = _buildOp(callData, _one(0, _v_small_k0()));

        vm.prank(ENTRYPOINT);
        uint256 res = account.validateUserOp(op, H_SMALL, 0);
        assertEq(res, 1, "Frozen account must reject single-signature transfer");
    }

    function test_FrozenAccount_SmallTransfer_TwoSignatures_Succeeds() public {
        vm.prank(ENTRYPOINT);
        account.execute(address(account), 0, abi.encodeCall(PasskeyAccount.freeze, ()));

        bytes memory callData = abi.encodeCall(PasskeyAccount.execute, (RECIPIENT, 0.1 ether, ""));
        PackedUserOperation memory op = _buildOp(callData, _two(0, _v_large_k0(), 1, _v_large_k1()));

        vm.prank(ENTRYPOINT);
        uint256 res = account.validateUserOp(op, H_LARGE, 0);
        assertEq(res, 0, "Frozen account allows 2-of-2 Quorum operations");
    }

    function test_FrozenAccount_Unfreeze_RequiresTwoSignatures() public {
        vm.prank(ENTRYPOINT);
        account.execute(address(account), 0, abi.encodeCall(PasskeyAccount.freeze, ()));

        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute,
            (address(account), 0, abi.encodeCall(PasskeyAccount.unfreeze, ()))
        );
        PackedUserOperation memory op1 = _buildOp(callData, _one(0, _v_small_k0()));
        vm.prank(ENTRYPOINT);
        uint256 res1 = account.validateUserOp(op1, H_SMALL, 0);
        assertEq(res1, 1, "Unfreeze must reject 1-signature");

        PackedUserOperation memory op2 = _buildOp(callData, _two(0, _v_large_k0(), 1, _v_large_k1()));
        vm.prank(ENTRYPOINT);
        uint256 res2 = account.validateUserOp(op2, H_LARGE, 0);
        assertEq(res2, 0, "Unfreeze must validate with 2-of-2 Quorum");

        vm.prank(ENTRYPOINT);
        account.execute(address(account), 0, abi.encodeCall(PasskeyAccount.unfreeze, ()));
        assertFalse(account.isFrozen(), "Account should be unfrozen");
    }

    // =========================================================================
    // 2. Recipient Allowlist (Address Book Firewall)
    // =========================================================================

    function test_Allowlist_WhenDisabled_UnknownRecipient_OneSig() public {
        assertFalse(account.allowlistEnabled());

        bytes memory callData = abi.encodeCall(PasskeyAccount.execute, (HACKER_DEST, 0.1 ether, ""));
        PackedUserOperation memory op = _buildOp(callData, _one(0, _v_small_k0()));

        vm.prank(ENTRYPOINT);
        uint256 res = account.validateUserOp(op, H_SMALL, 0);
        assertEq(res, 0, "When allowlist disabled, sub-threshold transfer clears with 1 sig");
    }

    function test_Allowlist_WhenEnabled_UnknownRecipient_SingleSig_Rejected() public {
        vm.prank(address(account));
        account.setAllowlistEnabled(true);
        vm.prank(address(account));
        account.setAllowedRecipient(RECIPIENT, true);

        bytes memory callData = abi.encodeCall(PasskeyAccount.execute, (HACKER_DEST, 0.1 ether, ""));
        PackedUserOperation memory op = _buildOp(callData, _one(0, _v_small_k0()));

        vm.prank(ENTRYPOINT);
        uint256 res = account.validateUserOp(op, H_SMALL, 0);
        assertEq(res, 1, "Non-allowlisted recipient must be rejected with 1 signature");
    }

    function test_Allowlist_WhenEnabled_WhitelistedRecipient_OneSig_Succeeds() public {
        vm.prank(address(account));
        account.setAllowlistEnabled(true);
        vm.prank(address(account));
        account.setAllowedRecipient(RECIPIENT, true);

        bytes memory callData = abi.encodeCall(PasskeyAccount.execute, (RECIPIENT, 0.1 ether, ""));
        PackedUserOperation memory op = _buildOp(callData, _one(0, _v_small_k0()));

        vm.prank(ENTRYPOINT);
        uint256 res = account.validateUserOp(op, H_SMALL, 0);
        assertEq(res, 0, "Whitelisted recipient clears sub-threshold with 1 signature");
    }

    function test_Allowlist_WhenEnabled_UnknownRecipient_TwoSig_Succeeds() public {
        vm.prank(address(account));
        account.setAllowlistEnabled(true);

        bytes memory callData = abi.encodeCall(PasskeyAccount.execute, (HACKER_DEST, 0.1 ether, ""));
        PackedUserOperation memory op = _buildOp(callData, _two(0, _v_large_k0(), 1, _v_large_k1()));

        vm.prank(ENTRYPOINT);
        uint256 res = account.validateUserOp(op, H_LARGE, 0);
        assertEq(res, 0, "Non-whitelisted recipient succeeds when authorized by 2-of-2 Quorum");
    }

    function test_Allowlist_ERC20Transfer_ChecksInnerRecipient() public {
        vm.prank(address(account));
        account.setTokenThreshold(USDC, 100e6, 6);

        vm.prank(address(account));
        account.setAllowlistEnabled(true);
        vm.prank(address(account));
        account.setAllowedRecipient(RECIPIENT, true);

        bytes memory erc20Call = abi.encodeWithSelector(
            bytes4(0xa9059cbb),
            HACKER_DEST,
            10e6
        );
        bytes memory callData = abi.encodeCall(PasskeyAccount.execute, (USDC, 0, erc20Call));

        PackedUserOperation memory op = _buildOp(callData, _one(0, _v_small_k0()));
        vm.prank(ENTRYPOINT);
        uint256 res = account.validateUserOp(op, H_SMALL, 0);
        assertEq(res, 1, "ERC20 transfer to non-allowlisted address must be rejected with 1 sig");

        bytes memory validErc20 = abi.encodeWithSelector(
            bytes4(0xa9059cbb),
            RECIPIENT,
            10e6
        );
        bytes memory validCallData = abi.encodeCall(PasskeyAccount.execute, (USDC, 0, validErc20));
        PackedUserOperation memory validOp = _buildOp(validCallData, _one(0, _v_small_k0()));
        vm.prank(ENTRYPOINT);
        uint256 validRes = account.validateUserOp(validOp, H_SMALL, 0);
        assertEq(validRes, 0, "ERC20 transfer to whitelisted address clears with 1 sig");
    }

    function test_Allowlist_Batch_AnyUnknownRecipient_Escalates() public {
        vm.prank(address(account));
        account.setAllowlistEnabled(true);
        vm.prank(address(account));
        account.setAllowedRecipient(RECIPIENT, true);

        address[] memory dests = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory funcs = new bytes[](2);

        dests[0] = RECIPIENT; values[0] = 0.01 ether; funcs[0] = "";
        dests[1] = HACKER_DEST; values[1] = 0.01 ether; funcs[1] = "";

        bytes memory batchCalldata = abi.encodeCall(PasskeyAccount.executeBatch, (dests, values, funcs));
        PackedUserOperation memory op = _buildOp(batchCalldata, _one(0, _v_small_k0()));

        vm.prank(ENTRYPOINT);
        uint256 res = account.validateUserOp(op, H_SMALL, 0);
        assertEq(res, 1, "Batch containing unapproved recipient must escalate to Quorum and reject 1 sig");
    }
}
