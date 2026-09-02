import React, { useState } from 'react';
import { useWallet } from '../../context/WalletContext';
import { TransactionItem } from '../../types/wallet';
import { ArrowUpRight, ArrowDownLeft, Bot, Shield, ExternalLink } from 'lucide-react';

export const ActivityTab: React.FC = () => {
  const { transactions, account, setActiveModal, setSelectedTx } = useWallet();
  const [filter, setFilter] = useState<'ALL' | 'SEND' | 'RECEIVE' | 'AGENT' | 'QUORUM'>('ALL');

  const filteredTxs = transactions.filter((tx) => {
    if (filter === 'ALL') return true;
    return tx.type === filter;
  });

  const getTxIcon = (type: TransactionItem['type']) => {
    switch (type) {
      case 'SEND':
        return <ArrowUpRight className="w-4 h-4 text-baseBlue" />;
      case 'RECEIVE':
        return <ArrowDownLeft className="w-4 h-4 text-success" />;
      case 'AGENT':
        return <Bot className="w-4 h-4 text-secondary" />;
      case 'QUORUM':
        return <Shield className="w-4 h-4 text-warning" />;
    }
  };

  const handleTxClick = (tx: TransactionItem) => {
    setSelectedTx(tx);
    setActiveModal('txDetails');
  };

  return (
    <div className="flex flex-col gap-2.5 p-3.5">
      {/* Top Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-base-content/70 tracking-wide uppercase">
            History
          </span>
          <span className="badge badge-xs bg-base-300 border-none font-mono text-[10px]">
            {transactions.length}
          </span>
        </div>
        <a
          href={`https://sepolia.basescan.org/address/${account}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-semibold text-baseBlue hover:underline flex items-center gap-1"
        >
          <span>BaseScan</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Filter Chips (DaisyUI style) */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {(['ALL', 'SEND', 'RECEIVE', 'AGENT', 'QUORUM'] as const).map((chip) => (
          <button
            key={chip}
            onClick={() => setFilter(chip)}
            className={`btn btn-xs rounded-lg px-2 text-[10.5px] font-semibold transition-all border ${
              filter === chip
                ? 'btn-primary shadow-sm text-white'
                : 'btn-ghost bg-base-200/80 border-base-content/10 text-base-content/70 hover:bg-base-300'
            }`}
          >
            {chip === 'ALL'
              ? 'All'
              : chip === 'SEND'
              ? 'Sent'
              : chip === 'RECEIVE'
              ? 'Received'
              : chip === 'AGENT'
              ? 'AI Agent'
              : 'Quorum'}
          </button>
        ))}
      </div>

      {/* Transactions List */}
      <div className="flex flex-col gap-2">
        {filteredTxs.length === 0 ? (
          <div className="p-6 text-center text-xs text-base-content/50">
            No transactions found for this filter.
          </div>
        ) : (
          filteredTxs.map((tx) => (
            <div
              key={tx.id}
              onClick={() => handleTxClick(tx)}
              className="flex items-center justify-between p-3 rounded-xl bg-base-200/80 hover:bg-base-200 border border-base-content/10 shadow-sm transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-base-100 flex items-center justify-center border border-base-content/10 shadow-sm group-hover:scale-105 transition-transform">
                  {getTxIcon(tx.type)}
                </div>
                <div>
                  <div className="text-xs font-bold text-base-content group-hover:text-baseBlue transition-colors">
                    {tx.title}
                  </div>
                  <div className="text-[10.5px] text-base-content/60 font-mono">
                    {tx.recipientOrSender}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs font-mono font-bold text-base-content">{tx.amount}</div>
                <div className="text-[10px] text-base-content/50">{tx.timestamp}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
