"use client";

import { useEffect, useState } from 'react';
import { useWallet } from '@/hooks/useAppKitWallet';
import { mcpClient } from '@/lib/mcp-client';
import { CoinsIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';

interface CreditBalanceIndicatorProps {
  onPurchaseClick: () => void;
}

export function CreditBalanceIndicator({ onPurchaseClick }: CreditBalanceIndicatorProps) {
  const { publicKey, connected } = useWallet();
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSubscription, setHasSubscription] = useState(false);

  useEffect(() => {
    async function fetchBalance() {
      if (!connected || !publicKey) {
        setBalance(null);
        setHasSubscription(false);
        return;
      }

      setIsLoading(true);
      try {
        const walletAddress = publicKey.toBase58();

        // Check both subscription and credits
        const [subscriptionResult, creditsResult] = await Promise.all([
          mcpClient.checkSubscription({ walletAddress }),
          mcpClient.getCreditBalance({ walletAddress }),
        ]);

        setHasSubscription(subscriptionResult.isActive);
        setBalance(creditsResult.balance);
      } catch (error) {
        console.error('Failed to fetch balance:', error);
        setBalance(0);
      } finally {
        setIsLoading(false);
      }
    }

    fetchBalance();
  }, [connected, publicKey]);

  if (!connected) {
    return null;
  }

  if (hasSubscription) {
    return (
      <Button
        variant="secondary"
        size="secondary"
        className="bg-gradient-to-r from-yellow-600 to-yellow-500 border-none text-white flex items-center gap-2 text-xs font-semibold"
        disabled
      >
        <CoinsIcon size={14} weight="fill" />
        <span>Premium</span>
      </Button>
    );
  }

  return (
    <Button
      variant="secondary"
      size="secondary"
      className={`border-primary text-white flex items-center gap-2 text-xs ${
        balance && balance > 0
          ? 'bg-green-900/30 hover:bg-green-900/50'
          : 'bg-red-900/30 hover:bg-red-900/50'
      }`}
      onClick={onPurchaseClick}
      disabled={isLoading}
      title={balance && balance > 0 ? `${balance} credits available` : 'Purchase credits for premium features'}
    >
      <CoinsIcon size={14} weight={balance && balance > 0 ? 'fill' : 'regular'} />
      <span>
        {isLoading ? '...' : balance !== null ? `${balance} Credits` : 'Get Credits'}
      </span>
    </Button>
  );
}
