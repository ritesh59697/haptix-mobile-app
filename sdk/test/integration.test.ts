import { describe, it, expect } from 'vitest';
import {
  HaptixAccountClient,
  generateAgentKey,
  parseTokenAmount,
  calculateAmountOutMinimum,
  validateAgentSingleCall,
  CANONICAL_ENTRYPOINT_V07,
  SELECTORS
} from '../src/index.js';
import type { AgentSessionConfig } from '../src/types.js';

describe('Haptix SDK End-to-End Integration Flow', () => {
  const accountAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
  const usdcToken = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
  const recipient = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
  const router = '0x2626664c2603336E57B271c5C0b26F421741e481' as const;
  const chainId = 84532; // Base Sepolia

  const agent = generateAgentKey();

  const client = new HaptixAccountClient({
    accountAddress,
    chainId,
    entryPoint: CANONICAL_ENTRYPOINT_V07,
    bundlerUrl: 'https://api.pimlico.io/v2/84532/rpc?apikey=mock',
    agentPrivateKey: agent.privateKey
  });

  const sessionConfig: AgentSessionConfig = {
    agentKey: agent.address,
    validAfter: 1000,
    validUntil: Math.floor(Date.now() / 1000) + 86400,
    humanApprovalThreshold: parseTokenAmount('200', 6), // 200 USDC ceiling
    perTxLimitEth: 50000000000000000n, // 0.05 ETH
    perTxLimitToken: parseTokenAmount('50', 6), // 50 USDC max autonomous
    windowDuration: 86400n,
    allowedProtocols: [recipient, router],
    allowedSelectors: [SELECTORS.TRANSFER, SELECTORS.UNISWAP_V3_EXACT_INPUT_SINGLE],
    allowedTokens: [usdcToken],
    tokenWindowCaps: [parseTokenAmount('100', 6)]
  };

  it('should build, validate, and sign an autonomous UserOp within limits', async () => {
    const amount = parseTokenAmount('30', 6); // 30 USDC <= 50 USDC autonomous limit

    // 1. Pre-flight offline validation
    const transferCalldata = client.encodeERC20Transfer(recipient, amount);
    const validation = validateAgentSingleCall(
      sessionConfig,
      usdcToken,
      0n,
      transferCalldata,
      Math.floor(Date.now() / 1000)
    );

    expect(validation.valid).toBe(true);
    expect(validation.requiresEscalation).toBe(false);

    // 2. Build UserOperation
    const userOp = client.buildTransferUserOp({
      tokenAddress: usdcToken,
      recipient,
      amount,
      nonce: 0n,
      gasParams: {
        verificationGasLimit: 150000n,
        callGasLimit: 60000n,
        preVerificationGas: 50000n,
        maxPriorityFeePerGas: 50000000n,
        maxFeePerGas: 200000000n
      }
    });

    expect(userOp.sender).toBe(accountAddress);
    expect(userOp.nonce).toBe(0n);
    expect(userOp.callData.startsWith(SELECTORS.EXECUTE_BY_AGENT)).toBe(true);

    // 3. Autonomous signing
    const signedOp = await client.signAutonomousUserOp(userOp);
    expect(signedOp.signature.startsWith('0x01')).toBe(true);
  });

  it('should detect escalation requirement and sign escalated UserOp with passkeys', async () => {
    const amount = parseTokenAmount('150', 6); // 150 USDC > 50 USDC limit, <= 200 USDC ceiling

    // 1. Pre-flight validation
    const transferCalldata = client.encodeERC20Transfer(recipient, amount);
    const validation = validateAgentSingleCall(
      sessionConfig,
      usdcToken,
      0n,
      transferCalldata,
      Math.floor(Date.now() / 1000)
    );

    expect(validation.valid).toBe(true);
    expect(validation.requiresEscalation).toBe(true); // Escalation flag triggered!

    // 2. Build UserOperation
    const userOp = client.buildTransferUserOp({
      tokenAddress: usdcToken,
      recipient,
      amount,
      nonce: 1n,
      gasParams: {
        verificationGasLimit: 250000n,
        callGasLimit: 60000n,
        preVerificationGas: 50000n,
        maxPriorityFeePerGas: 50000000n,
        maxFeePerGas: 200000000n
      }
    });

    // 3. Passkey quorum signing
    const passkeyIds = [0n, 1n];
    const passkeySigs = [
      {
        authenticatorData: '0x0500000000' as const,
        clientDataJSON: '{"type":"webauthn.get"}',
        challengeIndex: 23n,
        typeIndex: 1n,
        r: 12345n,
        s: 67890n
      },
      {
        authenticatorData: '0x0500000000' as const,
        clientDataJSON: '{"type":"webauthn.get"}',
        challengeIndex: 23n,
        typeIndex: 1n,
        r: 54321n,
        s: 98765n
      }
    ];

    const signedOp = await client.signEscalatedUserOp(userOp, passkeyIds, passkeySigs);
    expect(signedOp.signature.startsWith('0x02')).toBe(true);
  });

  it('should build and sign a safe Uniswap V3 swap with slippage bounds', async () => {
    const amountIn = parseTokenAmount('40', 6); // 40 USDC
    const quotedOut = parseTokenAmount('0.015', 18); // 0.015 WETH
    const amountOutMinimum = calculateAmountOutMinimum(quotedOut, 50n); // 0.5% slippage

    const wethToken = '0x4200000000000000000000000000000000000006' as const;

    const userOp = client.buildSwapUserOp({
      routerAddress: router,
      swapParams: {
        tokenIn: usdcToken,
        tokenOut: wethToken,
        fee: 3000,
        recipient: accountAddress,
        amountIn,
        amountOutMinimum
      },
      nonce: 2n,
      gasParams: {
        verificationGasLimit: 200000n,
        callGasLimit: 120000n,
        preVerificationGas: 60000n,
        maxPriorityFeePerGas: 50000000n,
        maxFeePerGas: 200000000n
      }
    });

    expect(userOp.callData.startsWith(SELECTORS.EXECUTE_BY_AGENT)).toBe(true);
    const signedOp = await client.signAutonomousUserOp(userOp);
    expect(signedOp.signature.startsWith('0x01')).toBe(true);
  });
});
