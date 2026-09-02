import React, { useState, useRef, useEffect } from 'react';
import { useWallet } from '../context/WalletContext';
import { useTheme } from '../context/ThemeContext';
import { 
  Copy, 
  ExternalLink, 
  KeyRound, 
  ShieldAlert, 
  Maximize2, 
  Settings, 
  Sun, 
  Moon, 
  Lock, 
  ChevronDown,
  Check
} from 'lucide-react';

export const OptionsMenu: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { account, copyAddress, copied, setActiveTab, setActiveModal, setFrozen } = useWallet();
  const { toggleTheme, isDark } = useTheme();

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handlePanicFreeze = () => {
    setIsOpen(false);
    const confirmLock = window.confirm(
      '🚨 EMERGENCY PANIC FREEZE:\n\nLock down this smart account immediately?\nSingle-sig Touch ID and agent sessions will be blocked until 2-of-2 Quorum unfreeze.'
    );
    if (!confirmLock) return;
    setFrozen(true);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ isFrozen: true });
    }
    alert('🚨 ACCOUNT FROZEN: Emergency 1-Sig Lock active.');
  };

  const handleExpandDesktop = () => {
    setIsOpen(false);
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime) {
        chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
        return;
      }
    } catch (e) {}
    window.open(window.location.href, '_blank');
  };

  return (
    <div className="relative" ref={menuRef}>
      {/* Options ▾ Button (DaisyUI style) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="btn btn-xs sm:btn-sm bg-base-200/80 hover:bg-base-300 border border-base-content/10 shadow-sm text-xs font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-all active:scale-95"
      >
        <span>Options</span>
        <ChevronDown className={`w-3.5 h-3.5 text-base-content/60 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Floating Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-56 p-1.5 rounded-xl bg-base-200/95 backdrop-blur-xl border border-base-content/10 shadow-2xl z-50 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-150">
          {/* Copy Address */}
          <button
            onClick={() => {
              copyAddress();
              setTimeout(() => setIsOpen(false), 300);
            }}
            className="flex items-center justify-between w-full px-2.5 py-2 rounded-lg text-xs font-medium text-base-content/80 hover:text-base-content hover:bg-base-300/80 transition-colors"
          >
            <div className="flex items-center gap-2">
              {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5 text-base-content/60" />}
              <span>{copied ? 'Address Copied!' : 'Copy Address'}</span>
            </div>
            <span className="badge badge-sm font-mono text-[10px] bg-base-100 border-base-content/10">
              {account.slice(0, 6)}
            </span>
          </button>

          {/* View on BaseScan */}
          <a
            href={`https://sepolia.basescan.org/address/${account}`}
            target="_blank"
            rel="noreferrer"
            onClick={() => setIsOpen(false)}
            className="flex items-center justify-between w-full px-2.5 py-2 rounded-lg text-xs font-medium text-base-content/80 hover:text-base-content hover:bg-base-300/80 transition-colors"
          >
            <div className="flex items-center gap-2">
              <ExternalLink className="w-3.5 h-3.5 text-base-content/60" />
              <span>View on BaseScan</span>
            </div>
            <span className="text-[10px] text-base-content/40 font-mono">↗</span>
          </a>

          {/* Passkey Hardware Keys */}
          <button
            onClick={() => {
              setActiveTab('security');
              setIsOpen(false);
            }}
            className="flex items-center justify-between w-full px-2.5 py-2 rounded-lg text-xs font-medium text-base-content/80 hover:text-base-content hover:bg-base-300/80 transition-colors"
          >
            <div className="flex items-center gap-2">
              <KeyRound className="w-3.5 h-3.5 text-secondary" />
              <span>Passkey Hardware Keys</span>
            </div>
            <span className="badge badge-xs badge-info font-mono text-[9px]">P-256</span>
          </button>

          {/* Policy Firewall */}
          <button
            onClick={() => {
              setActiveTab('security');
              setIsOpen(false);
            }}
            className="flex items-center justify-between w-full px-2.5 py-2 rounded-lg text-xs font-medium text-base-content/80 hover:text-base-content hover:bg-base-300/80 transition-colors"
          >
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5 text-warning" />
              <span>Policy Firewall</span>
            </div>
            <span className="badge badge-xs badge-ghost font-mono text-[9px]">Strict</span>
          </button>

          {/* Expand Desktop Mode */}
          <button
            onClick={handleExpandDesktop}
            className="flex items-center justify-between w-full px-2.5 py-2 rounded-lg text-xs font-medium text-base-content/80 hover:text-base-content hover:bg-base-300/80 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Maximize2 className="w-3.5 h-3.5 text-base-content/60" />
              <span>Expand Desktop Mode</span>
            </div>
          </button>

          {/* Toggle Theme */}
          <button
            onClick={() => {
              toggleTheme();
              setIsOpen(false);
            }}
            className="flex items-center justify-between w-full px-2.5 py-2 rounded-lg text-xs font-medium text-base-content/80 hover:text-base-content hover:bg-base-300/80 transition-colors"
          >
            <div className="flex items-center gap-2">
              {isDark ? <Sun className="w-3.5 h-3.5 text-warning" /> : <Moon className="w-3.5 h-3.5 text-info" />}
              <span>Theme: <strong>{isDark ? 'Dark' : 'Light'}</strong></span>
            </div>
            <span className="badge badge-xs bg-base-100 border-base-content/10 text-[9px]">
              {isDark ? 'Light ☀️' : 'Dark 🌙'}
            </span>
          </button>

          {/* Wallet Preferences / Settings */}
          <button
            onClick={() => {
              setActiveModal('settings');
              setIsOpen(false);
            }}
            className="flex items-center justify-between w-full px-2.5 py-2 rounded-lg text-xs font-medium text-base-content/80 hover:text-base-content hover:bg-base-300/80 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-3.5 h-3.5 text-base-content/60" />
              <span>Wallet Preferences</span>
            </div>
          </button>

          <div className="divider my-1 border-base-content/10 h-0" />

          {/* Emergency Panic Lock */}
          <button
            onClick={handlePanicFreeze}
            className="flex items-center justify-between w-full px-2.5 py-2 rounded-lg text-xs font-semibold text-error hover:bg-error/10 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-error" />
              <span>Emergency Panic Lock</span>
            </div>
            <span className="badge badge-xs badge-error text-[9px] font-mono text-white">1-Sig</span>
          </button>
        </div>
      )}
    </div>
  );
};
