import React from 'react';
import { useWallet } from '../../context/WalletContext';
import { X, ExternalLink, CheckCircle2 } from 'lucide-react';

export const TxDetailModal: React.FC = () => {
  const { activeModal, setActiveModal, selectedTx, account } = useWallet();

  if (activeModal !== 'txDetails' || !selectedTx) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-h-[90vh] overflow-y-auto bg-base-100 rounded-t-2xl border-t border-base-content/10 shadow-2xl p-4 flex flex-col gap-3 animate-in slide-in-from-bottom duration-250">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-base-content/10">
          <div className="text-sm font-bold text-base-content">Transaction Details</div>
          <button
            onClick={() => setActiveModal(null)}
            className="btn btn-xs btn-circle btn-ghost text-base-content/70 hover:text-base-content"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Transaction Summary Box */}
        <div className="p-3.5 rounded-xl bg-base-200/80 border border-base-content/10 flex flex-col items-center text-center gap-1">
          <div className="text-xl font-extrabold font-mono text-base-content">
            {selectedTx.amount}
          </div>
          <div className="text-xs text-base-content/60">{selectedTx.fiat}</div>
          <div className="badge badge-success badge-sm font-semibold gap-1 mt-1 text-white">
            <CheckCircle2 className="w-3 h-3" />
            <span>{selectedTx.status}</span>
          </div>
        </div>

        {/* Key-Value Breakdown */}
        <div className="flex flex-col gap-1.5 text-xs p-3 rounded-xl bg-base-200/60 border border-base-content/10">
          <div className="flex justify-between py-1 border-b border-base-content/5">
            <span className="text-base-content/60">Type:</span>
            <span className="font-semibold text-base-content">{selectedTx.title}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-base-content/5">
            <span className="text-base-content/60">Timestamp:</span>
            <span className="text-base-content/80">{selectedTx.timestamp}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-base-content/5">
            <span className="text-base-content/60">Target:</span>
            <span className="font-mono text-base-content/90 text-[11px]">{selectedTx.recipientOrSender}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-base-content/60">UserOp Hash:</span>
            <span className="font-mono text-base-content/90 text-[11px]">{selectedTx.hash}</span>
          </div>
        </div>

        {/* View on BaseScan External Link */}
        <a
          href={`https://sepolia.basescan.org/address/${account}`}
          target="_blank"
          rel="noreferrer"
          className="btn btn-outline btn-sm gap-2 w-full text-xs"
        >
          <span>View on BaseScan Explorer</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
};
