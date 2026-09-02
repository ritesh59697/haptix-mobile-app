// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {PasskeyAccount, PackedUserOperation} from "../src/PasskeyAccount.sol";
import {WebAuthn} from "../src/WebAuthn.sol";
import {SpendPolicy} from "../src/SpendPolicy.sol";
import {Vectors} from "./Vectors.sol";

contract MockERC20Decimals {
    string public name;
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockFeeOnTransferToken {
    string public name = "Fee Token";
    string public symbol = "FEE";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        uint256 fee = amount / 10; // 10% fee
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += (amount - fee);
        return true;
    }
}

contract MockFalseReturningToken {
    string public name = "False Token";
    string public symbol = "FALSE";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false; // Returns false instead of reverting
    }
}

contract MockERC721 {
    mapping(uint256 => address) public ownerOf;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    function mint(address to, uint256 tokenId) external {
        ownerOf[tokenId] = to;
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        require(ownerOf[tokenId] == from, "owner");
        ownerOf[tokenId] = to;
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
    }
}

/// @title AgentSecurityHardeningTest -- Production-readiness & deep invariant fuzzing
contract AgentSecurityHardeningTest is Test, Vectors {
    PasskeyAccount account;
    MockERC20Decimals usdc6;
    MockERC20Decimals wbtc8;
    MockERC20Decimals dai18;
    MockFeeOnTransferToken feeToken;
    MockFalseReturningToken falseToken;
    MockERC721 nft;

    address constant ENTRYPOINT = address(0xE);
    address constant RECIPIENT = address(0xBEEF);
    address constant ATTACKER = address(0xDEAD);
    uint256 constant THRESHOLD = 1 ether;

    uint256 constant AGENT_PK = 0xA11CE;
    address agentKey;

    function setUp() public {
        agentKey = vm.addr(AGENT_PK);

        account = new PasskeyAccount(ENTRYPOINT, _signers2(K0_X, K0_Y, K1_X, K1_Y), THRESHOLD);
        usdc6 = new MockERC20Decimals("USDC", "USDC", 6);
        wbtc8 = new MockERC20Decimals("WBTC", "WBTC", 8);
        dai18 = new MockERC20Decimals("DAI", "DAI", 18);
        feeToken = new MockFeeOnTransferToken();
        falseToken = new MockFalseReturningToken();
        nft = new MockERC721();

        vm.deal(address(account), 100 ether);
        usdc6.mint(address(account), 10_000 * 1e6);
        wbtc8.mint(address(account), 10 * 1e8);
        dai18.mint(address(account), 10_000 * 1e18);
        feeToken.mint(address(account), 1_000 * 1e18);
        nft.mint(address(account), 1);

        address[] memory protocols = new address[](1);
        protocols[0] = RECIPIENT;

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = bytes4(0);

        address[] memory tokens = new address[](4);
        tokens[0] = address(usdc6);
        tokens[1] = address(wbtc8);
        tokens[2] = address(dai18);
        tokens[3] = address(feeToken);

        uint256[] memory caps = new uint256[](4);
        caps[0] = 100 * 1e6;  // 100 USDC
        caps[1] = 1 * 1e8;    // 1 WBTC
        caps[2] = 100 * 1e18; // 100 DAI
        caps[3] = 100 * 1e18; // 100 FEE

        PasskeyAccount.SessionConfig memory config = PasskeyAccount.SessionConfig({
            agentKey: agentKey,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 7 days),
            humanApprovalThreshold: 100 * 1e18, // highest threshold across units
            perTxLimitEth: 0.05 ether,
            perTxLimitToken: 50 * 1e18, // generic token max
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
    // 1. Token Decimals & Multi-Asset Unit Invariant Isolation
    // =======================================================================

    function test_Decimals_USDC6_EnforcedInBaseUnits() public {
        // 40 USDC (40 * 1e6) is under 50 * 1e18 limit
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 40 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc6), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(uint160(val), 0, "40 USDC should validate cleanly in base units");
    }

    function test_Decimals_WBTC8_EnforcedInBaseUnits() public {
        // 0.5 WBTC (50_000_000 base units)
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 50_000_000);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(wbtc8), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(uint160(val), 0, "0.5 WBTC should validate cleanly in base units");
    }

    function test_Decimals_DAI18_EnforcedInBaseUnits() public {
        // 40 DAI (40 * 1e18 base units)
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 40 * 1e18);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(dai18), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(uint160(val), 0, "40 DAI should validate cleanly in base units");
    }

    function test_Decimals_MultiAssetBatch_PreservesIndividualUnits() public {
        // Batch spending 30 USDC (6 dec) + 0.2 WBTC (8 dec) + 30 DAI (18 dec)
        address[] memory dests = new address[](3);
        dests[0] = address(usdc6);
        dests[1] = address(wbtc8);
        dests[2] = address(dai18);

        uint256[] memory values = new uint256[](3);

        bytes[] memory funcs = new bytes[](3);
        funcs[0] = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 30 * 1e6);
        funcs[1] = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 20_000_000);
        funcs[2] = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 30 * 1e18);

        bytes memory callData = abi.encodeCall(PasskeyAccount.executeBatchByAgent, (agentKey, dests, values, funcs));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(uint160(val), 0, "Multi-asset batch with diverse decimals must validate independently");
    }

    // =======================================================================
    // 2. Non-Standard ERC-20 & Edge Case Testing
    // =======================================================================

    function test_ERC20_FeeOnTransfer_AccountingHolds() public {
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 40 * 1e18);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(feeToken), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(uint160(val), 0, "Fee-on-transfer token validates normally");

        vm.prank(ENTRYPOINT);
        account.executeByAgent(agentKey, address(feeToken), 0, innerFunc);

        // Account balance reduced by 40 * 1e18, recipient received 36 * 1e18 (4 fee)
        assertEq(feeToken.balanceOf(RECIPIENT), 36 * 1e18);
    }

    function test_ERC20_ZeroAmountTransfer_Rejected() public {
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 0);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc6), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Zero amount ERC-20 transfer MUST be rejected for autonomous agent");
    }

    // =======================================================================
    // 3. NFT Transfer & Approval Fail-Closed Protection
    // =======================================================================

    function test_NFT_SafeTransferFrom_RejectedForAutonomousAgent() public {
        bytes memory innerFunc = abi.encodeWithSelector(MockERC721.safeTransferFrom.selector, address(account), ATTACKER, 1);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(nft), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "ERC-721 safeTransferFrom MUST fail closed for autonomous agent ops");
    }

    function test_NFT_SetApprovalForAll_RejectedForAutonomousAgent() public {
        bytes memory innerFunc = abi.encodeWithSelector(MockERC721.setApprovalForAll.selector, ATTACKER, true);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(nft), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "ERC-721 setApprovalForAll MUST fail closed for autonomous agent ops");
    }

    // =======================================================================
    // 4. Session Re-Granting & Revocation Lifecycle
    // =======================================================================

    function test_Lifecycle_Revocation_ImmediatelyRejectsAgent() public {
        // Revoke session via onlySelf (2-of-N passkey config)
        vm.prank(address(account));
        account.revokeAgentSession(agentKey);

        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 10 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc6), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(val, 1, "Revoked agent session MUST be rejected immediately");
    }

    function test_Lifecycle_ReGrantSession_RestoresAgentWithNewLimits() public {
        // First revoke
        vm.prank(address(account));
        account.revokeAgentSession(agentKey);

        // Then re-grant with new limits
        address[] memory protocols = new address[](1);
        protocols[0] = RECIPIENT;
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = bytes4(0);
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc6);
        uint256[] memory caps = new uint256[](1);
        caps[0] = 500 * 1e6;

        PasskeyAccount.SessionConfig memory newConfig = PasskeyAccount.SessionConfig({
            agentKey: agentKey,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 14 days),
            humanApprovalThreshold: 200 * 1e6,
            perTxLimitEth: 0.1 ether,
            perTxLimitToken: 150 * 1e6,
            windowDuration: 1 days,
            allowedProtocols: protocols,
            allowedSelectors: selectors,
            allowedTokens: tokens,
            tokenWindowCaps: caps
        });

        vm.prank(address(account));
        account.grantAgentSession(newConfig);

        // Now agent can spend under new limits
        bytes memory innerFunc = abi.encodeWithSelector(SpendPolicy.TRANSFER, RECIPIENT, 120 * 1e6);
        bytes memory callData = abi.encodeCall(PasskeyAccount.executeByAgent, (agentKey, address(usdc6), 0, innerFunc));

        (PackedUserOperation memory op, bytes32 opHash) = _buildAgentOp(callData, 0);
        op.signature = _signAgentOp(AGENT_PK, opHash);

        uint256 val = _validateOp(op, opHash);
        assertEq(uint160(val), 0, "Re-granted agent session must validate successfully");
    }

    // =======================================================================
    // 5. Invariant Property Testing: Same-Token Swap Reject
    // =======================================================================

    function _decodeHelper(bytes calldata func) external pure returns (SpendPolicy.SwapParams memory) {
        return SpendPolicy.decodeUniswapV3ExactInputSingle(func);
    }

    function test_DeFi_SwapSameToken_Rejected() public view {
        // exactInputSingle with tokenIn == tokenOut
        SpendPolicy.SwapParams memory p = this._decodeHelper(
            abi.encodeWithSelector(
                SpendPolicy.UNISWAP_V3_EXACT_INPUT_SINGLE,
                address(usdc6),
                address(usdc6), // tokenIn == tokenOut!
                uint24(3000),
                address(account),
                uint256(20 * 1e6),
                uint256(19 * 1e6),
                uint160(0)
            )
        );
        assertFalse(p.isValid, "Swap where tokenIn == tokenOut MUST be marked invalid");
    }
}
