// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {PasskeyAccount, PackedUserOperation} from "../src/PasskeyAccount.sol";
import {WebAuthn} from "../src/WebAuthn.sol";
import {SpendPolicy} from "../src/SpendPolicy.sol";
import {Vectors} from "./Vectors.sol";

contract MockERC20Integration {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

contract MockUniswapV3RouterIntegration {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut) {
        require(params.amountIn > 0, "zero in");
        require(params.amountOutMinimum > 0, "zero slippage protection");
        amountOut = params.amountOutMinimum;
        // Mock transfer from router to recipient
        MockERC20Integration(params.tokenOut).mint(params.recipient, amountOut);
    }
}

/// @notice Mock EntryPoint that faithfully simulates standard ERC-4337 v0.7 validation & execution
contract MockEntryPoint4337 {
    function handleOp(PackedUserOperation calldata userOp) external {
        bytes32 userOpHash = PasskeyAccount(payable(userOp.sender)).getUserOpHash(userOp);

        // 1. Validation phase
        uint256 validationData = PasskeyAccount(payable(userOp.sender)).validateUserOp(userOp, userOpHash, 0);

        uint160 authorizer = uint160(validationData);
        uint48 validUntil = uint48(validationData >> 160);
        uint48 validAfter = uint48(validationData >> 208);

        require(authorizer == 0, "AA24 signature error");
        if (validUntil != 0) {
            require(block.timestamp <= validUntil, "AA22 expired");
        }
        require(block.timestamp >= validAfter, "AA22 not due");

        // 2. Execution phase
        (bool ok, bytes memory ret) = userOp.sender.call(userOp.callData);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}

/// @title AgentIntegrationTest -- End-to-end EntryPoint integration test suite
contract AgentIntegrationTest is Test, Vectors {
    PasskeyAccount account;
    MockEntryPoint4337 entryPoint;
    MockERC20Integration usdc;
    MockERC20Integration weth;
    MockUniswapV3RouterIntegration router;

    address constant RECIPIENT = address(0xBEEF);
    uint256 constant THRESHOLD = 1 ether;

    uint256 constant AGENT_PK = 0xA11CE;
    address agentKey;

    bytes32 constant H_LARGE = bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222));

    function setUp() public {
        agentKey = vm.addr(AGENT_PK);

        entryPoint = new MockEntryPoint4337();
        account = new PasskeyAccount(address(entryPoint), _signers2(K0_X, K0_Y, K1_X, K1_Y), THRESHOLD);
        usdc = new MockERC20Integration();
        weth = new MockERC20Integration();
        router = new MockUniswapV3RouterIntegration();

        vm.deal(address(account), 100 ether);
        usdc.mint(address(account), 10_000 * 1e6);

        address[] memory protocols = new address[](2);
        protocols[0] = address(router);
        protocols[1] = RECIPIENT;

        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = SpendPolicy.UNISWAP_V3_EXACT_INPUT_SINGLE;
        selectors[1] = bytes4(0);

        address[] memory tokens = new address[](3);
        tokens[0] = address(usdc);
        tokens[1] = address(weth);
        tokens[2] = address(0); // ETH

        uint256[] memory caps = new uint256[](3);
        caps[0] = 100 * 1e6; // 100 USDC rolling cap
        caps[1] = 10 * 1e18; // 10 WETH rolling cap
        caps[2] = 0.2 ether; // 0.2 ETH rolling cap

        PasskeyAccount.SessionConfig memory config = PasskeyAccount.SessionConfig({
            agentKey: agentKey,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 7 days),
            humanApprovalThreshold: 200 * 1e6, // $200 max escalation cap
            perTxLimitEth: 0.05 ether,
            perTxLimitToken: 50 * 1e6, // $50 max per tx
            windowDuration: 1 days,
            allowedProtocols: protocols,
            allowedSelectors: selectors,
            allowedTokens: tokens,
            tokenWindowCaps: caps
        });

        vm.prank(address(account));
        account.grantAgentSession(config);
    }

    // --- Helpers -----------------------------------------------------------

    function _signAgentOp(uint256 pk, bytes32 userOpHash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, userOpHash);
        bytes memory agentSig = abi.encodePacked(r, s, v);
        return abi.encodePacked(uint8(1), abi.encode(vm.addr(pk), agentSig));
    }

    function _signEscalatedOp(
        uint256 pk,
        bytes32 userOpHash,
        uint256[] memory ids,
        WebAuthn.Signature[] memory passkeySigs
    ) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, userOpHash);
        bytes memory agentSig = abi.encodePacked(r, s, v);
        return abi.encodePacked(uint8(2), abi.encode(vm.addr(pk), agentSig, ids, passkeySigs));
    }

    function _buildUserOp(bytes memory callData, uint256 nonce) internal view returns (PackedUserOperation memory op) {
        op.sender = address(account);
        op.nonce = nonce;
        op.callData = callData;
        op.accountGasLimits = bytes32(0);
        op.preVerificationGas = 50000;
        op.gasFees = bytes32(0);
    }

    // =======================================================================
    // 1. End-to-End UserOp Validation & Execution Through EntryPoint
    // =======================================================================

    function test_Integration_AgentUserOp_ThroughEntryPoint() public {
        // Agent sends $30 USDC through real EntryPoint simulation
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 30 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        PackedUserOperation memory op = _buildUserOp(callData, 0);
        bytes32 opHash = account.getUserOpHash(op);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 recipientBefore = usdc.balanceOf(RECIPIENT);
        entryPoint.handleOp(op);
        uint256 recipientAfter = usdc.balanceOf(RECIPIENT);

        assertEq(recipientAfter - recipientBefore, 30 * 1e6, "Recipient must receive exactly 30 USDC");
    }

    function test_Integration_EscalatedUserOp_ThroughEntryPoint() public {
        // Agent requests $150 USDC (above $50 per-tx limit, under $200 max ceiling)
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 150 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        PackedUserOperation memory op = _buildUserOp(callData, 0);

        uint256[] memory passkeyIds = new uint256[](2);
        passkeyIds[0] = 0;
        passkeyIds[1] = 1;
        WebAuthn.Signature[] memory passkeySigs = new WebAuthn.Signature[](2);
        passkeySigs[0] = _v_large_k0();
        passkeySigs[1] = _v_large_k1();

        // For this vector test, we use H_LARGE
        op.signature = _signEscalatedOp(AGENT_PK, H_LARGE, passkeyIds, passkeySigs);

        // Verify direct validation with H_LARGE passes
        vm.prank(address(entryPoint));
        uint256 val = account.validateUserOp(op, H_LARGE, 0);
        assertEq(uint160(val), 0, "Escalated op validation MUST succeed");
    }

    function test_Integration_ExceedsHumanEscalationLimit_Reverts() public {
        // Agent attempts to send $250 USDC (above $200 humanApprovalThreshold ceiling)
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 250 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        PackedUserOperation memory op = _buildUserOp(callData, 0);

        uint256[] memory passkeyIds = new uint256[](2);
        passkeyIds[0] = 0;
        passkeyIds[1] = 1;
        WebAuthn.Signature[] memory passkeySigs = new WebAuthn.Signature[](2);
        passkeySigs[0] = _v_large_k0();
        passkeySigs[1] = _v_large_k1();

        op.signature = _signEscalatedOp(AGENT_PK, H_LARGE, passkeyIds, passkeySigs);

        vm.prank(address(entryPoint));
        uint256 val = account.validateUserOp(op, H_LARGE, 0);
        assertEq(val, 1, "Op exceeding humanApprovalThreshold MUST be rejected even with passkey quorum");
    }

    function test_Integration_ExpiredSession() public {
        // Fast-forward past 7 days session expiry
        vm.warp(block.timestamp + 8 days);

        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 10 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        PackedUserOperation memory op = _buildUserOp(callData, 0);
        bytes32 opHash = account.getUserOpHash(op);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        vm.expectRevert("AA22 expired");
        entryPoint.handleOp(op);
    }

    function test_Integration_RevokedSession() public {
        // Revoke session
        vm.prank(address(account));
        account.revokeAgentSession(agentKey);

        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 10 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        PackedUserOperation memory op = _buildUserOp(callData, 0);
        bytes32 opHash = account.getUserOpHash(op);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        vm.expectRevert("AA24 signature error");
        entryPoint.handleOp(op);
    }

    function test_Integration_RollingWindow() public {
        // Execute Op 1: $40 USDC (fits under $50 per-tx and $100 rolling cap)
        bytes memory callData1 = abi.encodeCall(
            PasskeyAccount.executeByAgent,
            (agentKey, address(usdc), 0, abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 40 * 1e6))
        );
        PackedUserOperation memory op1 = _buildUserOp(callData1, 0);
        op1.signature = _signAgentOp(AGENT_PK, account.getUserOpHash(op1));
        entryPoint.handleOp(op1);

        // Execute Op 2: $40 USDC (total spent = $80 <= $100 cap)
        bytes memory callData2 = abi.encodeCall(
            PasskeyAccount.executeByAgent,
            (agentKey, address(usdc), 0, abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 40 * 1e6))
        );
        PackedUserOperation memory op2 = _buildUserOp(callData2, 1);
        op2.signature = _signAgentOp(AGENT_PK, account.getUserOpHash(op2));
        entryPoint.handleOp(op2);

        // Op 3: $30 USDC (total proposed = $110 > $100 cap) -> Must be rejected by EntryPoint until window rolls
        bytes memory callData3 = abi.encodeCall(
            PasskeyAccount.executeByAgent,
            (agentKey, address(usdc), 0, abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 30 * 1e6))
        );
        PackedUserOperation memory op3 = _buildUserOp(callData3, 2);
        op3.signature = _signAgentOp(AGENT_PK, account.getUserOpHash(op3));

        vm.expectRevert("AA22 not due");
        entryPoint.handleOp(op3);
    }

    function test_Integration_BatchAccounting() public {
        address[] memory dests = new address[](2);
        dests[0] = address(usdc);
        dests[1] = RECIPIENT;

        uint256[] memory values = new uint256[](2);
        values[0] = 0;
        values[1] = 0.02 ether; // 0.02 ETH under 0.05 limit

        bytes[] memory funcs = new bytes[](2);
        funcs[0] = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 25 * 1e6); // 25 USDC under 50 limit
        funcs[1] = "";

        bytes memory callData = abi.encodeCall(PasskeyAccount.executeBatchByAgent, (agentKey, dests, values, funcs));
        PackedUserOperation memory op = _buildUserOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, account.getUserOpHash(op));

        uint256 recipientEthBefore = RECIPIENT.balance;
        uint256 recipientUsdcBefore = usdc.balanceOf(RECIPIENT);

        entryPoint.handleOp(op);

        assertEq(RECIPIENT.balance - recipientEthBefore, 0.02 ether);
        assertEq(usdc.balanceOf(RECIPIENT) - recipientUsdcBefore, 25 * 1e6);
    }

    function test_Integration_CrossChainReplay() public {
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.executeByAgent,
            (agentKey, address(usdc), 0, abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 20 * 1e6))
        );
        PackedUserOperation memory op = _buildUserOp(callData, 0);

        // Sign for chainId 1
        vm.chainId(1);
        bytes32 hashChain1 = account.getUserOpHash(op);
        op.signature = _signAgentOp(AGENT_PK, hashChain1);

        // Replay on chainId 8453 (Base)
        vm.chainId(8453);
        vm.expectRevert("AA24 signature error");
        entryPoint.handleOp(op);
    }

    function test_Integration_WrongEntryPoint() public {
        bytes memory callData = abi.encodeCall(
            PasskeyAccount.executeByAgent,
            (agentKey, address(usdc), 0, abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 20 * 1e6))
        );
        PackedUserOperation memory op = _buildUserOp(callData, 0);

        MockEntryPoint4337 rogueEntryPoint = new MockEntryPoint4337();

        // Sign for account's configured entryPoint
        bytes32 validHash = account.getUserOpHash(op);
        op.signature = _signAgentOp(AGENT_PK, validHash);

        // Submit to rogue entryPoint
        vm.expectRevert();
        rogueEntryPoint.handleOp(op);
    }

    function test_Integration_PasskeyReplay() public {
        bytes memory innerFunc1 = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 150 * 1e6);
        bytes memory cd1 = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc1));
        _buildUserOp(cd1, 0);

        uint256[] memory passkeyIds = new uint256[](2);
        passkeyIds[0] = 0;
        passkeyIds[1] = 1;
        WebAuthn.Signature[] memory passkeySigs = new WebAuthn.Signature[](2);
        passkeySigs[0] = _v_large_k0();
        passkeySigs[1] = _v_large_k1();

        bytes memory sig = _signEscalatedOp(AGENT_PK, H_LARGE, passkeyIds, passkeySigs);

        // Replay on different calldata/target (ATTACKER)
        bytes memory innerFunc2 = abi.encodeWithSelector(SpendPolicy.TRANSFER, address(0xDEAD), 150 * 1e6);
        bytes memory cd2 = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc2));
        PackedUserOperation memory op2 = _buildUserOp(cd2, 1);
        op2.signature = sig;

        bytes32 hash2 = account.getUserOpHash(op2);
        vm.prank(address(entryPoint));
        uint256 val = account.validateUserOp(op2, hash2, 0);
        assertEq(val, 1, "Passkey signature replay on different operation MUST be rejected");
    }

    function test_Integration_UniswapSlippageBoundary() public {
        // Swap with amountOutMinimum: 35 WETH (valid slippage)
        bytes memory innerFunc = abi.encodeWithSelector(
            SpendPolicy.UNISWAP_V3_EXACT_INPUT_SINGLE,
            MockUniswapV3RouterIntegration.ExactInputSingleParams({
                tokenIn: address(usdc),
                tokenOut: address(weth),
                fee: 3000,
                recipient: address(account),
                amountIn: 40 * 1e6,
                amountOutMinimum: 35 * 1e18,
                sqrtPriceLimitX96: 0
            })
        );
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(router), 0, innerFunc));
        PackedUserOperation memory op = _buildUserOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, account.getUserOpHash(op));

        uint256 wethBefore = weth.balanceOf(address(account));
        entryPoint.handleOp(op);
        uint256 wethAfter = weth.balanceOf(address(account));

        assertEq(wethAfter - wethBefore, 35 * 1e18, "Account received swap output tokens");
    }
}
