// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {PasskeyAccount} from "../src/PasskeyAccount.sol";

interface IEntryPoint {
    struct PackedUserOperation {
        address sender;
        uint256 nonce;
        bytes initCode;
        bytes callData;
        bytes32 accountGasLimits;
        uint256 preVerificationGas;
        bytes32 gasFees;
        bytes paymasterAndData;
        bytes signature;
    }
    function getUserOpHash(PackedUserOperation calldata userOp)
        external view returns (bytes32);
    function getNonce(address sender, uint192 key)
        external view returns (uint256);
}

/// @notice Computes the UserOp hash for setWindow(ETH, 0.05 ether, 1 day).
///
/// @dev setWindow is `onlySelf` and is NOT an `execute` call, so
///      _requiredSignatures gives it the full 2-signature quorum. Both alpha
///      and beta must sign this exact hash.
///
///      Verification gas is higher than a plain transfer: two P-256
///      verifications instead of one, ~110k each.
contract ConfigureWindow is Script {
    address constant ACCOUNT = 0x34Aeb3A39fd1838D1C897F879EAB0a258507802c;
    address constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    uint128 constant VERIFICATION_GAS = 400_000; // 2x P-256 verify
    uint128 constant CALL_GAS = 60_000;
    uint256 constant PRE_VERIFICATION_GAS = 60_000;

    function buildOp() public view returns (IEntryPoint.PackedUserOperation memory op) {
        op = IEntryPoint.PackedUserOperation({
            sender: ACCOUNT,
            nonce: IEntryPoint(ENTRYPOINT).getNonce(ACCOUNT, 0),
            initCode: "",
            // MUST be wrapped in execute(). setWindow is `onlySelf`, so it
            // requires msg.sender == the account. Calling it directly from a
            // UserOp makes msg.sender the ENTRYPOINT, which reverts NotSelf()
            // -- validation passes, both signatures are accepted, and then the
            // inner call fails with UserOperationEvent.success = false while
            // the account still pays gas. Routing through execute() makes the
            // account call itself.
            callData: abi.encodeCall(
                PasskeyAccount.execute,
                (ACCOUNT, 0, abi.encodeCall(
                    PasskeyAccount.setWindow, (address(0), 0.05 ether, 1 days, 18)
                ))
            ),
            accountGasLimits: bytes32(
                (uint256(VERIFICATION_GAS) << 128) | uint256(CALL_GAS)
            ),
            preVerificationGas: PRE_VERIFICATION_GAS,
            gasFees: bytes32((uint256(0.05 gwei) << 128) | uint256(0.2 gwei)),
            paymasterAndData: "",
            signature: ""
        });
    }

    function run() external view {
        IEntryPoint.PackedUserOperation memory op = buildOp();
        bytes32 h = IEntryPoint(ENTRYPOINT).getUserOpHash(op);

        console.log("=== setWindow(ETH, 0.05 ether, 1 day) ===");
        console.log("sender:", op.sender);
        console.log("nonce: ", op.nonce);
        console.log("");
        console.log("prefund required (wei):",
            (uint256(VERIFICATION_GAS) + CALL_GAS + PRE_VERIFICATION_GAS) * 0.2 gwei);
        console.log("account balance  (wei):", ACCOUNT.balance);
        console.log("");
        console.log("=== SIGN THIS HASH WITH *BOTH* ALPHA AND BETA ===");
        console.logBytes32(h);
    }
}
