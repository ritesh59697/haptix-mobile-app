// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {PasskeyAccount} from "../src/PasskeyAccount.sol";
import {WebAuthn} from "../src/WebAuthn.sol";

/// @notice Post-deploy checks against the live contract.
/// @dev Run:
///        ACCOUNT=0x... forge script script/Verify.s.sol:Verify \
///          --rpc-url https://sepolia.base.org
///
///      Read-only: no broadcast, no key. Confirms the deployed account holds
///      the expected passkey and that a REAL Touch ID signature verifies
///      against it on-chain.
contract Verify is Script {
    uint256 constant PASSKEY_X =
        0x0a8f6391ed420c4e95dc28a9e9d7f521e8b8e8bc02a5498767dab23e186fb4b1;
    uint256 constant PASSKEY_Y =
        0x2f80f498ca651d787a7d2890539d8c3c1e5e56f386a8718cb158a80778dd99ad;
    uint256 constant SIGNER1_X =
        0x6b8584d043dde84421a6dbf378bfc19b323bebf87337c9d369b512172717ff33;
    uint256 constant SIGNER1_Y =
        0x4813ad13e76a40044cc1cdda0cbea4e68c2f3005c6279ecaf47568b10f5e0343;

    function run() external view {
        address addr = vm.envAddress("ACCOUNT");
        PasskeyAccount account = PasskeyAccount(payable(addr));

        console.log("=== deployed state ===");
        console.log("address:     ", addr);
        console.log("codesize:    ", addr.code.length);
        console.log("entryPoint:  ", account.entryPoint());
        console.log("signerCount: ", account.signerCount());
        console.log("threshold:   ", account.threshold());
        console.log("windowSecs:  ", account.windowSeconds());

        (uint256 x, uint256 y) = account.signers(0);
        console.log("");
        console.log("=== signer 0 ===");
        console.logBytes32(bytes32(x));
        console.logBytes32(bytes32(y));
        require(x == PASSKEY_X && y == PASSKEY_Y, "signer 0 mismatch");
        console.log("-> matches Touch ID passkey 'signer-1'");

        require(account.signerCount() == 2, "expected 2 enrolled signers");
        (uint256 x1, uint256 y1) = account.signers(1);
        console.log("");
        console.log("=== signer 1 ===");
        console.logBytes32(bytes32(x1));
        console.logBytes32(bytes32(y1));
        require(x1 == SIGNER1_X && y1 == SIGNER1_Y, "signer 1 mismatch");
        console.log("-> matches Touch ID passkey 'signer-2'");
        console.log("");
        console.log("Both enrolled: the account CAN be configured (config calls");
        console.log("require a 2-signature quorum).");

        // The precompile is what makes passkey verification cheap. Confirm it
        // is live at this address by replaying the signature captured from the
        // browser harness.
        bytes32 message =
            0xe5f8d2c37c42f42a299234e33eaa35372e14e4421cb7b67f4209822ec3b44913;
        uint256 r =
            0xb9bc57c560dab5489f3db4e24abf5b14cc0530b66f7b564e61971fc94e9f740b;
        uint256 s =
            0x181ea0fe175ff54f13e48553c482d52e9abf02b976628708627e5199db7a8607;

        (bool ok, bytes memory ret) = address(0x100).staticcall(
            abi.encode(message, r, s, PASSKEY_X, PASSKEY_Y)
        );

        console.log("");
        console.log("=== RIP-7212 precompile ===");
        console.log("call ok:     ", ok);
        console.log("returndata:  ", ret.length);
        require(
            ok && ret.length == 32 && abi.decode(ret, (uint256)) == 1,
            "real passkey signature failed on-chain"
        );
        console.log("-> real Touch ID signature verifies ON-CHAIN");
    }
}
