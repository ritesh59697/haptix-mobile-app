// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {PasskeyAccountFactory} from "../src/PasskeyAccountFactory.sol";
import {PasskeyAccount} from "../src/PasskeyAccount.sol";
import {Vectors} from "./Vectors.sol";

contract PasskeyAccountFactoryTest is Test, Vectors {
    PasskeyAccount implementation;
    PasskeyAccountFactory factory;
    address constant ENTRYPOINT = address(0xE);
    uint256 constant THRESHOLD = 1 ether;

    function setUp() public {
        implementation = new PasskeyAccount(ENTRYPOINT, _signers2(K0_X, K0_Y, K1_X, K1_Y), THRESHOLD);
        factory = new PasskeyAccountFactory(address(implementation));
    }

    function test_GetAddress_MatchesDeployed() public {
        PasskeyAccount.PublicKey[] memory signers = _signers2(K0_X, K0_Y, K1_X, K1_Y);
        bytes32 salt = bytes32(uint256(12345));

        address predicted = factory.getAddress(signers, THRESHOLD, salt);
        assertTrue(predicted != address(0));
        assertEq(predicted.code.length, 0);

        PasskeyAccount deployed = factory.createAccount(signers, THRESHOLD, salt);
        assertEq(address(deployed), predicted);
        assertGt(predicted.code.length, 0);
        assertEq(deployed.entryPoint(), ENTRYPOINT);
        assertEq(deployed.threshold(), THRESHOLD);
        assertEq(deployed.signerCount(), 2);
    }

    function test_CreateAccount_Idempotent() public {
        PasskeyAccount.PublicKey[] memory signers = _signers2(K0_X, K0_Y, K1_X, K1_Y);
        bytes32 salt = bytes32(uint256(999));

        address predicted = factory.getAddress(signers, THRESHOLD, salt);
        PasskeyAccount first = factory.createAccount(signers, THRESHOLD, salt);
        PasskeyAccount second = factory.createAccount(signers, THRESHOLD, salt);

        assertEq(address(first), predicted);
        assertEq(address(second), predicted);
    }

    function test_DifferentSalts_DifferentAddresses() public view {
        PasskeyAccount.PublicKey[] memory signers = _signers2(K0_X, K0_Y, K1_X, K1_Y);
        bytes32 salt1 = bytes32(uint256(1));
        bytes32 salt2 = bytes32(uint256(2));

        address addr1 = factory.getAddress(signers, THRESHOLD, salt1);
        address addr2 = factory.getAddress(signers, THRESHOLD, salt2);

        assertTrue(addr1 != addr2);
    }

    function test_DifferentSigners_DifferentAddresses() public view {
        PasskeyAccount.PublicKey[] memory s1 = _signers2(K0_X, K0_Y, K1_X, K1_Y);
        PasskeyAccount.PublicKey[] memory s2 = _signers2(K0_X, K0_Y, 0x1234, 0x5678);
        bytes32 salt = bytes32(uint256(100));

        address addr1 = factory.getAddress(s1, THRESHOLD, salt);
        address addr2 = factory.getAddress(s2, THRESHOLD, salt);

        assertTrue(addr1 != addr2);
    }

    function test_PasskeyPair_Overload_MatchesArray() public view {
        PasskeyAccount.PublicKey memory p0 = PasskeyAccount.PublicKey(K0_X, K0_Y);
        PasskeyAccount.PublicKey memory p1 = PasskeyAccount.PublicKey(K1_X, K1_Y);
        bytes32 salt = bytes32(uint256(777));

        address addrFromPair = factory.getAddress(p0, p1, THRESHOLD, salt);
        address addrFromArray = factory.getAddress(_signers2(K0_X, K0_Y, K1_X, K1_Y), THRESHOLD, salt);

        assertEq(addrFromPair, addrFromArray, "pair overload must match array overload");
    }

    function test_Attack_Factory_SingleSigner_Reverts() public {
        PasskeyAccount.PublicKey[] memory signers = new PasskeyAccount.PublicKey[](1);
        signers[0] = PasskeyAccount.PublicKey(K0_X, K0_Y);
        bytes32 salt = bytes32(uint256(123));

        vm.expectRevert(PasskeyAccount.MinSignersRequired.selector);
        factory.createAccount(signers, THRESHOLD, salt);
    }

    function test_ImplementationCannotBeReinitialized() public {
        PasskeyAccount.PublicKey[] memory signers = _signers2(K0_X, K0_Y, K1_X, K1_Y);
        vm.expectRevert(PasskeyAccount.AlreadyInitialized.selector);
        implementation.initialize(signers, THRESHOLD);
    }

    function test_CloneCannotBeReinitialized() public {
        PasskeyAccount.PublicKey[] memory signers = _signers2(K0_X, K0_Y, K1_X, K1_Y);
        bytes32 salt = bytes32(uint256(555));
        PasskeyAccount deployed = factory.createAccount(signers, THRESHOLD, salt);

        vm.expectRevert(PasskeyAccount.AlreadyInitialized.selector);
        deployed.initialize(signers, THRESHOLD);
    }

    function test_InitCode_Execution_Matches_PackedUserOp() public {
        PasskeyAccount.PublicKey memory p0 = PasskeyAccount.PublicKey(K0_X, K0_Y);
        PasskeyAccount.PublicKey memory p1 = PasskeyAccount.PublicKey(K1_X, K1_Y);
        bytes32 salt = bytes32(uint256(888));

        address predicted = factory.getAddress(p0, p1, THRESHOLD, salt);
        assertEq(predicted.code.length, 0, "not deployed yet");

        bytes memory factoryCall = abi.encodeWithSignature(
            "createAccount((uint256,uint256),(uint256,uint256),uint256,bytes32)",
            p0, p1, THRESHOLD, salt
        );
        bytes memory initCode = abi.encodePacked(address(factory), factoryCall);

        // EntryPoint parses initCode[0:20] for factory address and executes the remainder
        address factoryAddr = address(bytes20(initCode));
        assertEq(factoryAddr, address(factory), "factory address parsed from initCode prefix");

        (bool ok, ) = factoryAddr.call(factoryCall);
        assertTrue(ok, "initCode execution succeeded");
        assertGt(predicted.code.length, 0, "account created at predicted address");
    }
}
