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

/// @notice Submits setWindow(ETH, 0.05 ether, 1 day) with BOTH passkeys.
///
/// @dev Two signatures because setWindow is `onlySelf` and is not an `execute`
///      call, so _requiredSignatures returns the full quorum. The policy that
///      guards spending also guards the limits themselves -- an attacker
///      holding one passkey cannot raise their own cap.
///
///      Note the two clientDataJSON values differ in length (243 vs 134 bytes):
///      Chrome appended `other_keys_can_be_added_here` to one and not the other.
///      Verification survives that because WebAuthn.sol compares substrings at
///      the reported offsets instead of matching a template.
contract SendConfigureWindow is Script {
    address constant ACCOUNT = 0x34Aeb3A39fd1838D1C897F879EAB0a258507802c;
    address constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address constant BENEFICIARY = 0x22db962929afe98d0269De0BAa6c442A3Aa6913D;

    uint128 constant VERIFICATION_GAS = 400_000;
    uint128 constant CALL_GAS = 60_000;
    uint256 constant PRE_VERIFICATION_GAS = 60_000;

    bytes32 constant EXPECTED_HASH =
        0xb9092e24f77e9d3c3dd3f15c16def0a0810e21c6a27c1b74eeb1cd71eb44234b;

    function _alpha() internal pure returns (WebAuthn.Signature memory) {
        return WebAuthn.Signature({
            authenticatorData: hex"49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d00000000",
            clientDataJSON: '{"type":"webauthn.get","challenge":"uQkuJPd-nTw90_FcFt7woIEOIcaifBt07rHNcetEI0s","origin":"http://localhost:5199","crossOrigin":false,"other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"}',
            challengeIndex: 23,
            typeIndex: 1,
            r: 0x7b8301fdd377c60a048a8ddc88c8aa1efc8961a8403f722115232c74d5112472,
            s: 0x5903d0da6f22ce7fbb112ce4176dfb02c9d54605e638b69df2053cdf744ee11e
        });
    }

    function _beta() internal pure returns (WebAuthn.Signature memory) {
        return WebAuthn.Signature({
            authenticatorData: hex"49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d00000000",
            clientDataJSON: '{"type":"webauthn.get","challenge":"uQkuJPd-nTw90_FcFt7woIEOIcaifBt07rHNcetEI0s","origin":"http://localhost:5199","crossOrigin":false}',
            challengeIndex: 23,
            typeIndex: 1,
            r: 0xab173e18fd896058b02576eed25e9353b6f73a4a53e7bfa69c304794ddfca16f,
            s: 0x1e123be445e23284bc4a2b9c24d899844ce09a58a2ec3e67fe85d7dcabc56289
        });
    }

    function run() external {
        // Signer ids MUST be strictly ascending -- the account rejects
        // unordered or duplicate ids, which is what makes "two distinct
        // signers" cheap to enforce.
        uint256[] memory ids = new uint256[](2);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](2);
        ids[0] = 0; sigs[0] = _alpha();
        ids[1] = 1; sigs[1] = _beta();

        // Wrapped in execute() so the account calls ITSELF. setWindow is
        // `onlySelf`; a UserOp whose callData is setWindow directly arrives
        // with msg.sender == EntryPoint and reverts NotSelf() -- after
        // validation has already passed and the gas has already been spent.
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.execute,
            (ACCOUNT, 0, abi.encodeCall(
                PasskeyAccount.setWindow, (address(0), 0.05 ether, 1 days, 18)
            ))
        );
        uint256 nonce = IEntryPoint(ENTRYPOINT).getNonce(ACCOUNT, 0);
        bytes32 gasLimits = bytes32(
            (uint256(VERIFICATION_GAS) << 128) | uint256(CALL_GAS)
        );
        bytes32 fees = bytes32((uint256(0.05 gwei) << 128) | uint256(0.2 gwei));

        // Build the hash-probe as a SEPARATE struct. Assigning `probe = op`
        // copies a reference, so blanking probe.signature would blank the real
        // op too -- which surfaces only as an opaque "AA23 reverted".
        IEntryPoint.PackedUserOperation memory probe = IEntryPoint.PackedUserOperation({
            sender: ACCOUNT, nonce: nonce, initCode: "", callData: callData,
            accountGasLimits: gasLimits, preVerificationGas: PRE_VERIFICATION_GAS,
            gasFees: fees, paymasterAndData: "", signature: ""
        });
        bytes32 h = IEntryPoint(ENTRYPOINT).getUserOpHash(probe);
        require(h == EXPECTED_HASH, "hash drift: not the op that was signed");

        IEntryPoint.PackedUserOperation[] memory ops =
            new IEntryPoint.PackedUserOperation[](1);
        ops[0] = IEntryPoint.PackedUserOperation({
            sender: ACCOUNT, nonce: nonce, initCode: "", callData: callData,
            accountGasLimits: gasLimits, preVerificationGas: PRE_VERIFICATION_GAS,
            gasFees: fees, paymasterAndData: "",
            signature: abi.encode(ids, sigs)
        });

        vm.startBroadcast();
        IEntryPoint(ENTRYPOINT).handleOps(ops, payable(BENEFICIARY));
        vm.stopBroadcast();
    }
}

/// @notice Helper library / contract for calculating token base units from human-readable amounts.
library TokenUnitConverter {
    /// @notice Converts human-readable token amount to base units according to its decimal count.
    /// @param amount Human-readable token amount (e.g. 100 for 100 USDC).
    /// @param decimals Number of decimals (e.g. 6 for USDC, 18 for ETH / DAI).
    function toBaseUnits(uint256 amount, uint8 decimals) internal pure returns (uint256) {
        return amount * (10 ** decimals);
    }
}

/// @notice Example script: Configures 6-decimal Base Sepolia USDC (0x036CbD53842c5426634e7929541eC2318f3dCF7e).
///         Sets per-op threshold to 100 USDC (100 * 10^6 = 100_000_000) and 24h rolling window to 500 USDC (500 * 10^6 = 500_000_000).
contract ConfigureBaseSepoliaUsdcWindow is Script {
    address constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    uint8 constant USDC_DECIMALS = 6;

    function buildCalldata(address account) external pure returns (bytes memory) {
        uint256 usdcThreshold = TokenUnitConverter.toBaseUnits(100, USDC_DECIMALS); // 100_000_000 (100 USDC)
        uint256 usdcCap = TokenUnitConverter.toBaseUnits(500, USDC_DECIMALS);       // 500_000_000 (500 USDC)

        bytes memory configThreshold = abi.encodeCall(
            PasskeyAccount.setTokenThreshold, (BASE_SEPOLIA_USDC, usdcThreshold, USDC_DECIMALS)
        );
        bytes memory configWindow = abi.encodeCall(
            PasskeyAccount.setWindow, (BASE_SEPOLIA_USDC, usdcCap, 1 days, USDC_DECIMALS)
        );

        address[] memory targets = new address[](2);
        targets[0] = account;
        targets[1] = account;

        uint256[] memory values = new uint256[](2);

        bytes[] memory calls = new bytes[](2);
        calls[0] = configThreshold;
        calls[1] = configWindow;

        return abi.encodeCall(PasskeyAccount.executeBatch, (targets, values, calls));
    }
}
