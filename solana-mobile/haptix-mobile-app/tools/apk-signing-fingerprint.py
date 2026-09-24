#!/usr/bin/env python3
"""Print the SHA-256 signing-certificate fingerprint of an APK.

Android's Digital Asset Links check compares this exact value against
`sha256_cert_fingerprints` in `.well-known/assetlinks.json`, so it is the number to
publish whenever the signing keystore changes.

`keytool -printcert -jarfile` does not work here: release APKs are signed with the
v2/v3 scheme, which keeps the certificate in the APK Signing Block rather than in a
`META-INF/*.RSA` entry. This reads it out of that block directly.

    python3 tools/apk-signing-fingerprint.py path/to/app.apk
"""

import hashlib
import struct
import sys

V2_BLOCK_ID = 0x7109871A


def read_length_prefixed(buf: bytes, offset: int) -> tuple[bytes, int]:
    """Read one uint32-length-prefixed field, returning (value, next_offset)."""
    length = struct.unpack("<I", buf[offset : offset + 4])[0]
    return buf[offset + 4 : offset + 4 + length], offset + 4 + length


def signing_block_pairs(data: bytes) -> list[tuple[int, bytes]]:
    """Split the APK Signing Block into its (id, value) pairs."""
    eocd = data.rfind(b"PK\x05\x06")
    if eocd == -1:
        raise SystemExit("not a zip: no end-of-central-directory record")
    central_dir = struct.unpack("<I", data[eocd + 16 : eocd + 20])[0]

    if data[central_dir - 16 : central_dir] != b"APK Sig Block 42":
        raise SystemExit("no APK Signing Block: this APK is v1-signed or unsigned")

    # The block is framed by a repeated uint64 size, then the magic.
    block_size = struct.unpack("<Q", data[central_dir - 24 : central_dir - 16])[0]
    cursor, end = central_dir - 8 - block_size + 8, central_dir - 24

    pairs = []
    while cursor < end:
        length = struct.unpack("<Q", data[cursor : cursor + 8])[0]
        block_id = struct.unpack("<I", data[cursor + 8 : cursor + 12])[0]
        pairs.append((block_id, data[cursor + 12 : cursor + 8 + length]))
        cursor += 8 + length
    return pairs


def v2_certificate(value: bytes) -> bytes:
    """Dig the first signer's certificate out of a v2 block value."""
    signers, _ = read_length_prefixed(value, 0)
    signer, _ = read_length_prefixed(signers, 0)
    signed_data, _ = read_length_prefixed(signer, 0)

    # signed_data is digests, then certificates, then additional attributes.
    _, offset = read_length_prefixed(signed_data, 0)
    certificates, _ = read_length_prefixed(signed_data, offset)

    certificate, _ = read_length_prefixed(certificates, 0)
    return certificate


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: {sys.argv[0]} <app.apk>")

    with open(sys.argv[1], "rb") as handle:
        data = handle.read()

    for block_id, value in signing_block_pairs(data):
        if block_id != V2_BLOCK_ID:
            continue
        digest = hashlib.sha256(v2_certificate(value)).hexdigest().upper()
        print(":".join(digest[i : i + 2] for i in range(0, len(digest), 2)))
        return

    raise SystemExit("no v2 signer found: this APK uses only the v3/v4 scheme")


if __name__ == "__main__":
    main()
