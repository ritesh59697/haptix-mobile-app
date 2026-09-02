import React from 'react';
import { useWallet } from '../../context/WalletContext';

export const TokensTab: React.FC = () => {
  const { tokens } = useWallet();

  return (
    <div className="flex flex-col gap-2 px-3.5 pt-1 pb-3">
      {tokens.map((token) => (
        <div
          key={token.symbol}
          className="flex items-center justify-between p-3.5 rounded-[14px] bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] shadow-[0_2px_8px_rgba(0,0,0,0.3)] transition-all cursor-pointer group select-none"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[#0052FF]/15 border border-[#0052FF]/30 flex items-center justify-center font-bold text-white shadow-sm flex-shrink-0">
              {token.symbol === 'ETH' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L4 12.5L12 17L20 12.5L12 2Z" fill="#38BDF8" fillOpacity="0.8" />
                  <path d="M12 17L4 12.5L12 22L20 12.5L12 17Z" fill="#0052FF" />
                </svg>
              ) : token.symbol === 'USDC' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="#2775CA" strokeWidth="2" fill="#2775CA" fillOpacity="0.2" />
                  <path d="M12 7v10M14 9.5c0-.8-.7-1.5-2-1.5s-2 .7-2 1.5c0 2 4 1.5 4 3.5 0 .8-.7 1.5-2 1.5s-2-.7-2-1.5" stroke="#38BDF8" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              ) : (
                <span className="font-mono text-xs font-bold text-[#10B981]">{token.symbol}</span>
              )}
            </div>
            <div>
              <div className="text-[13.5px] font-bold text-white group-hover:text-[#38BDF8] transition-colors leading-tight">
                {token.name.split(' (')[0]}
              </div>
              <div className="text-[11px] text-[#64748B] font-medium mt-0.5">
                {token.symbol === 'ETH' ? 'ETH · Base Sepolia' : token.symbol === 'USDC' ? 'USDC · Circle' : 'Wrapped · Staked'}
              </div>
            </div>
          </div>

          <div className="text-right">
            <div className="text-[13px] font-bold font-mono text-white leading-tight">
              {token.balance}
            </div>
            <div className="text-[11px] font-mono text-[#64748B] mt-0.5">
              ≈ {token.fiatValue} USD
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
