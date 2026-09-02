import React from 'react';
import { useWallet } from './context/WalletContext';
import { Header } from './components/Header';
import { HeroBalance } from './components/HeroBalance';
import { QuickActions } from './components/QuickActions';
import { TabNavigation } from './components/TabNavigation';
import { TokensTab } from './components/tabs/TokensTab';
import { DefiTab } from './components/tabs/DefiTab';
import { SecurityTab } from './components/tabs/SecurityTab';
import { ActivityTab } from './components/tabs/ActivityTab';
import { SettingsSheet } from './components/modals/SettingsSheet';
import { SendModal } from './components/modals/SendModal';
import { ReceiveModal } from './components/modals/ReceiveModal';
import { TxDetailModal } from './components/modals/TxDetailModal';
import { ShieldAlert } from 'lucide-react';

export const App: React.FC = () => {
  const { activeTab, isFrozen, setFrozen } = useWallet();

  return (
    <div className="min-h-screen sm:py-8 sm:px-4 flex items-center justify-center bg-[#020617] [background:radial-gradient(circle_at_50%_30%,#0F172A_0%,#020617_100%)]">
      {/* Wallet Shell Container (Exact 380px Card from Image 2) */}
      <div className="w-full max-w-[380px] h-[600px] bg-[#08090D] sm:rounded-[24px] border border-white/10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9),0_0_50px_rgba(0,82,255,0.18)] flex flex-col relative overflow-hidden">
        {/* Top Header */}
        <Header />

        {/* Emergency Freeze Alert Banner */}
        {isFrozen && (
          <div className="bg-[#F43F5E]/15 border-b border-[#F43F5E]/30 text-[#FDA4AF] px-3.5 py-2 text-xs font-semibold flex items-center justify-between animate-in slide-in-from-top duration-200">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-[#F43F5E] animate-bounce" />
              <span>FREEZE ACTIVE: 2-of-2 Quorum</span>
            </div>
            <button
              onClick={() => setFrozen(false)}
              className="underline font-bold text-xs hover:text-white"
            >
              Unfreeze
            </button>
          </div>
        )}

        {/* Scrollable Main Area */}
        <main className="flex-1 overflow-y-auto flex flex-col no-scrollbar">
          <HeroBalance />
          <QuickActions />
          <TabNavigation />

          {/* Active Tab Pane */}
          <div className="flex-1">
            {activeTab === 'tokens' && <TokensTab />}
            {activeTab === 'defi' && <DefiTab />}
            {activeTab === 'security' && <SecurityTab />}
            {activeTab === 'activity' && <ActivityTab />}
          </div>
        </main>

        {/* Enclave Footer (Exact from Image 2) */}
        <footer className="px-3.5 py-2.5 bg-[#08090D] border-t border-white/[0.06] flex items-center justify-between text-[10.5px] text-[#475569] font-medium select-none">
          <div className="flex items-center gap-1.5 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
            <span>Enclave v0.7 · RIP-7212</span>
          </div>
          <span className="text-[#64748B] font-semibold tracking-wide">Haptix Labs</span>
        </footer>

        {/* Floating Modals & Slide-over Sheets */}
        <SettingsSheet />
        <SendModal />
        <ReceiveModal />
        <TxDetailModal />
      </div>
    </div>
  );
};
export default App;
