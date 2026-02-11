"use client";

import React, { useState } from 'react';
import { useWallet } from '@/hooks/useAppKitWallet';
import Header from '@/components/header';
import { SubscriptionModal } from '@/components/mcp-components/SubscriptionModal';
import { CreditsPurchaseModal } from '@/components/mcp-components/CreditsPurchaseModal';
import { Button } from '@/components/ui/button';
import {
  Lightning,
  CreditCard,
  Check,
  Sparkle,
  TrendUp,
  Bell,
  ShieldCheck,
  ChartLine
} from '@phosphor-icons/react';
import { SUBSCRIPTION_PRICE, CREDIT_PACKAGES } from '@/lib/x402Client';

export default function PricingPage() {
  const { connected } = useWallet();
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);

  return (
    <div className="flex min-h-screen flex-col relative">
      <Header />
      <main className="w-full flex-1 lg:px-[70px] px-4">
        <div className="max-w-6xl mx-auto py-8">
            {/* Header */}
            <div className="text-center mb-12">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/20 mb-6">
                <Sparkle size={32} className="text-primary" weight="fill" />
              </div>
              <h1 className="text-4xl font-bold text-white mb-4">
                Choose Your Plan
              </h1>
              <p className="text-lg text-gray-400 max-w-2xl mx-auto">
                Automate your liquidity positions with AI-powered management
              </p>
            </div>

            {/* Pricing Cards */}
            <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {/* Subscription Plan */}
          <div className="border border-primary/30 rounded-2xl p-8 bg-gradient-to-br from-primary/10 to-transparent relative overflow-hidden">
            <div className="absolute top-4 right-4">
              <div className="px-3 py-1 bg-primary rounded-full">
                <p className="text-xs font-bold text-white">RECOMMENDED</p>
              </div>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                <Lightning size={28} className="text-primary" weight="fill" />
              </div>
              <h2 className="text-2xl font-bold text-white">Premium Subscription</h2>
            </div>

            <div className="mb-6">
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-bold text-white">${SUBSCRIPTION_PRICE}</span>
                <span className="text-xl text-gray-400">/month</span>
              </div>
              <p className="text-sm text-gray-500 mt-1">Paid in USDC · Cancel anytime</p>
            </div>

            <div className="space-y-4 mb-8">
              <div className="flex items-start gap-3">
                <Check size={20} className="text-primary mt-0.5 flex-shrink-0" weight="bold" />
                <div>
                  <p className="text-white font-medium">Unlimited Auto-Repositions</p>
                  <p className="text-sm text-gray-400">Never worry about position management again</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <TrendUp size={20} className="text-primary mt-0.5 flex-shrink-0" weight="bold" />
                <div>
                  <p className="text-white font-medium">AI-Powered Optimization</p>
                  <p className="text-sm text-gray-400">Smart position rebalancing for maximum returns</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Bell size={20} className="text-primary mt-0.5 flex-shrink-0" weight="bold" />
                <div>
                  <p className="text-white font-medium">Real-Time Notifications</p>
                  <p className="text-sm text-gray-400">Get alerts on Telegram & website</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ChartLine size={20} className="text-primary mt-0.5 flex-shrink-0" weight="bold" />
                <div>
                  <p className="text-white font-medium">Advanced Analytics</p>
                  <p className="text-sm text-gray-400">Deep insights into your portfolio performance</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck size={20} className="text-primary mt-0.5 flex-shrink-0" weight="bold" />
                <div>
                  <p className="text-white font-medium">Priority Support</p>
                  <p className="text-sm text-gray-400">Get help when you need it most</p>
                </div>
              </div>
            </div>

            <Button
              onClick={() => setShowSubscriptionModal(true)}
              disabled={!connected}
              size="lg"
              className="w-full text-lg"
            >
              <Lightning size={20} className="mr-2" weight="fill" />
              {connected ? 'Get Premium' : 'Connect Wallet to Subscribe'}
            </Button>

            {!connected && (
              <p className="text-xs text-center text-gray-500 mt-3">
                Connect your wallet to purchase
              </p>
            )}
          </div>

          {/* Pay-as-you-go Credits */}
          <div className="border border-border rounded-2xl p-8 bg-gray-900/50">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center">
                <CreditCard size={28} className="text-blue-400" />
              </div>
              <h2 className="text-2xl font-bold text-white">Pay-As-You-Go</h2>
            </div>

            <div className="mb-6">
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-bold text-white">$0.01</span>
                <span className="text-xl text-gray-400">/reposition</span>
              </div>
              <p className="text-sm text-gray-500 mt-1">Buy credits that never expire</p>
            </div>

            <div className="space-y-3 mb-8">
              <div className="flex items-start gap-3">
                <Check size={20} className="text-green-400 mt-0.5 flex-shrink-0" weight="bold" />
                <p className="text-gray-300">1 credit = 1 auto-reposition</p>
              </div>
              <div className="flex items-start gap-3">
                <Check size={20} className="text-green-400 mt-0.5 flex-shrink-0" weight="bold" />
                <p className="text-gray-300">Credits never expire</p>
              </div>
              <div className="flex items-start gap-3">
                <Check size={20} className="text-green-400 mt-0.5 flex-shrink-0" weight="bold" />
                <p className="text-gray-300">No subscription required</p>
              </div>
              <div className="flex items-start gap-3">
                <Check size={20} className="text-green-400 mt-0.5 flex-shrink-0" weight="bold" />
                <p className="text-gray-300">Flexible usage</p>
              </div>
            </div>

            {/* Credit Packages */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="border border-border rounded-lg p-4 bg-gray-800/50">
                <p className="text-xs text-gray-400 mb-1">Trial</p>
                <p className="text-2xl font-bold text-white">${CREDIT_PACKAGES.trial.price}</p>
                <p className="text-sm text-blue-400">{CREDIT_PACKAGES.trial.amount} credit</p>
              </div>
              <div className="border border-border rounded-lg p-4 bg-gray-800/50">
                <p className="text-xs text-gray-400 mb-1">Starter</p>
                <p className="text-2xl font-bold text-white">${CREDIT_PACKAGES.starter.price}</p>
                <p className="text-sm text-blue-400">{CREDIT_PACKAGES.starter.amount} credits</p>
              </div>
              <div className="border border-primary/30 rounded-lg p-4 bg-primary/5">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-400">Power</p>
                  <span className="text-xs bg-primary px-2 py-0.5 rounded-full text-white font-medium">Popular</span>
                </div>
                <p className="text-2xl font-bold text-white">${CREDIT_PACKAGES.power.price}</p>
                <p className="text-sm text-blue-400">{CREDIT_PACKAGES.power.amount} credits</p>
              </div>
              <div className="border border-border rounded-lg p-4 bg-gray-800/50">
                <p className="text-xs text-gray-400 mb-1">Pro</p>
                <p className="text-2xl font-bold text-white">${CREDIT_PACKAGES.pro.price}</p>
                <p className="text-sm text-blue-400">{CREDIT_PACKAGES.pro.amount} credits</p>
              </div>
            </div>

            <Button
              onClick={() => setShowCreditsModal(true)}
              disabled={!connected}
              variant="secondary"
              size="lg"
              className="w-full text-lg"
            >
              <CreditCard size={20} className="mr-2" />
              {connected ? 'Buy Credits' : 'Connect Wallet to Purchase'}
            </Button>

            {!connected && (
              <p className="text-xs text-center text-gray-500 mt-3">
                Connect your wallet to purchase
              </p>
            )}
              </div>
          </div>
        </div>
      </main>

      {/* Modals */}
      <SubscriptionModal
        isOpen={showSubscriptionModal}
        onClose={() => setShowSubscriptionModal(false)}
        onSuccess={() => setShowSubscriptionModal(false)}
      />

      <CreditsPurchaseModal
        isOpen={showCreditsModal}
        onClose={() => setShowCreditsModal(false)}
        onSuccess={() => setShowCreditsModal(false)}
      />
    </div>
  );
}
