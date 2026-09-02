import {
  type Address,
  type Hex,
  encodeFunctionData,
  isAddressEqual
} from 'viem';
import {
  CANONICAL_ENTRYPOINT_V07,
  SELECTORS,
  NATIVE_ETH_ADDRESS
} from './constants.js';
import type {
  PackedUserOperation,
  UserOperationGasParams,
  UniswapV3SwapParams,
  WebAuthnSignature,
  UserOperationReceipt
} from './types.js';
import {
  buildPackedUserOp,
  computeUserOpHash,
  encodeExecuteByAgent,
  encodeExecuteBatchByAgent
} from './userop.js';
import {
  signUserOpHash,
  encodeAutonomousAgentSignature,
  encodeEscalatedAgentSignature,
  deriveAgentAddress
} from './agent.js';
import {
  encodeUniswapV3ExactInputSingle
} from './swap.js';
import { BundlerClient } from './bundler.js';

const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable'
  }
] as const;

export interface HaptixAccountClientOptions {
  accountAddress: Address;
  chainId: number;
  entryPoint?: Address;
  bundlerUrl: string;
  agentPrivateKey?: Hex;
}

export class HaptixAccountClient {
  readonly accountAddress: Address;
  readonly chainId: number;
  readonly entryPoint: Address;
  readonly bundler: BundlerClient;
  readonly agentPrivateKey?: Hex;
  readonly agentAddress?: Address;

  constructor(options: HaptixAccountClientOptions) {
    this.accountAddress = options.accountAddress;
    this.chainId = options.chainId;
    this.entryPoint = options.entryPoint ?? CANONICAL_ENTRYPOINT_V07;
    this.bundler = new BundlerClient(options.bundlerUrl, this.entryPoint);
    this.agentPrivateKey = options.agentPrivateKey;
    if (this.agentPrivateKey) {
      this.agentAddress = deriveAgentAddress(this.agentPrivateKey);
    }
  }

  /**
   * Helper: Encodes ERC-20 transfer calldata.
   */
  encodeERC20Transfer(to: Address, amount: bigint): Hex {
    return encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: 'transfer',
      args: [to, amount]
    });
  }

  /**
   * Builds an autonomous UserOperation for a plain ETH or ERC-20 transfer.
   */
  buildTransferUserOp(params: {
    tokenAddress: Address;
    recipient: Address;
    amount: bigint;
    nonce?: bigint;
    gasParams: UserOperationGasParams;
  }): PackedUserOperation {
    if (!this.agentAddress) {
      throw new Error('HaptixAccountClient: agentPrivateKey is required to build agent UserOps');
    }

    let dest: Address;
    let value: bigint;
    let func: Hex;

    if (isAddressEqual(params.tokenAddress, NATIVE_ETH_ADDRESS)) {
      dest = params.recipient;
      value = params.amount;
      func = '0x';
    } else {
      dest = params.tokenAddress;
      value = 0n;
      func = this.encodeERC20Transfer(params.recipient, params.amount);
    }

    const callData = encodeExecuteByAgent(this.agentAddress, dest, value, func);

    return buildPackedUserOp({
      sender: this.accountAddress,
      nonce: params.nonce ?? 0n,
      callData,
      gasParams: params.gasParams
    });
  }

  /**
   * Builds an autonomous UserOperation for a Uniswap V3 swap.
   */
  buildSwapUserOp(params: {
    routerAddress: Address;
    swapParams: UniswapV3SwapParams;
    nonce?: bigint;
    gasParams: UserOperationGasParams;
  }): PackedUserOperation {
    if (!this.agentAddress) {
      throw new Error('HaptixAccountClient: agentPrivateKey is required to build agent UserOps');
    }

    const swapFunc = encodeUniswapV3ExactInputSingle({
      ...params.swapParams,
      recipient: this.accountAddress // Strictly enforce smart account as recipient
    });

    const callData = encodeExecuteByAgent(
      this.agentAddress,
      params.routerAddress,
      0n,
      swapFunc
    );

    return buildPackedUserOp({
      sender: this.accountAddress,
      nonce: params.nonce ?? 0n,
      callData,
      gasParams: params.gasParams
    });
  }

  /**
   * Signs a UserOperation autonomously with the agent's secp256k1 key (sigType 0x01).
   */
  async signAutonomousUserOp(userOp: PackedUserOperation): Promise<PackedUserOperation> {
    if (!this.agentPrivateKey || !this.agentAddress) {
      throw new Error('Agent private key required for autonomous signing');
    }

    const userOpHash = computeUserOpHash(userOp, this.entryPoint, this.chainId);
    const ecdsaSig = await signUserOpHash(this.agentPrivateKey, userOpHash);
    const signature = encodeAutonomousAgentSignature(this.agentAddress, ecdsaSig);

    return {
      ...userOp,
      signature
    };
  }

  /**
   * Signs a UserOperation with agent key + 2-of-N hardware passkey quorum (sigType 0x02).
   */
  async signEscalatedUserOp(
    userOp: PackedUserOperation,
    passkeyIds: bigint[],
    passkeySignatures: WebAuthnSignature[]
  ): Promise<PackedUserOperation> {
    if (!this.agentPrivateKey || !this.agentAddress) {
      throw new Error('Agent private key required for signing');
    }

    const userOpHash = computeUserOpHash(userOp, this.entryPoint, this.chainId);
    const ecdsaSig = await signUserOpHash(this.agentPrivateKey, userOpHash);
    const signature = encodeEscalatedAgentSignature(
      this.agentAddress,
      ecdsaSig,
      passkeyIds,
      passkeySignatures
    );

    return {
      ...userOp,
      signature
    };
  }

  /**
   * Dispatches a signed UserOperation to the bundler and waits for on-chain receipt.
   */
  async sendUserOpAndWait(
    signedUserOp: PackedUserOperation,
    timeoutMs: number = 60000
  ): Promise<UserOperationReceipt> {
    const userOpHash = await this.bundler.sendUserOperation(signedUserOp);
    return this.bundler.waitForUserOperationReceipt(userOpHash, timeoutMs);
  }
}
