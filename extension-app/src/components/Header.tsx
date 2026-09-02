import React from 'react';
import { useWallet } from '../context/WalletContext';
import { OptionsMenu } from './OptionsMenu';
import { PanelRight, Copy, Check } from 'lucide-react';

export const Header: React.FC = () => {
  const { shortAccount, copyAddress, copied } = useWallet();

  const handleOpenSidePanel = () => {
    try {
      if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.open) {
        chrome.windows.getCurrent((w) => {
          if (w && w.id) chrome.sidePanel.open({ windowId: w.id });
        });
        return;
      }
    } catch (e) {}
    alert('Side panel is available in Chrome Side Panel view.');
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between px-3 py-2.5 bg-[#10121A]/85 backdrop-blur-xl border-b border-white/[0.08]">
      {/* Brand & Account Chip */}
      <div className="flex items-center gap-2">
        {/* Haptix Icon */}
        <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
            <defs>
              <linearGradient id="reactHdrLeft" x1="0%" y1="0%" x2="50%" y2="100%">
                <stop offset="0%" stopColor="#EC4899" />
                <stop offset="40%" stopColor="#D946EF" />
                <stop offset="100%" stopColor="#3B82F6" />
              </linearGradient>
              <linearGradient id="reactHdrRight" x1="50%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#C084FC" />
                <stop offset="60%" stopColor="#0052FF" />
                <stop offset="100%" stopColor="#06B6D4" />
              </linearGradient>
            </defs>
            <path
              d="M4 8C4 5.24 6.24 3 9 3H10C11.1 3 12 3.9 12 5V12.2L16.2 14.6L12 16.8V27C12 28.1 11.1 29 10 29H9C6.24 29 4 26.76 4 24V8Z"
              fill="url(#reactHdrLeft)"
            />
            <path
              d="M28 24C28 26.76 25.76 29 23 29H22C20.9 29 20 28.1 20 27V19.8L15.8 17.4L20 15.2V5C20 3.9 20.9 3 22 3H23C25.76 3 28 5.24 28 8V24Z"
              fill="url(#reactHdrRight)"
            />
          </svg>
        </div>

        {/* Account Pill */}
        <button
          onClick={copyAddress}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-[11px] font-mono font-medium text-[#E2E8F0] transition-all active:scale-95"
          title="Click to copy address"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
          <span>{shortAccount}</span>
          {copied ? (
            <Check className="w-3 h-3 text-[#10B981]" />
          ) : (
            <Copy className="w-3 h-3 text-[#94A3B8]" />
          )}
        </button>
      </div>

      {/* Header Right Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Network Badge - No Wrap, exact pill from Image 2 */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0052FF]/15 border border-[#0052FF]/30 text-[#38BDF8] text-[11px] font-semibold whitespace-nowrap flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-[#0052FF]" />
          <span>Base Sepolia</span>
        </div>

        {/* Sidepanel Button */}
        <button
          onClick={handleOpenSidePanel}
          className="w-7 h-7 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 flex items-center justify-center text-[#94A3B8] hover:text-white transition-all active:scale-95 flex-shrink-0"
          title="Open Side Panel"
        >
          <PanelRight className="w-3.5 h-3.5" />
        </button>

        {/* Options Dropdown */}
        <OptionsMenu />
      </div>
    </header>
  );
};
