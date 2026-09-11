// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {PasskeyAccount} from "../src/PasskeyAccount.sol";
import {PasskeyAccountFactory} from "../src/PasskeyAccountFactory.sol";

/// @notice Deploys PasskeyAccount to Base Sepolia with Ritesh's real Touch ID
///         passkey as signer 0.
///
/// @dev Run:
///        forge script script/Deploy.s.sol:Deploy \
///          --rpc-url https://sepolia.base.org \
///          --account <keystore-name> \
///          --broadcast
///
///      The constructor requires BOTH signers up front (minimum 2 signers)
///      and the per-op ETH threshold. Rolling windows and token thresholds are `onlySelf`,
///      so they require a UserOp through the EntryPoint, signed by both passkeys.
contract Deploy is Script {
    /// EntryPoint v0.7 -- verified live on Base Sepolia (codesize 16035).
    address constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    /// Signer 0 -- fresh Chrome Browser Profile passkey
    /// Signer 1 -- fresh iCloud Keychain passkey
    uint256 constant SIGNER0_X =
        0xae5316b13623a2e70ed4cf6e3fe5356eeea7fe05a18ba0f86a66d3dfc9a8d826;
    uint256 constant SIGNER0_Y =
        0x19c60579b3b5d02a6cfe835ac591bcff782355bdc03b2f5aa29b48a784a4b52d;

    uint256 constant SIGNER1_X =
        0xa93626e906df62e77f7f3ed41dcbe0145f02a1d684a771d3f8e10350a536daa8;
    uint256 constant SIGNER1_Y =
        0x6c3bbdc0764ed1da9890ed719306d0c909e231a13fd0be53e88be740380e02fa;

    /// Per-op ETH threshold: above this, a second passkey is required.
    uint256 constant ETH_THRESHOLD = 0.01 ether;

    function run() external {
        require(block.chainid == 84532, "not Base Sepolia");

        // Both fresh signers enrolled at construction
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
    }
}

/// @notice Computes counterfactual CREATE2 account address before deployment.
contract ComputeCounterfactualAddress is Script {
    address constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external {
        PasskeyAccount.PublicKey[] memory dummy = new PasskeyAccount.PublicKey[](2);
        dummy[0] = PasskeyAccount.PublicKey(1, 2);
        dummy[1] = PasskeyAccount.PublicKey(3, 4);
        PasskeyAccount implementation = new PasskeyAccount(ENTRYPOINT, dummy, type(uint256).max);
        PasskeyAccountFactory factory = new PasskeyAccountFactory(address(implementation));
        PasskeyAccount.PublicKey memory p0 = PasskeyAccount.PublicKey(
            0xa3b99c51ae83035154e9aaf7b23b4bb2dcd37721dfb8a1dc10ab204d4b3a6801,
            0x9afd5a1669db77182bb11bf8f08456643914de2451a3bf79de98fcafb0cabc3d
        );
        PasskeyAccount.PublicKey memory p1 = PasskeyAccount.PublicKey(
            0xe674161f196651a12baec4a98706b5ea424f21104b5bf793f75cbdfee531828b,
            0xd19ebbc657185048e777880b61a909ad683c1ee61df458fd707a802de8a9557e
        );

        bytes32 salt = bytes32(uint256(1));
        address predicted = factory.getAddress(p0, p1, 0.01 ether, salt);
        console.log("Predicted counterfactual address:", predicted);
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

        console.log("setWindow(ETH, 0.05 ether, 1 day, 18):");
        console.logBytes(
            abi.encodeWithSignature(
                "setWindow(address,uint256,uint256,uint8)",
                address(0), uint256(0.05 ether), uint256(1 days), uint8(18)
            )
        );
        console.log("");

        console.log("setTokenThreshold(USDC, 100e6, 6):");
        console.logBytes(
            abi.encodeWithSignature(
                "setTokenThreshold(address,uint256,uint8)", USDC, uint256(100e6), uint8(6)
            )
        );
        console.log("");

        console.log("setWindow(USDC, 500e6, 1 day, 6):");
        console.logBytes(
            abi.encodeWithSignature(
                "setWindow(address,uint256,uint256,uint8)",
                USDC, uint256(500e6), uint256(1 days), uint8(6)
            )
        );
    }
}

/// @notice Deploys PasskeyAccount implementation and PasskeyAccountFactory to Base Sepolia
contract DeployFactory is Script {
    address constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external returns (PasskeyAccount implementation, PasskeyAccountFactory factory) {
        require(block.chainid == 84532, "not Base Sepolia");

        // The implementation storage is locked permanently by _initialized = true in its constructor.
        // It requires >= 2 signers in the constructor. We provide dummy signers and max threshold.
        PasskeyAccount.PublicKey[] memory dummySigners = new PasskeyAccount.PublicKey[](2);
        dummySigners[0] = PasskeyAccount.PublicKey(1, 2);
        dummySigners[1] = PasskeyAccount.PublicKey(3, 4);

        vm.startBroadcast();
        implementation = new PasskeyAccount(ENTRYPOINT, dummySigners, type(uint256).max);
        factory = new PasskeyAccountFactory(address(implementation));
        vm.stopBroadcast();

        console.log("");
        console.log("=== PasskeyAccountFactory deployed ===");
        console.log("Implementation address: ", address(implementation));
        console.log("Factory address:        ", address(factory));
        console.log("EntryPoint:             ", factory.entryPoint());
        console.log("Explorer Implementation: https://sepolia.basescan.org/address/%s", address(implementation));
        console.log("Explorer Factory:        https://sepolia.basescan.org/address/%s", address(factory));
    }
}
