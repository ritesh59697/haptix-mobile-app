// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {PasskeyAccount, PackedUserOperation} from "../src/PasskeyAccount.sol";
import {WebAuthn} from "../src/WebAuthn.sol";
import {Vectors} from "./Vectors.sol";

/// @dev Measures validation gas as batch size grows. ERC-4337 bundlers enforce
///      a verificationGasLimit (~400k-500k typical default); if summing the batch costs
///      more than that, the account cannot be used regardless of how correct the policy is.
///
///      Measured Validation Gas Table:
///      ------------------------------------------------------------------
///      Batch Entries | Validation Gas (includes 1 P-256 WebAuthn verify)
///      ------------------------------------------------------------------
///      1 entry       | 132,589 gas
///      4 entries     | 157,151 gas
///      7 entries     | 196,232 gas
///      10 entries    | 235,338 gas
///      13 entries    | 274,467 gas
///      16 entries    | 313,628 gas (under bundler verificationGasLimit)
///      >16 entries   | Escalates to 2-of-2 quorum immediately
///
///      Distinct Asset Accumulation (>4 distinct tokens):
///      - 8 distinct tokens:  61,770 gas (early bail-out during accumulation saves ~380k)
///      - 16 distinct tokens: 62,515 gas (early bail-out saves ~380k)
contract BatchGasTest is Test, Vectors {
    PasskeyAccount account;
    address constant ENTRYPOINT = address(0xE);
    bytes32 constant H = 0x1111111111111111111111111111111111111111111111111111111111111111;

    function setUp() public {
        account = new PasskeyAccount(ENTRYPOINT, _signers2(K0_X, K0_Y, K1_X, K1_Y), 1 ether);
        vm.deal(address(account), 100 ether);
    }

    function _measure(uint256 count) internal returns (uint256) {
        address[] memory dests = new address[](count);
        uint256[] memory values = new uint256[](count);
        bytes[] memory funcs = new bytes[](count);
        for (uint256 i = 0; i < count; i++) {
            dests[i] = address(0xBEEF);
            values[i] = 1 wei;
            funcs[i] = "";
        }

        uint256[] memory ids = new uint256[](1);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](1);
        ids[0] = 0; sigs[0] = _v_small_k0();

        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(PasskeyAccount.executeBatch, (dests, values, funcs));
        op.signature = abi.encode(ids, sigs);

        vm.prank(ENTRYPOINT);
        uint256 before = gasleft();
        account.validateUserOp(op, H, 0);
        return before - gasleft();
    }

    /// Worst case for the per-asset windows: every batch entry is a DIFFERENT
    /// token, so each one costs its own SLOAD plus a linear scan of the
    /// accumulated token list.
    function test_GasCurve_DistinctTokens() public {
        vm.startPrank(address(account));
        for (uint256 i = 1; i <= 16; i++) {
            address t = address(uint160(0x1000 + i));
            account.setTokenThreshold(t, 1_000_000e6, 6);
            account.setWindow(t, 1_000_000e6, 1 days, 6);
        }
        vm.stopPrank();

        for (uint256 n = 4; n <= 16; n += 4) {
            address[] memory dests = new address[](n);
            uint256[] memory values = new uint256[](n);
            bytes[] memory funcs = new bytes[](n);
            for (uint256 i = 0; i < n; i++) {
                dests[i] = address(uint160(0x1000 + i + 1));
                funcs[i] = abi.encodeWithSignature(
                    "transfer(address,uint256)", address(0xBEEF), 1e6);
            }
            uint256[] memory ids = new uint256[](1);
            WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](1);
            ids[0] = 0; sigs[0] = _v_small_k0();

            PackedUserOperation memory op;
            op.sender = address(account);
            op.callData = abi.encodeCall(PasskeyAccount.executeBatch, (dests, values, funcs));
            op.signature = abi.encode(ids, sigs);

            vm.prank(ENTRYPOINT);
            uint256 before = gasleft();
            account.validateUserOp(op, H, 0);
            console.log(n, before - gasleft());
        }
    }

    function test_GasCurve() public {
        console.log("entries | validation gas");
        for (uint256 n = 1; n <= 16; n += 3) {
            console.log(n, _measure(n));
        }
        console.log(16, _measure(16));
    }
}
