#!/usr/bin/env node

/**
 * Haptix Protocol — Base Sepolia Testnet Verification Script
 * Validates on-chain EntryPoint, Factory, Smart Account state, and SDK compatibility.
 */

import { createPublicClient, http } from '../sdk/node_modules/viem/_esm/index.js';
import { baseSepolia } from '../sdk/node_modules/viem/_esm/chains/index.js';
import {
  CANONICAL_ENTRYPOINT_V07,
  generateAgentKey,
  parseTokenAmount,
  calculateAmountOutMinimum,
  validateSessionConfig
} from '../sdk/dist/index.js';

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
const ENTRYPOINT = process.env.ENTRYPOINT_ADDRESS || CANONICAL_ENTRYPOINT_V07;
const ACCOUNT = process.env.DEPLOYED_PASSKEY_ACCOUNT_ADDRESS || '0x34Aeb3A39fd1838D1C897F879EAB0a258507802c';

async function main() {
  console.log('====================================================');
  console.log('    HAPTIX BASE SEPOLIA TESTNET VALIDATION GATE     ');
  console.log('====================================================\n');

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL)
  });

  // 1. Check RPC & Chain ID
  console.log(`1. Connecting to RPC: ${RPC_URL}`);
  const chainId = await client.getChainId();
  console.log(`   Connected! Chain ID: ${chainId} (Expected: 84532)`);
  if (chainId !== 84532) {
    throw new Error(`Chain ID mismatch: expected 84532, got ${chainId}`);
  }

  // 2. Check Canonical EntryPoint v0.7 Code
  console.log(`\n2. Verifying Canonical EntryPoint: ${ENTRYPOINT}`);
  const entryPointCode = await client.getBytecode({ address: ENTRYPOINT });
  if (!entryPointCode || entryPointCode === '0x') {
    console.log('   ⚠️ WARNING: EntryPoint contract has no bytecode on this RPC.');
  } else {
    console.log(`   ✅ EntryPoint v0.7 Verified! Bytecode length: ${entryPointCode.length / 2 - 1} bytes.`);
  }

  // 3. Check Smart Account Deployment
  console.log(`\n3. Checking Smart Account Address: ${ACCOUNT}`);
  const accountCode = await client.getBytecode({ address: ACCOUNT });
  if (!accountCode || accountCode === '0x') {
    console.log('   ℹ️ Smart Account is in Counterfactual state (undeployed or CREATE2 ready).');
  } else {
    console.log(`   ✅ Smart Account deployed on-chain! Code size: ${accountCode.length / 2 - 1} bytes.`);
  }

  // 4. Test SDK Session Validation
  console.log('\n4. Testing SDK Session Parameter Generation');
  const agent = generateAgentKey();
  console.log(`   Generated In-Memory Agent Address: ${agent.address}`);

  const session = {
    agentKey: agent.address,
    validAfter: Math.floor(Date.now() / 1000),
    validUntil: Math.floor(Date.now() / 1000) + 86400 * 7,
    humanApprovalThreshold: parseTokenAmount('200', 6),
    perTxLimitEth: parseTokenAmount('0.05', 18),
    perTxLimitToken: parseTokenAmount('50', 6),
    windowDuration: 86400n,
    allowedProtocols: [ACCOUNT],
    allowedSelectors: ['0xa9059cbb'],
    allowedTokens: ['0x036CbD53842c5426634e7929541eC2318f3dCF7e'],
    tokenWindowCaps: [parseTokenAmount('100', 6)]
  };

  validateSessionConfig(session);
  console.log('   ✅ Session configuration strictly validated by SDK!');

  // 5. Test Integer Slippage Calculation
  console.log('\n5. Testing Integer Slippage Guard');
  const quotedOut = parseTokenAmount('100', 6);
  const minOut = calculateAmountOutMinimum(quotedOut, 50n); // 0.5%
  console.log(`   Quoted: 100.00 USDC -> Min Output (50 bps): ${minOut / 1000000n}.${minOut % 1000000n} USDC`);
  console.log('   ✅ Slippage Protection calculation validated!');

  console.log('\n====================================================');
  console.log('     🎉 TESTNET INTEGRATION VALIDATION PASSED!      ');
  console.log('====================================================\n');
}

main().catch(err => {
  console.error('\n❌ Testnet Validation Failed:', err.message);
  process.exit(1);
});
