import React from 'react';
import { useWallet } from '../../context/WalletContext';
import { KeyRound, Shield, Bot, Plus, CheckCircle2 } from 'lucide-react';

export const SecurityTab: React.FC = () => {
  const { credentials } = useWallet();

  return (
    <div className="flex flex-col gap-3 p-3.5">
      {/* WebAuthn Hardware Keys */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-bold text-base-content/70 tracking-wide uppercase flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 text-secondary" />
            <span>Hardware Passkeys</span>
          </span>
          <button
            onClick={() => alert('Connect another biometric device via WebAuthn')}
            className="text-xs font-semibold text-baseBlue hover:underline flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add Device
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {credentials.map((cred) => (
            <div
              key={cred.id}
              className="p-3 rounded-xl bg-base-200/80 border border-base-content/10 shadow-sm flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-success" />
                  <span className="text-xs font-bold text-base-content">{cred.name}</span>
                </div>
                <span className="badge badge-xs badge-info font-mono text-[9px]">P-256 Enclave</span>
              </div>
              <div className="text-[11px] text-base-content/60">{cred.algorithm}</div>
              <div className="text-[10px] text-base-content/40 font-mono">Last used: {cred.lastUsed}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Policy Firewall Rules */}
      <div className="p-3 rounded-xl bg-base-200/80 border border-base-content/10 shadow-sm flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold text-base-content">
            <Shield className="w-4 h-4 text-warning" />
            <span>Policy Firewall Rules</span>
          </div>
          <span className="badge badge-xs badge-warning font-mono text-[9px]">Strict</span>
        </div>

        <div className="flex flex-col gap-1.5 text-xs">
          <div className="flex justify-between py-1 border-b border-base-content/5">
            <span className="text-base-content/60">Single-Sig Threshold:</span>
            <strong className="text-secondary font-mono">&lt; 0.010 ETH</strong>
          </div>
          <div className="flex justify-between py-1 border-b border-base-content/5">
            <span className="text-base-content/60">Address Whitelist:</span>
            <span className="text-success font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Active
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-base-content/60">Approval Escalation:</span>
            <strong className="text-warning font-mono">2-of-2 Quorum</strong>
          </div>
        </div>
      </div>

      {/* AI Agent Session Management */}
      <div className="p-3 rounded-xl bg-base-200/80 border border-base-content/10 shadow-sm flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold text-base-content">
            <Bot className="w-4 h-4 text-secondary" />
            <span>AI Agent Session Keys</span>
          </div>
          <span className="badge badge-xs badge-success font-mono text-[9px]">Scoped</span>
        </div>
        <div className="text-xs text-base-content/70 leading-relaxed">
          AI agents execute atomic swaps with daily spending allowances ($50/day max) without ever accessing your master private key.
        </div>
      </div>
    </div>
  );
};
