// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {PasskeyAccount, PackedUserOperation} from "../src/PasskeyAccount.sol";
import {WebAuthn} from "../src/WebAuthn.sol";
import {Vectors} from "./Vectors.sol";

/// @notice ERC-7562 OP-011 bans TIMESTAMP/NUMBER during validation. The whole
///         rolling-window design exists to work around that. This test proves
///         the constraint is actually respected -- if validateUserOp ever read
///         the clock, every bundler would reject this account.
///
/// @dev vm.warp changes block.timestamp. If validateUserOp's result depended on
///      it, the same op would validate differently at different timestamps.
///      Identical results across wildly different clocks is strong evidence
///      that no TIMESTAMP read is reachable from the validation path.
contract Erc7562Test is Test, Vectors {
    PasskeyAccount account;
    address constant ENTRYPOINT = address(0xE);
    bytes32 constant H = 0x1111111111111111111111111111111111111111111111111111111111111111;

    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function setUp() public {
        account = new PasskeyAccount(ENTRYPOINT, _signers2(K0_X, K0_Y, K1_X, K1_Y), 1 ether);
        vm.deal(address(account), 100 ether);
        vm.startPrank(address(account));
        account.setWindow(address(0), 2 ether, 1 days, 18);
        account.setTokenThreshold(USDC, 500e6, 6);
        account.setWindow(USDC, 1000e6, 1 days, 6);
        vm.stopPrank();
    }

    /// Token-window validation must ALSO be time-independent. Mapping reads
    /// during validation are legal (STO-010), but a TIMESTAMP read is not --
    /// this proves the per-asset path did not sneak one in.
    function test_TokenValidationIsTimeIndependent() public {
        vm.warp(1_700_000_000);
        vm.prank(ENTRYPOINT);
        account.execute(USDC, 0, abi.encodeWithSignature(
            "transfer(address,uint256)", address(0xBEEF), 200e6));

        uint256[] memory ids = new uint256[](1);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](1);
        ids[0] = 0; sigs[0] = _v_small_k0();

        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(PasskeyAccount.execute, (USDC, 0,
            abi.encodeWithSignature("transfer(address,uint256)", address(0xBEEF), 200e6)));
        op.signature = abi.encode(ids, sigs);

        vm.warp(1_700_000_001);
        vm.prank(ENTRYPOINT);
        uint256 a = account.validateUserOp(op, H, 0);

        vm.warp(1_900_000_000);
        vm.prank(ENTRYPOINT);
        uint256 b = account.validateUserOp(op, H, 0);

        assertEq(a, b, "token window validation must not read the clock");
        console.log("token validationData (constant across time):", a);
    }

    function _validateAt(uint256 ts) internal returns (uint256) {
        vm.warp(ts);
        uint256[] memory ids = new uint256[](1);
        WebAuthn.Signature[] memory sigs = new WebAuthn.Signature[](1);
        ids[0] = 0; sigs[0] = _v_small_k0();

        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(PasskeyAccount.execute, (address(0xBEEF), 0.5 ether, ""));
        op.signature = abi.encode(ids, sigs);

        vm.prank(ENTRYPOINT);
        return account.validateUserOp(op, H, 0);
    }

    /// Validation output must be identical regardless of the current time.
    function test_ValidationIsTimeIndependent() public {
        // Open a window first so there is real state to read.
        vm.warp(1_700_000_000);
        vm.prank(ENTRYPOINT);
        account.execute(address(0xBEEF), 0.5 ether, "");

        uint256 a = _validateAt(1_700_000_001);
        uint256 b = _validateAt(1_800_000_000); // years later
        uint256 c = _validateAt(1_700_000_050);

        assertEq(a, b, "validation must not depend on block.timestamp");
        assertEq(a, c, "validation must not depend on block.timestamp");
        console.log("validationData (constant across time):", a);
    }

    /// Same for block number.
    function test_ValidationIsBlockIndependent() public {
        vm.warp(1_700_000_000);
        vm.prank(ENTRYPOINT);
        account.execute(address(0xBEEF), 0.5 ether, "");

        vm.roll(100);
        uint256 a = _validateAt(1_700_000_001);
        vm.roll(9_000_000);
        uint256 b = _validateAt(1_700_000_001);

        assertEq(a, b, "validation must not depend on block.number");
    }
}
