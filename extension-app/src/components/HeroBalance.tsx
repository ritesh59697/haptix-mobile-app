import React from 'react';
import { useWallet } from '../context/WalletContext';
import { TrendingUp, Zap } from 'lucide-react';

export const HeroBalance: React.FC = () => {
  const { balanceEth, balanceUsd } = useWallet();

  return (
    <section className="px-4 pt-4 pb-3 flex flex-col items-center text-center">
      <div className="flex items-center gap-1.5 text-xs font-medium text-base-content/60 mb-1">
        <span>Smart Account Net Worth</span>
        <span className="flex items-center gap-1 text-[10px] text-success font-semibold px-1.5 py-0.2 rounded-full bg-success/10">
          <TrendingUp className="w-2.5 h-2.5" /> +3.4%
        </span>
      </div>

      <div className="text-3xl font-extrabold tracking-tight font-heading text-base-content my-0.5">
        {balanceEth}
      </div>

      <div className="flex items-center gap-2 text-xs text-base-content/60">
        <span>{balanceUsd}</span>
        <span>•</span>
        <span className="flex items-center gap-0.5 text-baseBlue font-mono text-[11px]">
          <Zap className="w-3 h-3 text-baseBlue" /> Base Sepolia
        </span>
      </div>
    </section>
  );
};
