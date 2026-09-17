#!/usr/bin/env node

/**
 * Haptix Autonomous AI Agent Bot Runner (Base Sepolia)
 * 
 * Demonstrates a headless AI bot executing an autonomous on-chain transaction
 * through the user's PasskeyAccount using a pre-authorized ECDSA session key.
 * 
 * Core Features:
 * 1. Verifies on-chain session validity window & spending limits on Base Sepolia
 * 2. Demonstrates 0x01 Autonomous ECDSA signing (Zero Biometric/Passkey Prompts!)
 * 3. Builds standard ERC-4337 v0.7 PackedUserOperation
 * 4. Broadcasts to Pimlico Bundler -> EntryPoint v0.7 -> Base Sepolia
 * 5. Retrieves on-chain confirmation & displays BaseScan link
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

// Delegated Agent Session Keypair
const AGENT_PRIVATE_KEY = process.env.AGENT_SESSION_PRIVATE_KEY || '0x7fc37057650fd55a74b810ae0bac0fffa18185bdc50579f5f34e783834824799';
const AGENT_ADDRESS = '0x093F8575a87cdb2919E5B3f1677eD8d7815c9461';

// Target Allowlisted Recipient
const RECIPIENT = '0x22db962929afe98d0269De0BAa6c442A3Aa6913D';
const TRANSFER_AMOUNT_ETH = 100000000000000n; // 0.0001 ETH (~$0.41)

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║       HAPTIX: AUTONOMOUS AI AGENT ON-CHAIN BOT RUNNER         ║');
  console.log('║        Base Sepolia • ERC-4337 v0.7 • Zero Passkey Prompt     ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL)
  });

  console.log(`[Config] Smart Account:   ${ACCOUNT}`);
  console.log(`[Config] Agent Session:   ${AGENT_ADDRESS}`);
  console.log(`[Config] Target Address:  ${RECIPIENT}`);
  console.log(`[Config] Action Value:    0.0001 ETH (${TRANSFER_AMOUNT_ETH} wei)`);
  console.log(`[Config] EntryPoint v0.7: ${ENTRYPOINT}\n`);

  // Step 1: On-Chain Session Health Check
  console.log('--- Step 1: Verifying On-Chain Agent Session on Base Sepolia ---');
  const sessionAbi = parseAbi([
    'function agentSessions(address) view returns (uint48, uint48, bool, bool, uint256, uint256, uint256, uint256)'
  ]);

  const session = await client.readContract({
    address: ACCOUNT,
    abi: sessionAbi,
    functionName: 'agentSessions',
    args: [AGENT_ADDRESS]
  });

  const [validAfter, validUntil, isRegistered, revoked, humanThreshold, perTxEth, perTxToken, windowSec] = session;
  const currentBlock = await client.getBlock({ blockTag: 'latest' });
  const blockTime = Number(currentBlock.timestamp);

  console.log(`   isRegistered: ${isRegistered}`);
  console.log(`   revoked:      ${revoked}`);
  console.log(`   validAfter:   ${new Date(Number(validAfter) * 1000).toISOString()}`);
  console.log(`   validUntil:   ${new Date(Number(validUntil) * 1000).toISOString()}`);
  console.log(`   blockTime:    ${new Date(blockTime * 1000).toISOString()}`);
  console.log(`   perTxEth:     ${Number(perTxEth) / 1e18} ETH`);

  const IS_DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('--simulate');
  const DASHBOARD_URL = process.env.WEB_URL || 'http://localhost:57547/app.html';

  if (!isRegistered || revoked) {
    console.error(`\n❌ Error: Agent session for ${AGENT_ADDRESS} is not registered or was revoked.`);
    console.error(`Authorize the session using the Agents tab at ${DASHBOARD_URL}#tab-agents`);
    process.exit(1);
  }

  if (blockTime > Number(validUntil) && !IS_DRY_RUN) {
    console.log('\n⚠️  Notice: The on-chain session timestamp has reached its validity window limit.');
    console.log(`   Expired on: ${new Date(Number(validUntil) * 1000).toISOString()}`);
    console.log(`   Current:    ${new Date(blockTime * 1000).toISOString()}`);
    console.log('\n💡 To re-authorize with a fresh 30-day session:');
    console.log(`   1. Open ${DASHBOARD_URL}#tab-agents`);
    console.log(`   2. Click "Reconfigure Session" -> "Authorize Delegation with Passkey Quorum"`);
    console.log(`   3. Re-run this script!\n`);
    console.log('   (Tip: You can also run with --dry-run to test UserOp packing & 0x01 ECDSA signing offline:');
    console.log('    node scripts/run-autonomous-agent-bot.mjs --dry-run)\n');
    process.exit(0);
  } else if (IS_DRY_RUN && blockTime > Number(validUntil)) {
    console.log('\nℹ️  [Dry-Run Mode] Continuing simulation to verify UserOp assembly & Type 0x01 signature...\n');
  } else {
    console.log('   ✅ Valid On-Chain Session Active!\n');
  }

  // Step 2: Query EntryPoint Nonce
  console.log('--- Step 2: Fetching Account Nonce from EntryPoint v0.7 ---');
  const nonce = await client.readContract({
    address: ENTRYPOINT,
    abi: parseAbi(['function getNonce(address, uint192) view returns (uint256)']),
    functionName: 'getNonce',
    args: [ACCOUNT, 0n]
  });
  console.log(`   Current Nonce: ${nonce}\n`);

  // Step 3: Encode executeByAgent calldata
  console.log('--- Step 3: Encoding executeByAgent Calldata ---');
  const callData = encodeExecuteByAgent(
    AGENT_ADDRESS,
    RECIPIENT,
    TRANSFER_AMOUNT_ETH,
    '0x'
  );
  console.log(`   Calldata: ${callData.slice(0, 42)}... (${callData.length} chars)`);
  console.log(`   Selector: 0xaea6adc6 (executeByAgent)\n`);

  // Step 4: Build PackedUserOperation
  console.log('--- Step 4: Packing UserOperation ---');
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
  console.log('--- Step 5: Autonomous ECDSA Signing (Zero Passkey Prompts!) ---');
  const userOpHash = computeUserOpHash(userOp, ENTRYPOINT, 84532n);
  console.log(`   UserOpHash: ${userOpHash}`);

  const rawSig = await signUserOpHash(AGENT_PRIVATE_KEY, userOpHash);
  userOp.signature = encodeAutonomousAgentSignature(AGENT_ADDRESS, rawSig);
  console.log(`   ⚡ Autonomous Signature Created (Type 0x01 ECDSA)`);
  console.log(`   🔒 ZERO Passkey / WebAuthn Prompts Required!\n`);

  // Step 6: Submit to Pimlico Bundler
  if (IS_DRY_RUN) {
    console.log('--- Step 6: [Dry-Run] UserOp Assembly Complete ---');
    console.log(JSON.stringify({
      sender: userOp.sender,
      nonce: '0x' + userOp.nonce.toString(16),
      callData: userOp.callData.slice(0, 42) + '...',
      signatureType: 'Type 0x01 Autonomous ECDSA',
      signature: userOp.signature.slice(0, 42) + '...'
    }, null, 2));
    console.log('\n✅ Dry-Run Verification Successful: Packed UserOp and 0x01 ECDSA signature assembled with ZERO passkey prompts.\n');
    process.exit(0);
  }

  console.log('--- Step 6: Submitting to Pimlico Bundler on Base Sepolia ---');
  const bundler = new BundlerClient(BUNDLER_URL, ENTRYPOINT, 84532);
  const uoHash = await bundler.sendUserOperation(userOp);
  console.log(`   🚀 Bundler Accepted Autonomous UserOp!`);
  console.log(`   UserOpHash: ${uoHash}\n`);

  // Step 7: Wait for Base Sepolia Receipt
  console.log('--- Step 7: Waiting for On-Chain Confirmation ---');
  const receipt = await bundler.waitForUserOperationReceipt(uoHash, 45000, 2000);

  if (receipt && receipt.success === false) {
    console.error(`   ❌ UserOperation reverted on-chain.`);
    console.error(`   TxHash: ${receipt.receipt?.transactionHash}`);
    process.exit(1);
  }

  const txHash = receipt.receipt.transactionHash;
  const blockNumber = receipt.receipt.blockNumber;

  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║       🎉 AUTONOMOUS AI AGENT TRANSACTION CONFIRMED!           ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log(`   Transaction Hash: ${txHash}`);
  console.log(`   Block Number:     ${blockNumber}`);
  console.log(`   Gas Used:         ${receipt.actualGasUsed} gas`);
  console.log(`   BaseScan:         https://sepolia.basescan.org/tx/${txHash}\n`);
}

main().catch((err) => {
  console.error('\n❌ Execution Error:', err);
  process.exit(1);
});
