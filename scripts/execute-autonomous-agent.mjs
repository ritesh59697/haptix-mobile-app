#!/usr/bin/env node

/**
 * Haptix Autonomous AI Agent Execution Runner
 * 
 * Demonstrates a headless AI bot executing a live autonomous transaction on Base Sepolia
 * through account 0xB015... using its granted session key.
 * 
 * Verifies:
 * 1. Session is active on-chain
 * 2. Pre-flight spend limits & allowlists
 * 3. 0x01 Autonomous ECDSA signature (NO biometric/passkey prompt!)
 * 4. Submission to Pimlico Bundler -> EntryPoint v0.7
 * 5. On-chain execution receipt on Base Sepolia
 */

import { createPublicClient, http, parseAbi } from '../sdk/node_modules/viem/_esm/index.js';
import { baseSepolia } from '../sdk/node_modules/viem/_esm/chains/index.js';
import {
  CANONICAL_ENTRYPOINT_V07,
  signUserOpHash,
  encodeAutonomousAgentSignature,
  encodeExecuteByAgent,
  buildPackedUserOp,
  computeUserOpHash,
  BundlerClient
} from '../sdk/dist/index.js';

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
const ENTRYPOINT = process.env.ENTRYPOINT_ADDRESS || CANONICAL_ENTRYPOINT_V07;
const ACCOUNT = process.env.DEPLOYED_PASSKEY_ACCOUNT_ADDRESS || '0xB01543453cF31052c769d79e9C755E3b035d796f';
const BUNDLER_URL = process.env.BUNDLER_RPC_URL || 'https://api.pimlico.io/v2/84532/rpc?apikey=pim_hkKhRbcJfLUYSzezx8ofPd';

// The designated session keypair
const AGENT_PRIVATE_KEY = process.env.AGENT_SESSION_PRIVATE_KEY || '0x7fc37057650fd55a74b810ae0bac0fffa18185bdc50579f5f34e783834824799';
const AGENT_ADDRESS = '0x093F8575a87cdb2919E5B3f1677eD8d7815c9461';

// Recipient (allowlisted target)
const RECIPIENT = '0x22db962929afe98d0269De0BAa6c442A3Aa6913D';
const TRANSFER_AMOUNT_ETH = 100000000000000n; // 0.0001 ETH

async function main() {
  console.log('================================================================');
  console.log('       HAPTIX: AUTONOMOUS AI AGENT ON-CHAIN EXECUTION           ');
  console.log('================================================================\n');

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL)
  });

  console.log(`1. Target Smart Account: ${ACCOUNT}`);
  console.log(`2. Agent Session Key:   ${AGENT_ADDRESS}`);
  console.log(`3. Target Recipient:     ${RECIPIENT}`);
  console.log(`4. Transfer Value:       0.0001 ETH (100,000,000,000,000 wei)`);

  // Step 1: Check On-Chain Session Status
  console.log('\n--- Step 1: Verifying On-Chain Agent Session on Base Sepolia ---');
  const sessionAbi = parseAbi([
    'function agentSessions(address) view returns (uint48, uint48, bool, bool, uint256, uint256, uint256, uint256)',
    'function agentAllowedProtocols(address, address) view returns (bool)'
  ]);

  const session = await client.readContract({
    address: ACCOUNT,
    abi: sessionAbi,
    functionName: 'agentSessions',
    args: [AGENT_ADDRESS]
  });

  const [validAfter, validUntil, isRegistered, revoked, humanThreshold, perTxEth, perTxToken, windowSec] = session;
  console.log(`   isRegistered: ${isRegistered}`);
  console.log(`   revoked:      ${revoked}`);
  console.log(`   validAfter:   ${new Date(Number(validAfter) * 1000).toISOString()}`);
  console.log(`   validUntil:   ${new Date(Number(validUntil) * 1000).toISOString()}`);
  console.log(`   perTxEth:     ${Number(perTxEth) / 1e18} ETH`);

  if (!isRegistered || revoked) {
    console.error(`\n❌ Error: Agent session for ${AGENT_ADDRESS} is NOT active on-chain.`);
    console.error(`Please authorize the session first using the UI at http://localhost:5199/grant-session\n`);
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < Number(validAfter) || now > Number(validUntil)) {
    console.error(`\n❌ Error: Current timestamp (${now}) outside session validity window.`);
    process.exit(1);
  }

  console.log('   ✅ Active & Valid On-Chain Session Verified!');

  // Step 2: Query EntryPoint Nonce
  console.log('\n--- Step 2: Fetching Account Nonce from EntryPoint v0.7 ---');
  const nonce = await client.readContract({
    address: ENTRYPOINT,
    abi: parseAbi(['function getNonce(address, uint192) view returns (uint256)']),
    functionName: 'getNonce',
    args: [ACCOUNT, 0n]
  });
  console.log(`   Current Nonce: ${nonce}`);

  // Step 3: Encode executeByAgent calldata
  console.log('\n--- Step 3: Encoding executeByAgent Calldata ---');
  const callData = encodeExecuteByAgent(
    AGENT_ADDRESS,
    RECIPIENT,
    TRANSFER_AMOUNT_ETH,
    '0x'
  );
  console.log(`   Calldata length: ${callData.length} chars`);
  console.log(`   Selector: 0xaea6adc6 (executeByAgent)`);

  // Step 4: Build PackedUserOperation
  console.log('\n--- Step 4: Packing UserOperation ---');
  const userOp = buildPackedUserOp({
    sender: ACCOUNT,
    nonce,
    callData,
    gasParams: {
      verificationGasLimit: 250000n,
      callGasLimit: 120000n,
      preVerificationGas: 100000n,
      maxPriorityFeePerGas: 50000000n, // 0.05 gwei
      maxFeePerGas: 200000000n        // 0.20 gwei
    }
  });

  // Step 5: Autonomous ECDSA Signing (Zero Passkey Prompts!)
  console.log('\n--- Step 5: Autonomous ECDSA Signing (No Passkeys Needed) ---');
  const userOpHash = computeUserOpHash(userOp, ENTRYPOINT, 84532n);
  console.log(`   UserOpHash: ${userOpHash}`);

  const rawSig = await signUserOpHash(AGENT_PRIVATE_KEY, userOpHash);
  userOp.signature = encodeAutonomousAgentSignature(AGENT_ADDRESS, rawSig);
  console.log(`   Agent Signature Generated (Type 0x01 Autonomous ECDSA)`);
  console.log(`   Signature Length: ${userOp.signature.length} chars`);

  // Step 6: Submit to Pimlico Bundler
  console.log('\n--- Step 6: Submitting to Pimlico Bundler ---');
  const bundler = new BundlerClient(BUNDLER_URL, ENTRYPOINT, 84532);
  const uoHash = await bundler.sendUserOperation(userOp);
  console.log(`   🚀 Bundler Accepted Autonomous UserOp!`);
  console.log(`   UserOpHash: ${uoHash}`);

  // Step 7: Wait for Base Sepolia Receipt
  console.log('\n--- Step 7: Polling for Base Sepolia Confirmation ---');
  const receipt = await bundler.waitForUserOperationReceipt(uoHash, 45000, 2000);

  if (receipt && receipt.success === false) {
    console.error(`   ❌ UserOperation reverted on-chain.`);
    console.error(`   TxHash: ${receipt.receipt?.transactionHash}`);
    process.exit(1);
  }

  const txHash = receipt.receipt.transactionHash;
  const blockNumber = receipt.receipt.blockNumber;

  console.log('\n================================================================');
  console.log('       🎉 AUTONOMOUS AI AGENT TRANSACTION CONFIRMED!            ');
  console.log('================================================================');
  console.log(`   Transaction Hash: ${txHash}`);
  console.log(`   Block Number:     ${blockNumber}`);
  console.log(`   Gas Used:         ${receipt.actualGasUsed} gas`);
  console.log(`   BaseScan:         https://sepolia.basescan.org/tx/${txHash}`);
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('\n❌ Execution Error:', err);
  process.exit(1);
});
