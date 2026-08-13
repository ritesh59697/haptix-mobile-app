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
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Builds the UserOp and asks the EntryPoint for its hash.
///
/// @dev The hash is computed BY THE ENTRYPOINT (`getUserOpHash`) rather than
///      reimplemented here. The v0.7 hash binds the packed op, the EntryPoint
///      address, and chainId; hand-rolling that packing is the single most
///      common way a first UserOp fails, and the failure looks like an
///      unhelpful "AA24 signature error" rather than anything diagnostic.
///
///      Run:
///        forge script script/BuildUserOp.s.sol:BuildUserOp \
///          --rpc-url https://sepolia.base.org
contract BuildUserOp is Script {
    address constant ACCOUNT = 0x34Aeb3A39fd1838D1C897F879EAB0a258507802c;
    address constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address constant RECIPIENT = 0x22db962929afe98d0269De0BAa6c442A3Aa6913D;

    uint256 constant SEND_VALUE = 0.0001 ether; // below the 0.01 threshold

    /// @dev accountGasLimits packs verificationGasLimit (high 128) and
    ///      callGasLimit (low 128). Verification must cover a P-256 precompile
    ///      call plus the policy checks -- measured at 109k on-chain, so 200k
    ///      leaves headroom without over-inflating the prefund.
    ///
    ///      The EntryPoint requires the account to prefund
    ///      (verificationGas + callGas + preVerificationGas) * maxFeePerGas
    ///      BEFORE execution, refunding the unused part afterwards. Generous
    ///      limits therefore demand a large up-front balance: 400k/100k/100k at
    ///      2 gwei needed 0.0012 ETH and failed with "AA21 didn't pay prefund",
    ///      even though the op actually costs a fraction of that. Base Sepolia's
    ///      base fee is ~0.005 gwei, so 0.2 gwei is already generous.
    uint128 constant VERIFICATION_GAS = 200_000;
    uint128 constant CALL_GAS = 60_000;
    uint256 constant PRE_VERIFICATION_GAS = 60_000;

    function run() external view {
        uint256 nonce = IEntryPoint(ENTRYPOINT).getNonce(ACCOUNT, 0);

        // gasFees packs maxPriorityFeePerGas (high 128) | maxFeePerGas (low 128)
        uint128 maxPriorityFee = 0.05 gwei;
        uint128 maxFee = 0.2 gwei;

        IEntryPoint.PackedUserOperation memory op = IEntryPoint.PackedUserOperation({
            sender: ACCOUNT,
            nonce: nonce,
            initCode: "",
            callData: abi.encodeCall(
                PasskeyAccount.execute, (RECIPIENT, SEND_VALUE, "")
            ),
            accountGasLimits: bytes32(
                (uint256(VERIFICATION_GAS) << 128) | uint256(CALL_GAS)
            ),
            preVerificationGas: PRE_VERIFICATION_GAS,
            gasFees: bytes32(
                (uint256(maxPriorityFee) << 128) | uint256(maxFee)
            ),
            paymasterAndData: "",
            signature: "" // hash is computed over an EMPTY signature
        });

        bytes32 userOpHash = IEntryPoint(ENTRYPOINT).getUserOpHash(op);

        console.log("=== UserOp ===");
        console.log("sender:  ", op.sender);
        console.log("nonce:   ", op.nonce);
        console.log("value:   ", SEND_VALUE);
        console.log("to:      ", RECIPIENT);
        console.log("");
        console.log("callData:");
        console.logBytes(op.callData);
        console.log("");
        console.log("accountGasLimits:");
        console.logBytes32(op.accountGasLimits);
        console.log("gasFees:");
        console.logBytes32(op.gasFees);
        console.log("");
        console.log("=== SIGN THIS HASH WITH YOUR PASSKEY ===");
        console.logBytes32(userOpHash);
        console.log("");
        console.log("Paste it into web/index.html step 2, sign with signer-1,");
        console.log("then hand back authenticatorData / clientDataJSON / r / s.");
        console.log("");
        console.log("account balance: ", ACCOUNT.balance);
        console.log("EP deposit:      ", IEntryPoint(ENTRYPOINT).balanceOf(ACCOUNT));
    }
}
