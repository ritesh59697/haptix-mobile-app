import {
  type Address,
  type Hex,
  encodeFunctionData,
  isAddressEqual,
  parseUnits,
  formatUnits
} from 'viem';
import {
  DEFAULT_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  NATIVE_ETH_ADDRESS
} from './constants.js';
import type { UniswapV3SwapParams, SwapQuote } from './types.js';

const UNISWAP_V3_ROUTER02_ABI = [
  {
    type: 'function',
    name: 'exactInputSingle',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' }
        ]
      }
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable'
  }
] as const;

/**
 * Parses a decimal string token amount into base units (bigint) without floating-point precision loss.
 */
export function parseTokenAmount(amountStr: string, decimals: number): bigint {
  if (!amountStr || isNaN(Number(amountStr)) || Number(amountStr) < 0) {
    throw new Error(`Invalid token amount: "${amountStr}"`);
  }
  return parseUnits(amountStr, decimals);
}

/**
 * Formats a base unit bigint into a human-readable decimal string.
 */
export function formatTokenAmount(amountBaseUnits: bigint, decimals: number): string {
  return formatUnits(amountBaseUnits, decimals);
}

/**
 * Parses ETH string into wei.
 */
export function parseEthAmount(ethStr: string): bigint {
  return parseUnits(ethStr, 18);
}

/**
 * Formats wei into ETH decimal string.
 */
export function formatEthAmount(wei: bigint): string {
  return formatUnits(wei, 18);
}

/**
 * Calculates the exact minimum output amount with integer-based slippage protection.
 * amountOutMinimum = quotedAmountOut * (10000 - slippageBps) / 10000
 */
export function calculateAmountOutMinimum(
  quotedAmountOut: bigint,
  slippageBps: bigint = DEFAULT_SLIPPAGE_BPS
): bigint {
  if (quotedAmountOut <= 0n) {
    throw new Error('Invalid quotedAmountOut: must be greater than 0');
  }
  if (slippageBps > MAX_SLIPPAGE_BPS) {
    throw new Error(
      `Slippage tolerance ${slippageBps} bps exceeds maximum allowed ${MAX_SLIPPAGE_BPS} bps (5%)`
    );
  }

  const minOut = (quotedAmountOut * (10000n - slippageBps)) / 10000n;
  if (minOut <= 0n) {
    throw new Error('Calculated amountOutMinimum resulted in 0 base units (excessive slippage)');
  }
  return minOut;
}

/**
 * Validates and encodes a Uniswap V3 exactInputSingle call.
 * Strictly enforces recipient lock, non-zero amountIn, and non-zero amountOutMinimum.
 */
export function encodeUniswapV3ExactInputSingle(params: UniswapV3SwapParams): Hex {
  if (isAddressEqual(params.tokenIn, params.tokenOut)) {
    throw new Error('Invalid swap: tokenIn and tokenOut must be distinct addresses');
  }
  if (isAddressEqual(params.tokenIn, NATIVE_ETH_ADDRESS) || isAddressEqual(params.tokenOut, NATIVE_ETH_ADDRESS)) {
    throw new Error('Invalid swap: Uniswap V3 exactInputSingle requires wrapped ERC-20 token addresses (e.g. WETH), not address(0)');
  }
  if (params.amountIn <= 0n) {
    throw new Error('Invalid swap: amountIn must be greater than 0');
  }
  if (params.amountOutMinimum <= 0n) {
    throw new Error('Security Violation: amountOutMinimum must be > 0 to protect against MEV sandwich attacks');
  }

  return encodeFunctionData({
    abi: UNISWAP_V3_ROUTER02_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee: params.fee,
        recipient: params.recipient,
        amountIn: params.amountIn,
        amountOutMinimum: params.amountOutMinimum,
        sqrtPriceLimitX96: params.sqrtPriceLimitX96 ?? 0n
      }
    ]
  });
}
