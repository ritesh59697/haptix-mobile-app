import React from 'react';
import { useWallet } from '../context/WalletContext';


export const HeroBalance: React.FC = () => {
  const { balanceEth, balanceUsd } = useWallet();

  return (
    <section className="px-4 pt-5 pb-3 flex flex-col items-center text-center">
      <div className="text-[10.5px] font-semibold tracking-[0.08em] uppercase text-[#64748B] mb-1">
        Smart Account Net Worth
      </div>

      <div className="text-[34px] font-extrabold tracking-tight font-heading text-white leading-none my-1">
        {balanceEth}
      </div>

      <div className="text-[13px] font-medium text-[#94A3B8] tracking-wide">
        {balanceUsd}
      </div>
    </section>
  );
};
