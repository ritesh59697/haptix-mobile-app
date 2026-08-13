// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {PasskeyAccount} from "../src/PasskeyAccount.sol";

/// @notice Deploys PasskeyAccount to Base Sepolia with Ritesh's real Touch ID
///         passkey as signer 0.
///
/// @dev Run:
///        forge script script/Deploy.s.sol:Deploy \
///          --rpc-url https://sepolia.base.org \
///          --account <keystore-name> \
///          --broadcast
///
///      The constructor only sets signer 0 and the per-op ETH threshold. The
///      rolling windows and token thresholds are `onlySelf`, so they cannot be
///      configured from a script -- they require a UserOp through the
///      EntryPoint, signed by the passkey. See ConfigureCalldata below, which
///      prints the calldata you would submit to do that.
contract Deploy is Script {
    /// EntryPoint v0.7 -- verified live on Base Sepolia (codesize 16035).
    address constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    /// Signer 0 -- passkey "alpha".
    /// Signer 1 -- passkey "beta".
    ///
    /// Deliberately distinct labels: an earlier account used "signer-1" and
    /// "signer-2", which the macOS/Chrome credential picker presented
    /// indistinguishably, so three separate signing attempts silently used the
    /// wrong key. Both points below were checked to satisfy
    /// y^2 = x^3 - 3x + b over the P-256 field.
    uint256 constant SIGNER0_X =
        0xa3b99c51ae83035154e9aaf7b23b4bb2dcd37721dfb8a1dc10ab204d4b3a6801;
    uint256 constant SIGNER0_Y =
        0x9afd5a1669db77182bb11bf8f08456643914de2451a3bf79de98fcafb0cabc3d;

    uint256 constant SIGNER1_X =
        0xe674161f196651a12baec4a98706b5ea424f21104b5bf793f75cbdfee531828b;
    uint256 constant SIGNER1_Y =
        0xd19ebbc657185048e777880b61a909ad683c1ee61df458fd707a802de8a9557e;

    /// Per-op ETH threshold: above this, a second passkey is required.
    uint256 constant ETH_THRESHOLD = 0.01 ether;

    function run() external {
        require(block.chainid == 84532, "not Base Sepolia");

        // Both signers are enrolled at construction. With only one, the account
        // could never be configured -- config calls take the 2-signature quorum,
        // including the addSigner call that would enrol the second key.
        PasskeyAccount.PublicKey[] memory initial =
            new PasskeyAccount.PublicKey[](2);
        initial[0] = PasskeyAccount.PublicKey(SIGNER0_X, SIGNER0_Y);
        initial[1] = PasskeyAccount.PublicKey(SIGNER1_X, SIGNER1_Y);

        vm.startBroadcast();

        PasskeyAccount account = new PasskeyAccount(
            ENTRYPOINT, initial, ETH_THRESHOLD
        );

        vm.stopBroadcast();

        console.log("");
        console.log("=== PasskeyAccount deployed ===");
        console.log("address:      ", address(account));
        console.log("entryPoint:   ", account.entryPoint());
        console.log("signerCount:  ", account.signerCount());
        console.log("threshold:    ", account.threshold());
        console.log("");
        console.log("Explorer: https://sepolia.basescan.org/address/%s", address(account));
        console.log("");
        console.log("NOTE: rolling windows are NOT configured. They are onlySelf,");
        console.log("so they require a UserOp signed by the passkey. Run");
        console.log("script/Configure.s.sol to print that calldata.");
    }
}

/// @notice Prints the calldata for the `onlySelf` configuration calls.
/// @dev These cannot be broadcast directly -- that is the point of onlySelf.
///      Each must travel through validateUserOp as a UserOp, and because they
///      are not `execute` calls, _requiredSignatures gives them the full
///      2-signature quorum. With only one passkey enrolled, they cannot be
///      executed at all until a second signer is added.
contract ConfigureCalldata is Script {
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e; // Base Sepolia USDC

    function run() external pure {
        console.log("=== onlySelf configuration calldata ===");
        console.log("");
        console.log("Each of these must be submitted as a UserOp and requires");
        console.log("TWO passkey signatures (they are not `execute` calls).");
        console.log("");

        console.log("setWindow(ETH, 0.05 ether, 1 day):");
        console.logBytes(
            abi.encodeWithSignature(
                "setWindow(address,uint256,uint256)",
                address(0), uint256(0.05 ether), uint256(1 days)
            )
        );
        console.log("");

        console.log("setTokenThreshold(USDC, 100e6):");
        console.logBytes(
            abi.encodeWithSignature(
                "setTokenThreshold(address,uint256)", USDC, uint256(100e6)
            )
        );
        console.log("");

        console.log("setWindow(USDC, 500e6, 1 day):");
        console.logBytes(
            abi.encodeWithSignature(
                "setWindow(address,uint256,uint256)",
                USDC, uint256(500e6), uint256(1 days)
            )
        );
    }
}
