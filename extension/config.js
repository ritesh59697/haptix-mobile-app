// Extension Configuration for Passkey Smart Wallet on Base Sepolia

export const CONFIG = {
  chainId: 84532,
  chainName: 'Base Sepolia',
  rpcUrl: 'https://sepolia.base.org',
  entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  defaultAccount: '0xB01543453cF31052c769d79e9C755E3b035d796f',
  bundlerUrl: 'https://api.pimlico.io/v2/84532/rpc?apikey=pim_hkKhRbcJfLUYSzezx8ofPd',
  
  gas: {
    verificationGasLimit: 200000n,
    callGasLimit: 60000n,
    preVerificationGas: 60000n,
    maxPriorityFeePerGas: 50000000n, // 0.05 gwei
    maxFeePerGas: 200000000n        // 0.20 gwei
  },

  tokens: {
    ETH: {
      symbol: 'ETH',
      name: 'Native Ethereum',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      defaultThreshold: '0.01'
    },
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin (Base Sepolia)',
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      decimals: 6,
      defaultThreshold: '25'
    }
  }
};
