import React from 'react';
import { useWallet } from '../context/WalletContext';


export const TabNavigation: React.FC = () => {
  const { activeTab, setActiveTab } = useWallet();

  const tabs = [
    { id: 'tokens', label: 'Tokens' },
    { id: 'defi', label: 'AI Agents' },
    { id: 'security', label: 'Security' },
    { id: 'activity', label: 'Activity' },
  ] as const;

  return (
    <div className="px-3.5 pt-1 pb-2">
      <div className="flex items-center p-[3px] rounded-xl bg-white/[0.04] border border-white/[0.07] gap-0.5">
        {tabs.map((t) => {
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 py-1.5 px-2 rounded-[9px] text-[11.5px] font-semibold transition-all select-none text-center ${
                isActive
                  ? 'bg-gradient-to-b from-white/[0.12] to-white/[0.06] border border-white/[0.18] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2),0_2px_6px_rgba(0,0,0,0.4)] text-white font-bold'
                  : 'text-[#64748B] hover:text-[#CBD5E1] hover:bg-white/[0.03]'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
