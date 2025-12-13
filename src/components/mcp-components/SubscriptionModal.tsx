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
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="border border-border rounded-lg bg-gray-900 max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Lightning size={24} className="text-primary" weight="fill" />
            </div>
            <h2 className="text-xl font-semibold text-white">Subscribe to Premium</h2>
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
            <h3 className="text-xl font-semibold text-white mb-2">Subscription Active!</h3>
            <p className="text-gray-400 mb-4">
              You now have unlimited auto-repositions for 30 days
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
              {/* Pricing */}
              <div className="border border-primary/30 rounded-lg p-6 bg-primary/10 text-center">
                <div className="text-4xl font-bold text-white mb-2">
                  ${SUBSCRIPTION_PRICE}
                  <span className="text-lg text-gray-400 font-normal">/month</span>
                </div>
                <p className="text-sm text-gray-400">Paid in USDC</p>
              </div>

              {/* Benefits */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-white">What&apos;s Included:</h3>
                <ul className="space-y-2">
                  <li className="flex items-start gap-2 text-sm text-gray-300">
                    <Check size={18} className="text-green-400 mt-0.5 flex-shrink-0" />
                    <span>Unlimited auto-repositions</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-gray-300">
                    <Check size={18} className="text-green-400 mt-0.5 flex-shrink-0" />
                    <span>Priority position monitoring</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-gray-300">
                    <Check size={18} className="text-green-400 mt-0.5 flex-shrink-0" />
                    <span>Advanced analytics & insights</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-gray-300">
                    <Check size={18} className="text-green-400 mt-0.5 flex-shrink-0" />
                    <span>Telegram & website notifications</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-gray-300">
                    <Check size={18} className="text-green-400 mt-0.5 flex-shrink-0" />
                    <span>24/7 support</span>
                  </li>
                </ul>
              </div>

              {/* Wallet Check */}
              {!connected && (
                <div className="border border-yellow-500/30 rounded-lg p-4 bg-yellow-900/10">
                  <div className="flex items-start gap-3">
                    <Wallet size={20} className="text-yellow-400 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-yellow-300">Wallet Required</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Please connect your wallet to purchase subscription
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-border space-y-3">
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
                    Subscribe for ${SUBSCRIPTION_PRICE}/month
                  </>
                )}
              </Button>
              <p className="text-xs text-center text-gray-500">
                Auto-renews monthly. Cancel anytime from settings.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
