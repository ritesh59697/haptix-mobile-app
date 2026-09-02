import React from 'react';
import { useWallet } from '../context/WalletContext';
import { Coins, Layers, ShieldCheck, History } from 'lucide-react';

export const TabNavigation: React.FC = () => {
  const { activeTab, setActiveTab, transactions } = useWallet();

  const tabs = [
    { id: 'tokens', label: 'Tokens', icon: Coins },
    { id: 'defi', label: 'DeFi', icon: Layers },
    { id: 'security', label: 'Security', icon: ShieldCheck },
    { id: 'activity', label: 'Activity', icon: History, badge: transactions.length },
  ] as const;

  return (
    <div className="px-3.5 pt-2 pb-1">
      <div className="flex items-center p-1 rounded-xl bg-base-200/70 border border-base-content/10">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                isActive
                  ? 'bg-base-100 text-baseBlue shadow-sm font-bold border border-base-content/10'
                  : 'text-base-content/60 hover:text-base-content hover:bg-base-300/40'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-baseBlue' : 'text-base-content/60'}`} />
              <span>{t.label}</span>
              {'badge' in t && t.badge !== undefined && (
                <span className="badge badge-xs font-mono text-[9px] bg-base-300 text-base-content/70 border-none px-1">
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
