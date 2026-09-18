// Extension Configuration for Haptix Multi-Chain Smart Wallet (ERC-4337 v0.7 + RIP-7212)

export const NETWORKS = {
  84532: {
    chainId: 84532,
    chainIdHex: '0x14a34',
    name: 'Base Sepolia',
    shortName: 'Base Sepolia',
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    factoryAddress: '0x1bB7cCf96cB211045982fC8a0069D9C0d718B83b',
    implementationAddress: '0x9B553dF98bbC1c7152698c4739A93281F0FBB110',
    bundlerUrl: (typeof localStorage !== 'undefined' ? localStorage.getItem('passkey_bundler_url') : null) || 'https://api.pimlico.io/v2/84532/rpc?apikey=pim_hkKhRbcJfLUYSzezx8ofPd',
    isTestnet: true,
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    uniswapV3Router: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
    uniswapV3Quoter: '0xC5290058841028F1614F3A6F0F5816cAd0df5E27',
    weth: '0x4200000000000000000000000000000000000006',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    tokens: {
      ETH: {
        symbol: 'ETH',
        name: 'Native Ethereum',
        address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
        defaultThreshold: '0.01',
        defaultThresholdUnits: 10000000000000000n,
        defaultCap: '0.05'
      },
      USDC: {
        symbol: 'USDC',
        name: 'USD Coin (Base Sepolia)',
        address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        decimals: 6,
        defaultThreshold: '25',
        defaultThresholdUnits: 25000000n,
        defaultCap: '100'
      }
    }
  },
  8453: {
    chainId: 8453,
    chainIdHex: '0x2105',
    name: 'Base Mainnet',
    shortName: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    factoryAddress: '0x1bB7cCf96cB211045982fC8a0069D9C0d718B83b',
    implementationAddress: '0x9B553dF98bbC1c7152698c4739A93281F0FBB110',
    bundlerUrl: 'https://api.pimlico.io/v2/8453/rpc?apikey=pim_hkKhRbcJfLUYSzezx8ofPd',
    isTestnet: false,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
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
        name: 'USD Coin',
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        decimals: 6,
        defaultThreshold: '50'
      }
    }
  },
  42161: {
    chainId: 42161,
    chainIdHex: '0xa4b1',
    name: 'Arbitrum One',
    shortName: 'Arbitrum',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    explorerUrl: 'https://arbiscan.io',
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    factoryAddress: '0x1bB7cCf96cB211045982fC8a0069D9C0d718B83b',
    implementationAddress: '0x9B553dF98bbC1c7152698c4739A93281F0FBB110',
    bundlerUrl: 'https://api.pimlico.io/v2/42161/rpc?apikey=pim_hkKhRbcJfLUYSzezx8ofPd',
    isTestnet: false,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
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
        name: 'USD Coin',
        address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        decimals: 6,
        defaultThreshold: '50'
      },
      USDG: {
        symbol: 'USDG',
        name: 'Global Dollar (Paxos)',
        address: '0x004B506865409877C9fA29bfb1ebA929984B9bbC',
        decimals: 6,
        defaultThreshold: '50'
      }
    }
  },
  421614: {
    chainId: 421614,
    chainIdHex: '0x66eee',
    name: 'Arbitrum Sepolia',
    shortName: 'Arb Sepolia',
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    explorerUrl: 'https://sepolia.arbiscan.io',
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    factoryAddress: '0x60319237e8dd2D661eBcF8E6933458BD78Ce146d',
    implementationAddress: '0xd5e179970f8aBA0CB049b95c2A4D4dcC64F1a0A3',
    bundlerUrl: 'https://api.pimlico.io/v2/421614/rpc?apikey=pim_hkKhRbcJfLUYSzezx8ofPd',
    isTestnet: true,
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
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
        name: 'USD Coin',
        address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        decimals: 6,
        defaultThreshold: '25'
      },
      USDG: {
        symbol: 'USDG',
        name: 'Global Dollar (Paxos)',
        address: '0xDDF7d873F5738c2A191624b1ba1Aba7042621E43',
        decimals: 6,
        defaultThreshold: '25'
      }
    }
  },
  5042002: {
    chainId: 5042002,
    chainIdHex: '0x4cefa2',
    name: 'Arc Testnet',
    shortName: 'Arc Testnet',
    rpcUrl: 'https://rpc.testnet.arc.network',
    explorerUrl: 'https://testnet.arcscan.app',
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    factoryAddress: '0x60319237e8dd2D661eBcF8E6933458BD78Ce146d',
    implementationAddress: '0xd5e179970f8aBA0CB049b95c2A4D4dcC64F1a0A3',
    isTestnet: true,
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
    tokens: {
      USDC: {
        symbol: 'USDC',
        name: 'Native USDC (Gas)',
        address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
        defaultThreshold: '25'
      }
    }
  },
  5042: {
    chainId: 5042,
    chainIdHex: '0x13b2',
    name: 'Arc Mainnet',
    shortName: 'Arc',
    rpcUrl: 'https://rpc.mainnet.arc.io',
    explorerUrl: 'https://explorer.arc.io',
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    isTestnet: false,
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
    tokens: {
      USDC: {
        symbol: 'USDC',
        name: 'Native USDC (Gas)',
        address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
        defaultThreshold: '50'
      }
    }
  },
  10: {
    chainId: 10,
    chainIdHex: '0xa',
    name: 'OP Mainnet',
    shortName: 'Optimism',
    rpcUrl: 'https://mainnet.optimism.io',
    explorerUrl: 'https://optimistic.etherscan.io',
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    factoryAddress: '0x1bB7cCf96cB211045982fC8a0069D9C0d718B83b',
    implementationAddress: '0x9B553dF98bbC1c7152698c4739A93281F0FBB110',
    bundlerUrl: 'https://api.pimlico.io/v2/10/rpc?apikey=pim_hkKhRbcJfLUYSzezx8ofPd',
    isTestnet: false,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
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
        name: 'USD Coin',
        address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
        decimals: 6,
        defaultThreshold: '50'
      }
    }
  },
  11155420: {
    chainId: 11155420,
    chainIdHex: '0xaa37dc',
    name: 'OP Sepolia',
    shortName: 'OP Sepolia',
    rpcUrl: 'https://sepolia.optimism.io',
    explorerUrl: 'https://sepolia-optimism.etherscan.io',
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    factoryAddress: '0x1bB7cCf96cB211045982fC8a0069D9C0d718B83b',
    implementationAddress: '0x9B553dF98bbC1c7152698c4739A93281F0FBB110',
    bundlerUrl: 'https://api.pimlico.io/v2/11155420/rpc?apikey=pim_hkKhRbcJfLUYSzezx8ofPd',
    isTestnet: true,
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    tokens: {
      ETH: {
        symbol: 'ETH',
        name: 'Native Ethereum',
        address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
        defaultThreshold: '0.01'
      }
    }
  }
};

export const DEFAULT_CHAIN_ID = 84532;

export function getNetwork(chainId) {
  const id = typeof chainId === 'string' 
    ? (chainId.startsWith('0x') ? parseInt(chainId, 16) : parseInt(chainId, 10))
    : Number(chainId);
  return NETWORKS[id] || NETWORKS[DEFAULT_CHAIN_ID];
}

// Default export configuration matching Base Sepolia for legacy callers and smart account defaults
export const CONFIG = {
  ...NETWORKS[DEFAULT_CHAIN_ID],
  defaultAccount: '0xB01543453cF31052c769d79e9C755E3b035d796f',
  
  // Supported DEX & DeFi Infrastructure (Base Sepolia)
  uniswapV3Router: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
  uniswapV3Quoter: '0xC5290058841028F1614F3A6F0F5816cAd0df5E27',
  weth: '0x4200000000000000000000000000000000000006',
  usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',

  // Delegated AI Agent Session Keypair for Autonomous Execution
  agentAddress: '0x093F8575a87cdb2919E5B3f1677eD8d7815c9461',
  agentPrivateKey: '0x7fc37057650fd55a74b810ae0bac0fffa18185bdc50579f5f34e783834824799',

  gas: {
    verificationGasLimit: 200000n,
    callGasLimit: 60000n,
    preVerificationGas: 100000n,
    maxPriorityFeePerGas: 50000000n, // 0.05 gwei
    maxFeePerGas: 200000000n        // 0.20 gwei
  }
};
