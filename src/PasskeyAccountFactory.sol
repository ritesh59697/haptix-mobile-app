// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {PasskeyAccount} from "./PasskeyAccount.sol";

/// @title PasskeyAccountFactory
/// @notice An ERC-4337 factory for deterministic PasskeyAccount deployment via CREATE2.
/// @dev Enables counterfactual wallet addresses: users can generate their account address
///      off-chain and receive funds before the contract is deployed.
contract PasskeyAccountFactory {
    address public immutable entryPoint;

    event AccountCreated(address indexed account, bytes32 indexed salt, uint256 signerCount, uint256 threshold);

    constructor(address _entryPoint) {
        entryPoint = _entryPoint;
    }

    /// @notice Computes the deterministic counterfactual address for a PasskeyAccount.
    /// @param passkey0 The primary passkey public key.
    /// @param passkey1 The secondary passkey public key (required for 2-sig quorum).
    /// @param threshold The wei threshold above which a 2nd signature is required.
    /// @param salt Unique salt for CREATE2 address derivation.
    function getAddress(
        PasskeyAccount.PublicKey memory passkey0,
        PasskeyAccount.PublicKey memory passkey1,
        uint256 threshold,
        bytes32 salt
    ) public view returns (address) {
        PasskeyAccount.PublicKey[] memory initial = new PasskeyAccount.PublicKey[](2);
        initial[0] = passkey0;
        initial[1] = passkey1;
        return getAddress(initial, threshold, salt);
    }

    /// @notice Computes the deterministic counterfactual address for a PasskeyAccount.
    /// @param initialSigners Passkey public keys enrolled at construction (minimum 2).
    /// @param threshold The wei threshold above which a 2nd signature is required.
    /// @param salt Unique salt for CREATE2 address derivation.
    function getAddress(
        PasskeyAccount.PublicKey[] memory initialSigners,
        uint256 threshold,
        bytes32 salt
    ) public view returns (address) {
        bytes memory creationCode = abi.encodePacked(
            type(PasskeyAccount).creationCode,
            abi.encode(entryPoint, initialSigners, threshold)
        );
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(creationCode))
        );
        return address(uint160(uint256(hash)));
    }

    /// @notice Deploys an account using CREATE2 if not already deployed, or returns existing address.
    /// @param passkey0 The primary passkey public key.
    /// @param passkey1 The secondary passkey public key (required for 2-sig quorum).
    /// @param threshold The wei threshold above which a 2nd signature is required.
    /// @param salt Unique salt for CREATE2 address derivation.
    function createAccount(
        PasskeyAccount.PublicKey memory passkey0,
        PasskeyAccount.PublicKey memory passkey1,
        uint256 threshold,
        bytes32 salt
    ) external returns (PasskeyAccount) {
        PasskeyAccount.PublicKey[] memory initial = new PasskeyAccount.PublicKey[](2);
        initial[0] = passkey0;
        initial[1] = passkey1;
        return createAccount(initial, threshold, salt);
    }

    /// @notice Deploys an account using CREATE2 if not already deployed, or returns existing address.
    /// @param initialSigners Passkey public keys enrolled at construction (minimum 2).
    /// @param threshold The wei threshold above which a 2nd signature is required.
    /// @param salt Unique salt for CREATE2 address derivation.
    function createAccount(
        PasskeyAccount.PublicKey[] memory initialSigners,
        uint256 threshold,
        bytes32 salt
    ) public returns (PasskeyAccount) {
        address addr = getAddress(initialSigners, threshold, salt);
        if (addr.code.length > 0) {
            return PasskeyAccount(payable(addr));
        }

        PasskeyAccount account = new PasskeyAccount{salt: salt}(
            entryPoint,
            initialSigners,
            threshold
        );
        emit AccountCreated(address(account), salt, initialSigners.length, threshold);
        return account;
    }
}

