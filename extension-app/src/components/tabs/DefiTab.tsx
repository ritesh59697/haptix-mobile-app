import React from 'react';
import { useWallet } from '../../context/WalletContext';
import { ArrowUpRight } from 'lucide-react';

export const DefiTab: React.FC = () => {
  const { defiVaults } = useWallet();

  return (
    <div className="flex flex-col gap-2.5 p-3.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-bold text-base-content/70 tracking-wide uppercase">
          Base Yield Vaults
        </span>
        <span className="badge badge-sm badge-info font-mono text-[10px]">ERC-4337 Batch</span>
      </div>

      <div className="flex flex-col gap-2">
        {defiVaults.map((vault) => (
          <div
            key={vault.id}
            className="p-3 rounded-xl bg-base-200/80 hover:bg-base-200 border border-base-content/10 shadow-sm flex flex-col gap-2 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-base-content group-hover:text-baseBlue transition-colors">
                  {vault.name}
                </div>
                <div className="text-xs text-base-content/60">{vault.protocol}</div>
              </div>
              <div className="badge badge-success badge-sm font-bold font-mono text-white">
                {vault.apy}
              </div>
            </div>

            <div className="divider my-0 border-base-content/5" />

            <div className="flex items-center justify-between text-xs">
              <div className="text-base-content/60">
                TVL: <strong className="text-base-content font-mono">{vault.tvl}</strong>
              </div>
              <button className="btn btn-xs btn-primary gap-1 shadow-sm">
                <span>Deposit</span>
                <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
