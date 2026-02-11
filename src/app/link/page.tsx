"use client";

import PageTemplate from "@/components/PageTemplate";
import React from "react";
import { useWallet } from "@/hooks/useAppKitWallet";
import { WalletLinkingCard } from '@/components/mcp-components/WalletLinkingCard';
import { WalletDeletionDialog } from '@/components/mcp-components/WalletDeletionDialog';
import { showToast } from '@/lib/utils/showToast';
import { LinkIcon } from "@phosphor-icons/react";

const LinkPage = () => {
  const { publicKey, connected, connecting } = useWallet();

  return (
    <PageTemplate>
      <div className="max-w-4xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <LinkIcon className="w-8 h-8 text-primary" />
            <h1 className="text-3xl font-bold">Telegram Integration</h1>
          </div>
          <p className="text-gray-400">
            Link your wallet to Telegram to unlock advanced features, real-time notifications, and automated position management.
          </p>
        </div>

        {/* Wallet Linking Section */}
        <WalletLinkingCard
          onLinkSuccess={() => {
            showToast.success('Success!', 'Your wallet has been linked to Telegram');
          }}
          onLinkError={(error) => {
            showToast.error('Link Failed', error.message);
          }}
        />

        {/* Wallet Deletion Section - Danger Zone */}
        {connected && publicKey && (
          <div className="mt-8">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-red-400">Danger Zone</h2>
              <p className="text-sm text-gray-400">
                Permanently delete all wallet data and unlink from Telegram. This action cannot be undone.
              </p>
            </div>
            <WalletDeletionDialog
              walletAddress={publicKey.toBase58()}
              onDeleteSuccess={() => {
                showToast.success('Wallet Deleted', 'All wallet data has been removed');
              }}
              onDeleteError={(error) => {
                showToast.error('Deletion Failed', error.message);
              }}
            />
          </div>
        )}

        {/* Info Cards */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-border rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-2">What you get</h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Real-time position alerts and notifications</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Automated position management via bot</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Advanced PnL tracking and analytics</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>One-click access to your portfolio</span>
              </li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-2">Security & Privacy</h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">🔒</span>
                <span>Secure token-based linking (expires in 5 minutes)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">🔒</span>
                <span>Private keys never leave your wallet</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">🔒</span>
                <span>Unlink anytime from this page</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">🔒</span>
                <span>Complete data deletion available</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </PageTemplate>
  );
};

export default LinkPage;
