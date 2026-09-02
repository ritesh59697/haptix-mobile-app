import React from 'react';
import { useWallet } from '../../context/WalletContext';
import { X, Copy, Check, QrCode } from 'lucide-react';

export const ReceiveModal: React.FC = () => {
  const { activeModal, setActiveModal, account, copyAddress, copied } = useWallet();

  if (activeModal !== 'receive') return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-h-[90vh] overflow-y-auto bg-base-100 rounded-t-2xl border-t border-base-content/10 shadow-2xl p-4 flex flex-col items-center gap-3.5 animate-in slide-in-from-bottom duration-250">
        {/* Header */}
        <div className="flex items-center justify-between w-full pb-2 border-b border-base-content/10">
          <div className="text-sm font-bold text-base-content">Receive on Base</div>
          <button
            onClick={() => setActiveModal(null)}
            className="btn btn-xs btn-circle btn-ghost text-base-content/70 hover:text-base-content"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* QR Code Graphic Box */}
        <div className="w-44 h-44 rounded-2xl bg-white p-3 border border-base-content/10 shadow-md flex flex-col items-center justify-center text-black my-2">
          {/* Stylized QR placeholder */}
          <div className="w-full h-full border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center gap-1.5 p-2 text-center">
            <QrCode className="w-12 h-12 text-black" />
            <span className="text-[10px] font-mono text-gray-500 break-all leading-tight">
              {account.slice(0, 10)}...{account.slice(-8)}
            </span>
          </div>
        </div>

        <div className="text-center">
          <div className="text-xs text-base-content/60">Your Base Sepolia Address:</div>
          <div className="text-xs font-mono font-bold text-base-content break-all mt-1 px-3 py-1.5 bg-base-200 rounded-lg border border-base-content/10">
            {account}
          </div>
        </div>

        {/* Copy Address Button */}
        <button
          onClick={copyAddress}
          className="btn btn-primary w-full text-xs font-bold gap-2 text-white shadow-md shadow-baseBlue/25"
        >
          {copied ? <Check className="w-4 h-4 text-white" /> : <Copy className="w-4 h-4" />}
          <span>{copied ? 'Address Copied!' : 'Copy Full Address'}</span>
        </button>
      </div>
    </div>
  );
};
