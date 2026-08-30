// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {PasskeyAccount, PackedUserOperation} from "../src/PasskeyAccount.sol";
import {WebAuthn} from "../src/WebAuthn.sol";
import {Vectors} from "./Vectors.sol";

contract ERC1271Test is Test, Vectors {
    PasskeyAccount account;
    address constant ENTRYPOINT = address(0xE);
    uint256 constant THRESHOLD = 1 ether;

    bytes32 constant MSG_HASH = keccak256("Sign in to Uniswap");
    bytes4 constant MAGICVALUE = 0x1626ba7e;
    bytes4 constant INVALID = 0xffffffff;

    uint256 constant P256_N =
        0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551;

    // Generated P-256 keys specifically for this test fixture
    uint256 constant K0_X_1271 =
        0x468bab0ff974d389f9b43224a1538c8857a3b9b4fb180940ffa871b2efef8c3c;
    uint256 constant K0_Y_1271 =
        0x007e0b1f166c0161be4b8bf91e6816bbf743c23c763533826137d3fc07e3794d;

    uint256 constant K1_X_1271 =
        0xfd0af757882a1f0d12922f98ee154ad185bcd93e053d864e240b11fbb8858821;
    uint256 constant K1_Y_1271 =
        0x614087a02815c234d48fb4f442239f55f07b53c8bf5975eb679367b958f2a723;

    function _sig0() internal pure returns (WebAuthn.Signature memory) {
        return WebAuthn.Signature({
            authenticatorData: hex"00000000000000000000000000000000000000000000000000000000000000000500000000",
            clientDataJSON: '{"type":"webauthn.get","challenge":"3v9Yi0o1kA9ccZ-pdnD8ajSoSxJ7mwFMojLD113RHck","origin":"https://localhost:5173"}',
            challengeIndex: 23,
            typeIndex: 1,
            r: 0x35ab5a4cc110e7967600219522b8be4173da84ad93e3a3001716dda588f7dfe9,
            s: 0x666e1a6de8f529024c9f789fc096ee75843ceca348844046eaa0adfbee70754c
        });
    }

    function _sig1() internal pure returns (WebAuthn.Signature memory) {
        return WebAuthn.Signature({
            authenticatorData: hex"00000000000000000000000000000000000000000000000000000000000000000500000000",
            clientDataJSON: '{"type":"webauthn.get","challenge":"3v9Yi0o1kA9ccZ-pdnD8ajSoSxJ7mwFMojLD113RHck","origin":"https://localhost:5173"}',
            challengeIndex: 23,
            typeIndex: 1,
            r: 0x072e2665767c23a65eaf25e65974a428de7270dc13223227ff6f3f34761f654f,
            s: 0x2504e3684b360616c7685ddab8c7232bd121535e1d2418ddf181408959a9902a
        });
    }

    function setUp() public {
        account = new PasskeyAccount(
            ENTRYPOINT,
            _signers2(K0_X_1271, K0_Y_1271, K1_X_1271, K1_Y_1271),
            THRESHOLD
        );
    }

    /// Valid WebAuthn signature over EIP-712 getMessageHash returns ERC-1271 MAGICVALUE.
    function test_ERC1271_ValidSignature_ReturnsMagicValue() public view {
        bytes memory sigPayload = abi.encode(uint256(0), _sig0());
        bytes4 result = account.isValidSignature(MSG_HASH, sigPayload);
        assertEq(result, MAGICVALUE, "valid signature must return ERC-1271 magic value");
    }

    /// A second enrolled passkey (signer 1) can also authorize login on its own (1-of-N).
    function test_ERC1271_SecondSigner_Alone_ReturnsMagicValue() public view {
        bytes memory sigPayload = abi.encode(uint256(1), _sig1());
        bytes4 result = account.isValidSignature(MSG_HASH, sigPayload);
        assertEq(result, MAGICVALUE, "signer 1 alone must be able to log in");
    }

    /// Malleated high-s signature is strictly rejected.
    function test_Attack_ERC1271_HighS_Rejected() public view {
        WebAuthn.Signature memory s = _sig0();
        s.s = P256_N - s.s; // high-s twin

        bytes memory sigPayload = abi.encode(uint256(0), s);
        bytes4 result = account.isValidSignature(MSG_HASH, sigPayload);
        assertEq(result, INVALID, "high-s 1271 signature must be rejected");
    }

    /// Valid signature for a different message hash fails.
    function test_Attack_ERC1271_WrongChallenge_Rejected() public view {
        bytes32 differentMsg = keccak256("Sign in to Malicious dApp");
        bytes memory sigPayload = abi.encode(uint256(0), _sig0());

        bytes4 result = account.isValidSignature(differentMsg, sigPayload);
        assertEq(result, INVALID, "signature for different hash must fail");
    }

    /// Signer id out of range (>= signerCount) fails immediately.
    function test_Attack_ERC1271_WrongSignerId_Rejected() public view {
        bytes memory sigPayload = abi.encode(uint256(99), _sig0());
        bytes4 result = account.isValidSignature(MSG_HASH, sigPayload);
        assertEq(result, INVALID, "non-existent signer id must fail");
    }

    /// UserOp signature encoding (uint256[], Signature[]) is safely rejected by 1271.
    function test_Attack_ERC1271_UserOpEncoding_Rejected() public {
        uint256[] memory ids = new uint256[](1);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](1);
        ids[0] = 0;
        sigs[0] = _sig0();

        bytes memory userOpSig = abi.encode(ids, sigs);
        try account.isValidSignature(MSG_HASH, userOpSig) returns (bytes4 result) {
            assertEq(result, INVALID, "userOp encoding must be rejected in 1271");
        } catch {
            // Revert on invalid abi decoding also rejects the signature
        }
    }

    /// Replaying a valid UserOp signature as an ERC-1271 signature fails.
    function test_Attack_ReplayUserOpSignatureAs1271_Rejected() public {
        // _v_small_k0 is a real UserOp vector from Vectors.sol
        bytes memory userOpSig = abi.encode(uint256(0), _v_small_k0());
        try account.isValidSignature(MSG_HASH, userOpSig) returns (bytes4 result) {
            assertEq(result, INVALID, "UserOp signature challenge does not match 1271 digest");
        } catch {
            // Revert on malformed encoding also rejects
        }
    }

    /// Replaying a valid ERC-1271 signature as a UserOp signature fails validation.
    function test_Attack_Replay1271SignatureAsUserOp_Rejected() public {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(
            PasskeyAccount.execute, (address(0xBEEF), 0.001 ether, "")
        );
        // Pack 1271 signature as UserOp signature
        op.signature = abi.encode(uint256(0), _sig0());

        vm.prank(ENTRYPOINT);
        try account.validateUserOp(op, MSG_HASH, 0) returns (uint256 r) {
            assertEq(r, 1, "1271 signature payload cannot validate UserOp");
        } catch {
            // Revert in validation causes EntryPoint to fail UserOp
        }
    }

    /// Domain separator binds block.chainid and verifyingContract address.
    function test_Policy_DomainSeparator_BindsChainIdAndContract() public {
        bytes32 dsOriginal = account.domainSeparator();

        // Chain change
        vm.chainId(84532);
        bytes32 dsNewChain = account.domainSeparator();
        assertTrue(dsOriginal != dsNewChain, "domain separator must differ across chains");

        // Contract address change
        vm.chainId(31337);
        PasskeyAccount otherAccount = new PasskeyAccount(
            ENTRYPOINT,
            _signers2(K0_X_1271, K0_Y_1271, K1_X_1271, K1_Y_1271),
            THRESHOLD
        );
        assertTrue(dsOriginal != otherAccount.domainSeparator(), "domain separator must differ across accounts");
    }
}
