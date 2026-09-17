import test from 'node:test';
import assert from 'node:assert';
import { 
  encodeUniswapV3ExactInputSingle,
  encodeExecuteBatch,
  fetchUniswapQuote,
  encodeAutonomousAgentSignature,
  encodeExecuteByAgent
} from '../web/userop.js';
import { signUserOpHash } from '../web/agent-client.js';
import { CONFIG } from '../web/config.js';

test('Uniswap V3 exactInputSingle encoding matches SwapRouter02 ABI specifications', () => {
  const calldata = encodeUniswapV3ExactInputSingle({
    tokenIn: CONFIG.weth,
    tokenOut: CONFIG.usdc,
    fee: 3000,
    recipient: CONFIG.defaultAccount,
    amountIn: 1000000000000000n, // 0.001 ETH
    amountOutMinimum: 4000000n,    // 4.00 USDC
    sqrtPriceLimitX96: 0n
  });

  assert.ok(calldata.startsWith('0x04e45aaf'), 'Selector matches SwapRouter02 exactInputSingle (0x04e45aaf)');
  // 4 bytes selector + 7 words * 32 bytes = 228 bytes = 458 hex characters with 0x prefix
  assert.strictEqual(calldata.length, 458, 'Calldata is exactly 228 bytes (458 hex chars)');
  assert.ok(calldata.includes(CONFIG.weth.slice(2).toLowerCase()), 'Includes tokenIn WETH address');
  assert.ok(calldata.includes(CONFIG.usdc.slice(2).toLowerCase()), 'Includes tokenOut USDC address');
  assert.ok(calldata.includes(CONFIG.defaultAccount.slice(2).toLowerCase()), 'Includes recipient smart account address');
});

test('PasskeyAccount executeBatch encoding generates valid dynamic ABI arrays', () => {
  const dests = [CONFIG.usdc, CONFIG.uniswapV3Router];
  const values = [0n, 0n];
  const funcs = [
    '0x095ea7b3' + CONFIG.uniswapV3Router.replace(/^0x/, '').padStart(64, '0') + (1000000n).toString(16).padStart(64, '0'),
    '0x04e45aaf' + '00'.repeat(224)
  ];

  const batchCalldata = encodeExecuteBatch(dests, values, funcs);
  assert.ok(batchCalldata.startsWith('0x47e1da2a'), 'Selector matches executeBatch (0x47e1da2a)');
  assert.ok(batchCalldata.length > 200, 'Batch calldata contains valid packed array payloads');
});

test('Live Uniswap V3 QuoterV2 returns real-time quote on Base Sepolia', async () => {
  const amountIn = 1000000000000000n; // 0.001 ETH
  const quoted = await fetchUniswapQuote({
    rpcUrl: CONFIG.rpcUrl,
    quoterAddress: CONFIG.uniswapV3Quoter,
    tokenIn: CONFIG.weth,
    tokenOut: CONFIG.usdc,
    amountIn,
    fee: 3000
  });

  assert.ok(quoted > 0n, 'Quoted amount must be strictly greater than 0');
  const quotedUsdc = Number(quoted) / 1e6;
  console.log(`  Live Uniswap V3 Quote on Base Sepolia: 0.001 ETH = $${quotedUsdc.toFixed(2)} USDC`);
  assert.ok(quotedUsdc > 1.0 && quotedUsdc < 100.0, '0.001 ETH price on Base Sepolia is in a reasonable range ($1-$100)');
});

test('Autonomous Agent Type 0x01 ECDSA signature generation (Zero Passkey Prompts)', async () => {
  const dummyUserOpHash = '0x11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';
  const rawSig = await signUserOpHash(CONFIG.agentPrivateKey, dummyUserOpHash);
  const autoSig = encodeAutonomousAgentSignature(CONFIG.agentAddress, rawSig);

  assert.ok(autoSig.startsWith('0x01'), 'Autonomous signature has 0x01 prefix');
  assert.ok(autoSig.includes(CONFIG.agentAddress.slice(2).toLowerCase()), 'Autonomous signature encodes the authorized agent key address');
  assert.strictEqual(autoSig.length, 388, 'Standard autonomous agent signature payload length is 388 chars');
});

test('executeByAgent calldata packaging matches PasskeyAccount interface', () => {
  const target = '0x22db962929afe98d0269De0BAa6c442A3Aa6913D';
  const valWei = 100000000000000n;
  const calldata = encodeExecuteByAgent(CONFIG.agentAddress, target, valWei, '0x');

  assert.ok(calldata.startsWith('0xaea6adc6'), 'Selector matches executeByAgent (0xaea6adc6)');
  assert.ok(calldata.includes(CONFIG.agentAddress.slice(2).toLowerCase()), 'Contains agent address');
  assert.ok(calldata.includes(target.slice(2).toLowerCase()), 'Contains target recipient address');
});
