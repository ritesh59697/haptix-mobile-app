// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {PasskeyAccount} from "../src/PasskeyAccount.sol";
import {PasskeyAccountFactory} from "../src/PasskeyAccountFactory.sol";

/// @title DeployMainnet
/// @notice Deploys Haptix PasskeyAccount implementation and PasskeyAccountFactory
///         across EVM L2 mainnets (Base, Arbitrum One, OP Mainnet) and testnets.
///
/// @dev Usage:
///   # Base Mainnet (chainId 8453)
///   forge script script/DeployMainnet.s.sol:DeployMainnet \
///     --rpc-url https://mainnet.base.org \
///     --account <keystore-or-private-key> \
///     --broadcast --verify
///
///   # Arbitrum One (chainId 42161)
///   forge script script/DeployMainnet.s.sol:DeployMainnet \
///     --rpc-url https://arb1.arbitrum.io/rpc \
///     --account <keystore-or-private-key> \
///     --broadcast --verify
///
///   # OP Mainnet (chainId 10)
///   forge script script/DeployMainnet.s.sol:DeployMainnet \
///     --rpc-url https://mainnet.optimism.io \
///     --account <keystore-or-private-key> \
///     --broadcast --verify
contract DeployMainnet is Script {
    /// Canonical ERC-4337 v0.7 EntryPoint (same on Base, Arbitrum, OP, and Sepolia testnets)
    address constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external returns (PasskeyAccount implementation, PasskeyAccountFactory factory) {
        uint256 chainId = block.chainid;
        string memory networkName = "Unknown Network";
        string memory explorerBase = "";

        if (chainId == 8453) {
            networkName = "Base Mainnet";
            explorerBase = "https://basescan.org/address/";
        } else if (chainId == 42161) {
            networkName = "Arbitrum One";
            explorerBase = "https://arbiscan.io/address/";
        } else if (chainId == 10) {
            networkName = "OP Mainnet";
            explorerBase = "https://optimistic.etherscan.io/address/";
        } else if (chainId == 84532) {
            networkName = "Base Sepolia";
            explorerBase = "https://sepolia.basescan.org/address/";
        } else if (chainId == 421614) {
            networkName = "Arbitrum Sepolia";
            explorerBase = "https://sepolia.arbiscan.io/address/";
        } else if (chainId == 11155420) {
            networkName = "OP Sepolia";
            explorerBase = "https://sepolia-optimism.etherscan.io/address/";
        } else if (chainId == 5042) {
            networkName = "Arc Mainnet";
            explorerBase = "https://explorer.arc.io/address/";
        } else if (chainId == 5042002) {
            networkName = "Arc Testnet";
            explorerBase = "https://testnet.arcscan.app/address/";
        } else {
            console.log("Deploying to non-standard chainId:", chainId);
        }

        console.log("==================================================");
        console.log("Starting Haptix Multi-Chain Factory Deployment");
        console.log("Target Network:", networkName);
        console.log("Chain ID:      ", chainId);
        console.log("EntryPoint:    ", ENTRYPOINT);
        console.log("==================================================");

        // Implementation requires >= 2 signers in constructor.
        // It is permanently locked (_initialized = true) in constructor.
        PasskeyAccount.PublicKey[] memory dummySigners = new PasskeyAccount.PublicKey[](2);
        dummySigners[0] = PasskeyAccount.PublicKey(1, 2);
        dummySigners[1] = PasskeyAccount.PublicKey(3, 4);

        vm.startBroadcast();

        implementation = new PasskeyAccount(ENTRYPOINT, dummySigners, type(uint256).max);
        factory = new PasskeyAccountFactory(address(implementation));

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Succeeded! ===");
        console.log("Implementation Address:", address(implementation));
        console.log("Factory Address:       ", address(factory));
        console.log("EntryPoint Address:    ", factory.entryPoint());
        if (bytes(explorerBase).length > 0) {
            console.log("Implementation Explorer:", string.concat(explorerBase, vm.toString(address(implementation))));
            console.log("Factory Explorer:       ", string.concat(explorerBase, vm.toString(address(factory))));
        }
        console.log("");
        console.log("=== Verification Commands ===");
        console.log(string.concat("forge verify-contract ", vm.toString(address(implementation)), " src/PasskeyAccount.sol:PasskeyAccount --chain-id ", vm.toString(chainId)));
        console.log(string.concat("forge verify-contract ", vm.toString(address(factory)), " src/PasskeyAccountFactory.sol:PasskeyAccountFactory --constructor-args ", vm.toString(abi.encode(address(implementation))), " --chain-id ", vm.toString(chainId)));
        console.log("==================================================");
    }
}
