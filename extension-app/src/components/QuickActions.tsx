import React from 'react';
import { useWallet } from '../context/WalletContext';
import { ArrowUpRight, ArrowDownLeft, Bot, Shield, ShieldAlert } from 'lucide-react';

export const QuickActions: React.FC = () => {
  const { setActiveModal, setActiveTab, isFrozen, setFrozen } = useWallet();

  return (
    <div className="grid grid-cols-4 gap-2 px-4 py-2">
      {/* Send Button */}
      <button
        onClick={() => setActiveModal('send')}
        className="flex flex-col items-center gap-1.5 group active:scale-95 transition-transform"
      >
        <div className="w-11 h-11 rounded-2xl bg-base-200/90 hover:bg-base-300 border border-base-content/10 flex items-center justify-center text-base-content/90 group-hover:text-baseBlue group-hover:border-baseBlue/30 shadow-sm transition-all">
          <ArrowUpRight className="w-5 h-5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </div>
        <span className="text-[11px] font-semibold text-base-content/70 group-hover:text-base-content">
          Send
        </span>
      </button>

      {/* Receive Button */}
      <button
        onClick={() => setActiveModal('receive')}
        className="flex flex-col items-center gap-1.5 group active:scale-95 transition-transform"
      >
        <div className="w-11 h-11 rounded-2xl bg-base-200/90 hover:bg-base-300 border border-base-content/10 flex items-center justify-center text-base-content/90 group-hover:text-baseBlue group-hover:border-baseBlue/30 shadow-sm transition-all">
          <ArrowDownLeft className="w-5 h-5 transition-transform group-hover:translate-y-0.5 group-hover:-translate-x-0.5" />
        </div>
        <span className="text-[11px] font-semibold text-base-content/70 group-hover:text-base-content">
          Receive
        </span>
      </button>

      {/* AI Agents Button */}
      <button
        onClick={() => setActiveTab('security')}
        className="flex flex-col items-center gap-1.5 group active:scale-95 transition-transform"
      >
        <div className="w-11 h-11 rounded-2xl bg-base-200/90 hover:bg-base-300 border border-base-content/10 flex items-center justify-center text-base-content/90 group-hover:text-secondary group-hover:border-secondary/30 shadow-sm transition-all">
          <Bot className="w-5 h-5 text-secondary transition-transform group-hover:scale-110" />
        </div>
        <span className="text-[11px] font-semibold text-base-content/70 group-hover:text-base-content">
          AI Agents
        </span>
      </button>

      {/* Freeze / Lockdown Button */}
      <button
        onClick={() => setFrozen(!isFrozen)}
        className="flex flex-col items-center gap-1.5 group active:scale-95 transition-transform"
      >
        <div
          className={`w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm transition-all ${
            isFrozen
              ? 'bg-error text-white border border-error'
              : 'bg-base-200/90 hover:bg-base-300 border border-base-content/10 text-base-content/90 group-hover:text-error group-hover:border-error/30'
          }`}
        >
          {isFrozen ? (
            <ShieldAlert className="w-5 h-5 text-white animate-pulse" />
          ) : (
            <Shield className="w-5 h-5 transition-transform group-hover:scale-110" />
          )}
        </div>
        <span
          className={`text-[11px] font-semibold ${
            isFrozen ? 'text-error font-bold' : 'text-base-content/70 group-hover:text-base-content'
          }`}
        >
          {isFrozen ? 'Frozen' : 'Freeze'}
        </span>
      </button>
    </div>
  );
};
