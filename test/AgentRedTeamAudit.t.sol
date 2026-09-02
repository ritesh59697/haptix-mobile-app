// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {PasskeyAccount, PackedUserOperation} from "../src/PasskeyAccount.sol";
import {WebAuthn} from "../src/WebAuthn.sol";
import {SpendPolicy} from "../src/SpendPolicy.sol";
import {Vectors} from "./Vectors.sol";

contract MockReentrantTarget {
    PasskeyAccount public account;
    bool public attacked;

    constructor(PasskeyAccount _account) {
        account = _account;
    }

    receive() external payable {
        attacked = true;
        try account.removeSigner(0) {} catch {}
    }

    // Malicious callback when called by the account
    fallback() external payable {
        attacked = true;
        // Attempt to call onlySelf function grantAgentSession or removeSigner
        try account.removeSigner(0) {
            // Should never succeed
        } catch {}
    }
}

contract MockERC20RedTeam {
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

contract MockUniswapV3RouterRedTeam {
    struct ExactInputSingleParamsV2 {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactInputSingleParamsV1 {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParamsV2 calldata params) external pure returns (uint256 amountOut) {
        amountOut = params.amountOutMinimum > 0 ? params.amountOutMinimum : params.amountIn;
    }

    function exactInputSingle(ExactInputSingleParamsV1 calldata params) external pure returns (uint256 amountOut) {
        amountOut = params.amountOutMinimum > 0 ? params.amountOutMinimum : params.amountIn;
    }
}

/// @title AgentRedTeamAuditTest -- Dedicated security red-team and adversarial fuzz suite
contract AgentRedTeamAuditTest is Test, Vectors {
    PasskeyAccount account;
    MockERC20RedTeam usdc;
    MockUniswapV3RouterRedTeam router;
    MockReentrantTarget reentrantTarget;

    address constant ENTRYPOINT = address(0xE);
    address constant RECIPIENT = address(0xBEEF);
    address constant ATTACKER = address(0xDEAD);
    uint256 constant THRESHOLD = 1 ether;

    uint256 constant AGENT_PK = 0xA11CE;
    address agentKey;

    uint256 constant AGENT_2_PK = 0xB0B;
    address agent2Key;

    bytes32 constant H_LARGE = bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222));

    function setUp() public {
        agentKey = vm.addr(AGENT_PK);
        agent2Key = vm.addr(AGENT_2_PK);

        account = new PasskeyAccount(ENTRYPOINT, _signers2(K0_X, K0_Y, K1_X, K1_Y), THRESHOLD);
        usdc = new MockERC20RedTeam();
        router = new MockUniswapV3RouterRedTeam();
        reentrantTarget = new MockReentrantTarget(account);

        vm.deal(address(account), 100 ether);
        usdc.mint(address(account), 10_000 * 1e6);

        address[] memory protocols = new address[](3);
        protocols[0] = address(router);
        protocols[1] = RECIPIENT;
        protocols[2] = address(reentrantTarget);

        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = SpendPolicy.UNISWAP_V3_EXACT_INPUT_SINGLE;
        selectors[1] = bytes4(0);
        selectors[2] = bytes4(0);

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

    function _buildAgentOp(bytes memory callData, uint256 nonce) internal view returns (PackedUserOperation memory op, bytes32 opHash) {
        op.sender = address(account);
        op.nonce = nonce;
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
    // 1. Red-Team: Value Leaks & Sidecar Injection
    // =======================================================================

    function test_Attack_SwapWithNativeEthLeak_Blocked() public {
        // Attacker attempts to attach 5 ETH along with a 20 USDC swap
        bytes memory innerFunc = abi.encodeWithSelector(
            SpendPolicy.UNISWAP_V3_EXACT_INPUT_SINGLE,
            MockUniswapV3RouterRedTeam.ExactInputSingleParamsV2({
                tokenIn: address(usdc),
                tokenOut: address(0xCAFE),
                fee: 3000,
                recipient: address(account),
                amountIn: 20 * 1e6,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
        // value = 5 ether (LEAK ATTACK!)
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(router), 5 ether, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Swap with value > 0 MUST be rejected to prevent native ETH value leaks");
    }

    function test_Attack_ERC20TransferWithNativeEthLeak_Blocked() public {
        // Attacker attempts to attach 5 ETH along with an ERC20 transfer
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 20 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 5 ether, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "ERC20 transfer with value > 0 MUST be rejected to prevent native ETH value leaks");
    }

    // =======================================================================
    // 2. Red-Team: Malicious Array Offsets & Batch Head Overlap
    // =======================================================================

    function test_Attack_BatchWithHeadOffsetUnder128_Blocked() public {
        // Construct malformed executeBatchByAgent with array offsets pointing inside static head (< 128)
        bytes memory malformedCallData = abi.encodePacked(
            PasskeyAccount.executeBatchByAgent.selector,
            bytes32(uint256(uint160(agentKey))), // word 0: agentKey
            bytes32(uint256(96)),                // word 1: dests offset = 96 (< 128!)
            bytes32(uint256(96)),                // word 2: values offset = 96 (< 128!)
            bytes32(uint256(96))                 // word 3: funcs offset = 96 (< 128!)
        );

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(malformedCallData, 0);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Array offset overlapping static head MUST fail closed");
    }

    function test_Attack_GrantSessionLengthMismatch_Reverts() public {
        address[] memory protocols = new address[](2);
        protocols[0] = address(router);
        protocols[1] = RECIPIENT;

        bytes4[] memory selectors = new bytes4[](1); // MISMATCH: 1 selector for 2 protocols
        selectors[0] = SpendPolicy.UNISWAP_V3_EXACT_INPUT_SINGLE;

        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        uint256[] memory caps = new uint256[](1);
        caps[0] = 100 * 1e6;

        PasskeyAccount.SessionConfig memory config = PasskeyAccount.SessionConfig({
            agentKey: agent2Key,
            validAfter: uint48(block.timestamp),
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
        vm.expectRevert(PasskeyAccount.LengthMismatch.selector);
        account.grantAgentSession(config);
    }

    function test_Attack_NegativeOrZeroDuration_Reverts() public {
        address[] memory protocols = new address[](1);
        protocols[0] = RECIPIENT;
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = bytes4(0);
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        uint256[] memory caps = new uint256[](1);
        caps[0] = 100 * 1e6;

        // validUntil <= validAfter
        PasskeyAccount.SessionConfig memory config = PasskeyAccount.SessionConfig({
            agentKey: agent2Key,
            validAfter: uint48(block.timestamp + 10 days),
            validUntil: uint48(block.timestamp + 5 days),
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
        vm.expectRevert(PasskeyAccount.InvalidSessionDuration.selector);
        account.grantAgentSession(config);
    }

    // =======================================================================
    // 3. Red-Team: Escalation Cross-Operation Replay Matrix
    // =======================================================================

    function test_Attack_ReplayPasskeySignatureWithDifferentNonce_Blocked() public {
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 150 * 1e6);
        bytes memory cd = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));

        // Op at nonce 0 signed with passkey quorum
        (, bytes32 hash0) = _buildAgentOp(cd, 0);
        uint256[] memory passkeyIds = new uint256[](2);
        passkeyIds[0] = 0;
        passkeyIds[1] = 1;
        WebAuthn.Signature[] memory passkeySigs = new WebAuthn.Signature[](2);
        passkeySigs[0] = _v_large_k0();
        passkeySigs[1] = _v_large_k1();

        bytes memory escalatedSig = _signEscalatedOp(AGENT_PK, hash0, passkeyIds, passkeySigs);

        // Attacker creates Op at nonce 1 and attaches previous escalated signature
        (PackedUserOperation memory op1, bytes32 hash1) = _buildAgentOp(cd, 1);
        op1.signature = escalatedSig;

        uint256 val = _validateOp(op1, hash1);
        assertEq(val, 1, "Replaying passkey signature on different nonce MUST fail");
    }

    function test_Attack_ReplayPasskeySignatureWithDifferentTarget_Blocked() public {
        bytes memory innerFunc1 = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 150 * 1e6);
        bytes memory cd1 = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc1));
        (, bytes32 hash1) = _buildAgentOp(cd1, 0);

        uint256[] memory passkeyIds = new uint256[](2);
        passkeyIds[0] = 0;
        passkeyIds[1] = 1;
        WebAuthn.Signature[] memory passkeySigs = new WebAuthn.Signature[](2);
        passkeySigs[0] = _v_large_k0();
        passkeySigs[1] = _v_large_k1();

        bytes memory escalatedSig = _signEscalatedOp(AGENT_PK, hash1, passkeyIds, passkeySigs);

        // Attacker changes target to ATTACKER
        bytes memory innerFunc2 = abi.encodeWithSelector(SpendPolicy.TRANSFER, ATTACKER, 150 * 1e6);
        bytes memory cd2 = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc2));
        (PackedUserOperation memory op2, bytes32 hash2) = _buildAgentOp(cd2, 0);
        op2.signature = escalatedSig;

        uint256 val = _validateOp(op2, hash2);
        assertEq(val, 1, "Replaying passkey signature on different target MUST fail");
    }

    function test_Attack_ReorderedPasskeySigners_Blocked() public {
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 150 * 1e6);
        bytes memory cd = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));
        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(cd, 0);

        // Out-of-order signer IDs: [1, 0] instead of [0, 1]
        uint256[] memory passkeyIds = new uint256[](2);
        passkeyIds[0] = 1;
        passkeyIds[1] = 0;
        WebAuthn.Signature[] memory passkeySigs = new WebAuthn.Signature[](2);
        passkeySigs[0] = _v_large_k1();
        passkeySigs[1] = _v_large_k0();

        op.signature = _signEscalatedOp(AGENT_PK, opHash, passkeyIds, passkeySigs);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Out-of-order signer IDs MUST fail verification");
    }

    function test_Attack_DuplicatePasskeySigner_Blocked() public {
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 150 * 1e6);
        bytes memory cd = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc), 0, innerFunc));
        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(cd, 0);

        // Duplicate signer ID: [0, 0]
        uint256[] memory passkeyIds = new uint256[](2);
        passkeyIds[0] = 0;
        passkeyIds[1] = 0;
        WebAuthn.Signature[] memory passkeySigs = new WebAuthn.Signature[](2);
        passkeySigs[0] = _v_large_k0();
        passkeySigs[1] = _v_large_k0();

        op.signature = _signEscalatedOp(AGENT_PK, opHash, passkeyIds, passkeySigs);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Duplicate signer ID MUST fail verification");
    }

    // =======================================================================
    // 4. Red-Team: Reentrancy & Callback Hijacking
    // =======================================================================

    function test_Attack_ArbitraryContractReentrancy_Blocked() public {
        // Agent calls reentrantTarget (allowed protocol), which tries to call removeSigner(0) in its fallback
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(reentrantTarget), 0.01 ether, ""));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(uint160(val), 0, "Initial validation of approved call should pass");

        // Execute via EntryPoint
        vm.prank(ENTRYPOINT);
        account.executeByAgent(agentKey, address(reentrantTarget), 0.01 ether, "");

        assertTrue(reentrantTarget.attacked(), "Fallback was triggered");
        assertEq(account.signerCount(), 2, "SignerCount must NOT have changed: reentrancy into onlySelf failed");
    }

    // =======================================================================
    // 5. Red-Team: SwapRouter V1 vs V2 Layout Auditing
    // =======================================================================

    function test_Attack_SwapRecipientLock_SwapRouterV1_Blocked() public {
        // Whitelist SwapRouter V1 selector
        vm.prank(address(account));
        account.setAgentSelector(agentKey, address(router), SpendPolicy.UNISWAP_V3_EXACT_INPUT_SINGLE_ROUTER1, true);

        // Attacker attempts to route proceeds to ATTACKER on Router V1
        bytes memory innerFunc = abi.encodeWithSelector(
            SpendPolicy.UNISWAP_V3_EXACT_INPUT_SINGLE_ROUTER1,
            MockUniswapV3RouterRedTeam.ExactInputSingleParamsV1({
                tokenIn: address(usdc),
                tokenOut: address(0xCAFE),
                fee: 3000,
                recipient: ATTACKER, // MALICIOUS!
                deadline: block.timestamp + 100,
                amountIn: 40 * 1e6,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(router), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "SwapRouter V1 swap with recipient != account MUST be rejected");
    }

    function test_Attack_SwapRecipientLock_SwapRouterV1_Success() public {
        vm.prank(address(account));
        account.setAgentSelector(agentKey, address(router), SpendPolicy.UNISWAP_V3_EXACT_INPUT_SINGLE_ROUTER1, true);

        // Valid SwapRouter V1 swap
        bytes memory innerFunc = abi.encodeWithSelector(
            SpendPolicy.UNISWAP_V3_EXACT_INPUT_SINGLE_ROUTER1,
            MockUniswapV3RouterRedTeam.ExactInputSingleParamsV1({
                tokenIn: address(usdc),
                tokenOut: address(0xCAFE),
                fee: 3000,
                recipient: address(account), // CORRECT
                deadline: block.timestamp + 100,
                amountIn: 40 * 1e6,
                amountOutMinimum: 38 * 1e6,
                sqrtPriceLimitX96: 0
            })
        );
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(router), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(uint160(val), 0, "Valid SwapRouter V1 swap under limits MUST succeed");
    }

    // =======================================================================
    // 6. Property & Fuzzing: Malicious / Random Calldata Fails Closed
    // =======================================================================

    function testFuzz_MaliciousCalldata_AlwaysFailsClosed(bytes calldata randomData) public {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.nonce = 0;
        op.callData = randomData;
        op.accountGasLimits = bytes32(0);
        op.preVerificationGas = 50000;
        op.gasFees = bytes32(0);
        bytes32 opHash = account.getUserOpHash(op);

        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        // Either fails signature/calldata (returns 1) or returns valid validationData
        // It must NEVER revert or panic!
        assertTrue(val == 1 || uint160(val) == 0, "Validation must handle all arbitrary fuzzed inputs cleanly without reverting");
    }
}
