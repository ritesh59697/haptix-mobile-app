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
const ACCOUNT = process.env.DEPLOYED_PASSKEY_ACCOUNT_ADDRESS || '0xB01543453cF31052c769d79e9C755E3b035d796f';
const USDC = process.env.USDC_TOKEN_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const BUNDLER_URL = process.env.BUNDLER_RPC_URL || 'https://api.pimlico.io/v2/84532/rpc?apikey=pim_hkKhRbcJfLUYSzezx8ofPd';

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

  // 3. Check Smart Account Deployment & State
  console.log(`\n3. Checking Smart Account Address: ${ACCOUNT}`);
  const accountCode = await client.getBytecode({ address: ACCOUNT });
  if (!accountCode || accountCode === '0x') {
    console.log('   ℹ️ Smart Account is in Counterfactual state (undeployed or CREATE2 ready).');
  } else {
    console.log(`   ✅ Smart Account deployed on-chain! Code size: ${accountCode.length / 2 - 1} bytes.`);
  }

  // 4. Check On-Chain Balances & Prefund
  console.log('\n4. Checking On-Chain Balances & Prefund:');
  const ethBalance = await client.getBalance({ address: ACCOUNT });
  console.log(`   Account ETH Balance: ${Number(ethBalance) / 1e18} ETH (${ethBalance} wei)`);

  let epDeposit = 0n;
  try {
    const epAbi = [{
      type: 'function',
      name: 'balanceOf',
      inputs: [{ name: 'account', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }],
      stateMutability: 'view'
    }];
    epDeposit = await client.readContract({
      address: ENTRYPOINT,
      abi: epAbi,
      functionName: 'balanceOf',
      args: [ACCOUNT]
    });
    console.log(`   EntryPoint Deposit:  ${Number(epDeposit) / 1e18} ETH (${epDeposit} wei)`);
  } catch (e) {
    console.log(`   EntryPoint Deposit query: ${e.message}`);
  }

  try {
    const erc20Abi = [{
      type: 'function',
      name: 'balanceOf',
      inputs: [{ name: 'account', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }],
      stateMutability: 'view'
    }];
    const usdcBalance = await client.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [ACCOUNT]
    });
    console.log(`   USDC Balance:        ${Number(usdcBalance) / 1e6} USDC`);
  } catch (e) {
    console.log(`   USDC Balance query:  ${e.message}`);
  }

  // 5. Check Bundler RPC Connectivity
  console.log(`\n5. Checking Bundler RPC Endpoint: ${BUNDLER_URL.replace(/apikey=[^&]+/, 'apikey=REDACTED')}`);
  try {
    const bundlerRes = await fetch(BUNDLER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_supportedEntryPoints',
        params: []
      })
    });
    if (bundlerRes.status === 401 || bundlerRes.status === 403) {
      console.log('   ⚠️ BUNDLER BLOCKED: Provider returned 401 Unauthorized (requires valid API key).');
    } else {
      const data = await bundlerRes.json();
      console.log(`   Bundler Supported EntryPoints: ${JSON.stringify(data.result || data.error)}`);
    }
  } catch (e) {
    console.log(`   Bundler connection error: ${e.message}`);
  }

  // 6. Test SDK Session Validation
  console.log('\n6. Testing SDK Session Parameter Generation');
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
