// Configuration for Passkey Smart Wallet on Base Sepolia
// Users can configure their own Bundler RPC URL without exposing secrets in source code.

export const CONFIG = {
  chainId: 84532,
  chainName: 'Base Sepolia',
  rpcUrl: 'https://sepolia.base.org',
  entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  factoryAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  defaultAccount: '0x34Aeb3A39fd1838D1C897F879EAB0a258507802c',
  
  // Bundler URL for eth_sendUserOperation & eth_getUserOperationReceipt
  // Can be set dynamically in the UI settings or loaded from localStorage
  bundlerUrl: localStorage.getItem('passkey_bundler_url') || 'https://api.pimlico.io/v2/84532/rpc?apikey=public',
  
  // Default spending firewall limits
  policy: {
    singleSigEthThreshold: '0.01',
    singleSigEthThresholdWei: 10000000000000000n, // 0.01 ETH
    windowDurationHours: 24,
  }
};
