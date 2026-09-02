import React from 'react';
import { useWallet } from '../../context/WalletContext';
import { useTheme } from '../../context/ThemeContext';
import { Settings, X, Moon, Sun, Trash2, RotateCcw } from 'lucide-react';

export const SettingsSheet: React.FC = () => {
  const { activeModal, setActiveModal } = useWallet();
  const { toggleTheme, isDark } = useTheme();

  if (activeModal !== 'settings') return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-h-[90vh] overflow-y-auto bg-base-100 rounded-t-2xl border-t border-base-content/10 shadow-2xl p-4 flex flex-col gap-3.5 animate-in slide-in-from-bottom duration-250">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-base-content/10">
          <div className="flex items-center gap-2 text-sm font-bold text-base-content">
            <Settings className="w-4 h-4 text-baseBlue" />
            <span>Wallet Settings</span>
          </div>
          <button
            onClick={() => setActiveModal(null)}
            className="btn btn-xs btn-circle btn-ghost text-base-content/70 hover:text-base-content"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Section 1: Appearance & Theme */}
        <div className="p-3 rounded-xl bg-base-200/80 border border-base-content/10 flex flex-col gap-2">
          <div className="text-xs font-bold text-base-content/70 uppercase tracking-wide">
            Appearance &amp; Theme
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-base-300 flex items-center justify-center text-sm">
                {isDark ? <Moon className="w-4 h-4 text-info" /> : <Sun className="w-4 h-4 text-warning" />}
              </div>
              <div>
                <div className="text-xs font-bold text-base-content">
                  {isDark ? 'Dark Obsidian' : 'Crisp Light'}
                </div>
                <div className="text-[11px] text-base-content/60">
                  {isDark ? 'Switch to Crisp Light theme' : 'Switch to Dark Obsidian theme'}
                </div>
              </div>
            </div>
            {/* DaisyUI Toggle */}
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-sm"
              checked={!isDark}
              onChange={toggleTheme}
            />
          </div>
        </div>

        {/* Section 2: Connected DApps */}
        <div className="p-3 rounded-xl bg-base-200/80 border border-base-content/10 flex flex-col gap-2">
          <div className="text-xs font-bold text-base-content/70 uppercase tracking-wide">
            Connected DApps
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-base-100 border border-base-content/10">
            <span className="text-xs font-mono text-base-content/80">http://localhost:57547</span>
            <button
              onClick={() => alert('Origin access revoked.')}
              className="btn btn-xs btn-error btn-outline"
            >
              Revoke
            </button>
          </div>
        </div>

        {/* Section 3: Network & RPC Infrastructure */}
        <div className="p-3 rounded-xl bg-base-200/80 border border-base-content/10 flex flex-col gap-2">
          <div className="text-xs font-bold text-base-content/70 uppercase tracking-wide">
            Network &amp; RPC Infrastructure
          </div>
          <div className="flex flex-col gap-1.5 text-xs">
            <div className="flex justify-between py-1 border-b border-base-content/5">
              <span className="text-base-content/60">Network:</span>
              <strong className="text-base-content font-mono">Base Sepolia (84532)</strong>
            </div>
            <div className="flex justify-between py-1 border-b border-base-content/5">
              <span className="text-base-content/60">EntryPoint:</span>
              <span className="font-mono text-base-content/90 text-[11px]">v0.7 (Canonical)</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-base-content/60">RIP-7212 Precompile:</span>
              <span className="text-success font-semibold text-[11px] font-mono">Active (0x100)</span>
            </div>
          </div>
        </div>

        {/* Section 4: Maintenance & Diagnostics */}
        <div className="p-3 rounded-xl bg-base-200/80 border border-base-content/10 flex flex-col gap-2">
          <div className="text-xs font-bold text-base-content/70 uppercase tracking-wide">
            Maintenance &amp; Diagnostics
          </div>
          <button
            onClick={() => alert('Pending UserOps queue cleared.')}
            className="btn btn-sm btn-outline gap-2 w-full text-xs"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Clear Pending Approval Queue</span>
          </button>
          <button
            onClick={() => {
              if (window.confirm('Reset local extension cache and reload?')) {
                localStorage.clear();
                window.location.reload();
              }
            }}
            className="btn btn-sm btn-error text-white gap-2 w-full text-xs shadow-sm"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Reset Local Extension Cache</span>
          </button>
        </div>
      </div>
    </div>
  );
};
