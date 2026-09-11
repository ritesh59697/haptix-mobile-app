// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {PasskeyAccount} from "./PasskeyAccount.sol";

/// @title PasskeyAccountFactory
/// @notice An ERC-4337 factory deploying PasskeyAccount clones via ERC-1167 minimal proxies and CREATE2.
/// @dev Enables counterfactual wallet addresses: users can generate their account address
///      off-chain and receive funds before the contract is deployed.
contract PasskeyAccountFactory {
    address public immutable accountImplementation;
    bytes32 public immutable cloneInitCodeHash;

    error FailedToDeployClone();

    event AccountCreated(address indexed account, bytes32 indexed salt, uint256 signerCount, uint256 threshold);

    constructor(address _accountImplementation) {
        accountImplementation = _accountImplementation;
        bytes memory initCode = abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73",
            _accountImplementation,
            hex"5af43d82803e903d91602b57fd5bf3"
        );
        cloneInitCodeHash = keccak256(initCode);
    }

    /// @notice Returns the EntryPoint address configured on the implementation contract.
    function entryPoint() external view returns (address) {
        return PasskeyAccount(payable(accountImplementation)).entryPoint();
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
        bytes32 actualSalt = keccak256(abi.encode(initialSigners, threshold, salt));
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), actualSalt, cloneInitCodeHash)
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
        if (initialSigners.length < 2) revert PasskeyAccount.MinSignersRequired();

        address addr = getAddress(initialSigners, threshold, salt);
        if (addr.code.length > 0) {
            return PasskeyAccount(payable(addr));
        }

        bytes32 actualSalt = keccak256(abi.encode(initialSigners, threshold, salt));
        bytes memory initCode = abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73",
            accountImplementation,
            hex"5af43d82803e903d91602b57fd5bf3"
        );

        address clone;
        assembly {
            clone := create2(0, add(initCode, 0x20), mload(initCode), actualSalt)
        }
        if (clone == address(0)) revert FailedToDeployClone();

        PasskeyAccount(payable(clone)).initialize(initialSigners, threshold);
        emit AccountCreated(clone, salt, initialSigners.length, threshold);
        return PasskeyAccount(payable(clone));
    }
}
