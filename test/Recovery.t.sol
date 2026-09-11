// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {PasskeyAccount, PackedUserOperation} from "../src/PasskeyAccount.sol";
import {WebAuthn} from "../src/WebAuthn.sol";
import {Vectors} from "./Vectors.sol";

contract RecoveryTest is Test, Vectors {
    PasskeyAccount account;

    address constant ENTRYPOINT = address(0xE);
    address constant GUARDIAN = address(0x900D);
    address constant STRANGER = address(0xDEAD);
    uint48 constant TIMELOCK = 2 days;
    bytes32 constant H_SMALL = bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111));

    // Additional P-256 test vectors for replacement keys
    uint256 constant NEW_K0_X = 0x2222222222222222222222222222222222222222222222222222222222222222;
    uint256 constant NEW_K0_Y = 0x3333333333333333333333333333333333333333333333333333333333333333;
    uint256 constant NEW_K1_X = 0x4444444444444444444444444444444444444444444444444444444444444444;
    uint256 constant NEW_K1_Y = 0x5555555555555555555555555555555555555555555555555555555555555555;

    function setUp() public {
        account = new PasskeyAccount(ENTRYPOINT, _signers2(K0_X, K0_Y, K1_X, K1_Y), 1 ether);
        vm.deal(address(account), 10 ether);

        // Configure GUARDIAN via onlySelf
        vm.prank(address(account));
        account.setGuardian(GUARDIAN, TIMELOCK);
    }

    function _newSigners2() internal pure returns (PasskeyAccount.PublicKey[] memory) {
        PasskeyAccount.PublicKey[] memory s = new PasskeyAccount.PublicKey[](2);
        s[0] = PasskeyAccount.PublicKey(NEW_K0_X, NEW_K0_Y);
        s[1] = PasskeyAccount.PublicKey(NEW_K1_X, NEW_K1_Y);
        return s;
    }

    function _one(uint256 id, WebAuthn.Signature memory s)
        internal pure returns (bytes memory)
    {
        uint256[] memory ids = new uint256[](1);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](1);
        ids[0] = id; sigs[0] = s;
        return abi.encode(ids, sigs);
    }

    // -----------------------------------------------------------------------
    // Configuration Tests
    // -----------------------------------------------------------------------

    function test_SetGuardian_OnlySelf_DirectCallReverts() public {
        vm.prank(STRANGER);
        vm.expectRevert(PasskeyAccount.NotSelf.selector);
        account.setGuardian(STRANGER, TIMELOCK);
    }

    function test_SetGuardian_InvalidTimelock_Reverts() public {
        vm.prank(address(account));
        vm.expectRevert(PasskeyAccount.InvalidTimelock.selector);
        account.setGuardian(GUARDIAN, 12 hours); // below 1 day minimum
    }

    function test_SetGuardian_CanDisableWithZeroAddress() public {
        vm.prank(address(account));
        account.setGuardian(address(0), 0);
        assertEq(account.guardian(), address(0));
    }

    // -----------------------------------------------------------------------
    // Recovery Initiation Tests
    // -----------------------------------------------------------------------

    function test_InitiateRecovery_Stranger_Reverts() public {
        PasskeyAccount.PublicKey[] memory newKeys = _newSigners2();
        vm.prank(STRANGER);
        vm.expectRevert(PasskeyAccount.NotGuardian.selector);
        account.initiateRecovery(newKeys);
    }

    function test_InitiateRecovery_FewerThanTwoSigners_Reverts() public {
        PasskeyAccount.PublicKey[] memory singleKey = new PasskeyAccount.PublicKey[](1);
        singleKey[0] = PasskeyAccount.PublicKey(NEW_K0_X, NEW_K0_Y);

        vm.prank(GUARDIAN);
        vm.expectRevert(PasskeyAccount.MinSignersRequired.selector);
        account.initiateRecovery(singleKey);
    }

    function test_InitiateRecovery_InvalidPublicKey_Reverts() public {
        PasskeyAccount.PublicKey[] memory badKeys = new PasskeyAccount.PublicKey[](2);
        badKeys[0] = PasskeyAccount.PublicKey(0, NEW_K0_Y); // zero X
        badKeys[1] = PasskeyAccount.PublicKey(NEW_K1_X, NEW_K1_Y);

        vm.prank(GUARDIAN);
        vm.expectRevert(PasskeyAccount.InvalidPublicKey.selector);
        account.initiateRecovery(badKeys);
    }

    function test_InitiateRecovery_DuplicateKeys_Reverts() public {
        PasskeyAccount.PublicKey[] memory dupKeys = new PasskeyAccount.PublicKey[](2);
        dupKeys[0] = PasskeyAccount.PublicKey(NEW_K0_X, NEW_K0_Y);
        dupKeys[1] = PasskeyAccount.PublicKey(NEW_K0_X, NEW_K0_Y);

        vm.prank(GUARDIAN);
        vm.expectRevert(PasskeyAccount.DuplicateSigner.selector);
        account.initiateRecovery(dupKeys);
    }

    function test_InitiateRecovery_Success() public {
        PasskeyAccount.PublicKey[] memory newKeys = _newSigners2();

        vm.prank(GUARDIAN);
        account.initiateRecovery(newKeys);

        (uint48 executeAfter, bool active, bytes32 signersHash) = account.pendingRecovery();
        assertTrue(active);
        assertEq(executeAfter, uint48(block.timestamp + TIMELOCK));
        assertEq(signersHash, keccak256(abi.encode(newKeys)));
    }

    function test_InitiateRecovery_AlreadyPending_Reverts() public {
        PasskeyAccount.PublicKey[] memory newKeys = _newSigners2();

        vm.prank(GUARDIAN);
        account.initiateRecovery(newKeys);

        vm.prank(GUARDIAN);
        vm.expectRevert(PasskeyAccount.RecoveryPending.selector);
        account.initiateRecovery(newKeys);
    }

    // -----------------------------------------------------------------------
    // Recovery Execution Tests
    // -----------------------------------------------------------------------

    function test_CompleteRecovery_NoActiveRecovery_Reverts() public {
        PasskeyAccount.PublicKey[] memory newKeys = _newSigners2();
        vm.expectRevert(PasskeyAccount.NoActiveRecovery.selector);
        account.completeRecovery(newKeys);
    }

    function test_CompleteRecovery_TimelockNotExpired_Reverts() public {
        PasskeyAccount.PublicKey[] memory newKeys = _newSigners2();
        vm.prank(GUARDIAN);
        account.initiateRecovery(newKeys);

        // Advance 1 day (timelock is 2 days)
        vm.warp(block.timestamp + 1 days);

        vm.expectRevert(PasskeyAccount.TimelockNotExpired.selector);
        account.completeRecovery(newKeys);
    }

    function test_CompleteRecovery_SignersHashMismatch_Reverts() public {
        PasskeyAccount.PublicKey[] memory newKeys = _newSigners2();
        vm.prank(GUARDIAN);
        account.initiateRecovery(newKeys);

        vm.warp(block.timestamp + TIMELOCK + 1);

        // Try to complete with different keys
        PasskeyAccount.PublicKey[] memory tamperedKeys = new PasskeyAccount.PublicKey[](2);
        tamperedKeys[0] = PasskeyAccount.PublicKey(NEW_K0_X, NEW_K0_Y);
        tamperedKeys[1] = PasskeyAccount.PublicKey(0x9999, 0x8888);

        vm.expectRevert(PasskeyAccount.SignersHashMismatch.selector);
        account.completeRecovery(tamperedKeys);
    }

    function test_CompleteRecovery_FrozenAccount_Reverts() public {
        PasskeyAccount.PublicKey[] memory newKeys = _newSigners2();
        vm.prank(GUARDIAN);
        account.initiateRecovery(newKeys);

        vm.warp(block.timestamp + TIMELOCK + 1);

        // Owner detects and freezes account
        vm.prank(address(account));
        account.freeze();

        vm.expectRevert(PasskeyAccount.AccountIsFrozen.selector);
        account.completeRecovery(newKeys);
    }

    function test_CompleteRecovery_Success() public {
        PasskeyAccount.PublicKey[] memory newKeys = _newSigners2();
        vm.prank(GUARDIAN);
        account.initiateRecovery(newKeys);

        // Fast-forward past timelock
        vm.warp(block.timestamp + TIMELOCK + 10);

        account.completeRecovery(newKeys);

        // Verify old signers wiped and new installed
        assertEq(account.signerCount(), 2);
        (uint256 x0, uint256 y0) = account.signers(0);
        (uint256 x1, uint256 y1) = account.signers(1);
        assertEq(x0, NEW_K0_X);
        assertEq(y0, NEW_K0_Y);
        assertEq(x1, NEW_K1_X);
        assertEq(y1, NEW_K1_Y);

        // Pending recovery cleaned up
        (, bool active,) = account.pendingRecovery();
        assertFalse(active);
    }

    // -----------------------------------------------------------------------
    // Cancellation Tests
    // -----------------------------------------------------------------------

    function test_CancelRecovery_ByAccount_Success() public {
        PasskeyAccount.PublicKey[] memory newKeys = _newSigners2();
        vm.prank(GUARDIAN);
        account.initiateRecovery(newKeys);

        // Account cancels via onlySelf
        vm.prank(address(account));
        account.cancelRecovery();

        (, bool active,) = account.pendingRecovery();
        assertFalse(active);
    }

    function test_CancelRecovery_ByGuardian_Success() public {
        PasskeyAccount.PublicKey[] memory newKeys = _newSigners2();
        vm.prank(GUARDIAN);
        account.initiateRecovery(newKeys);

        vm.prank(GUARDIAN);
        account.cancelRecovery();

        (, bool active,) = account.pendingRecovery();
        assertFalse(active);
    }

    function test_CancelRecovery_Unauthorized_Reverts() public {
        PasskeyAccount.PublicKey[] memory newKeys = _newSigners2();
        vm.prank(GUARDIAN);
        account.initiateRecovery(newKeys);

        vm.prank(STRANGER);
        vm.expectRevert(PasskeyAccount.NotSelf.selector);
        account.cancelRecovery();
    }

    function test_CancelRecovery_NoActive_Reverts() public {
        vm.prank(address(account));
        vm.expectRevert(PasskeyAccount.NoActiveRecovery.selector);
        account.cancelRecovery();
    }

    function test_SetGuardian_CancelsPendingRecovery() public {
        PasskeyAccount.PublicKey[] memory newKeys = _newSigners2();
        vm.prank(GUARDIAN);
        account.initiateRecovery(newKeys);

        // Setting a new guardian cancels the previous pending recovery
        vm.prank(address(account));
        account.setGuardian(address(0xAAAA), 3 days);

        assertEq(account.guardian(), address(0xAAAA));
        assertEq(account.recoveryTimelock(), 3 days);
        (, bool active,) = account.pendingRecovery();
        assertFalse(active);
    }

    // -----------------------------------------------------------------------
    // 1-Signature Emergency Policy Test
    // -----------------------------------------------------------------------

    function test_EmergencyCancel_OneSignatureUserOp() public {
        // Construct UserOp calldata calling execute(address(account), 0, cancelRecovery.selector)
        bytes memory cancelCalldata = abi.encodeWithSelector(PasskeyAccount.cancelRecovery.selector);
        bytes memory executeCalldata = abi.encodeWithSelector(
            PasskeyAccount.execute.selector,
            address(account),
            uint256(0),
            cancelCalldata
        );

        PackedUserOperation memory userOp;
        userOp.sender = address(account);
        userOp.callData = executeCalldata;

        // Use valid single-signature vector for small op
        userOp.signature = _one(0, _v_small_k0());

        // Call validateUserOp through ENTRYPOINT
        vm.prank(ENTRYPOINT);
        uint256 val = account.validateUserOp(userOp, H_SMALL, 0);
        assertEq(uint160(val), 0, "Emergency cancelRecovery MUST succeed with a single passkey signature");
    }
}
