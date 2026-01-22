"use client";

import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Lightning, X, Check, Wallet } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { purchaseSubscription, SUBSCRIPTION_PRICE } from '@/lib/x402Client';
import { showToast } from '@/lib/utils/showToast';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function SubscriptionModal({ isOpen, onClose, onSuccess }: SubscriptionModalProps) {
  const { publicKey, signTransaction, connected } = useWallet();
  const [loading, setLoading] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const handleSubscribe = async () => {
    if (!publicKey || !signTransaction) {
      showToast.error('Wallet Not Connected', 'Please connect your wallet first');
      return;
    }

    setLoading(true);
    try {
      showToast.info('Processing Payment', 'Please approve the payment in your wallet...');

      // Use the new x402 SDK-based client
      const result = await purchaseSubscription({ publicKey, signTransaction });

      if (result.success && result.signature) {
        setTxSignature(result.signature);
        showToast.success('Subscription Activated!', 'You now have unlimited auto-repositions');
        onSuccess?.();

        // Close after 2 seconds
        setTimeout(() => {
          onClose();
        }, 2000);
      } else {
        throw new Error(result.error || 'Payment failed');
      }
    } catch (error) {
      console.error('[x402] Subscription error:', error);
      showToast.error(
        'Payment Failed',
        error instanceof Error ? error.message : 'Please try again'
      );
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="border border-border rounded-lg bg-gray-900 max-w-md w-full shadow-2xl max-h-[95vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-border">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Lightning size={20} className="text-primary sm:hidden" weight="fill" />
              <Lightning size={24} className="text-primary hidden sm:block" weight="fill" />
            </div>
            <h2 className="text-lg sm:text-xl font-semibold text-white">Subscribe to Premium</h2>
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
          <div className="p-4 sm:p-6 text-center">
            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3 sm:mb-4">
              <Check size={32} className="text-green-400 sm:hidden" weight="bold" />
              <Check size={40} className="text-green-400 hidden sm:block" weight="bold" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold text-white mb-2">Subscription Active!</h3>
            <p className="text-sm text-gray-400 mb-3 sm:mb-4">
              Unlimited auto-repositions for 30 days
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
            <div className="p-4 sm:p-6 space-y-3 sm:space-y-4">
              {/* Pricing */}
              <div className="border border-primary/30 rounded-lg p-4 sm:p-6 bg-primary/10 text-center">
                <div className="text-3xl sm:text-4xl font-bold text-white mb-1 sm:mb-2">
                  ${SUBSCRIPTION_PRICE}
                  <span className="text-base sm:text-lg text-gray-400 font-normal">/month</span>
                </div>
                <p className="text-xs sm:text-sm text-gray-400">Paid in USDC</p>
              </div>

              {/* Benefits - Compact 2-column grid on mobile */}
              <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm text-gray-300">
                <div className="flex items-center gap-1.5">
                  <Check size={14} className="text-green-400 flex-shrink-0" />
                  <span>Unlimited repositions</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Check size={14} className="text-green-400 flex-shrink-0" />
                  <span>Priority monitoring</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Check size={14} className="text-green-400 flex-shrink-0" />
                  <span>Advanced analytics</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Check size={14} className="text-green-400 flex-shrink-0" />
                  <span>24/7 support</span>
                </div>
              </div>

              {/* Wallet Check */}
              {!connected && (
                <div className="border border-yellow-500/30 rounded-lg p-3 bg-yellow-900/10">
                  <div className="flex items-center gap-2">
                    <Wallet size={18} className="text-yellow-400 flex-shrink-0" />
                    <p className="text-xs sm:text-sm font-medium text-yellow-300">
                      Connect wallet to subscribe
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 sm:p-6 border-t border-border">
              <Button
                onClick={handleSubscribe}
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
                    <Lightning size={20} className="mr-2" weight="fill" />
                    Subscribe - ${SUBSCRIPTION_PRICE}/month
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
