import {
  type Address,
  type Hex,
  type PublicClient,
  encodeFunctionData,
  parseAbi
} from 'viem';

export const RECOVERY_ABI = parseAbi([
  'function guardian() view returns (address)',
  'function recoveryTimelock() view returns (uint48)',
  'function pendingRecovery() view returns (uint48 executeAfter, bool active, bytes32 signersHash)',
  'function setGuardian(address newGuardian, uint48 timelock) external',
  'function initiateRecovery((uint256 x, uint256 y)[] newSigners) external',
  'function completeRecovery((uint256 x, uint256 y)[] newSigners) external',
  'function cancelRecovery() external'
]);

export interface PasskeyPublicKey {
  x: bigint;
  y: bigint;
}

export interface RecoveryStatus {
  guardian: Address;
  recoveryTimelock: number;
  pendingRecovery: {
    executeAfter: number;
    active: boolean;
    signersHash: Hex;
  };
  canComplete: boolean;
}

/**
 * Encodes calldata to set or update the account guardian and timelock.
 * Must be executed via 2-of-2 passkey quorum UserOp.
 */
export function encodeSetGuardian(newGuardian: Address, timelockSeconds: number): Hex {
  return encodeFunctionData({
    abi: RECOVERY_ABI,
    functionName: 'setGuardian',
    args: [newGuardian, timelockSeconds]
  });
}

/**
 * Encodes calldata for the guardian to initiate account recovery.
 */
export function encodeInitiateRecovery(newSigners: PasskeyPublicKey[]): Hex {
  return encodeFunctionData({
    abi: RECOVERY_ABI,
    functionName: 'initiateRecovery',
    args: [newSigners.map(s => ({ x: s.x, y: s.y }))]
  });
}

/**
 * Encodes calldata to finalize recovery and install new signers after timelock expires.
 */
export function encodeCompleteRecovery(newSigners: PasskeyPublicKey[]): Hex {
  return encodeFunctionData({
    abi: RECOVERY_ABI,
    functionName: 'completeRecovery',
    args: [newSigners.map(s => ({ x: s.x, y: s.y }))]
  });
}

/**
 * Encodes calldata to cancel a pending recovery (can be called by user with 1 passkey).
 */
export function encodeCancelRecovery(): Hex {
  return encodeFunctionData({
    abi: RECOVERY_ABI,
    functionName: 'cancelRecovery'
  });
}

/**
 * Queries the on-chain recovery status of a PasskeyAccount.
 */
export async function getRecoveryStatus(
  client: PublicClient,
  accountAddress: Address
): Promise<RecoveryStatus> {
  const [guardian, timelock, pending] = await Promise.all([
    client.readContract({
      address: accountAddress,
      abi: RECOVERY_ABI,
      functionName: 'guardian'
    }),
    client.readContract({
      address: accountAddress,
      abi: RECOVERY_ABI,
      functionName: 'recoveryTimelock'
    }),
    client.readContract({
      address: accountAddress,
      abi: RECOVERY_ABI,
      functionName: 'pendingRecovery'
    })
  ]);

  const now = Math.floor(Date.now() / 1000);
  const [executeAfter, active, signersHash] = pending;

  return {
    guardian,
    recoveryTimelock: Number(timelock),
    pendingRecovery: {
      executeAfter: Number(executeAfter),
      active,
      signersHash
    },
    canComplete: active && now >= Number(executeAfter)
  };
}
