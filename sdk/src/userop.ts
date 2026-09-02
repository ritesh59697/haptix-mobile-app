import {
  type Address,
  type Hex,
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  padHex,
  toHex,
  parseAbiParameters
} from 'viem';
import type {
  PackedUserOperation,
  UserOperationGasParams
} from './types.js';

const EXECUTE_BY_AGENT_ABI = [
  {
    type: 'function',
    name: 'executeByAgent',
    inputs: [
      { name: 'agentKey', type: 'address' },
      { name: 'dest', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'func', type: 'bytes' }
    ],
    outputs: [],
    stateMutability: 'payable'
  }
] as const;

const EXECUTE_BATCH_BY_AGENT_ABI = [
  {
    type: 'function',
    name: 'executeBatchByAgent',
    inputs: [
      { name: 'agentKey', type: 'address' },
      { name: 'dests', type: 'address[]' },
      { name: 'values', type: 'uint256[]' },
      { name: 'funcs', type: 'bytes[]' }
    ],
    outputs: [],
    stateMutability: 'payable'
  }
] as const;

/**
 * Packs 16-byte verificationGasLimit and 16-byte callGasLimit into a single bytes32.
 */
export function packAccountGasLimits(verificationGasLimit: bigint, callGasLimit: bigint): Hex {
  const high = toHex(verificationGasLimit, { size: 16 });
  const low = toHex(callGasLimit, { size: 16 });
  return concatHex([high, low]);
}

/**
 * Packs 16-byte maxPriorityFeePerGas and 16-byte maxFeePerGas into a single bytes32.
 */
export function packGasFees(maxPriorityFeePerGas: bigint, maxFeePerGas: bigint): Hex {
  const high = toHex(maxPriorityFeePerGas, { size: 16 });
  const low = toHex(maxFeePerGas, { size: 16 });
  return concatHex([high, low]);
}

/**
 * Unpacks accountGasLimits into verificationGasLimit and callGasLimit.
 */
export function unpackAccountGasLimits(accountGasLimits: Hex): {
  verificationGasLimit: bigint;
  callGasLimit: bigint;
} {
  const hexNoPrefix = accountGasLimits.slice(2).padStart(64, '0');
  const highHex = '0x' + hexNoPrefix.slice(0, 32);
  const lowHex = '0x' + hexNoPrefix.slice(32, 64);
  return {
    verificationGasLimit: BigInt(highHex),
    callGasLimit: BigInt(lowHex)
  };
}

/**
 * Unpacks gasFees into maxPriorityFeePerGas and maxFeePerGas.
 */
export function unpackGasFees(gasFees: Hex): {
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
} {
  const hexNoPrefix = gasFees.slice(2).padStart(64, '0');
  const highHex = '0x' + hexNoPrefix.slice(0, 32);
  const lowHex = '0x' + hexNoPrefix.slice(32, 64);
  return {
    maxPriorityFeePerGas: BigInt(highHex),
    maxFeePerGas: BigInt(lowHex)
  };
}

/**
 * Builds a PackedUserOperation struct for ERC-4337 v0.7.
 */
export function buildPackedUserOp(params: {
  sender: Address;
  nonce?: bigint;
  initCode?: Hex;
  callData: Hex;
  gasParams: UserOperationGasParams;
  paymasterAndData?: Hex;
  signature?: Hex;
}): PackedUserOperation {
  return {
    sender: params.sender,
    nonce: params.nonce ?? 0n,
    initCode: params.initCode ?? '0x',
    callData: params.callData,
    accountGasLimits: packAccountGasLimits(
      params.gasParams.verificationGasLimit,
      params.gasParams.callGasLimit
    ),
    preVerificationGas: params.gasParams.preVerificationGas,
    gasFees: packGasFees(
      params.gasParams.maxPriorityFeePerGas,
      params.gasParams.maxFeePerGas
    ),
    paymasterAndData: params.paymasterAndData ?? '0x',
    signature: params.signature ?? '0x'
  };
}

/**
 * Computes canonical ERC-4337 v0.7 userOpHash matching PasskeyAccount.sol:
 * userOpHash = keccak256(abi.encode(keccak256(pack(userOp)), entryPoint, chainId))
 */
export function computeUserOpHash(
  userOp: PackedUserOperation,
  entryPoint: Address,
  chainId: number | bigint
): Hex {
  const initCodeHash = keccak256(userOp.initCode);
  const callDataHash = keccak256(userOp.callData);
  const paymasterAndDataHash = keccak256(userOp.paymasterAndData);

  const packedInner = encodeAbiParameters(
    parseAbiParameters(
      'address sender, uint256 nonce, bytes32 initCodeHash, bytes32 callDataHash, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes32 paymasterAndDataHash'
    ),
    [
      userOp.sender,
      userOp.nonce,
      initCodeHash,
      callDataHash,
      userOp.accountGasLimits,
      userOp.preVerificationGas,
      userOp.gasFees,
      paymasterAndDataHash
    ]
  );

  const innerHash = keccak256(packedInner);

  const fullHash = encodeAbiParameters(
    parseAbiParameters('bytes32 innerHash, address entryPoint, uint256 chainId'),
    [innerHash, entryPoint, BigInt(chainId)]
  );

  return keccak256(fullHash);
}

/**
 * Encodes calldata for executeByAgent(agentKey, dest, value, func).
 */
export function encodeExecuteByAgent(
  agentKey: Address,
  dest: Address,
  value: bigint,
  func: Hex
): Hex {
  return encodeFunctionData({
    abi: EXECUTE_BY_AGENT_ABI,
    functionName: 'executeByAgent',
    args: [agentKey, dest, value, func]
  });
}

/**
 * Encodes calldata for executeBatchByAgent(agentKey, dests, values, funcs).
 */
export function encodeExecuteBatchByAgent(
  agentKey: Address,
  dests: Address[],
  values: bigint[],
  funcs: Hex[]
): Hex {
  if (dests.length !== values.length || dests.length !== funcs.length) {
    throw new Error('Batch array lengths must match exactly (dests, values, funcs)');
  }
  return encodeFunctionData({
    abi: EXECUTE_BATCH_BY_AGENT_ABI,
    functionName: 'executeBatchByAgent',
    args: [agentKey, dests, values, funcs]
  });
}
