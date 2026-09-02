import React, { createContext, useContext, useState, useEffect } from 'react';
import { TokenAsset, DefiVault, TransactionItem, PasskeyCredential } from '../types/wallet';

interface WalletContextType {
  account: string;
  shortAccount: string;
  balanceEth: string;
  setBalanceEth: (val: string) => void;
  balanceUsd: string;
  setBalanceUsd: (val: string) => void;
  network: string;
  activeTab: 'tokens' | 'defi' | 'security' | 'activity';
  setActiveTab: (tab: 'tokens' | 'defi' | 'security' | 'activity') => void;
  isFrozen: boolean;
  setFrozen: (frozen: boolean) => void;
  activeModal: 'settings' | 'send' | 'receive' | 'txDetails' | null;
  setActiveModal: (modal: 'settings' | 'send' | 'receive' | 'txDetails' | null) => void;
  selectedTx: TransactionItem | null;
  setSelectedTx: (tx: TransactionItem | null) => void;
  tokens: TokenAsset[];
  defiVaults: DefiVault[];
  transactions: TransactionItem[];
  credentials: PasskeyCredential[];
  copyAddress: () => void;
  copied: boolean;
}

const DEFAULT_ACCOUNT = '0xB01543453cF31052c769d79e9C755E3b035d796f';

const INITIAL_TOKENS: TokenAsset[] = [
  {
    symbol: 'ETH',
    name: 'Ethereum (Base)',
    balance: '0.0041 ETH',
    fiatValue: '$13.12',
    change24h: '+3.42%',
    isPositive: true,
    iconBg: '#0052FF',
    iconText: 'Ξ',
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    balance: '120.00 USDC',
    fiatValue: '$120.00',
    change24h: '0.00%',
    isPositive: true,
    iconBg: '#2775CA',
    iconText: '$',
  },
  {
    symbol: 'cbETH',
    name: 'Coinbase Wrapped Staked ETH',
    balance: '0.0000 cbETH',
    fiatValue: '$0.00',
    change24h: '+2.85%',
    isPositive: true,
    iconBg: '#10B981',
    iconText: 'cb',
  },
];

const INITIAL_DEFI: DefiVault[] = [
  {
    id: 'vault-1',
    name: 'Aerodrome Slipstream',
    protocol: 'USDC / ETH 0.05%',
    apy: '14.8% APY',
    tvl: '$8.2M',
    deposited: '$0.00',
    tag: 'Autocompounding',
    color: '#0052FF',
  },
  {
    id: 'vault-2',
    name: 'Aave V3 Base',
    protocol: 'Supply USDC Earn Yield',
    apy: '6.4% APY',
    tvl: '$42.1M',
    deposited: '$0.00',
    tag: 'Hardware Sign',
    color: '#10B981',
  },
  {
    id: 'vault-3',
    name: 'Seamless Protocol',
    protocol: 'Integrated Liquidity Market',
    apy: '9.2% APY',
    tvl: '$12.5M',
    deposited: '$0.00',
    tag: 'Audited',
    color: '#38BDF8',
  },
];

const INITIAL_TXS: TransactionItem[] = [
  {
    id: 'tx-1',
    type: 'SEND',
    title: 'Sent ETH',
    recipientOrSender: 'To: 0x742d...44e',
    amount: '-0.0015 ETH',
    fiat: '≈ $4.80 USD',
    timestamp: '12 mins ago',
    status: 'Confirmed',
    statusColor: '#10B981',
    hash: '0x3f8a...9c12',
  },
  {
    id: 'tx-2',
    type: 'AGENT',
    title: 'AI Agent Session',
    recipientOrSender: 'Auto-Swap: 10 USDC → cbETH',
    amount: '10.00 USDC',
    fiat: '≈ $10.00 USD',
    timestamp: '2 hours ago',
    status: 'Autonomous',
    statusColor: '#38BDF8',
    hash: '0xa41b...28e1',
  },
  {
    id: 'tx-3',
    type: 'RECEIVE',
    title: 'Received Base Sepolia',
    recipientOrSender: 'From: Base Faucet',
    amount: '+0.0050 ETH',
    fiat: '≈ $16.00 USD',
    timestamp: 'Yesterday',
    status: 'Confirmed',
    statusColor: '#10B981',
    hash: '0x992c...ff41',
  },
  {
    id: 'tx-4',
    type: 'QUORUM',
    title: 'Quorum Rule Update',
    recipientOrSender: 'Policy: Threshold updated to 0.05 ETH',
    amount: '2-of-2 Multi-Sig',
    fiat: 'System Governance',
    timestamp: '3 days ago',
    status: 'Confirmed',
    statusColor: '#F59E0B',
    hash: '0xee12...884a',
  },
];

const INITIAL_CREDENTIALS: PasskeyCredential[] = [
  {
    id: 'key-1',
    name: 'MacBook Touch ID Enclave',
    algorithm: 'ES256 (secp256r1 / P-256)',
    authenticator: 'Apple Platform Secure Enclave',
    lastUsed: 'Today, 22:45',
    status: 'Active',
  },
  {
    id: 'key-2',
    name: 'iPhone 15 Pro Face ID',
    algorithm: 'ES256 (FIDO2 WebAuthn)',
    authenticator: 'iCloud Keychain Sync',
    lastUsed: 'Aug 30, 2026',
    status: 'Active',
  },
];

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [account, setAccount] = useState(DEFAULT_ACCOUNT);
  const [balanceEth, setBalanceEth] = useState('0.0041 ETH');
  const [balanceUsd, setBalanceUsd] = useState('≈ $13.12 USD');
  const [network] = useState('Base Sepolia');
  const [activeTab, setActiveTab] = useState<'tokens' | 'defi' | 'security' | 'activity'>('tokens');
  const [isFrozen, setFrozen] = useState(false);
  const [activeModal, setActiveModal] = useState<'settings' | 'send' | 'receive' | 'txDetails' | null>(null);
  const [selectedTx, setSelectedTx] = useState<TransactionItem | null>(null);
  const [copied, setCopied] = useState(false);

  const shortAccount = `${account.slice(0, 6)}...${account.slice(-4)}`;

  const copyAddress = () => {
    navigator.clipboard.writeText(account);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    // Check if account or frozen state in chrome.storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['haptix_account', 'isFrozen'], (res) => {
        if (res.haptix_account) setAccount(res.haptix_account);
        if (res.isFrozen) setFrozen(Boolean(res.isFrozen));
      });
    }
  }, []);

  return (
    <WalletContext.Provider
      value={{
        account,
        shortAccount,
        balanceEth,
        setBalanceEth,
        balanceUsd,
        setBalanceUsd,
        network,
        activeTab,
        setActiveTab,
        isFrozen,
        setFrozen,
        activeModal,
        setActiveModal,
        selectedTx,
        setSelectedTx,
        tokens: INITIAL_TOKENS,
        defiVaults: INITIAL_DEFI,
        transactions: INITIAL_TXS,
        credentials: INITIAL_CREDENTIALS,
        copyAddress,
        copied,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet must be used within a WalletProvider');
  return context;
};
