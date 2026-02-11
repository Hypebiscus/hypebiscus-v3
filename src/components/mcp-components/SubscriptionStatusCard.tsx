"use client";

import React, { useState, useEffect } from 'react';
import { useWallet } from '@/hooks/useAppKitWallet';
import { CreditCard, Lightning, Wallet, ArrowsClockwise } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { mcpClient } from '@/lib/services/mcpClient';
import { showToast } from '@/lib/utils/showToast';
import { SubscriptionModal } from './SubscriptionModal';
import { CreditsPurchaseModal } from './CreditsPurchaseModal';

interface SubscriptionStatus {
  isActive: boolean;
  tier?: string;
  expiresAt?: string;
  daysRemaining?: number;
}

interface CreditBalance {
  balance: number;
  totalPurchased: number;
  totalUsed: number;
  message: string;
}

export function SubscriptionStatusCard() {
  const { publicKey, connected } = useWallet();
  const [loading, setLoading] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);

  const fetchStatus = async () => {
    if (!publicKey || !connected) return;

    setLoading(true);
    try {
      // Fetch subscription status
      const subResponse = (await mcpClient.callTool('check_subscription', {
        walletAddress: publicKey.toBase58(),
      })) as { success: boolean; data?: SubscriptionStatus };

      if (subResponse.success && subResponse.data) {
        setSubscription(subResponse.data);
      }

      // Fetch credit balance
      const creditsResponse = (await mcpClient.callTool('get_credit_balance', {
        walletAddress: publicKey.toBase58(),
      })) as { success: boolean; data?: CreditBalance };

      if (creditsResponse.success && creditsResponse.data) {
        setCredits(creditsResponse.data);
      }
    } catch (error) {
      console.error('Error fetching payment status:', error);
      showToast.error('Failed to fetch payment status', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!publicKey || !connected) return;

    // Debounce to prevent rapid-fire requests
    const timeoutId = setTimeout(() => {
      fetchStatus();
    }, 500);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, connected]);

  if (!connected) {
    return (
      <div className="border border-border rounded-lg p-6 bg-gray-900/50">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
            <Wallet size={24} className="text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Payment Status</h3>
            <p className="text-sm text-gray-400">Connect wallet to view</p>
          </div>
        </div>
        <p className="text-sm text-gray-400">
          Connect your wallet to view your subscription and credits balance.
        </p>
      </div>
    );
  }

  if (loading && !subscription && !credits) {
    return (
      <div className="border border-border rounded-lg p-6 bg-gray-900/50">
        <div className="flex items-center justify-center py-8">
          <ArrowsClockwise size={32} className="text-primary animate-spin" />
        </div>
      </div>
    );
  }

  const hasActiveSubscription = subscription?.isActive;
  const hasCredits = credits && credits.balance > 0;
  const hasAnyPayment = hasActiveSubscription || hasCredits;

  return (
    <div className="border border-border rounded-lg p-6 bg-gray-900/50">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
            <CreditCard size={24} className="text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Payment Status</h3>
            <p className="text-sm text-gray-400">
              {hasAnyPayment ? 'Active' : 'No active payment'}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchStatus}
          disabled={loading}
          className="flex items-center gap-2"
        >
          <ArrowsClockwise size={16} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      {/* Subscription Status */}
      {hasActiveSubscription && subscription ? (
        <div className="mb-6 p-4 rounded-lg bg-green-900/20 border border-green-500/30">
          <div className="flex items-center gap-2 mb-2">
            <Lightning size={20} className="text-green-400" weight="fill" />
            <h4 className="font-semibold text-white">Active Subscription</h4>
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Tier:</span>
              <span className="text-white font-medium capitalize">{subscription.tier}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Expires:</span>
              <span className="text-white">
                {subscription.expiresAt ? new Date(subscription.expiresAt).toLocaleDateString() : 'N/A'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Days Remaining:</span>
              <span className={`font-medium ${
                (subscription.daysRemaining || 0) < 7 ? 'text-yellow-400' : 'text-green-400'
              }`}>
                {subscription.daysRemaining || 0} days
              </span>
            </div>
          </div>
          <p className="text-xs text-green-400 mt-3">
            ✓ Unlimited auto-repositions
          </p>
        </div>
      ) : (
        <div className="mb-6 p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
          <div className="flex items-center gap-2 mb-2">
            <Lightning size={20} className="text-gray-400" />
            <h4 className="font-semibold text-white">No Subscription</h4>
          </div>
          <p className="text-sm text-gray-400 mb-3">
            Subscribe for unlimited auto-repositions
          </p>
          <Button
            size="sm"
            className="w-full"
            onClick={() => setShowSubscriptionModal(true)}
          >
            Subscribe - $4.99/month
          </Button>
        </div>
      )}

      {/* Credits Balance */}
      <div className={`p-4 rounded-lg border ${
        hasCredits
          ? 'bg-blue-900/20 border-blue-500/30'
          : 'bg-gray-800/50 border-gray-700/50'
      }`}>
        <div className="flex items-center gap-2 mb-2">
          <Wallet size={20} className={hasCredits ? 'text-blue-400' : 'text-gray-400'} />
          <h4 className="font-semibold text-white">Credits Balance</h4>
        </div>

        {credits ? (
          <>
            <div className="space-y-1 text-sm mb-3">
              <div className="flex justify-between">
                <span className="text-gray-400">Available:</span>
                <span className={`font-bold text-lg ${
                  credits.balance > 0 ? 'text-blue-400' : 'text-gray-400'
                }`}>
                  {credits.balance} credits
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Repositions Available:</span>
                <span className="text-white font-medium">
                  {Math.floor(credits.balance / 1)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-700/50">
                <div>
                  <p className="text-xs text-gray-500">Total Purchased</p>
                  <p className="text-sm text-white">{credits.totalPurchased}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Total Used</p>
                  <p className="text-sm text-white">{credits.totalUsed}</p>
                </div>
              </div>
            </div>

            {credits.balance < 10 && (
              <p className="text-xs text-yellow-400 mb-2">
                ⚠️ Low balance - consider purchasing more credits
              </p>
            )}

            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => setShowCreditsModal(true)}
            >
              Purchase Credits ($0.01 each)
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-400 mb-3">
              Pay-per-use at $0.01 per reposition
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => setShowCreditsModal(true)}
            >
              Purchase Credits
            </Button>
          </>
        )}
      </div>

      {/* Info Notice */}
      {!hasAnyPayment && (
        <div className="mt-4 p-3 rounded-lg bg-yellow-900/20 border border-yellow-500/30">
          <p className="text-xs text-yellow-300">
            💡 Choose subscription for unlimited repositions or purchase credits for pay-as-you-go
          </p>
        </div>
      )}

      {/* Payment Modals */}
      <SubscriptionModal
        isOpen={showSubscriptionModal}
        onClose={() => setShowSubscriptionModal(false)}
        onSuccess={() => {
          fetchStatus(); // Refresh status after successful payment
        }}
      />
      <CreditsPurchaseModal
        isOpen={showCreditsModal}
        onClose={() => setShowCreditsModal(false)}
        onSuccess={() => {
          fetchStatus(); // Refresh status after successful payment
        }}
      />
    </div>
  );
}
