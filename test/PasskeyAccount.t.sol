// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {PasskeyAccount, PackedUserOperation} from "../src/PasskeyAccount.sol";
import {WebAuthn} from "../src/WebAuthn.sol";
import {Vectors} from "./Vectors.sol";

/// @dev These tests use REAL P-256 signatures produced by tools/genvec.mjs and
///      verified by the native precompile at 0x100 (EVM version: osaka). Nothing
///      here is mocked -- a passing test means the cryptography actually works.
contract PasskeyAccountTest is Test, Vectors {
    PasskeyAccount account;

    address constant ENTRYPOINT = address(0xE);
    address constant RECIPIENT = address(0xBEEF);
    uint256 constant THRESHOLD = 1 ether;

    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant NFT = address(0xBAD0);

    // The challenges the vectors were signed over.
    bytes32 constant H_SMALL   = bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111));
    bytes32 constant H_LARGE   = bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222));
    bytes32 constant H_OTHER   = bytes32(uint256(0x3333333333333333333333333333333333333333333333333333333333333333));
    bytes32 constant H_NOUV    = bytes32(uint256(0x4444444444444444444444444444444444444444444444444444444444444444));
    bytes32 constant H_UNKNOWN = bytes32(uint256(0x5555555555555555555555555555555555555555555555555555555555555555));
    bytes32 constant H_ERC20   = bytes32(uint256(0x6666666666666666666666666666666666666666666666666666666666666666));

    function setUp() public {
        account = new PasskeyAccount(ENTRYPOINT, _signers1(K0_X, K0_Y), THRESHOLD);
        vm.deal(address(account), 100 ether);

        vm.prank(address(account));
        account.addSigner(K1_X, K1_Y);
    }

    // ---------------------------------------------------------------- helpers

    function _opValue(uint256 value) internal pure returns (bytes memory) {
        return abi.encodeCall(PasskeyAccount.execute, (RECIPIENT, value, ""));
    }

    function _one(uint256 id, WebAuthn.Signature memory s)
        internal pure returns (bytes memory)
    {
        uint256[] memory ids = new uint256[](1);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](1);
        ids[0] = id; sigs[0] = s;
        return abi.encode(ids, sigs);
    }

    function _two(
        uint256 a, WebAuthn.Signature memory sa,
        uint256 b, WebAuthn.Signature memory sb
    ) internal pure returns (bytes memory) {
        uint256[] memory ids = new uint256[](2);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](2);
        ids[0] = a; sigs[0] = sa;
        ids[1] = b; sigs[1] = sb;
        return abi.encode(ids, sigs);
    }

    function _validate(bytes memory callData, bytes memory sig, bytes32 h)
        internal returns (uint256)
    {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = callData;
        op.signature = sig;
        vm.prank(ENTRYPOINT);
        return account.validateUserOp(op, h, 0);
    }

    // ------------------------------------------------------------ happy paths

    function test_SmallTransfer_OneSignature() public {
        uint256 r = _validate(
            _opValue(0.5 ether),
            _one(0, _v_small_k0()),
            H_SMALL
        );
        assertEq(r, 0, "below threshold: one passkey should suffice");
    }

    function test_LargeTransfer_TwoSignatures() public {
        uint256 r = _validate(
            _opValue(5 ether),
            _two(0, _v_large_k0(), 1, _v_large_k1()),
            H_LARGE
        );
        assertEq(r, 0, "above threshold: two distinct passkeys should pass");
    }

    // ------------------------------------------------------------- the attacks

    /// The central claim of the whole design: one stolen passkey cannot move
    /// funds above the threshold. This is the test that would fail if the
    /// policy lived in a UI instead of in validateUserOp.
    function test_Attack_LargeTransfer_SingleSignature_Rejected() public {
        uint256 r = _validate(
            _opValue(5 ether),
            _one(0, _v_large_k0()),
            H_LARGE
        );
        assertEq(r, 1, "one sig must NOT clear the threshold");
    }

    /// Signing twice with the same passkey must not satisfy a 2-of-N policy.
    function test_Attack_SameSignerTwice_Rejected() public {
        uint256 r = _validate(
            _opValue(5 ether),
            _two(0, _v_large_k0(), 0, _v_large_k0()),
            H_LARGE
        );
        assertEq(r, 1, "duplicate signer id must be rejected");
    }

    /// Descending / unordered ids are the same bypass wearing a hat.
    function test_Attack_UnorderedSigners_Rejected() public {
        uint256 r = _validate(
            _opValue(5 ether),
            _two(1, _v_large_k1(), 0, _v_large_k0()),
            H_LARGE
        );
        assertEq(r, 1, "ids must be strictly ascending");
    }

    /// A signature over a DIFFERENT UserOp must not authorize this one.
    function test_Attack_SignatureFromAnotherOp_Rejected() public {
        uint256 r = _validate(
            _opValue(5 ether),
            _two(0, _v_other_k0(), 1, _v_other_k1()),
            H_LARGE // signed over H_OTHER, presented against H_LARGE
        );
        assertEq(r, 1, "cross-op replay must fail");
    }

    /// Low-s enforcement. (r, n-s) is cryptographically valid over the same
    /// message, so the precompile accepts it -- our contract must not.
    function test_Attack_HighS_Rejected() public {
        WebAuthn.Signature memory s = _v_small_k0();
        uint256 n = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551;

        // Sanity: the high-s twin really is accepted by the precompile.
        bytes32 message = sha256(
            abi.encodePacked(s.authenticatorData, sha256(bytes(s.clientDataJSON)))
        );
        (bool ok, bytes memory ret) = address(0x100).staticcall(
            abi.encode(message, s.r, n - s.s, K0_X, K0_Y)
        );
        assertTrue(ok && ret.length == 32, "high-s IS valid P-256; that's the point");

        s.s = n - s.s;
        uint256 r = _validate(_opValue(0.5 ether), _one(0, s), H_SMALL);
        assertEq(r, 1, "high-s must be rejected despite being valid P-256");
    }

    /// User Presence without User Verification: someone tapped the key, but no
    /// biometric was checked. Must not authorize spending.
    function test_Attack_NoUserVerification_Rejected() public {
        uint256 r = _validate(
            _opValue(0.5 ether),
            _one(0, _v_noUV_k0()),
            H_NOUV
        );
        assertEq(r, 1, "UP-only (no biometric) must not authorize");
    }

    /// Unknown calldata must default to the full quorum, not to one signature.
    function test_Attack_UnknownSelector_RequiresTwo() public {
        uint256 r = _validate(
            abi.encodeWithSignature("someOtherThing(uint256)", 1),
            _one(0, _v_unknown_k0()),
            H_UNKNOWN
        );
        assertEq(r, 1, "unrecognized selector must require 2 sigs");
    }

    /// Truncated execute() calldata must reject cleanly, not revert on an
    /// out-of-bounds calldata slice inside validateUserOp.
    function test_Attack_TruncatedCalldata_Rejected() public {
        bytes memory truncated = abi.encodePacked(
            PasskeyAccount.execute.selector, bytes32(0)
        ); // 36 bytes: has a selector, but no value field
        uint256 r = _validate(truncated, _one(0, _v_unknown_k0()), H_UNKNOWN);
        assertEq(r, 1, "truncated calldata must reject, not revert");
    }

    /// Config changes are policy-gated: no external caller can lower the
    /// threshold or enroll their own passkey.
    function test_Attack_DirectConfigCall_Reverts() public {
        vm.expectRevert(PasskeyAccount.NotSelf.selector);
        account.setThreshold(0);

        vm.expectRevert(PasskeyAccount.NotSelf.selector);
        account.addSigner(0xDEAD, 0xBEEF);
    }

    /// Only the EntryPoint may drive the account.
    function test_Attack_DirectExecute_Reverts() public {
        vm.expectRevert(PasskeyAccount.NotEntryPoint.selector);
        account.execute(RECIPIENT, 1 ether, "");
    }

    // ------------------------------------------------- ERC-20 policy (fixed)

    /// The bypass that a value-only policy could not see: a million-dollar
    /// USDC transfer with `value == 0`. Now caught by decoding the inner call.
    function test_Attack_LargeERC20Transfer_SingleSignature_Rejected() public {
        vm.prank(address(account));
        account.setTokenThreshold(USDC, 1000e6); // $1000 threshold

        bytes memory inner = abi.encodeWithSignature(
            "transfer(address,uint256)", address(0xdEaD), 1_000_000e6
        );
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute, (USDC, 0, inner)
        );

        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 1, "large ERC-20 transfer must require 2 sigs");
    }

    /// A small token transfer, under the configured threshold, still needs one.
    function test_SmallERC20Transfer_OneSignature() public {
        vm.prank(address(account));
        account.setTokenThreshold(USDC, 1000e6);

        bytes memory inner = abi.encodeWithSignature(
            "transfer(address,uint256)", address(0xdEaD), 10e6 // $10
        );
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute, (USDC, 0, inner)
        );

        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 0, "small ERC-20 transfer should clear with 1 sig");
    }

    /// An UNCONFIGURED token must not be treated as unlimited. Threshold 0
    /// means "unknown", and unknown means full quorum -- otherwise the fix
    /// would reintroduce the bypass for every token you forgot to configure.
    function test_Attack_UnconfiguredToken_RequiresTwo() public {
        address randomToken = address(0xC0FFEE);
        bytes memory inner = abi.encodeWithSignature(
            "transfer(address,uint256)", address(0xdEaD), 1e6
        );
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute, (randomToken, 0, inner)
        );

        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 1, "unconfigured token must require 2 sigs");
    }

    /// Approvals are unbounded, persistent delegations -- always full quorum,
    /// regardless of amount. This is the `approve()` drain vector.
    function test_Attack_Approve_AlwaysRequiresTwo() public {
        vm.prank(address(account));
        account.setTokenThreshold(USDC, 1_000_000e6); // very permissive

        bytes memory inner = abi.encodeWithSignature(
            "approve(address,uint256)", address(0xdEaD), 1 // even 1 unit
        );
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute, (USDC, 0, inner)
        );

        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 1, "approve must always require 2 sigs");
    }

    /// setApprovalForAll hands over an entire NFT collection in one call.
    function test_Attack_SetApprovalForAll_RequiresTwo() public {
        bytes memory inner = abi.encodeWithSignature(
            "setApprovalForAll(address,bool)", address(0xdEaD), true
        );
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute, (NFT, 0, inner)
        );

        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 1, "setApprovalForAll must require 2 sigs");
    }

    /// transferFrom moves tokens too, at a different calldata offset.
    function test_Attack_LargeTransferFrom_RequiresTwo() public {
        vm.prank(address(account));
        account.setTokenThreshold(USDC, 1000e6);

        bytes memory inner = abi.encodeWithSignature(
            "transferFrom(address,address,uint256)",
            address(account), address(0xdEaD), 1_000_000e6
        );
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute, (USDC, 0, inner)
        );

        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 1, "large transferFrom must require 2 sigs");
    }

    /// An arbitrary DeFi call the policy cannot price must get full quorum.
    function test_Attack_UnknownInnerCall_RequiresTwo() public {
        bytes memory inner = abi.encodeWithSignature(
            "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
            1e18, 0, new address[](0), address(0xdEaD), block.timestamp
        );
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute, (address(0xDEF1), 0, inner)
        );

        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 1, "unknown inner call must require 2 sigs");
    }

    /// Malformed ABI encoding in the `func` argument must not revert.
    function test_Attack_MalformedFuncOffset_DoesNotRevert() public {
        // Hand-craft execute() calldata with a wild dynamic offset.
        bytes memory callData = abi.encodePacked(
            PasskeyAccount.execute.selector,
            bytes32(uint256(uint160(USDC))),   // dest
            bytes32(uint256(0)),               // value
            bytes32(type(uint256).max)         // func offset -> garbage
        );

        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 1, "malformed offset must reject cleanly, not revert");
    }

    // -------------------------------------------------------- construction

    /// An account deployed with BOTH signers can configure itself immediately,
    /// because config calls take the 2-signature quorum and both keys exist.
    function test_TwoSignerConstructor_CanConfigureItself() public {
        PasskeyAccount acct = new PasskeyAccount(
            ENTRYPOINT, _signers2(K0_X, K0_Y, K1_X, K1_Y), THRESHOLD
        );
        assertEq(acct.signerCount(), 2, "both signers enrolled at construction");

        PackedUserOperation memory op;
        op.sender = address(acct);
        op.callData = abi.encodeCall(
            PasskeyAccount.setWindow, (address(0), 1 ether, 1 days)
        );
        op.signature = _two(0, _v_small_k0(), 1, _v_small_k1());

        vm.prank(ENTRYPOINT);
        uint256 r = acct.validateUserOp(op, H_SMALL, 0);
        assertEq(r, 0, "two enrolled signers can authorize config");
    }

    /// A single-signer account cannot configure itself -- not even to enrol the
    /// second signer it would need. This is why the deploy script takes both
    /// keys up front.
    function test_SingleSignerConstructor_CannotConfigureItself() public {
        PasskeyAccount acct = new PasskeyAccount(
            ENTRYPOINT, _signers1(K0_X, K0_Y), THRESHOLD
        );

        PackedUserOperation memory op;
        op.sender = address(acct);
        op.callData = abi.encodeCall(PasskeyAccount.addSigner, (K1_X, K1_Y));
        op.signature = _one(0, _v_small_k0());

        vm.prank(ENTRYPOINT);
        uint256 r = acct.validateUserOp(op, H_SMALL, 0);
        assertEq(r, 1, "one signer cannot enrol a second -- permanently stuck");
    }

    /// An empty signer set would be an account nobody controls.
    function test_ZeroSigners_Reverts() public {
        PasskeyAccount.PublicKey[] memory none = new PasskeyAccount.PublicKey[](0);
        vm.expectRevert(PasskeyAccount.NoSigners.selector);
        new PasskeyAccount(ENTRYPOINT, none, THRESHOLD);
    }

    // ------------------------------------------------------------------ gas

    function test_Gas_SingleSignatureValidation() public {
        uint256 before = gasleft();
        _validate(_opValue(0.5 ether), _one(0, _v_small_k0()), H_SMALL);
        console.log("validateUserOp, 1 passkey sig, gas:", before - gasleft());
    }
}
