/**
 * Haptix Autonomous Agent Execution Runner Example
 * Demonstrates a headless AI bot executing autonomous micro-transactions
 * within on-chain SpendPolicy boundaries using @haptix/sdk.
 */

import {
  generateAgentKey,
  buildPackedUserOp,
  computeUserOpHash,
  signUserOpHash,
  encodeAutonomousAgentSignature,
  encodeExecuteByAgent,
  validateAgentSingleCall,
  calculateAmountOutMinimum,
  parseTokenAmount,
  formatTokenAmount,
  CANONICAL_ENTRYPOINT_V07
} from '../sdk/dist/index.js';

// Configuration
const CONFIG = {
  chainId: 84532n, // Base Sepolia
  entryPoint: CANONICAL_ENTRYPOINT_V07,
  accountAddress: '0x34Aeb3A39fd1838D1C897F879EAB0a258507802c',
  usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  uniswapRouter: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4'
};

async function startAgentBot() {
  console.log('======================================================');
  console.log('       HAPTIX AUTONOMOUS AI AGENT BOT RUNTIME         ');
  console.log('======================================================\n');

  // 1. Initialize Agent Keypair (secp256k1)
  const agentKey = generateAgentKey();
  console.log(`[Agent Bot] Initialized in-memory session key:`);
  console.log(`            Address: ${agentKey.address}`);

  // 2. Active Session Configuration (Granted by Human Owner via Passkey)
  const sessionConfig = {
    agentKey: agentKey.address,
    validAfter: Math.floor(Date.now() / 1000) - 60,
    validUntil: Math.floor(Date.now() / 1000) + 86400 * 7, // 7 days
    perTxLimitEth: parseTokenAmount('0.05', 18),
    perTxLimitToken: parseTokenAmount('50', 6), // $50 max autonomous
    humanApprovalThreshold: parseTokenAmount('200', 6), // $200 escalation ceiling
    windowDuration: 86400n, // 24h
    allowedProtocols: [CONFIG.usdcAddress, CONFIG.uniswapRouter, '0x22db962929afe98d0269De0BAa6c442A3Aa6913D'],
    allowedSelectors: ['0xa9059cbb', '0x04e45aaf'],
    allowedTokens: [CONFIG.usdcAddress],
    tokenWindowCaps: [parseTokenAmount('100', 6)] // $100 per 24h
  };

  console.log(`[Agent Bot] Active Policy Firewalls:`);
  console.log(`            Autonomous Per-Tx Limit: $50.00 USDC`);
  console.log(`            Human Escalation Ceiling: $200.00 USDC`);
  console.log(`            24h Rolling Spend Cap:   $100.00 USDC\n`);

  // Scenario 1: Execute Autonomous Micro-Trade ($20.00 USDC)
  console.log('--- Action 1: Autonomous Micro-Transfer ($20.00 USDC) ---');
  const amountToSpend = parseTokenAmount('20', 6);
  const recipient = '0x22db962929afe98d0269De0BAa6c442A3Aa6913D';
  const transferData = '0xa9059cbb' +
    recipient.slice(2).padStart(64, '0') +
    amountToSpend.toString(16).padStart(64, '0');

  // Pre-flight policy validation
  const check = validateAgentSingleCall(
    sessionConfig,
    CONFIG.usdcAddress,
    0n,
    transferData as `0x${string}`
  );

  if (!check.valid) {
    console.error(`[Agent Bot] ❌ Policy Violation: ${check.reason}`);
    return;
  }

  if (check.requiresEscalation) {
    console.log(`[Agent Bot] 🔑 Operation exceeds $50.00 -> Requesting Human Passkey Biometric Quorum...`);
  } else {
    console.log(`[Agent Bot] ✅ Operation $\\le$ $50.00 -> Proceeding Autonomously (0x01 Signature)...`);
    
    // Build UserOp
    const callData = encodeExecuteByAgent(
      agentKey.address,
      CONFIG.usdcAddress,
      0n,
      transferData as `0x${string}`
    );

    const userOp = buildPackedUserOp({
      sender: CONFIG.accountAddress,
      nonce: 0n,
      callData,
      gasParams: {
        verificationGasLimit: 200000n,
        callGasLimit: 80000n,
        preVerificationGas: 60000n,
        maxPriorityFeePerGas: 50000000n,
        maxFeePerGas: 200000000n
      }
    });

    const userOpHash = computeUserOpHash(userOp, CONFIG.entryPoint, CONFIG.chainId);
    const rawSig = await signUserOpHash(agentKey.privateKey, userOpHash);
    userOp.signature = encodeAutonomousAgentSignature(agentKey.address, rawSig);

    console.log(`[Agent Bot] ⚡ UserOperation constructed & signed!`);
    console.log(`            UserOp Hash: ${userOpHash}`);
    console.log(`            Signature Type: 0x01 (Autonomous Agent Key)`);
    console.log(`            Ready for Bundler Broadcast -> eth_sendUserOperation\n`);
  }

  // Scenario 2: Large Rebalance Attempt ($150.00 USDC)
  console.log('--- Action 2: Large Rebalance Attempt ($150.00 USDC) ---');
  const largeAmount = parseTokenAmount('150', 6);
  const largeTransferData = '0xa9059cbb' +
    recipient.slice(2).padStart(64, '0') +
    largeAmount.toString(16).padStart(64, '0');

  const check2 = validateAgentSingleCall(
    sessionConfig,
    CONFIG.usdcAddress,
    0n,
    largeTransferData as `0x${string}`
  );

  console.log(`[Agent Bot] Policy Check Result:`);
  console.log(`            Valid: ${check2.valid}`);
  console.log(`            Requires Escalation: ${check2.requiresEscalation}`);
  console.log(`            Action: Dispatching WebAuthn push notification to User Device...\n`);

  console.log('======================================================');
  console.log('     🎉 HAPTIX AGENT BOT COMPLETED TEST CYCLE!         ');
  console.log('======================================================\n');
}

startAgentBot().catch(console.error);
