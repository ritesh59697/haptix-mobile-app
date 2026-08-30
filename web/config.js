// Configuration for Passkey Smart Wallet on Base Sepolia

export const CONFIG = {
  chainId: 84532,
  chainName: 'Base Sepolia',
  rpcUrl: 'https://sepolia.base.org',
  entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  factoryAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  defaultAccount: '0x34Aeb3A39fd1838D1C897F879EAB0a258507802c',
  
  // Bundler URL for eth_sendUserOperation & eth_getUserOperationReceipt
  bundlerUrl: localStorage.getItem('passkey_bundler_url') || 'https://api.pimlico.io/v2/84532/rpc?apikey=public',
  
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
