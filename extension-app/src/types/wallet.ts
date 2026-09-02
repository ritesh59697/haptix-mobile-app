export interface TokenAsset {
  symbol: string;
  name: string;
  balance: string;
  fiatValue: string;
  change24h: string;
  isPositive: boolean;
  iconBg: string;
  iconText: string;
}

export interface DefiVault {
  id: string;
  name: string;
  protocol: string;
  apy: string;
  tvl: string;
  deposited: string;
  tag: string;
  color: string;
}

export interface TransactionItem {
  id: string;
  type: 'SEND' | 'RECEIVE' | 'AGENT' | 'QUORUM';
  title: string;
  recipientOrSender: string;
  amount: string;
  fiat: string;
  timestamp: string;
  status: 'Confirmed' | 'Pending' | 'Autonomous';
  statusColor: string;
  hash: string;
}

export interface PasskeyCredential {
  id: string;
  name: string;
  algorithm: string;
  authenticator: string;
  lastUsed: string;
  status: 'Active' | 'Revoked';
}

export type ThemeMode = 'haptix-dark' | 'haptix-light';
