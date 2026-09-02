// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "../src/WebAuthn.sol";
import "../src/PasskeyAccount.sol";

contract VerifyLiveSig is Test {
    function testLiveSignature() public view {
        bytes memory sigBytes = hex"00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000170000000000000000000000000000000000000000000000000000000000000001e5d9291a5e60a0d45c48b721dab5af7df4447296a2ae49c72b4716117014aa406ca86e93470a57816f250266972e9c6f91336559d9ec89657a7f40ffcda95468000000000000000000000000000000000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000877b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a224663684276453941426d496d67324179505656645f43304f654f774d356445723456643735716555465f4d222c226f726967696e223a22687474703a2f2f6c6f63616c686f73743a3537353437222c2263726f73734f726967696e223a66616c73657d00000000000000000000000000000000000000000000000000";

        (uint256[] memory ids, WebAuthn.Signature[] memory sigs) =
            abi.decode(sigBytes, (uint256[], WebAuthn.Signature[]));

        console.log("ids length:", ids.length);
        console.log("signer id 0:", ids[0]);
        console.log("sigs length:", sigs.length);
        console.log("authenticatorData len:", sigs[0].authenticatorData.length);
        console.log("clientDataJSON:", sigs[0].clientDataJSON);
        console.log("challengeIndex:", sigs[0].challengeIndex);
        console.log("typeIndex:", sigs[0].typeIndex);
        console.log("r:", sigs[0].r);
        console.log("s:", sigs[0].s);

        // Signer #0 on contract 0xEe8888BDd3d6a2B3F17173773511D151b74961d6
        uint256 x = 0x495fe3f6029fc58c8dabf8621da1ac5f59852bdaee5731157d965ab7f1abb47c;
        uint256 y = 0xbf5cb5d1c5bd72b67aeacf82a49150f46dabd7d5a9cd900cda0875c7084ee724;

        bytes32 userOpHash = 0x15c841bc4f408664e68360523d551dfc2d0e78ec0ce5d12be1577be6a79417f3;

        // Step 1: Malleability
        console.log("Check 1 - r != 0:", sigs[0].r != 0);
        console.log("Check 1 - s <= N/2:", sigs[0].s <= WebAuthn.P256_N / 2);

        // Step 2: Flags
        bytes1 flags = sigs[0].authenticatorData[32];
        console.log("Check 2 - UP:", (flags & 0x01) == 0x01);
        console.log("Check 2 - UV:", (flags & 0x04) == 0x04);

        // Step 3: typeIndex
        bytes memory cd = bytes(sigs[0].clientDataJSON);
        console.log("Check 3 - cd length:", cd.length);
        console.log("Check 3 - type slice:");
        bytes memory typeSlice = new bytes(21);
        for (uint i = 0; i < 21; i++) typeSlice[i] = cd[sigs[0].typeIndex + i];
        console.log(string(typeSlice));

        // Let's call WebAuthn.verify directly with x, y
        bool ok0 = WebAuthn.verify(
            abi.encodePacked(userOpHash),
            true,
            sigs[0],
            x,
            y
        );
        console.log("WebAuthn.verify with x, y returned:", ok0);

        bytes memory chalSlice = new bytes(56);
        for (uint i = 0; i < 56; i++) chalSlice[i] = cd[sigs[0].challengeIndex + i];
        console.log("Actual chal slice:");
        console.log(string(chalSlice));

        // Step 5: P256 Verify
        bytes32 clientHash = sha256(cd);
        bytes32 message = sha256(abi.encodePacked(sigs[0].authenticatorData, clientHash));
        console.log("Message hash:");
        console.logBytes32(message);

        // Test with Recovered Point 0
        uint256 xRec = 0xb22ecf75340c4000e30400b9623256b3b5092c84fa681051e39393fbf9628fd7;
        uint256 yRec = 0x9b79b1ba375da0fecf2a25e8dbf28e7289401c844ab1e7e20f215f619e93910f;
        bytes memory argsRec = abi.encode(message, sigs[0].r, sigs[0].s, xRec, yRec);
        (bool okRec, bytes memory retRec) = address(0x100).staticcall(argsRec);
        console.log("Precompile with Recovered Key ok:", okRec);
        console.log("Precompile with Recovered Key ret length:", retRec.length);
        if (retRec.length == 32) {
            console.log("Precompile with Recovered Key decoded:", abi.decode(retRec, (uint256)));
        }
    }
}
