// Configuration for Passkey Smart Wallet on Base Sepolia

export const CONFIG = {
  chainId: 84532,
  chainName: 'Base Sepolia',
  rpcUrl: 'https://sepolia.base.org',
  entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  factoryAddress: '0x1bB7cCf96cB211045982fC8a0069D9C0d718B83b',
  implementationAddress: '0x9B553dF98bbC1c7152698c4739A93281F0FBB110',
  defaultAccount: '0xB01543453cF31052c769d79e9C755E3b035d796f',
  
  // Default Bundler endpoint for Base Sepolia
  bundlerUrl: localStorage.getItem('passkey_bundler_url') || 'https://api.pimlico.io/v2/84532/rpc?apikey=pim_hkKhRbcJfLUYSzezx8ofPd',

  // Gas limits matching PasskeyAccount benchmarks (P-256 Osaka precompile ~109k gas)
  gas: {
    verificationGasLimit: 200000n,
    callGasLimit: 60000n,
    preVerificationGas: 100000n,
    maxPriorityFeePerGas: 50000000n, // 0.05 gwei
    maxFeePerGas: 200000000n        // 0.20 gwei
  },
  
  // Supported Assets & Policies
  tokens: {
    ETH: {
      symbol: 'ETH',
      name: 'Native Ethereum',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      defaultThreshold: '0.01',
      defaultThresholdUnits: 10000000000000000n, // 0.01 ETH
      defaultCap: '0.05',
    },
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin (Base Sepolia)',
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      decimals: 6,
      defaultThreshold: '25', // 25 USDC
      defaultThresholdUnits: 25000000n, // 25 * 10^6 base units
      defaultCap: '100', // 100 USDC per 24h
    }
  }
};
