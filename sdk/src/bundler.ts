import {
  type Address,
  type Hex,
  toHex
} from 'viem';
import { CANONICAL_ENTRYPOINT_V07 } from './constants.js';
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

export class BundlerClient {
  readonly bundlerUrl: string;
  readonly entryPoint: Address;

  constructor(bundlerUrl: string, entryPoint: Address = CANONICAL_ENTRYPOINT_V07) {
    if (!bundlerUrl) {
      throw new Error('BundlerClient requires a valid bundlerUrl');
    }
    this.bundlerUrl = bundlerUrl;
    this.entryPoint = entryPoint;
  }

  /**
   * Dispatches a JSON-RPC request to the bundler endpoint.
   */
  async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    };

    const response = await fetch(this.bundlerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Bundler HTTP Error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as { result?: T; error?: BundlerRpcError };
    if (data.error) {
      throw new Error(`Bundler RPC Error [${data.error.code}]: ${data.error.message}`);
    }

    return data.result as T;
  }

  /**
   * Formats a PackedUserOperation for JSON-RPC transport (converting bigints to 0x-hex strings).
   */
  private formatUserOpForRpc(userOp: PackedUserOperation): Record<string, string> {
    return {
      sender: userOp.sender,
      nonce: toHex(userOp.nonce),
      initCode: userOp.initCode,
      callData: userOp.callData,
      accountGasLimits: userOp.accountGasLimits,
      preVerificationGas: toHex(userOp.preVerificationGas),
      gasFees: userOp.gasFees,
      paymasterAndData: userOp.paymasterAndData,
      signature: userOp.signature
    };
  }

  /**
   * Submits a PackedUserOperation to the bundler via eth_sendUserOperation.
   */
  async sendUserOperation(userOp: PackedUserOperation): Promise<Hex> {
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
