// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {PasskeyAccount, PackedUserOperation} from "../src/PasskeyAccount.sol";
import {WebAuthn} from "../src/WebAuthn.sol";
import {SpendPolicy} from "../src/SpendPolicy.sol";
import {Vectors} from "./Vectors.sol";

contract MockERC20 {
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

contract MockUniswapV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external pure returns (uint256 amountOut) {
        amountOut = params.amountOutMinimum > 0 ? params.amountOutMinimum : params.amountIn;
    }
}

/// @title AgentSecurityTest -- Comprehensive adversarial test suite for AI Agent delegation
contract AgentSecurityTest is Test, Vectors {
    PasskeyAccount account;
    MockERC20 usdc;
    MockUniswapV3Router router;

    address constant ENTRYPOINT = address(0xE);
    address constant RECIPIENT = address(0xBEEF);
    address constant ATTACKER = address(0xDEAD);
    uint256 constant THRESHOLD = 1 ether;

    uint256 constant AGENT_PK = 0xA11CE;
    address agentKey;

    uint256 constant ATTACKER_AGENT_PK = 0xBADB07;
    address attackerAgentKey;

    bytes32 constant H_LARGE = bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222));

    function setUp() public {
        agentKey = vm.addr(AGENT_PK);
        attackerAgentKey = vm.addr(ATTACKER_AGENT_PK);

        account = new PasskeyAccount(ENTRYPOINT, _signers2(K0_X, K0_Y, K1_X, K1_Y), THRESHOLD);
        usdc = new MockERC20();
        router = new MockUniswapV3Router();

        vm.deal(address(account), 100 ether);
        usdc.mint(address(account), 10_000 * 1e6); // 10,000 USDC

        // Master User grants session to agentKey:
        // - perTxLimitEth: 0.05 ether (~$150)
        // - perTxLimitToken: 50 * 1e6 (50 USDC)
        // - humanApprovalThreshold: 100 * 1e6 (100 USDC)
        // - windowDuration: 1 days
        // - rolling cap: 100 * 1e6 (100 USDC per day)
        // - allowedProtocols: [router, RECIPIENT]
        // - allowedSelectors: [router.exactInputSingle]
        // - allowedTokens: [USDC, ETH]
        address[] memory protocols = new address[](2);
        protocols[0] = address(router);
        protocols[1] = RECIPIENT;

        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = SpendPolicy.UNISWAP_V3_EXACT_INPUT_SINGLE;
        selectors[1] = bytes4(0);

        address[] memory tokens = new address[](3);
        tokens[0] = address(usdc);
        tokens[1] = address(0); // ETH
        tokens[2] = address(0xCAFE); // tokenOut for swaps

        uint256[] memory caps = new uint256[](3);
        caps[0] = 100 * 1e6; // 100 USDC rolling cap
        caps[1] = 0.2 ether; // 0.2 ETH rolling cap
        caps[2] = 100 * 1e18; // CAFE rolling cap

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
        WebAuthn.Signature[] memory sigs
    ) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, userOpHash);
        bytes memory agentSig = abi.encodePacked(r, s, v);
        return abi.encodePacked(uint8(2), abi.encode(vm.addr(pk), agentSig, ids, sigs));
    }

    function _buildAgentOp(bytes memory callData) internal view returns (PackedUserOperation memory op, bytes32 opHash) {
        op.sender = address(account);
        op.nonce = 0;
        op.callData = callData;
        op.accountGasLimits = bytes32(0);
        op.preVerificationGas = 50000;
        op.gasFees = bytes32(0);
        opHash = account.getUserOpHash(op);
    }

    function _validateOp(PackedUserOperation memory op, bytes32 opHash) internal returns (uint256) {
        vm.prank(ENTRYPOINT);
        return account.validateUserOp(op, opHash, 0);
    }

    // =======================================================================
    // 1. Core Legitimacy & Micro-Spend Verification
    // =======================================================================

    function test_Agent_ValidMicroSpend_Success() public {
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 20 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(uint160(val), 0, "Autonomous 20 USDC transfer under $50 should succeed");
    }

    function test_Agent_UniswapV3_ValidSwap_Success() public {
        bytes memory innerFunc = abi.encodeWithSelector(
            SpendPolicy.UNISWAP_V3_EXACT_INPUT_SINGLE,
            MockUniswapV3Router.ExactInputSingleParams({
                tokenIn: address(usdc),
                tokenOut: address(0xCAFE),
                fee: 3000,
                recipient: address(account), // recipient lock: smart account
                amountIn: 45 * 1e6, // $45 under $50 limit
                amountOutMinimum: 40 * 1e6, // Non-zero slippage protection
                sqrtPriceLimitX96: 0
            })
        );
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(router), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(uint160(val), 0, "Valid Uniswap V3 swap under limits should succeed");
    }

    function test_Agent_UniswapV3_ZeroSlippage_Reverts() public {
        bytes memory innerFunc = abi.encodeWithSelector(
            SpendPolicy.UNISWAP_V3_EXACT_INPUT_SINGLE,
            MockUniswapV3Router.ExactInputSingleParams({
                tokenIn: address(usdc),
                tokenOut: address(0xCAFE),
                fee: 3000,
                recipient: address(account),
                amountIn: 45 * 1e6,
                amountOutMinimum: 0, // DANGEROUS: Zero slippage protection
                sqrtPriceLimitX96: 0
            })
        );
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(router), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Autonomous swap with amountOutMinimum == 0 MUST be rejected");
    }

    // =======================================================================
    // 2. Authentication & Cryptographic Integrity
    // =======================================================================

    function test_Agent_InvalidSignature_Reverts() public {
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 20 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        // Signed with wrong private key
        op.signature = _signAgentOp(0x999999, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Forged ECDSA signature must return validation failure");
    }

    function test_Agent_UnknownAgent_Reverts() public {
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 20 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (attackerAgentKey, address(usdc), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(ATTACKER_AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Unregistered agent key must return validation failure");
    }

    function test_Agent_MalleableSignature_Reverts() public {
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 20 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AGENT_PK, opHash);

        // Craft high-S malleable signature
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 highS = bytes32(n - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;

        bytes memory malleableSig = abi.encodePacked(r, highS, flippedV);
        op.signature = abi.encodePacked(uint8(1), abi.encode(agentKey, malleableSig));

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "High-S malleable signature must be rejected");
    }

    function test_Agent_MalformedSignature_Reverts() public {
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 20 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = hex"0112345678"; // truncated garbage

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Malformed signature payload must fail closed");
    }

    // =======================================================================
    // 3. Lifecycle & Expiry Guardrails (INVARIANT 8 & 9)
    // =======================================================================

    function test_Agent_Revoked_Reverts() public {
        // Master user revokes agentKey
        vm.prank(address(account));
        account.revokeAgentSession(agentKey);

        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 20 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Revoked agent key must fail immediately");
    }

    function test_Agent_Expired_Reverts() public {
        // Fast forward 8 days (session expiry was 7 days)
        vm.warp(block.timestamp + 8 days);

        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 20 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        // Valid until is checked or validation data carries expired time
        uint48 validUntil = uint48(val >> 160);
        assertTrue(validUntil < block.timestamp, "Expired agent session must return past validUntil");
    }

    function test_Agent_NotYetValid_Reverts() public {
        // Grant session starting in future
        address[] memory protocols = new address[](1);
        protocols[0] = RECIPIENT;
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = bytes4(0);
        uint256[] memory caps = new uint256[](1);
        caps[0] = 100 * 1e6;

        PasskeyAccount.SessionConfig memory futureConfig = PasskeyAccount.SessionConfig({
            agentKey: attackerAgentKey,
            validAfter: uint48(block.timestamp + 1 days),
            validUntil: uint48(block.timestamp + 7 days),
            humanApprovalThreshold: 100 * 1e6,
            perTxLimitEth: 0.05 ether,
            perTxLimitToken: 50 * 1e6,
            windowDuration: 1 days,
            allowedProtocols: protocols,
            allowedSelectors: selectors,
            allowedTokens: tokens,
            tokenWindowCaps: caps
        });
        vm.prank(address(account));
        account.grantAgentSession(futureConfig);

        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 20 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (attackerAgentKey, address(usdc), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(ATTACKER_AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        uint48 validAfter = uint48(val >> 208);
        assertTrue(validAfter > block.timestamp, "Future session must return validAfter in future");
    }

    // =======================================================================
    // 4. Per-Transaction & Rolling Window Limits (INVARIANT 4 & 5)
    // =======================================================================

    function test_Agent_ExceedsPerTxLimit_Reverts() public {
        // Agent attempts $60 transfer ($50 limit)
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 60 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Exceeding per-tx limit autonomously must fail");
    }

    function test_Agent_ExceedsRollingWindow_Reverts() public {
        // 1st op: $40
        bytes memory innerFunc1 = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 40 * 1e6);
        bytes memory cd1 = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc1));
        (PackedUserOperation memory op1, bytes32 opHash1) = _buildAgentOp(cd1);
        op1.signature = _signAgentOp(AGENT_PK, opHash1);
        uint256 val1 = _validateOp(op1, opHash1);
        assertEq(uint160(val1), 0);

        vm.prank(ENTRYPOINT);
        account.executeByAgent(agentKey, address(usdc), 0, innerFunc1);

        // 2nd op: $40
        bytes memory innerFunc2 = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 40 * 1e6);
        bytes memory cd2 = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc2));
        (PackedUserOperation memory op2, bytes32 opHash2) = _buildAgentOp(cd2);
        op2.signature = _signAgentOp(AGENT_PK, opHash2);
        uint256 val2 = _validateOp(op2, opHash2);
        assertEq(uint160(val2), 0);

        vm.prank(ENTRYPOINT);
        account.executeByAgent(agentKey, address(usdc), 0, innerFunc2);

        // 3rd op: $40 (Total = $120 > $100 rolling cap)
        bytes memory innerFunc3 = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 40 * 1e6);
        bytes memory cd3 = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc3));
        (PackedUserOperation memory op3, bytes32 opHash3) = _buildAgentOp(cd3);
        op3.signature = _signAgentOp(AGENT_PK, opHash3);

        uint256 val3 = _validateOp(op3, opHash3);
        // Returns deferred validAfter in future when window rolls
        uint48 validAfter3 = uint48(val3 >> 208);
        assertTrue(validAfter3 > block.timestamp, "3rd op exceeding daily rolling cap must be deferred / rejected");
    }

    // =======================================================================
    // 5. Batch Security & Splitting Attack Defense (PHASE 2D)
    // =======================================================================

    function test_Agent_BatchLimitBypass_Reverts() public {
        // Attacker splits $80 into 2 x $40 within a single batch
        address[] memory dests = new address[](2);
        dests[0] = address(usdc);
        dests[1] = address(usdc);

        uint256[] memory values = new uint256[](2);
        values[0] = 0;
        values[1] = 0;

        bytes[] memory funcs = new bytes[](2);
        funcs[0] = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 40 * 1e6);
        funcs[1] = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 40 * 1e6);

        bytes memory callData = abi.encodeCall(PasskeyAccount.executeBatchByAgent, (agentKey, dests, values, funcs));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Batch splitting 2 x $40 to bypass $50 per-tx limit MUST be rejected");
    }

    // =======================================================================
    // 6. DeFi Safety: Recipient Lock & Approval Security (INVARIANT 6 & 7)
    // =======================================================================

    function test_Agent_SwapRecipientHijack_Reverts() public {
        // Attacker modifies recipient in Uniswap V3 swap calldata to route output to ATTACKER
        bytes memory innerFunc = abi.encodeWithSelector(
            SpendPolicy.UNISWAP_V3_EXACT_INPUT_SINGLE,
            MockUniswapV3Router.ExactInputSingleParams({
                tokenIn: address(usdc),
                tokenOut: address(0xCAFE),
                fee: 3000,
                recipient: ATTACKER, // MALICIOUS RECIPIENT!
                amountIn: 40 * 1e6,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(router), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Swap with recipient != smart account MUST be rejected");
    }

    function test_Agent_InfiniteApproval_Reverts() public {
        // Agent attempts to create an unlimited allowance on USDC
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.APPROVE, ATTACKER, type(uint256).max);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Autonomous token approval MUST be rejected");
    }

    function test_Agent_UnapprovedProtocol_Reverts() public {
        // Calling untrusted contract
        address untrustedProtocol = address(0x999);
        bytes memory innerFunc = abi.encodeWithSignature("drainFunds()");
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, untrustedProtocol, 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Calling unapproved protocol MUST be rejected");
    }

    function test_Agent_UnapprovedSelector_Reverts() public {
        // Router is approved for exactInputSingle, but agent calls exactOutputSingle (unapproved)
        bytes4 unapprovedSelector = 0xdb3e2198;
        bytes memory innerFunc = abi.encodeWithSelector(unapprovedSelector, hex"1234");
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(router), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Calling unapproved selector on approved router MUST be rejected");
    }

    // =======================================================================
    // 7. Isolation of Master Authority (INVARIANTS 1, 2, 3)
    // =======================================================================

    function test_Agent_CannotModifyOwnPermissions() public {
        // Agent tries to call grantAgentSession on the account to increase its own limit
        PasskeyAccount.SessionConfig memory newConfig = PasskeyAccount.SessionConfig({
            agentKey: agentKey,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 30 days),
            humanApprovalThreshold: 0,
            perTxLimitEth: 100 ether,
            perTxLimitToken: 1_000_000 * 1e6, // $1,000,000 limit
            windowDuration: 1 days,
            allowedProtocols: new address[](0),
            allowedSelectors: new bytes4[](0),
            allowedTokens: new address[](0),
            tokenWindowCaps: new uint256[](0)
        });
        bytes memory innerFunc = abi.encodeWithSelector(PasskeyAccount.grantAgentSession.selector, newConfig);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(account), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Agent attempting to call self config to raise limit MUST be rejected");
    }

    function test_Agent_CannotAddNewAgent() public {
        PasskeyAccount.SessionConfig memory newConfig = PasskeyAccount.SessionConfig({
            agentKey: attackerAgentKey,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 30 days),
            humanApprovalThreshold: 0,
            perTxLimitEth: 100 ether,
            perTxLimitToken: 1_000_000 * 1e6,
            windowDuration: 1 days,
            allowedProtocols: new address[](0),
            allowedSelectors: new bytes4[](0),
            allowedTokens: new address[](0),
            tokenWindowCaps: new uint256[](0)
        });
        bytes memory innerFunc = abi.encodeWithSelector(PasskeyAccount.grantAgentSession.selector, newConfig);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(account), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Agent cannot register another agent");
    }

    function test_Agent_CannotRemoveMasterSigner() public {
        bytes memory innerFunc = abi.encodeWithSelector(PasskeyAccount.removeSigner.selector, 0);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(account), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Agent cannot remove master passkey signers");
    }

    function test_Agent_CannotBypassFreeze() public {
        // Master user triggers emergency freeze
        vm.prank(address(account));
        account.freeze();

        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 20 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "All agent ops MUST fail when account is frozen");
    }

    // =======================================================================
    // 8. Human Escalation & Dual-Signature Security (PHASE 2G)
    // =======================================================================

    function test_Agent_HumanEscalationWithoutPasskey_Reverts() public {
        // Agent requests $150 (above humanApprovalThreshold of $100)
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 150 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "High-value op without passkey approval MUST fail");
    }

    function test_Agent_HumanEscalationWithValidPasskey_Succeeds() public {
        // Agent requests $150 and includes 2-of-2 Passkey authorization
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 150 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        (PackedUserOperation memory op, ) = _buildAgentOp(callData);

        // Escalated op signature: agent + 2 passkeys
        uint256[] memory passkeyIds = new uint256[](2);
        passkeyIds[0] = 0;
        passkeyIds[1] = 1;

        WebAuthn.Signature[] memory passkeySigs = new WebAuthn.Signature[](2);
        passkeySigs[0] = _v_large_k0();
        passkeySigs[1] = _v_large_k1();

        // For this vector test, we bind to H_LARGE hash
        bytes memory sig = _signEscalatedOp(AGENT_PK, H_LARGE, passkeyIds, passkeySigs);
        op.signature = sig;

        vm.prank(ENTRYPOINT);
        uint256 val = account.validateUserOp(op, H_LARGE, 0);
        assertEq(uint160(val), 0, "Escalated op with valid passkey quorum MUST succeed");
    }

    function test_Agent_HumanApprovalReplay_Reverts() public {
        // Op 1 (approved for 150 USDC)
        bytes memory innerFunc1 = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 150 * 1e6);
        bytes memory cd1 = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc1));
        _buildAgentOp(cd1);

        uint256[] memory passkeyIds = new uint256[](2);
        passkeyIds[0] = 0;
        passkeyIds[1] = 1;
        WebAuthn.Signature[] memory passkeySigs = new WebAuthn.Signature[](2);
        passkeySigs[0] = _v_large_k0();
        passkeySigs[1] = _v_large_k1();

        bytes memory sigFromOp1 = _signEscalatedOp(AGENT_PK, H_LARGE, passkeyIds, passkeySigs);

        // Op 2 (Attacker crafts different calldata: transfer to ATTACKER instead)
        bytes memory innerFunc2 = abi.encodeWithSelector(SpendPolicy.TRANSFER, ATTACKER, 150 * 1e6);
        bytes memory cd2 = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc2));
        (PackedUserOperation memory op2, bytes32 opHash2) = _buildAgentOp(cd2);

        // Attacker attempts to attach signature from Op 1
        op2.signature = sigFromOp1;

        uint256 val = _validateOp(op2, opHash2);
        assertEq(val, 1, "Replaying human approval on a different operation MUST be rejected");
    }

    // =======================================================================
    // 9. Replay & Domain Separation (INVARIANT 12)
    // =======================================================================

    function test_Agent_CrossChainReplay_Reverts() public {
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 20 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        (PackedUserOperation memory op, ) = _buildAgentOp(callData);

        // Sign hash for chainId 1 (Ethereum Mainnet)
        bytes32 mainnetHash = keccak256(
            abi.encode(
                keccak256(abi.encode(op.sender, op.nonce, keccak256(op.initCode), keccak256(op.callData), op.accountGasLimits, op.preVerificationGas, op.gasFees, keccak256(op.paymasterAndData))),
                ENTRYPOINT,
                1 // chainId 1
            )
        );

        op.signature = _signAgentOp(AGENT_PK, mainnetHash);

        // Broadcast on test chain (chainId 31337 / block.chainid)
        bytes32 localHash = account.getUserOpHash(op);
        uint256 val = _validateOp(op, localHash);
        assertEq(val, 1, "Cross-chain replay MUST be rejected");
    }

    function test_Agent_WrongEntryPoint_Reverts() public {
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 20 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        (PackedUserOperation memory op, ) = _buildAgentOp(callData);

        // Sign hash for fake EntryPoint
        bytes32 fakeEntryPointHash = keccak256(
            abi.encode(
                keccak256(abi.encode(op.sender, op.nonce, keccak256(op.initCode), keccak256(op.callData), op.accountGasLimits, op.preVerificationGas, op.gasFees, keccak256(op.paymasterAndData))),
                address(0xFA3E),
                block.chainid
            )
        );

        op.signature = _signAgentOp(AGENT_PK, fakeEntryPointHash);

        bytes32 localHash = account.getUserOpHash(op);
        uint256 val = _validateOp(op, localHash);
        assertEq(val, 1, "Wrong EntryPoint signature MUST be rejected");
    }

    function test_Agent_DirectExecute_WithoutExecuteByAgent_Reverts() public {
        // Agent attempts to call standard execute() instead of executeByAgent()
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 20 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.execute, (address(usdc), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Agent signature calling execute() directly MUST be rejected");
    }
}
