import React from 'react';
import { useWallet } from '../context/WalletContext';
import { ArrowUpRight, ArrowDown, Lock, Loader2 } from 'lucide-react';

export const QuickActions: React.FC = () => {
  const { setActiveModal, setActiveTab, isFrozen, setFrozen } = useWallet();

  return (
    <div className="grid grid-cols-4 gap-2 px-4 pt-2 pb-4">
      {/* Send Button */}
      <button
        onClick={() => setActiveModal('send')}
        className="flex flex-col items-center gap-1.5 group active:scale-95 transition-transform"
      >
        <div className="w-[46px] h-[46px] rounded-[14px] bg-gradient-to-b from-white/[0.09] to-white/[0.03] hover:from-white/[0.15] hover:to-white/[0.06] border border-white/[0.12] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_3px_8px_rgba(0,0,0,0.3)] flex items-center justify-center text-white/90 group-hover:text-white transition-all">
          <ArrowUpRight className="w-5 h-5 text-white/80 group-hover:text-white transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </div>
        <span className="text-[11px] font-semibold text-[#94A3B8] group-hover:text-white transition-colors">
          Send
        </span>
      </button>

      {/* Receive Button */}
      <button
        onClick={() => setActiveModal('receive')}
        className="flex flex-col items-center gap-1.5 group active:scale-95 transition-transform"
      >
        <div className="w-[46px] h-[46px] rounded-[14px] bg-gradient-to-b from-white/[0.09] to-white/[0.03] hover:from-white/[0.15] hover:to-white/[0.06] border border-white/[0.12] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_3px_8px_rgba(0,0,0,0.3)] flex items-center justify-center text-white/90 group-hover:text-white transition-all">
          <ArrowDown className="w-5 h-5 text-white/80 group-hover:text-white transition-transform group-hover:translate-y-0.5" />
        </div>
        <span className="text-[11px] font-semibold text-[#94A3B8] group-hover:text-white transition-colors">
          Receive
        </span>
      </button>

      {/* AI Agents Button (Exact Cyan Specular Squircle from Image 2) */}
      <button
        onClick={() => setActiveTab('security')}
        className="flex flex-col items-center gap-1.5 group active:scale-95 transition-transform"
      >
        <div className="w-[46px] h-[46px] rounded-[14px] bg-gradient-to-b from-[#0052FF]/20 to-[#0052FF]/05 hover:from-[#0052FF]/30 hover:to-[#0052FF]/10 border border-[#0052FF]/40 shadow-[inset_0_1px_0_0_rgba(56,189,248,0.3),0_3px_10px_rgba(0,82,255,0.25)] flex items-center justify-center text-[#38BDF8] transition-all">
          <Loader2 className="w-5 h-5 text-[#38BDF8] animate-[spin_8s_linear_infinite]" />
        </div>
        <span className="text-[11px] font-semibold text-[#38BDF8] group-hover:text-[#7DD3FC] transition-colors">
          AI Agents
        </span>
      </button>

      {/* Freeze Button (Exact Red/Ruby Border Squircle from Image 2) */}
      <button
        onClick={() => setFrozen(!isFrozen)}
        className="flex flex-col items-center gap-1.5 group active:scale-95 transition-transform"
      >
        <div
          className={`w-[46px] h-[46px] rounded-[14px] flex items-center justify-center transition-all ${
            isFrozen
              ? 'bg-[#F43F5E] text-white shadow-[0_0_15px_rgba(244,63,94,0.6)]'
              : 'bg-gradient-to-b from-[#F43F5E]/20 to-[#F43F5E]/05 hover:from-[#F43F5E]/30 hover:to-[#F43F5E]/10 border border-[#F43F5E]/40 shadow-[inset_0_1px_0_0_rgba(244,63,94,0.3),0_3px_10px_rgba(244,63,94,0.2)] text-[#FDA4AF]'
          }`}
        >
          <Lock className="w-5 h-5" />
        </div>
        <span
          className={`text-[11px] font-semibold transition-colors ${
            isFrozen ? 'text-[#F43F5E] font-bold' : 'text-[#FDA4AF] group-hover:text-[#FFE4E6]'
          }`}
        >
          {isFrozen ? 'Frozen' : 'Freeze'}
        </span>
      </button>
    </div>
  );
};
