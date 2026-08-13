// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {PasskeyAccount} from "../src/PasskeyAccount.sol";
import {WebAuthn} from "../src/WebAuthn.sol";

interface IEntryPoint {
    struct PackedUserOperation {
        address sender;
        uint256 nonce;
        bytes initCode;
        bytes callData;
        bytes32 accountGasLimits;
        uint256 preVerificationGas;
        bytes32 gasFees;
        bytes paymasterAndData;
        bytes signature;
    }
    function handleOps(
        PackedUserOperation[] calldata ops,
        address payable beneficiary
    ) external;
    function getUserOpHash(PackedUserOperation calldata userOp)
        external view returns (bytes32);
    function getNonce(address sender, uint192 key)
        external view returns (uint256);
}

/// @notice Submits the signed UserOp by calling handleOps directly.
///
/// @dev We act as our own bundler. That is not a shortcut -- it exercises the
///      identical on-chain path a hosted bundler would take (simulate,
///      validate, execute), while keeping every revert reason visible instead
///      of hidden behind a mempool policy rejection.
///
///      Run:
///        forge script script/SendUserOp.s.sol:SendUserOp \
///          --rpc-url https://sepolia.base.org \
///          --account passkey-deployer --password "" --broadcast
contract SendUserOp is Script {
    address constant ACCOUNT = 0x34Aeb3A39fd1838D1C897F879EAB0a258507802c;
    address constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address constant RECIPIENT = 0x22db962929afe98d0269De0BAa6c442A3Aa6913D;

    uint256 constant SEND_VALUE = 0.0001 ether;
    uint128 constant VERIFICATION_GAS = 200_000;
    uint128 constant CALL_GAS = 60_000;
    uint256 constant PRE_VERIFICATION_GAS = 60_000;

    /// Signature produced by passkey "alpha" over the UserOp hash. Confirmed
    /// against the live RIP-7212 precompile (returned 1) before submitting.
    function _sig() internal pure returns (WebAuthn.Signature memory) {
        return WebAuthn.Signature({
            authenticatorData: hex"49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d00000000",
            clientDataJSON: '{"type":"webauthn.get","challenge":"9AkzkQSjipXY2vkkswlKJis2e3d_krdiNrqFwSm9jWo","origin":"http://localhost:5199","crossOrigin":false}',
            challengeIndex: 23,
            typeIndex: 1,
            r: 0xcf9cb07d406edc31ed6a313632ffb4e3f76b98a5705585c3e43b3d3ec00abe58,
            s: 0x093557b1323a127bb6bad9a5f92571ed64cb5b9d1368cc0c9f3ae693b0f16746
        });
    }

    function run() external {
        // Signature payload: abi.encode(uint256[] signerIds, Signature[] sigs).
        // One signature, signer id 0 (alpha) -- the op is below the 0.01 ETH
        // threshold, so the policy accepts a single passkey.
        uint256[] memory ids = new uint256[](1);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](1);
        ids[0] = 0;
        sigs[0] = _sig();

        IEntryPoint.PackedUserOperation memory op = IEntryPoint.PackedUserOperation({
            sender: ACCOUNT,
            nonce: IEntryPoint(ENTRYPOINT).getNonce(ACCOUNT, 0),
            initCode: "",
            callData: abi.encodeCall(
                PasskeyAccount.execute, (RECIPIENT, SEND_VALUE, "")
            ),
            accountGasLimits: bytes32(
                (uint256(VERIFICATION_GAS) << 128) | uint256(CALL_GAS)
            ),
            preVerificationGas: PRE_VERIFICATION_GAS,
            gasFees: bytes32((uint256(0.05 gwei) << 128) | uint256(0.2 gwei)),
            paymasterAndData: "",
            signature: abi.encode(ids, sigs)
        });

        // The hash is computed over an EMPTY signature field, so re-derive it
        // with the signature blanked to confirm we are submitting the op that
        // was actually signed.
        //
        // NOTE: `probe = op` would copy a REFERENCE, not a value -- blanking
        // probe.signature would then blank the real op too, and handleOps would
        // revert with an opaque "AA23 reverted" because validateUserOp received
        // an empty signature. Build a separate struct instead.
        IEntryPoint.PackedUserOperation memory probe = IEntryPoint.PackedUserOperation({
            sender: op.sender,
            nonce: op.nonce,
            initCode: op.initCode,
            callData: op.callData,
            accountGasLimits: op.accountGasLimits,
            preVerificationGas: op.preVerificationGas,
            gasFees: op.gasFees,
            paymasterAndData: op.paymasterAndData,
            signature: ""
        });
        bytes32 h = IEntryPoint(ENTRYPOINT).getUserOpHash(probe);
        console.log("submitting op with hash:");
        console.logBytes32(h);
        require(
            h == 0xf409339104a38a95d8daf924b3094a262b367b777f92b76236ba85c129bd8d6a,
            "hash drift: this is not the op that was signed"
        );

        IEntryPoint.PackedUserOperation[] memory ops =
            new IEntryPoint.PackedUserOperation[](1);
        ops[0] = op;

        uint256 balBefore = RECIPIENT.balance;
        uint256 acctBefore = ACCOUNT.balance;

        // The beneficiary receives the gas refund. `msg.sender` inside a
        // broadcast block is the SCRIPT contract, not the broadcasting EOA --
        // and the script has no receive(), so the EntryPoint's payout reverts
        // with "AA91 failed send to beneficiary" AFTER the op has already
        // executed successfully. Pay the deployer EOA explicitly instead.
        address payable beneficiary = payable(RECIPIENT);

        vm.startBroadcast();
        IEntryPoint(ENTRYPOINT).handleOps(ops, beneficiary);
        vm.stopBroadcast();

        console.log("");
        console.log("recipient before:", balBefore);
        console.log("account before:  ", acctBefore);
    }
}
