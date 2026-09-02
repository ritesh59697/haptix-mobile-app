import React from 'react';
import { useWallet } from '../../context/WalletContext';
import { TrendingUp, Plus } from 'lucide-react';

export const TokensTab: React.FC = () => {
  const { tokens, setActiveModal } = useWallet();

  return (
    <div className="flex flex-col gap-2 p-3.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-bold text-base-content/70 tracking-wide uppercase">
          Your Assets
        </span>
        <button
          onClick={() => setActiveModal('receive')}
          className="text-xs font-semibold text-baseBlue hover:underline flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Deposit
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {tokens.map((token) => (
          <div
            key={token.symbol}
            className="flex items-center justify-between p-3 rounded-xl bg-base-200/80 hover:bg-base-200 border border-base-content/10 shadow-sm transition-all cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white shadow-sm"
                style={{ backgroundColor: token.iconBg }}
              >
                {token.iconText}
              </div>
              <div>
                <div className="text-sm font-bold text-base-content group-hover:text-baseBlue transition-colors">
                  {token.name}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-base-content/60">
                  <span className="font-mono">{token.balance}</span>
                  <span className="text-[10px] text-success flex items-center gap-0.5">
                    <TrendingUp className="w-2.5 h-2.5" /> {token.change24h}
                  </span>
                </div>
              </div>
            </div>

            <div className="text-right font-mono text-sm font-bold text-base-content">
              {token.fiatValue}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
