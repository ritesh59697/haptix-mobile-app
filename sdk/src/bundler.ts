import {
  type Address,
  type Hex,
  type PublicClient,
  toHex,
  parseAbi
} from 'viem';
import {
  CANONICAL_ENTRYPOINT_V07,
  ENTRYPOINT_ERRORS,
  BUNDLER_RPC_ERRORS
} from './constants.js';
import type {
  PackedUserOperation,
  UserOperationGasParams,
  UserOperationReceipt,
  UserOperationByHash
} from './types.js';

export interface BundlerRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface PreflightCheckResult {
  ok: boolean;
  requiredPrefundWei: bigint;
  accountBalanceWei: bigint;
  entryPointDepositWei: bigint;
  totalAvailableWei: bigint;
  error?: string;
  hint?: string;
}

/**
 * Validates that an EntryPoint address matches canonical v0.7.
 */
export function validateEntryPoint(entryPoint: Address, chainId?: number): void {
  if (entryPoint.toLowerCase() !== CANONICAL_ENTRYPOINT_V07.toLowerCase()) {
    throw new Error(
      `Invalid EntryPoint address ${entryPoint}. Haptix requires canonical ERC-4337 v0.7 (${CANONICAL_ENTRYPOINT_V07})`
    );
  }
  if (
    chainId !== undefined &&
    chainId !== 84532 &&
    chainId !== 8453 &&
    chainId !== 10 &&
    chainId !== 42161 &&
    chainId !== 31337
  ) {
    throw new Error(
      `Unsupported chainId: ${chainId}. Expected Base (8453), Base Sepolia (84532), Optimism (10), or Arbitrum (42161).`
    );
  }
}

/**
 * Parses raw error strings for standard ERC-4337 EntryPoint error codes (e.g. AA21, AA22, AA23, AA24).
 */
export function decodeEntryPointError(rawMessage: string): { code: string; title: string; hint: string } | null {
  const match = rawMessage.match(/\b(AA\d{2})\b/);
  if (match && ENTRYPOINT_ERRORS[match[1]]) {
    return ENTRYPOINT_ERRORS[match[1]];
  }
  return null;
}

import {
  unpackAccountGasLimits,
  unpackGasFees
} from './userop.js';

/**
 * Performs pre-flight balance and EntryPoint prefund check.
 */
export async function checkPreflightBalance(
  client: PublicClient,
  userOp: PackedUserOperation,
  entryPoint: Address = CANONICAL_ENTRYPOINT_V07
): Promise<PreflightCheckResult> {
  const { verificationGasLimit, callGasLimit } = unpackAccountGasLimits(userOp.accountGasLimits);
  const { maxFeePerGas } = unpackGasFees(userOp.gasFees);
  const preVerificationGas = userOp.preVerificationGas;

  // Required prefund per ERC-4337 v0.7: (callGasLimit + verificationGasLimit * 3 + preVerificationGas) * maxFeePerGas
  const maxGasMultiplier = 3n;
  const maxGas = callGasLimit + (verificationGasLimit * maxGasMultiplier) + preVerificationGas;
  const requiredPrefundWei = maxGas * maxFeePerGas;

  // 1. Check account native balance
  const accountBalanceWei = await client.getBalance({ address: userOp.sender });

  // 2. Check EntryPoint deposit
  const entryPointAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);
  let entryPointDepositWei = 0n;
  try {
    entryPointDepositWei = await client.readContract({
      address: entryPoint,
      abi: entryPointAbi,
      functionName: 'balanceOf',
      args: [userOp.sender]
    });
  } catch {
    // EntryPoint call may fail if undeployed or network issue
  }

  const totalAvailableWei = accountBalanceWei + entryPointDepositWei;

  // If paymaster is configured (paymasterAndData != '0x'), prefund is paid by paymaster
  const isPaymasterSponsored = userOp.paymasterAndData !== '0x' && userOp.paymasterAndData.length > 2;

  if (isPaymasterSponsored) {
    return {
      ok: true,
      requiredPrefundWei,
      accountBalanceWei,
      entryPointDepositWei,
      totalAvailableWei
    };
  }

  if (totalAvailableWei < requiredPrefundWei) {
    const errorInfo = ENTRYPOINT_ERRORS.AA21;
    return {
      ok: false,
      requiredPrefundWei,
      accountBalanceWei,
      entryPointDepositWei,
      totalAvailableWei,
      error: `AA21: Account requires ${requiredPrefundWei} wei for gas prefund, but only has ${totalAvailableWei} wei (${accountBalanceWei} ETH + ${entryPointDepositWei} EntryPoint deposit).`,
      hint: errorInfo.hint
    };
  }

  return {
    ok: true,
    requiredPrefundWei,
    accountBalanceWei,
    entryPointDepositWei,
    totalAvailableWei
  };
}

/**
 * Fetches the current nonce for a sender account from the EntryPoint.
 */
export async function getAccountNonce(
  client: PublicClient,
  sender: Address,
  key: bigint = 0n,
  entryPoint: Address = CANONICAL_ENTRYPOINT_V07
): Promise<bigint> {
  return client.readContract({
    address: entryPoint,
    abi: parseAbi(['function getNonce(address,uint192) view returns (uint256)']),
    functionName: 'getNonce',
    args: [sender, key]
  });
}

export class BundlerClient {
  readonly bundlerUrl: string;
  readonly entryPoint: Address;
  readonly chainId?: number;

  constructor(
    bundlerUrl: string,
    entryPoint: Address = CANONICAL_ENTRYPOINT_V07,
    chainId?: number
  ) {
    if (!bundlerUrl) {
      throw new Error('BundlerClient requires a valid bundlerUrl');
    }
    validateEntryPoint(entryPoint, chainId);
    this.bundlerUrl = bundlerUrl;
    this.entryPoint = entryPoint;
    this.chainId = chainId;
  }

  /**
   * Dispatches a JSON-RPC request to the bundler endpoint with rich error decoding.
   */
  async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    };

    let response: Response;
    try {
      response = await fetch(this.bundlerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (networkErr: unknown) {
      const err = networkErr as Error;
      throw new Error(`Bundler Network Connection Failed: ${err.message}. Check bundler URL and internet access.`);
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Bundler Authentication Failed [HTTP ${response.status}]: Missing or invalid API key in bundler URL. Please configure a valid provider endpoint.`
        );
      }
      throw new Error(`Bundler HTTP Error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as { result?: T; error?: BundlerRpcError };
    if (data.error) {
      const { code, message } = data.error;
      const aaDecoded = decodeEntryPointError(message);
      const rpcDesc = BUNDLER_RPC_ERRORS[code];

      let enrichedMessage = `Bundler Error [${code}]: ${message}`;
      if (aaDecoded) {
        enrichedMessage = `EntryPoint Error [${aaDecoded.code} - ${aaDecoded.title}]: ${aaDecoded.hint} (Details: ${message})`;
      } else if (rpcDesc) {
        enrichedMessage = `Bundler RPC Error [${code} - ${rpcDesc}]: ${message}`;
      }

      const error = new Error(enrichedMessage);
      (error as unknown as { code: number }).code = code;
      throw error;
    }

    return data.result as T;
  }

  /**
   * Formats a PackedUserOperation for JSON-RPC transport (converting bigints to 0x-hex strings per ERC-4337 v0.7 RPC spec).
   */
  private formatUserOpForRpc(userOp: PackedUserOperation): Record<string, string> {
    const { verificationGasLimit, callGasLimit } = unpackAccountGasLimits(userOp.accountGasLimits);
    const { maxPriorityFeePerGas, maxFeePerGas } = unpackGasFees(userOp.gasFees);

    const rpcOp: Record<string, string> = {
      sender: userOp.sender,
      nonce: toHex(userOp.nonce),
      callData: userOp.callData,
      callGasLimit: toHex(callGasLimit),
      verificationGasLimit: toHex(verificationGasLimit),
      preVerificationGas: toHex(userOp.preVerificationGas),
      maxFeePerGas: toHex(maxFeePerGas),
      maxPriorityFeePerGas: toHex(maxPriorityFeePerGas),
      signature: userOp.signature
    };

    if (userOp.initCode && userOp.initCode !== '0x' && userOp.initCode.length >= 42) {
      rpcOp.factory = userOp.initCode.slice(0, 42);
      rpcOp.factoryData = '0x' + userOp.initCode.slice(42);
    }

    if (userOp.paymasterAndData && userOp.paymasterAndData !== '0x' && userOp.paymasterAndData.length >= 42) {
      rpcOp.paymaster = userOp.paymasterAndData.slice(0, 42);
    }

    return rpcOp;
  }

  /**
   * Fetches current account nonce directly from the EntryPoint using a viem PublicClient.
   */
  async getNonce(client: PublicClient, sender: Address, key: bigint = 0n): Promise<bigint> {
    return getAccountNonce(client, sender, key, this.entryPoint);
  }

  /**
   * Submits a PackedUserOperation to the bundler via eth_sendUserOperation.
   */
  async sendUserOperation(userOp: PackedUserOperation): Promise<Hex> {
    validateEntryPoint(this.entryPoint, this.chainId);
    const formattedOp = this.formatUserOpForRpc(userOp);
    return this.rpcCall<Hex>('eth_sendUserOperation', [formattedOp, this.entryPoint]);
  }

  /**
   * Estimates gas limits for a UserOperation via eth_estimateUserOperationGas.
   */
  async estimateUserOperationGas(
    userOp: Omit<PackedUserOperation, 'accountGasLimits' | 'gasFees' | 'preVerificationGas'> & {
      maxPriorityFeePerGas?: bigint;
      maxFeePerGas?: bigint;
    }
  ): Promise<UserOperationGasParams> {
    validateEntryPoint(this.entryPoint, this.chainId);
    const formattedOp = {
      sender: userOp.sender,
      nonce: toHex(userOp.nonce),
      initCode: userOp.initCode,
      callData: userOp.callData,
      signature: userOp.signature,
      paymasterAndData: userOp.paymasterAndData
    };

    const estimate = await this.rpcCall<{
      preVerificationGas: Hex;
      verificationGasLimit: Hex;
      callGasLimit: Hex;
      maxPriorityFeePerGas?: Hex;
      maxFeePerGas?: Hex;
    }>('eth_estimateUserOperationGas', [formattedOp, this.entryPoint]);

    return {
      preVerificationGas: BigInt(estimate.preVerificationGas),
      verificationGasLimit: BigInt(estimate.verificationGasLimit),
      callGasLimit: BigInt(estimate.callGasLimit),
      maxPriorityFeePerGas: userOp.maxPriorityFeePerGas ?? 50000000n, // 0.05 gwei fallback
      maxFeePerGas: userOp.maxFeePerGas ?? 200000000n // 0.20 gwei fallback
    };
  }

  /**
   * Queries UserOperation status by userOpHash via eth_getUserOperationByHash.
   */
  async getUserOperationByHash(userOpHash: Hex): Promise<UserOperationByHash | null> {
    return this.rpcCall<UserOperationByHash | null>('eth_getUserOperationByHash', [userOpHash]);
  }

  /**
   * Queries UserOperation receipt by userOpHash via eth_getUserOperationReceipt.
   */
  async getUserOperationReceipt(userOpHash: Hex): Promise<UserOperationReceipt | null> {
    return this.rpcCall<UserOperationReceipt | null>('eth_getUserOperationReceipt', [userOpHash]);
  }

  /**
   * Polls for UserOperation execution receipt with timeout and backoff.
   */
  async waitForUserOperationReceipt(
    userOpHash: Hex,
    timeoutMs: number = 60000,
    intervalMs: number = 2000
  ): Promise<UserOperationReceipt> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const receipt = await this.getUserOperationReceipt(userOpHash);
      if (receipt) {
        if (!receipt.success) {
          throw new Error(`UserOperation executed but failed on-chain: ${receipt.reason || 'Reverted'}`);
        }
        return receipt;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Timeout waiting for UserOperation receipt (${userOpHash}) after ${timeoutMs}ms`);
  }
}

