// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @title WebAuthn signature verification for P-256 passkeys.
/// @notice A passkey does not sign the bytes you hand it. The authenticator builds
///         its own message and signs that. To verify on-chain we must rebuild the
///         exact same preimage:
///
///             sha256( authenticatorData || sha256(clientDataJSON) )
///
///         Getting this wrong is the single most common bug in passkey wallets --
///         signatures verify in tests (where you control both sides) and fail
///         against real hardware.
library WebAuthn {
    /// @dev secp256r1 group order. Used for low-s normalization.
    uint256 constant P256_N =
        0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551;

    /// @dev RIP-7212 precompile. Verifies a P-256 signature for ~3450 gas.
    address constant P256_VERIFIER = address(0x100);

    /// @dev authenticatorData flag bits.
    bytes1 constant FLAG_USER_PRESENT = 0x01; // UP: a human touched the device
    bytes1 constant FLAG_USER_VERIFIED = 0x04; // UV: biometric/PIN was checked

    struct Signature {
        bytes authenticatorData;
        string clientDataJSON;
        /// @dev Byte offset of the `"challenge":"` *value* within clientDataJSON.
        uint256 challengeIndex;
        /// @dev Byte offset of the `"type":"` value within clientDataJSON.
        uint256 typeIndex;
        uint256 r;
        uint256 s;
    }

    /// @notice Verify a WebAuthn assertion over `challenge` by public key (x, y).
    /// @param requireUV Demand that the authenticator actually checked a biometric
    ///        or PIN. User Presence alone means "someone tapped the key" -- that is
    ///        not the same as "the owner authenticated".
    function verify(
        bytes memory challenge,
        bool requireUV,
        Signature memory sig,
        uint256 x,
        uint256 y
    ) internal view returns (bool) {
        // --- 1. Signature malleability & range ----------------------------
        // (r, s) and (r, n-s) are both valid ECDSA signatures over the same
        // message. If we let both through, an attacker can mint a second valid
        // signature for a UserOp they already saw. Anything keyed on the
        // signature bytes (replay guards, dedup) breaks. Enforce low-s (s <= n/2)
        // and ensure 0 < r < n and 0 < s <= n/2.
        if (sig.r == 0 || sig.r >= P256_N || sig.s == 0 || sig.s > P256_N / 2) {
            return false;
        }

        // --- 2. authenticatorData flags ------------------------------------
        // Layout: rpIdHash (32) || flags (1) || signCount (4) || [attested data]
        if (sig.authenticatorData.length < 37) return false;
        bytes1 flags = sig.authenticatorData[32];
        if (flags & FLAG_USER_PRESENT != FLAG_USER_PRESENT) return false;
        if (requireUV && (flags & FLAG_USER_VERIFIED != FLAG_USER_VERIFIED)) {
            return false;
        }

        // --- 3. clientDataJSON: type must be "webauthn.get" -----------------
        // Without this check a *registration* response (webauthn.create) could be
        // replayed as an *authentication* response.
        bytes memory cd = bytes(sig.clientDataJSON);
        if (!_sliceEquals(cd, sig.typeIndex, '"type":"webauthn.get"')) {
            return false;
        }

        // --- 4. clientDataJSON: challenge must match ------------------------
        // The challenge is the UserOp hash, base64url-encoded without padding.
        // We rebuild the expected substring and compare, rather than parsing
        // JSON on-chain.
        string memory expected = _b64url(challenge);
        if (
            !_sliceEquals(
                cd,
                sig.challengeIndex,
                string.concat('"challenge":"', expected, '"')
            )
        ) {
            return false;
        }

        // --- 5. Rebuild the signed preimage and verify ----------------------
        bytes32 clientHash = sha256(cd);
        bytes32 message = sha256(
            abi.encodePacked(sig.authenticatorData, clientHash)
        );

        return _p256Verify(message, sig.r, sig.s, x, y);
    }

    /// @dev Calls the RIP-7212 precompile.
    ///      MUST be a staticcall: on some OP-stack nodes the precompile returns
    ///      empty returndata when reached through a state-modifying call frame,
    ///      even though the call "succeeds". staticcall is the documented fix.
    ///      A naive `call` here fails only on real testnets, never in Foundry --
    ///      a genuinely nasty way to lose an afternoon.
    function _p256Verify(
        bytes32 message,
        uint256 r,
        uint256 s,
        uint256 x,
        uint256 y
    ) private view returns (bool) {
        bytes memory args = abi.encode(message, r, s, x, y);
        (bool ok, bytes memory ret) = P256_VERIFIER.staticcall(args);
        // Failed verification returns empty returndata, not 0. Both mean invalid.
        return ok && ret.length == 32 && abi.decode(ret, (uint256)) == 1;
    }

    function _sliceEquals(
        bytes memory haystack,
        uint256 offset,
        string memory needle
    ) private pure returns (bool) {
        bytes memory n = bytes(needle);
        if (offset + n.length > haystack.length) return false;
        for (uint256 i = 0; i < n.length; i++) {
            if (haystack[offset + i] != n[i]) return false;
        }
        return true;
    }

    /// @dev base64url encode, no padding -- the encoding WebAuthn uses for the
    ///      challenge field in clientDataJSON.
    function _b64url(bytes memory data) private pure returns (string memory) {
        if (data.length == 0) return "";
        bytes memory tbl =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

        uint256 len = data.length;
        uint256 outLen = ((len + 2) / 3) * 4;
        bytes memory out = new bytes(outLen);

        uint256 j = 0;
        for (uint256 i = 0; i < len; i += 3) {
            uint256 chunk = uint256(uint8(data[i])) << 16;
            if (i + 1 < len) chunk |= uint256(uint8(data[i + 1])) << 8;
            if (i + 2 < len) chunk |= uint256(uint8(data[i + 2]));

            out[j++] = tbl[(chunk >> 18) & 0x3f];
            out[j++] = tbl[(chunk >> 12) & 0x3f];
            out[j++] = tbl[(chunk >> 6) & 0x3f];
            out[j++] = tbl[chunk & 0x3f];
        }

        // Trim to the unpadded length (base64url drops '=').
        uint256 rem = len % 3;
        uint256 finalLen = rem == 0 ? outLen : outLen - (3 - rem);
        assembly {
            mstore(out, finalLen)
        }
        return string(out);
    }
}
