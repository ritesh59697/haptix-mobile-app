import React, { useState } from 'react';
import { useWallet } from '../../context/WalletContext';
import { X, Fingerprint, Zap, ArrowRight } from 'lucide-react';

export const SendModal: React.FC = () => {
  const { activeModal, setActiveModal, balanceEth } = useWallet();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [isSigning, setIsSigning] = useState(false);

  if (activeModal !== 'send') return null;

  const handleSend = () => {
    if (!recipient || !amount) {
      alert('Please enter a recipient address and amount.');
      return;
    }
    setIsSigning(true);
    setTimeout(() => {
      setIsSigning(false);
      alert(`✓ UserOp successfully signed with Touch ID!\nTx Hash: 0x9f8c...3b11\nAmount: ${amount} ETH sent to ${recipient}`);
      setActiveModal(null);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-h-[90vh] overflow-y-auto bg-base-100 rounded-t-2xl border-t border-base-content/10 shadow-2xl p-4 flex flex-col gap-3.5 animate-in slide-in-from-bottom duration-250">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-base-content/10">
          <div className="text-sm font-bold text-base-content">Send Assets</div>
          <button
            onClick={() => setActiveModal(null)}
            className="btn btn-xs btn-circle btn-ghost text-base-content/70 hover:text-base-content"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Recipient Input */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-base-content/70">Recipient Address or ENS</label>
          <input
            type="text"
            placeholder="0x... or vitalik.eth"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="input input-sm input-bordered w-full font-mono text-xs bg-base-200/80 focus:border-baseBlue"
          />
        </div>

        {/* Amount Input */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-base-content/70">
            <span>Amount</span>
            <span className="text-[11px] font-mono text-base-content/50">
              Avail: {balanceEth}
            </span>
          </div>
          <div className="relative">
            <input
              type="text"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input input-sm input-bordered w-full font-mono text-xs bg-base-200/80 focus:border-baseBlue pr-16"
            />
            <button
              onClick={() => setAmount('0.0041')}
              className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-xs btn-ghost text-baseBlue font-mono text-[10px] px-1.5 h-6 min-h-0"
            >
              MAX
            </button>
          </div>
        </div>

        {/* Paymaster Sponsorship Pill */}
        <div className="p-2.5 rounded-xl bg-success/10 border border-success/20 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-success font-semibold">
            <Zap className="w-3.5 h-3.5" />
            <span>Gasless UserOp</span>
          </div>
          <span className="badge badge-xs badge-success text-[10px] font-bold text-white">
            Sponsored
          </span>
        </div>

        {/* Submit Button with Biometric Icon */}
        <button
          onClick={handleSend}
          disabled={isSigning}
          className="btn btn-primary w-full text-xs font-bold gap-2 text-white shadow-lg shadow-baseBlue/25 mt-1"
        >
          {isSigning ? (
            <>
              <span className="loading loading-spinner loading-xs" />
              <span>Verifying Touch ID...</span>
            </>
          ) : (
            <>
              <Fingerprint className="w-4 h-4" />
              <span>Authorize with Passkey</span>
              <ArrowRight className="w-3.5 h-3.5 ml-auto" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};
