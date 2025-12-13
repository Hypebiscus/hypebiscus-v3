"use client";

import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Wallet as WalletIcon, X, Check, CreditCard } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { purchaseCredits, CREDIT_PACKAGES, type CreditPackage } from '@/lib/x402Client';
import { showToast } from '@/lib/utils/showToast';

interface CreditsPurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function CreditsPurchaseModal({ isOpen, onClose, onSuccess }: CreditsPurchaseModalProps) {
  const { publicKey, signTransaction, connected } = useWallet();
  const [loading, setLoading] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<CreditPackage>('power');
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const handlePurchase = async () => {
    if (!publicKey || !signTransaction) {
      showToast.error('Wallet Not Connected', 'Please connect your wallet first');
      return;
    }

    setLoading(true);
    try {
      showToast.info('Processing Payment', 'Please approve the payment in your wallet...');

      // Use the new x402 SDK-based client
      const result = await purchaseCredits(
        { publicKey, signTransaction },
        selectedPackage
      );

      if (result.success && result.signature) {
        setTxSignature(result.signature);
        const pkg = CREDIT_PACKAGES[selectedPackage];
        showToast.success(
          'Credits Added!',
          `${pkg.amount} credits added to your account`
        );
        onSuccess?.();

        // Close after 2 seconds
        setTimeout(() => {
          onClose();
        }, 2000);
      } else {
        throw new Error(result.error || 'Payment failed');
      }
    } catch (error) {
      console.error('[x402] Credits purchase error:', error);
      showToast.error(
        'Payment Failed',
        error instanceof Error ? error.message : 'Please try again'
      );
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const pkg = CREDIT_PACKAGES[selectedPackage];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="border border-border rounded-lg bg-gray-900 max-w-lg w-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
              <CreditCard size={24} className="text-blue-400" />
            </div>
            <h2 className="text-xl font-semibold text-white">Purchase Credits</h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Success State */}
        {txSignature ? (
          <div className="p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
              <Check size={40} className="text-green-400" weight="bold" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Credits Added!</h3>
            <p className="text-gray-400 mb-1">
              <span className="text-2xl font-bold text-blue-400">{pkg.amount}</span> {pkg.amount === 1 ? 'credit' : 'credits'}
            </p>
            <p className="text-sm text-gray-500 mb-4">
              {pkg.amount} auto-reposition{pkg.amount === 1 ? '' : 's'} available
            </p>
            <a
              href={`https://solscan.io/tx/${txSignature}${process.env.NEXT_PUBLIC_SOLANA_NETWORK !== 'mainnet-beta' ? '?cluster=devnet' : ''}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
            >
              View Transaction →
            </a>
          </div>
        ) : (
          <>
            {/* Content */}
            <div className="p-6 space-y-4">
              {/* Package Selection */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-white mb-3">Select Package:</h3>
                <div className="grid grid-cols-2 gap-3">
                  {/* Trial */}
                  <button
                    onClick={() => setSelectedPackage('trial')}
                    disabled={loading}
                    className={`border rounded-lg p-4 transition-all relative ${
                      selectedPackage === 'trial'
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-border bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-green-500 rounded-full">
                      <p className="text-xs font-medium text-white">Test</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-400 mb-1">Trial</p>
                      <p className="text-2xl font-bold text-white mb-1">
                        ${CREDIT_PACKAGES.trial.price}
                      </p>
                      <p className="text-sm text-blue-400">{CREDIT_PACKAGES.trial.amount}</p>
                      <p className="text-xs text-gray-500">credit</p>
                    </div>
                  </button>

                  {/* Starter */}
                  <button
                    onClick={() => setSelectedPackage('starter')}
                    disabled={loading}
                    className={`border rounded-lg p-4 transition-all ${
                      selectedPackage === 'starter'
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-border bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <div className="text-center">
                      <p className="text-xs text-gray-400 mb-1">Starter</p>
                      <p className="text-2xl font-bold text-white mb-1">
                        ${CREDIT_PACKAGES.starter.price}
                      </p>
                      <p className="text-sm text-blue-400">{CREDIT_PACKAGES.starter.amount}</p>
                      <p className="text-xs text-gray-500">credits</p>
                    </div>
                  </button>

                  {/* Power (Recommended) */}
                  <button
                    onClick={() => setSelectedPackage('power')}
                    disabled={loading}
                    className={`border rounded-lg p-4 transition-all relative ${
                      selectedPackage === 'power'
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-border bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-primary rounded-full">
                      <p className="text-xs font-medium text-white">Popular</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-400 mb-1">Power</p>
                      <p className="text-2xl font-bold text-white mb-1">
                        ${CREDIT_PACKAGES.power.price}
                      </p>
                      <p className="text-sm text-blue-400">{CREDIT_PACKAGES.power.amount}</p>
                      <p className="text-xs text-gray-500">credits</p>
                    </div>
                  </button>

                  {/* Pro */}
                  <button
                    onClick={() => setSelectedPackage('pro')}
                    disabled={loading}
                    className={`border rounded-lg p-4 transition-all ${
                      selectedPackage === 'pro'
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-border bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <div className="text-center">
                      <p className="text-xs text-gray-400 mb-1">Pro</p>
                      <p className="text-2xl font-bold text-white mb-1">
                        ${CREDIT_PACKAGES.pro.price}
                      </p>
                      <p className="text-sm text-blue-400">{CREDIT_PACKAGES.pro.amount}</p>
                      <p className="text-xs text-gray-500">credits</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Selected Package Details */}
              <div className="border border-blue-500/30 rounded-lg p-4 bg-blue-900/10">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm text-gray-400">Total Credits:</span>
                  <span className="text-lg font-bold text-white">{pkg.amount} credits</span>
                </div>
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm text-gray-400">Repositions:</span>
                  <span className="text-lg font-semibold text-blue-400">{pkg.amount}x</span>
                </div>
                <div className="flex justify-between items-center pt-3 border-t border-blue-500/20">
                  <span className="text-sm text-gray-400">Total Price (USDC):</span>
                  <span className="text-xl font-bold text-white">${pkg.price}</span>
                </div>
              </div>

              {/* Info */}
              <div className="space-y-2">
                <div className="flex items-start gap-2 text-xs text-gray-400">
                  <Check size={14} className="text-green-400 mt-0.5 flex-shrink-0" />
                  <span>Credits never expire</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-gray-400">
                  <Check size={14} className="text-green-400 mt-0.5 flex-shrink-0" />
                  <span>1 credit = 1 auto-reposition ($0.01 per use)</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-gray-400">
                  <Check size={14} className="text-green-400 mt-0.5 flex-shrink-0" />
                  <span>No subscription required</span>
                </div>
              </div>

              {/* Wallet Check */}
              {!connected && (
                <div className="border border-yellow-500/30 rounded-lg p-4 bg-yellow-900/10">
                  <div className="flex items-start gap-3">
                    <WalletIcon size={20} className="text-yellow-400 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-yellow-300">Wallet Required</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Please connect your wallet to purchase credits
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-border">
              <Button
                onClick={handlePurchase}
                disabled={loading || !connected}
                className="w-full"
                size="lg"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    <CreditCard size={20} className="mr-2" />
                    Purchase {pkg.amount} Credits - ${pkg.price}
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
