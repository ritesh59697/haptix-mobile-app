import { describe, it, expect } from 'vitest';
import {
  parseTokenAmount,
  formatTokenAmount,
  parseEthAmount,
  formatEthAmount,
  calculateAmountOutMinimum,
  encodeUniswapV3ExactInputSingle
} from '../src/swap.js';
import { SELECTORS, NATIVE_ETH_ADDRESS } from '../src/constants.js';

describe('Swap Quoting, Slippage, and Unit Normalization', () => {
  it('should parse and format token amounts with arbitrary decimals accurately', () => {
    // 6 decimals (USDC)
    expect(parseTokenAmount('50', 6)).toBe(50000000n);
    expect(parseTokenAmount('0.5', 6)).toBe(500000n);
    expect(formatTokenAmount(50000000n, 6)).toBe('50');

    // 8 decimals (WBTC)
    expect(parseTokenAmount('1.25', 8)).toBe(125000000n);
    expect(formatTokenAmount(125000000n, 8)).toBe('1.25');

    // 18 decimals (DAI)
    expect(parseTokenAmount('100.5', 18)).toBe(100500000000000000000n);
    expect(formatTokenAmount(100500000000000000000n, 18)).toBe('100.5');
  });

  it('should parse and format native ETH amounts in wei', () => {
    expect(parseEthAmount('0.05')).toBe(50000000000000000n);
    expect(formatEthAmount(50000000000000000n)).toBe('0.05');
  });

  it('should calculate amountOutMinimum with integer slippage protection', () => {
    const quoted = 1000000000n; // 1,000 units
    // Default 50 bps (0.5%) -> 995 units
    const minOutDefault = calculateAmountOutMinimum(quoted, 50n);
    expect(minOutDefault).toBe(995000000n);

    // 100 bps (1.0%) -> 990 units
    const minOut1Pct = calculateAmountOutMinimum(quoted, 100n);
    expect(minOut1Pct).toBe(990000000n);
  });

  it('should reject invalid or excessive slippage', () => {
    const quoted = 1000000n;
    // Exceeding 500 bps (5%)
    expect(() => calculateAmountOutMinimum(quoted, 600n)).toThrow(/exceeds maximum allowed/);
    // Quoted amount 0
    expect(() => calculateAmountOutMinimum(0n, 50n)).toThrow(/greater than 0/);
  });

  it('should encode Uniswap V3 exactInputSingle call matching selector 0x414bf382', () => {
    const tokenIn = '0x1111111111111111111111111111111111111111' as const;
    const tokenOut = '0x2222222222222222222222222222222222222222' as const;
    const account = '0x3333333333333333333333333333333333333333' as const;

    const calldata = encodeUniswapV3ExactInputSingle({
      tokenIn,
      tokenOut,
      fee: 3000,
      recipient: account,
      amountIn: 50000000n,
      amountOutMinimum: 49500000n
    });

    expect(calldata.startsWith(SELECTORS.UNISWAP_V3_EXACT_INPUT_SINGLE)).toBe(true);
  });

  it('should reject same-token swap (tokenIn == tokenOut)', () => {
    const token = '0x1111111111111111111111111111111111111111' as const;
    expect(() =>
      encodeUniswapV3ExactInputSingle({
        tokenIn: token,
        tokenOut: token,
        fee: 3000,
        recipient: token,
        amountIn: 100n,
        amountOutMinimum: 90n
      })
    ).toThrow(/must be distinct/);
  });

  it('should reject zero slippage protection (amountOutMinimum == 0)', () => {
    const tokenIn = '0x1111111111111111111111111111111111111111' as const;
    const tokenOut = '0x2222222222222222222222222222222222222222' as const;
    expect(() =>
      encodeUniswapV3ExactInputSingle({
        tokenIn,
        tokenOut,
        fee: 3000,
        recipient: tokenIn,
        amountIn: 100n,
        amountOutMinimum: 0n // Dangerous zero slippage!
      })
    ).toThrow(/Security Violation/);
  });
});
