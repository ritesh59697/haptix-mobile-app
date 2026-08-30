// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {PasskeyAccountFactory} from "../src/PasskeyAccountFactory.sol";
import {PasskeyAccount} from "../src/PasskeyAccount.sol";
import {Vectors} from "./Vectors.sol";

contract PasskeyAccountFactoryTest is Test, Vectors {
    PasskeyAccountFactory factory;
    address constant ENTRYPOINT = address(0xE);
    uint256 constant THRESHOLD = 1 ether;

    function setUp() public {
        factory = new PasskeyAccountFactory(ENTRYPOINT);
    }

    function test_GetAddress_MatchesDeployed() public {
        PasskeyAccount.PublicKey[] memory signers = _signers1(K0_X, K0_Y);
        bytes32 salt = bytes32(uint256(12345));

        address predicted = factory.getAddress(signers, THRESHOLD, salt);
        assertTrue(predicted != address(0));
        assertEq(predicted.code.length, 0);

        PasskeyAccount deployed = factory.createAccount(signers, THRESHOLD, salt);
        assertEq(address(deployed), predicted);
        assertGt(predicted.code.length, 0);
        assertEq(deployed.entryPoint(), ENTRYPOINT);
        assertEq(deployed.threshold(), THRESHOLD);
        assertEq(deployed.signerCount(), 1);
    }

    function test_CreateAccount_Idempotent() public {
        PasskeyAccount.PublicKey[] memory signers = _signers1(K0_X, K0_Y);
        bytes32 salt = bytes32(uint256(999));

        address predicted = factory.getAddress(signers, THRESHOLD, salt);
        PasskeyAccount first = factory.createAccount(signers, THRESHOLD, salt);
        PasskeyAccount second = factory.createAccount(signers, THRESHOLD, salt);

        assertEq(address(first), predicted);
        assertEq(address(second), predicted);
    }

    function test_DifferentSalts_DifferentAddresses() public {
        PasskeyAccount.PublicKey[] memory signers = _signers1(K0_X, K0_Y);
        bytes32 salt1 = bytes32(uint256(1));
        bytes32 salt2 = bytes32(uint256(2));

        address addr1 = factory.getAddress(signers, THRESHOLD, salt1);
        address addr2 = factory.getAddress(signers, THRESHOLD, salt2);

        assertTrue(addr1 != addr2);
    }

    function test_DifferentSigners_DifferentAddresses() public {
        PasskeyAccount.PublicKey[] memory s1 = _signers1(K0_X, K0_Y);
        PasskeyAccount.PublicKey[] memory s2 = _signers1(K1_X, K1_Y);
        bytes32 salt = bytes32(uint256(100));

        address addr1 = factory.getAddress(s1, THRESHOLD, salt);
        address addr2 = factory.getAddress(s2, THRESHOLD, salt);

        assertTrue(addr1 != addr2);
    }

    function test_TwoSigners_DeploySuccess() public {
        PasskeyAccount.PublicKey[] memory signers = new PasskeyAccount.PublicKey[](2);
        signers[0] = PasskeyAccount.PublicKey(K0_X, K0_Y);
        signers[1] = PasskeyAccount.PublicKey(K1_X, K1_Y);
        bytes32 salt = bytes32(uint256(42));

        address predicted = factory.getAddress(signers, THRESHOLD, salt);
        PasskeyAccount deployed = factory.createAccount(signers, THRESHOLD, salt);

        assertEq(address(deployed), predicted);
        assertEq(deployed.signerCount(), 2);
    }
}
