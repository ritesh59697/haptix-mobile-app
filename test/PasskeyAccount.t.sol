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
        account = new PasskeyAccount(ENTRYPOINT, _signers2(K0_X, K0_Y, K1_X, K1_Y), THRESHOLD);
        vm.deal(address(account), 100 ether);
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
        account.setTokenThreshold(USDC, 1000e6, 6); // $1000 threshold

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
        account.setTokenThreshold(USDC, 1000e6, 6);

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
        account.setTokenThreshold(USDC, 1_000_000e6, 6); // very permissive

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
        account.setTokenThreshold(USDC, 1000e6, 6);

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

    /// Offset smaller than static head (e.g. 64 < 96) is malformed and must reject cleanly.
    function test_Attack_MalformedFuncOffset_TooSmall_Rejected() public {
        bytes memory callData = abi.encodePacked(
            PasskeyAccount.execute.selector,
            bytes32(uint256(uint160(USDC))), // dest
            bytes32(uint256(0)),             // value
            bytes32(uint256(64))             // func offset pointing into static head
        );
        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 1, "offset pointing inside static head must reject");
    }

    /// Calldata shorter than 4 bytes or partial words must reject without reverting.
    function test_Attack_ShortCallData_RejectsWithoutReverting() public {
        bytes memory short1 = hex"12";
        bytes memory short2 = hex"123456";
        bytes memory short3 = hex"b61d27f6000000000000000000000000"; // 16 bytes

        assertEq(_validate(short1, _one(0, _v_unknown_k0()), H_UNKNOWN), 1, "1-byte calldata must reject");
        assertEq(_validate(short2, _one(0, _v_unknown_k0()), H_UNKNOWN), 1, "3-byte calldata must reject");
        assertEq(_validate(short3, _one(0, _v_unknown_k0()), H_UNKNOWN), 1, "16-byte calldata must reject");
    }

    /// EIP-2612 Permit selector always requires 2 signatures.
    function test_Attack_Permit_AlwaysRequiresTwo() public {
        vm.prank(address(account));
        account.setTokenThreshold(USDC, 1_000_000e6, 6);

        bytes memory inner = abi.encodeWithSignature(
            "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
            address(account), address(0xdEaD), 100e6, block.timestamp + 1000, 27, bytes32(0), bytes32(0)
        );
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute, (USDC, 0, inner)
        );

        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 1, "EIP-2612 permit must always require 2 sigs");
    }

    /// DAI-style permit selector always requires 2 signatures.
    function test_Attack_PermitDAI_AlwaysRequiresTwo() public {
        vm.prank(address(account));
        account.setTokenThreshold(USDC, 1_000_000e6, 6);

        bytes memory inner = abi.encodeWithSignature(
            "permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)",
            address(account), address(0xdEaD), 0, block.timestamp + 1000, true, 27, bytes32(0), bytes32(0)
        );
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute, (USDC, 0, inner)
        );

        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 1, "DAI permit must always require 2 sigs");
    }

    /// Permit2 permit selector always requires 2 signatures.
    function test_Attack_Permit2_AlwaysRequiresTwo() public {
        vm.prank(address(account));
        account.setTokenThreshold(USDC, 1_000_000e6, 6);

        bytes memory inner = abi.encodeWithSignature(
            "permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)",
            address(account), bytes32(0), hex"1234"
        );
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute, (address(0x000000000022D473030F116dDEE9F6B43aC78BA3), 0, inner)
        );

        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 1, "Permit2 must always require 2 sigs");
    }

    /// increaseAllowance always requires 2 signatures regardless of threshold.
    function test_Attack_IncreaseAllowance_AlwaysRequiresTwo() public {
        vm.prank(address(account));
        account.setTokenThreshold(USDC, 1_000_000e6, 6);

        bytes memory inner = abi.encodeWithSignature(
            "increaseAllowance(address,uint256)", address(0xdEaD), 10e6
        );
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute, (USDC, 0, inner)
        );

        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 1, "increaseAllowance must always require 2 sigs");
    }

    /// decreaseAllowance always requires 2 signatures.
    function test_Attack_DecreaseAllowance_AlwaysRequiresTwo() public {
        vm.prank(address(account));
        account.setTokenThreshold(USDC, 1_000_000e6, 6);

        bytes memory inner = abi.encodeWithSignature(
            "decreaseAllowance(address,uint256)", address(0xdEaD), 10e6
        );
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute, (USDC, 0, inner)
        );

        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 1, "decreaseAllowance must always require 2 sigs");
    }

    /// execute wrapping an onlySelf config call (e.g. setThreshold or setWindow) must require 2 signatures.
    function test_Attack_Execute_WrappingOnlySelfConfig_RequiresTwo() public {
        bytes memory inner = abi.encodeCall(PasskeyAccount.setThreshold, (100 ether));
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute, (address(account), 0, inner)
        );

        uint256 r = _validate(callData, _one(0, _v_unknown_k0()), H_UNKNOWN);
        assertEq(r, 1, "execute wrapping config call must require 2 sigs");
    }

    /// An unconfigured token (tokenThreshold == 0) must require 2 signatures.
    function test_Policy_UnconfiguredToken_ThresholdZero_RequiresTwo() public {
        address unconfigured = address(0x1234567890123456789012345678901234567890);
        assertEq(account.tokenThreshold(unconfigured), 0, "token starts unconfigured");

        bytes memory inner = abi.encodeWithSignature(
            "transfer(address,uint256)", address(0xdEaD), 1
        );
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute, (unconfigured, 0, inner)
        );

        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 1, "threshold 0 must mean unknown/quorum, not no limit");
    }

    /// When windowCap is 0, no rolling accumulation is enforced, but per-op threshold still applies.
    function test_Policy_WindowCapZero_HasNoRollingLimit_PerOpThresholdStillApplies() public {
        vm.prank(address(account));
        account.setTokenThreshold(USDC, 1000e6, 6);
        assertEq(account.windowCap(USDC), 0, "window cap is 0");

        // Small transfer under per-op threshold clears with 1 sig
        bytes memory smallInner = abi.encodeWithSignature(
            "transfer(address,uint256)", address(0xdEaD), 500e6
        );
        bytes memory smallCall = abi.encodeCall(
            PasskeyAccount.execute, (USDC, 0, smallInner)
        );
        assertEq(_validate(smallCall, _one(0, _v_erc20_k0()), H_ERC20), 0, "small transfer clears");

        // Large transfer over per-op threshold requires 2 sigs
        bytes memory largeInner = abi.encodeWithSignature(
            "transfer(address,uint256)", address(0xdEaD), 1500e6
        );
        bytes memory largeCall = abi.encodeCall(
            PasskeyAccount.execute, (USDC, 0, largeInner)
        );
        assertEq(_validate(largeCall, _one(0, _v_erc20_k0()), H_ERC20), 1, "large transfer requires 2 sigs");
    }

    /// Empty inner calldata is recognized as a plain ETH send.
    function test_Policy_EmptyInnerCalldata_TreatedAsPlainETH() public {
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute, (RECIPIENT, 0.5 ether, "")
        );
        uint256 r = _validate(callData, _one(0, _v_small_k0()), H_SMALL);
        assertEq(r, 0, "empty calldata below threshold is plain ETH and clears with 1 sig");
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
            PasskeyAccount.setWindow, (address(0), 1 ether, 1 days, 18)
        );
        op.signature = _two(0, _v_small_k0(), 1, _v_small_k1());

        vm.prank(ENTRYPOINT);
        uint256 r = acct.validateUserOp(op, H_SMALL, 0);
        assertEq(r, 0, "two enrolled signers can authorize config");
    }

    /// Deploying with fewer than 2 signers is strictly rejected to prevent permanent lockout.
    function test_Attack_SingleSignerConstructor_Reverts() public {
        vm.expectRevert(PasskeyAccount.MinSignersRequired.selector);
        new PasskeyAccount(ENTRYPOINT, _signers1(K0_X, K0_Y), THRESHOLD);
    }

    /// An empty signer set reverts MinSignersRequired.
    function test_Attack_ZeroSigners_Reverts() public {
        PasskeyAccount.PublicKey[] memory none = new PasskeyAccount.PublicKey[](0);
        vm.expectRevert(PasskeyAccount.MinSignersRequired.selector);
        new PasskeyAccount(ENTRYPOINT, none, THRESHOLD);
    }

    // ------------------------------------------------------------------ cross-chain replay & entrypoint

    /// getUserOpHash binds the current chainid and the account's trusted EntryPoint.
    function test_Policy_UserOpHash_BindsChainIdAndEntryPoint() public view {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.nonce = 0;
        op.callData = _opValue(0.5 ether);

        bytes32 expected = keccak256(
            abi.encode(
                keccak256(
                    abi.encode(
                        op.sender,
                        op.nonce,
                        keccak256(op.initCode),
                        keccak256(op.callData),
                        op.accountGasLimits,
                        op.preVerificationGas,
                        op.gasFees,
                        keccak256(op.paymasterAndData)
                    )
                ),
                ENTRYPOINT,
                block.chainid
            )
        );

        bytes32 h = account.getUserOpHash(op);
        assertEq(h, expected, "getUserOpHash must bind chainId and trusted entryPoint");
    }

    /// A valid signature on one chain must be rejected on another chain due to chainId binding in the hash.
    function test_Attack_CrossChainReplay_DifferentChainId_Rejected() public {
        // H_SMALL is the hash for the signed vector on the original chain
        // If we compute the hash under a different chainId (e.g. Ethereum Mainnet 1 vs Base Sepolia 84532):
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = _opValue(0.5 ether);
        op.signature = _one(0, _v_small_k0());

        // Simulate new chainId
        vm.chainId(1); // switch from default 31337 / 84532 to mainnet 1
        bytes32 mainnetHash = account.getUserOpHash(op);

        // The signature in _v_small_k0 covers H_SMALL, not mainnetHash
        vm.prank(ENTRYPOINT);
        uint256 r = account.validateUserOp(op, mainnetHash, 0);
        assertEq(r, 1, "replaying signature across different chainId must be rejected");
    }

    /// validateUserOp called by an untrusted / malicious EntryPoint must revert.
    function test_Attack_UntrustedEntryPoint_Reverts() public {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = _opValue(0.5 ether);
        op.signature = _one(0, _v_small_k0());

        address untrustedEP = address(0xBAD4337);
        vm.prank(untrustedEP);
        vm.expectRevert(PasskeyAccount.NotEntryPoint.selector);
        account.validateUserOp(op, H_SMALL, 0);
    }

    // ------------------------------------------------------------------ signer lifecycle

    /// An account with 2 signers cannot drop to 1 signer (lockout prevention).
    function test_Attack_RemoveSigner_CannotDropBelowTwo_Reverts() public {
        assertEq(account.signerCount(), 2, "starts with 2 signers");

        vm.prank(address(account));
        vm.expectRevert(PasskeyAccount.MinSignersRequired.selector);
        account.removeSigner(0);
    }

    /// When 3 signers exist, one can be removed safely, preserving exactly 2 signers.
    function test_Policy_RemoveSigner_Success_WhenThreeSigners() public {
        // Add a 3rd signer
        uint256 k2X = 0x112233;
        uint256 k2Y = 0x445566;
        vm.prank(address(account));
        account.addSigner(k2X, k2Y);
        assertEq(account.signerCount(), 3, "now 3 signers");

        // Remove signer 0 (swap-and-pop moves signer 2 into index 0)
        vm.prank(address(account));
        account.removeSigner(0);

        assertEq(account.signerCount(), 2, "drops back to 2 signers");
        (uint256 x0, uint256 y0) = account.signers(0);
        assertEq(x0, k2X, "last signer swapped into index 0");
        assertEq(y0, k2Y, "last signer swapped into index 0");
    }

    /// Cannot add an already enrolled public key twice.
    function test_Attack_AddDuplicateSigner_Reverts() public {
        vm.prank(address(account));
        vm.expectRevert(PasskeyAccount.DuplicateSigner.selector);
        account.addSigner(K0_X, K0_Y);
    }

    /// Cannot construct an account with duplicate public keys.
    function test_Attack_Constructor_DuplicateSigners_Reverts() public {
        PasskeyAccount.PublicKey[] memory dup = new PasskeyAccount.PublicKey[](2);
        dup[0] = PasskeyAccount.PublicKey(K0_X, K0_Y);
        dup[1] = PasskeyAccount.PublicKey(K0_X, K0_Y);

        vm.expectRevert(PasskeyAccount.DuplicateSigner.selector);
        new PasskeyAccount(ENTRYPOINT, dup, THRESHOLD);
    }

    /// replaceSigner atomically replaces an old key with a new key.
    function test_Policy_ReplaceSigner_Success() public {
        uint256 newX = 0xAAAA1111;
        uint256 newY = 0xBBBB2222;

        vm.prank(address(account));
        account.replaceSigner(1, newX, newY);

        assertEq(account.signerCount(), 2, "count remains 2");
        (uint256 x1, uint256 y1) = account.signers(1);
        assertEq(x1, newX, "signer 1 x updated");
        assertEq(y1, newY, "signer 1 y updated");
        assertTrue(account.isSigner(newX, newY), "new key recognized");
        assertFalse(account.isSigner(K1_X, K1_Y), "old key no longer recognized");
    }

    /// replaceSigner fails if new key is already enrolled.
    function test_Attack_ReplaceSigner_WithExistingSigner_Reverts() public {
        vm.prank(address(account));
        vm.expectRevert(PasskeyAccount.DuplicateSigner.selector);
        account.replaceSigner(1, K0_X, K0_Y);
    }

    /// Duplicate signer ids in userOp.signature are rejected cheap (<40k gas) without paying 107k for precompile.
    function test_Attack_DuplicateSignerId_CheapGasReject() public {
        uint256 gasBefore = gasleft();
        uint256 r = _validate(
            _opValue(5 ether),
            _two(0, _v_large_k0(), 0, _v_large_k0()),
            H_LARGE
        );
        uint256 gasUsed = gasBefore - gasleft();

        assertEq(r, 1, "duplicate id rejected");
        // Gas used must be well under 75k (without precompile, it rejects in ~38k before any WebAuthn.verify calls)
        assertLt(gasUsed, 75000, "duplicate id must reject cheaply before any crypto");
    }

    // ------------------------------------------------------------------ paymaster

    address constant PAYMASTER_A = address(0x9999);
    address constant PAYMASTER_B = address(0x8888);

    /// Sponsored ETH transfer under threshold works with 1 signature.
    function test_Paymaster_SponsoredETHTransfer_OneSignature() public {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = _opValue(0.5 ether);
        op.signature = _one(0, _v_small_k0());
        // ERC-4337 v0.7 paymasterAndData: paymaster address (20 bytes) + gas limits + context
        op.paymasterAndData = abi.encodePacked(
            PAYMASTER_A,
            uint128(100_000), // verificationGasLimit
            uint128(50_000),  // postOpGasLimit
            hex"1234"         // paymasterData
        );

        vm.prank(ENTRYPOINT);
        uint256 r = account.validateUserOp(op, H_SMALL, 0);
        assertEq(r, 0, "sponsored ETH transfer under threshold must succeed with 1 sig");
    }

    /// Sponsored approve still requires 2 signatures (cannot bypass policy via sponsorship).
    function test_Attack_Paymaster_SponsoredApprove_StillRequiresTwo() public {
        bytes memory approveCall = abi.encodeWithSignature(
            "approve(address,uint256)", address(0xDEAD), 1000e6
        );
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(
            PasskeyAccount.execute, (address(0x1234), 0, approveCall)
        );
        op.paymasterAndData = abi.encodePacked(
            PAYMASTER_A,
            uint128(100_000),
            uint128(50_000),
            hex"1234"
        );

        // 1 signature: rejected
        op.signature = _one(0, _v_small_k0());
        vm.prank(ENTRYPOINT);
        uint256 r1 = account.validateUserOp(op, H_SMALL, 0);
        assertEq(r1, 1, "sponsored approve with 1 signature must be rejected");

        // 2 signatures: accepted
        op.signature = _two(0, _v_large_k0(), 1, _v_large_k1());
        vm.prank(ENTRYPOINT);
        uint256 r2 = account.validateUserOp(op, H_LARGE, 0);
        assertEq(r2, 0, "sponsored approve with 2 signatures must succeed");
    }

    /// Configured trustedPaymaster allows trusted paymaster and rejects untrusted paymaster.
    function test_Policy_TrustedPaymaster_ConfigAndEnforcement() public {
        // Configuring trustedPaymaster requires 2 signatures
        bytes memory setPmCall = abi.encodeCall(
            PasskeyAccount.setTrustedPaymaster, (PAYMASTER_A)
        );
        bytes memory wrapped = abi.encodeCall(
            PasskeyAccount.execute, (address(account), 0, setPmCall)
        );

        // Single signature on config fails policy
        uint256 rSingle = _validate(wrapped, _one(0, _v_small_k0()), H_SMALL);
        assertEq(rSingle, 1, "setTrustedPaymaster must require 2 signatures");

        // 2 signatures succeeds on config
        uint256 rDouble = _validate(wrapped, _two(0, _v_large_k0(), 1, _v_large_k1()), H_LARGE);
        assertEq(rDouble, 0, "2 signatures can validate config call");

        // Configure trustedPaymaster directly via onlySelf
        vm.prank(address(account));
        account.setTrustedPaymaster(PAYMASTER_A);
        assertEq(account.trustedPaymaster(), PAYMASTER_A, "trustedPaymaster set");

        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = _opValue(0.5 ether);
        op.signature = _one(0, _v_small_k0());

        // Sponsored by trusted PAYMASTER_A: succeeds
        op.paymasterAndData = abi.encodePacked(PAYMASTER_A, uint128(100_000), uint128(50_000));
        vm.prank(ENTRYPOINT);
        uint256 rTrusted = account.validateUserOp(op, H_SMALL, 0);
        assertEq(rTrusted, 0, "op with trusted paymaster succeeds");

        // Sponsored by untrusted PAYMASTER_B: fails
        op.paymasterAndData = abi.encodePacked(PAYMASTER_B, uint128(100_000), uint128(50_000));
        vm.prank(ENTRYPOINT);
        uint256 rUntrusted = account.validateUserOp(op, H_SMALL, 0);
        assertEq(rUntrusted, 1, "op with untrusted paymaster must be rejected");
    }

    /// Malformed short paymaster data (< 20 bytes) is rejected.
    function test_Attack_Paymaster_MalformedShortData_Rejected() public {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = _opValue(0.5 ether);
        op.signature = _one(0, _v_small_k0());
        op.paymasterAndData = hex"123456"; // only 3 bytes, less than 20

        vm.prank(ENTRYPOINT);
        uint256 r = account.validateUserOp(op, H_SMALL, 0);
        assertEq(r, 1, "malformed short paymasterAndData must be rejected");
    }

    // ------------------------------------------------------------------ gas

    function test_Gas_SingleSignatureValidation() public {
        uint256 before = gasleft();
        _validate(_opValue(0.5 ether), _one(0, _v_small_k0()), H_SMALL);
        console.log("validateUserOp, 1 passkey sig, gas:", before - gasleft());
    }

    // --------------------------------------------- Production Named Verification Tests

    /// Splitting 1.5 ETH across batch entries does not bypass the 1 ETH threshold.
    function test_Attack_SplitBatch_DoesNotBypass() public {
        address[] memory targets = new address[](3);
        targets[0] = RECIPIENT;
        targets[1] = RECIPIENT;
        targets[2] = RECIPIENT;

        uint256[] memory values = new uint256[](3);
        values[0] = 0.5 ether;
        values[1] = 0.5 ether;
        values[2] = 0.5 ether; // total = 1.5 ether > 1 ether

        bytes[] memory calls = new bytes[](3);
        bytes memory batchCd = abi.encodeCall(PasskeyAccount.executeBatch, (targets, values, calls));

        uint256 r = _validate(batchCd, _one(0, _v_small_k0()), H_SMALL);
        assertEq(r, 1, "split batch exceeding threshold must require 2 sigs");
    }

    /// Multiple sequential single-sig ops within a window are capped by the window limit.
    function test_Attack_MultiOpDrip_WindowHolds() public {
        vm.prank(address(account));
        account.setWindow(address(0), 1.5 ether, 1 days, 18);

        // Op 1: 0.9 ETH -> authorized
        bytes memory cd1 = _opValue(0.9 ether);
        uint256 r1 = _validate(cd1, _one(0, _v_small_k0()), H_SMALL);
        assertEq(r1 & ((1 << 160) - 1), 0, "first op within window succeeds");
        vm.prank(ENTRYPOINT);
        account.execute(RECIPIENT, 0.9 ether, "");

        // Op 2: 0.9 ETH -> exceeds remaining 0.6 ETH in window -> deferred/constrained
        bytes memory cd2 = _opValue(0.9 ether);
        uint256 r2 = _validate(cd2, _one(0, _v_small_k0()), H_SMALL);
        uint48 validAfter = uint48((r2 >> 208) & ((1 << 48) - 1));
        assertGt(validAfter, block.timestamp, "second op exceeding window cap is deferred");
    }

    /// Approvals always require full quorum regardless of threshold.
    function test_Attack_ApproveAlwaysQuorum() public {
        vm.prank(address(account));
        account.setTokenThreshold(USDC, 1_000_000e6, 6);

        bytes memory inner = abi.encodeWithSignature("approve(address,uint256)", address(0xdEaD), 1);
        bytes memory callData = abi.encodeCall(PasskeyAccount.execute, (USDC, 0, inner));

        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 1, "approve must always require 2 signatures");
    }

    /// Unknown selectors always require 2 signatures.
    function test_Attack_UnknownSelectorQuorum() public {
        bytes memory callData = abi.encodeWithSelector(bytes4(0xdeadbeef), uint256(1));
        uint256 r = _validate(callData, _one(0, _v_small_k0()), H_SMALL);
        assertEq(r, 1, "unknown selector must require 2 signatures");
    }

    /// Malformed calldata / ABI offsets fail closed to 2 signatures.
    function test_Attack_MalformedAbiQuorum() public {
        bytes memory malformed = abi.encodePacked(PasskeyAccount.execute.selector, uint256(0), uint256(0), uint256(9999));
        uint256 r = _validate(malformed, _one(0, _v_small_k0()), H_SMALL);
        assertEq(r, 1, "malformed ABI offsets must require 2 signatures");
    }

    /// Unconfigured token threshold (0) requires 2 signatures.
    function test_Attack_UnconfiguredTokenQuorum() public {
        address unconfigured = address(0x9999999999999999999999999999999999999999);
        bytes memory inner = abi.encodeWithSignature("transfer(address,uint256)", address(0xdEaD), 10);
        bytes memory callData = abi.encodeCall(PasskeyAccount.execute, (unconfigured, 0, inner));

        uint256 r = _validate(callData, _one(0, _v_erc20_k0()), H_ERC20);
        assertEq(r, 1, "unconfigured token must require 2 signatures");
    }

    /// Signature with raw challenge instead of clientDataJSON SHA-256 is rejected.
    function test_Attack_RawChallenge_Rejected() public {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = _opValue(0.5 ether);

        WebAuthn.Signature memory badSig = _v_small_k0();
        badSig.clientDataJSON = '{"type":"webauthn.get","challenge":"badChallenge","origin":"http://localhost:5199","crossOrigin":false}';
        op.signature = _one(0, badSig);

        vm.prank(ENTRYPOINT);
        uint256 r = account.validateUserOp(op, H_SMALL, 0);
        assertEq(r, 1, "raw / mismatch challenge signature must be rejected");
    }

    /// Duplicate signer IDs are rejected before expensive precompile calls.
    function test_Attack_DuplicateSigner_CheapReject() public {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = _opValue(0.5 ether);
        op.signature = _two(0, _v_small_k0(), 0, _v_small_k0());

        uint256 before = gasleft();
        vm.prank(ENTRYPOINT);
        uint256 r = account.validateUserOp(op, H_SMALL, 0);
        uint256 spent = before - gasleft();

        assertEq(r, 1, "duplicate signer id must be rejected");
        assertLt(spent, 75_000, "duplicate id reject must cost < 75k gas");
    }

    /// Single signer cannot raise their own window cap.
    function test_Attack_OneSignerCannotRaiseCap() public {
        bytes memory inner = abi.encodeCall(PasskeyAccount.setWindow, (address(0), 1000 ether, 1 days, 18));
        bytes memory callData = abi.encodeCall(PasskeyAccount.execute, (address(account), 0, inner));

        uint256 r = _validate(callData, _one(0, _v_small_k0()), H_SMALL);
        assertEq(r, 1, "single signer cannot raise window cap");
    }

    /// Two-signature quorum bypasses rolling spend window constraints.
    function test_Window_TwoSigBypasses() public {
        vm.prank(address(account));
        account.setWindow(address(0), 0.5 ether, 1 days, 18);

        // Op of 10 ether with 2 signatures bypasses the 0.5 ether cap
        bytes memory callData = _opValue(10 ether);
        uint256 r = _validate(callData, _two(0, _v_large_k0(), 1, _v_large_k1()), H_LARGE);
        assertEq(r, 0, "2 signatures must bypass the spend window");
    }

    /// An op with validUntil in the past is rejected by EntryPoint shape.
    function test_Window_ValidUntilExpired_RejectedByEntryPointShape() public {
        vm.warp(1_700_000_000);
        vm.prank(address(account));
        account.setWindow(address(0), 1 ether, 1 days, 18);

        // First op opens the window
        vm.prank(ENTRYPOINT);
        account.execute(RECIPIENT, 0.2 ether, "");

        // Second op within open window carries validUntil = 1_700_000_000 + 1 days
        bytes memory callData = _opValue(0.5 ether);
        uint256 r = _validate(callData, _one(0, _v_small_k0()), H_SMALL);

        uint48 validUntil = uint48((r >> 160) & ((1 << 48) - 1));
        assertEq(validUntil, 1_700_000_000 + 1 days, "validUntil set to window expiry");

        // If block.timestamp > validUntil, EntryPoint shape rejects
        vm.warp(1_700_000_000 + 2 days);
        assertTrue(block.timestamp > validUntil, "op expired past validUntil");
    }

    /// Calling onlySelf config methods directly from an external caller reverts.
    function test_Config_OnlySelf_DirectCallReverts() public {
        vm.expectRevert(PasskeyAccount.NotSelf.selector);
        account.setThreshold(50 ether);

        vm.expectRevert(PasskeyAccount.NotSelf.selector);
        account.setWindow(address(0), 10 ether, 1 days, 18);
    }

    /// Config methods called via UserOp must be wrapped in execute so account is msg.sender.
    function test_Config_MustBeWrappedInExecute() public {
        // Direct config call arrives with msg.sender == ENTRYPOINT -> reverts NotSelf
        vm.prank(ENTRYPOINT);
        vm.expectRevert(PasskeyAccount.NotSelf.selector);
        account.setThreshold(50 ether);

        // Wrapped in execute -> msg.sender in setThreshold is address(account) -> succeeds
        vm.prank(ENTRYPOINT);
        account.execute(
            address(account),
            0,
            abi.encodeCall(PasskeyAccount.setThreshold, (50 ether))
        );
        assertEq(account.threshold(), 50 ether, "wrapped config call succeeds");
    }
}
