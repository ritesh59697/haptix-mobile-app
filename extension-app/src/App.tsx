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
import { ShieldAlert, ShieldCheck } from 'lucide-react';

export const App: React.FC = () => {
  const { activeTab, isFrozen, setFrozen } = useWallet();

  return (
    <div className="min-h-screen sm:py-6 sm:px-4 flex items-center justify-center bg-base-300/40">
      {/* Wallet Shell Container (Framed 380px Card) */}
      <div className="w-full max-w-[400px] min-h-[600px] bg-base-100 sm:rounded-3xl border border-base-content/10 shadow-2xl flex flex-col relative overflow-hidden">
        {/* Top Header */}
        <Header />

        {/* Emergency Freeze Alert Banner */}
        {isFrozen && (
          <div className="bg-error text-white px-3.5 py-2 text-xs font-semibold flex items-center justify-between animate-in slide-in-from-top duration-200">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-white animate-bounce" />
              <span>FREEZE ACTIVE: 2-of-2 Quorum</span>
            </div>
            <button
              onClick={() => setFrozen(false)}
              className="underline font-bold text-xs hover:text-white/80"
            >
              Unfreeze
            </button>
          </div>
        )}

        {/* Scrollable Main Area */}
        <main className="flex-1 overflow-y-auto flex flex-col pb-4">
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

        {/* Security Enclave Footer */}
        <footer className="px-3.5 py-2 bg-base-200/90 border-t border-base-content/10 flex items-center justify-between text-[10.5px] text-base-content/60">
          <div className="flex items-center gap-1.5 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            <span>Base Sepolia (84532)</span>
          </div>
          <div className="flex items-center gap-1 text-baseBlue font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>RIP-7212 Enclave Active</span>
          </div>
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
