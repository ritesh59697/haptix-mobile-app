// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {PasskeyAccount, PackedUserOperation} from "../src/PasskeyAccount.sol";
import {WebAuthn} from "../src/WebAuthn.sol";

/// @notice Fixtures captured from a REAL Touch ID passkey on macOS via
///         web/index.html, verified against the live Base Sepolia precompile.
///
///         Note the clientDataJSON below ends with `"crossOrigin":false` --
///         a field Chrome appends and hand-written test vectors usually omit.
///         Verifying by fixed-offset substring (rather than parsing the JSON)
///         is what makes the contract tolerate authenticator-specific fields
///         like this one. A stricter whole-string comparison would have broken
///         the moment it met real hardware.
contract RealPasskeyTest is Test {
    uint256 constant X = 0x0a8f6391ed420c4e95dc28a9e9d7f521e8b8e8bc02a5498767dab23e186fb4b1;
    uint256 constant Y = 0x2f80f498ca651d787a7d2890539d8c3c1e5e56f386a8718cb158a80778dd99ad;

    bytes32 constant CHALLENGE =
        0x1111111111111111111111111111111111111111111111111111111111111111;

    function _realSig() internal pure returns (WebAuthn.Signature memory) {
        return WebAuthn.Signature({
            authenticatorData: hex"49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97630500000000",
            clientDataJSON: '{"type":"webauthn.get","challenge":"ERERERERERERERERERERERERERERERERERERERERERE","origin":"http://localhost:5199","crossOrigin":false}',
            challengeIndex: 23,
            typeIndex: 1,
            r: 0xb9bc57c560dab5489f3db4e24abf5b14cc0530b66f7b564e61971fc94e9f740b,
            s: 0x181ea0fe175ff54f13e48553c482d52e9abf02b976628708627e5199db7a8607
        });
    }

    function verify(
        bytes memory challenge, bool requireUV,
        WebAuthn.Signature memory sig, uint256 x, uint256 y
    ) external view returns (bool) {
        return WebAuthn.verify(challenge, requireUV, sig, x, y);
    }

    uint256 constant K1_X =
        0xe674161f196651a12baec4a98706b5ea424f21104b5bf793f75cbdfee531828b;
    uint256 constant K1_Y =
        0xd19ebbc657185048e777880b61a909ad683c1ee61df458fd707a802de8a9557e;

    function _signers2(uint256 x0, uint256 y0, uint256 x1, uint256 y1)
        internal pure returns (PasskeyAccount.PublicKey[] memory a)
    {
        a = new PasskeyAccount.PublicKey[](2);
        a[0] = PasskeyAccount.PublicKey(x0, y0);
        a[1] = PasskeyAccount.PublicKey(x1, y1);
    }

    /// Real hardware signature must verify through the full WebAuthn path.
    function test_RealTouchIDSignature_Verifies() public view {
        bool ok = this.verify(
            abi.encodePacked(CHALLENGE), true, _realSig(), X, Y
        );
        assertTrue(ok, "real Touch ID passkey must verify");
    }

    /// Same signature, wrong challenge -> must fail.
    function test_RealSignature_WrongChallenge_Rejected() public view {
        bool ok = this.verify(
            abi.encodePacked(bytes32(uint256(0xdead))), true, _realSig(), X, Y
        );
        assertFalse(ok, "signature must not verify against a different challenge");
    }

    /// Same signature, someone else's public key -> must fail.
    function test_RealSignature_WrongKey_Rejected() public view {
        bool ok = this.verify(
            abi.encodePacked(CHALLENGE), true, _realSig(), X + 1, Y
        );
        assertFalse(ok, "signature must not verify under a different pubkey");
    }

    /// End-to-end: a real passkey authorizing a real UserOp through the account.
    function test_RealPasskey_AuthorizesSmallTransfer() public {
        PasskeyAccount account = new PasskeyAccount(address(0xE), _signers2(X, Y, K1_X, K1_Y), 1 ether);
        vm.deal(address(account), 10 ether);

        uint256[] memory ids = new uint256[](1);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](1);
        ids[0] = 0; sigs[0] = _realSig();

        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(
            PasskeyAccount.execute, (address(0xBEEF), 0.5 ether, "")
        );
        op.signature = abi.encode(ids, sigs);

        vm.prank(address(0xE));
        uint256 r = account.validateUserOp(op, CHALLENGE, 0);
        assertEq(r, 0, "real passkey should authorize a below-threshold transfer");
    }

    /// And the policy still holds against real hardware: one passkey is not
    /// enough above the threshold, no matter how genuine the signature is.
    function test_RealPasskey_CannotClearThresholdAlone() public {
        PasskeyAccount account = new PasskeyAccount(address(0xE), _signers2(X, Y, K1_X, K1_Y), 1 ether);
        vm.deal(address(account), 10 ether);

        uint256[] memory ids = new uint256[](1);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](1);
        ids[0] = 0; sigs[0] = _realSig();

        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(
            PasskeyAccount.execute, (address(0xBEEF), 5 ether, "")
        );
        op.signature = abi.encode(ids, sigs);

        vm.prank(address(0xE));
        uint256 r = account.validateUserOp(op, CHALLENGE, 0);
        assertEq(r, 1, "genuine signature, but one is not enough above threshold");
    }

    /// Replaying a real Touch ID signature signed for Base Sepolia on Ethereum Mainnet is rejected.
    function test_Attack_RealPasskey_CrossChainReplay_Rejected() public {
        PasskeyAccount account = new PasskeyAccount(address(0xE), _signers2(X, Y, K1_X, K1_Y), 1 ether);
        vm.deal(address(account), 10 ether);

        uint256[] memory ids = new uint256[](1);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](1);
        ids[0] = 0; sigs[0] = _realSig();

        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(
            PasskeyAccount.execute, (address(0xBEEF), 0.5 ether, "")
        );
        op.signature = abi.encode(ids, sigs);

        // Compute hash under another chainId (e.g. 1)
        vm.chainId(1);
        bytes32 mainnetHash = account.getUserOpHash(op);

        vm.prank(address(0xE));
        uint256 r = account.validateUserOp(op, mainnetHash, 0);
        assertEq(r, 1, "cross-chain replayed hardware signature must fail validation");
    }
}
