import {
  type Address,
  type Hex,
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbiParameters,
  isAddress
} from 'viem';
import type { WebAuthnPublicKey } from './types.js';

const FACTORY_ABI = [
  {
    type: 'function',
    name: 'createAccount',
    inputs: [
      {
        name: 'initialSigners',
        type: 'tuple[]',
        components: [
          { name: 'x', type: 'uint256' },
          { name: 'y', type: 'uint256' }
        ]
      },
      { name: 'threshold', type: 'uint256' },
      { name: 'salt', type: 'bytes32' }
    ],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'getAddress',
    inputs: [
      {
        name: 'initialSigners',
        type: 'tuple[]',
        components: [
          { name: 'x', type: 'uint256' },
          { name: 'y', type: 'uint256' }
        ]
      },
      { name: 'threshold', type: 'uint256' },
      { name: 'salt', type: 'bytes32' }
    ],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view'
  }
] as const;

/**
 * Builds the ERC-4337 v0.7 initCode for a counterfactual account deployment:
 * initCode = factoryAddress (20 bytes) || factoryCalldata (createAccount)
 */
export function buildAccountInitCode(params: {
  factoryAddress: Address;
  initialSigners: WebAuthnPublicKey[];
  threshold: bigint;
  salt: Hex;
}): Hex {
  if (params.initialSigners.length < 2) {
    throw new Error('PasskeyAccount requires at least 2 initial passkey signers for quorum security');
  }

  const factoryCalldata = encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: 'createAccount',
    args: [
      params.initialSigners.map(s => ({ x: s.x, y: s.y })),
      params.threshold,
      params.salt
    ]
  });

  return concatHex([params.factoryAddress, factoryCalldata]);
}
