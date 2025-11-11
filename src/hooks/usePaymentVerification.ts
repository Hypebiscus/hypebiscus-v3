import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { mcpClient } from '@/lib/services/mcpClient';

interface PaymentStatus {
  hasAccess: boolean;
  subscriptionActive: boolean;
  creditsBalance: number;
  loading: boolean;
  error: string | null;
}

interface VerifyAccessParams {
  requireCredits?: number;
  action?: string;
}

export function usePaymentVerification() {
  const { publicKey, connected } = useWallet();
  const [status, setStatus] = useState<PaymentStatus>({
    hasAccess: false,
    subscriptionActive: false,
    creditsBalance: 0,
    loading: false,
    error: null,
  });

  /**
   * Check if user has subscription or credits
   * Returns the actual status values, not just a boolean
   */
  const checkPaymentStatus = useCallback(async (): Promise<PaymentStatus> => {
    if (!connected || !publicKey) {
      const emptyStatus = {
        hasAccess: false,
        subscriptionActive: false,
        creditsBalance: 0,
        loading: false,
        error: 'Wallet not connected',
      };
      setStatus(emptyStatus);
      return emptyStatus;
    }

    setStatus(prev => ({ ...prev, loading: true, error: null }));

    try {
      const walletAddress = publicKey.toBase58();

      // Check subscription status
      // mcpClient.callTool() already parses the response
      const subData = await mcpClient.callTool('check_subscription', {
        walletAddress,
      }) as { isActive?: boolean };

      const subscriptionActive = subData?.isActive || false;

      // Check credits balance
      // mcpClient.callTool() already parses the response
      const creditsData = await mcpClient.callTool('get_credit_balance', {
        walletAddress,
      }) as { balance?: number };

      const creditsBalance = creditsData?.balance || 0;

      console.log('💰 Payment status:', { subscriptionActive, creditsBalance });

      const hasAccess = subscriptionActive || creditsBalance > 0;

      const newStatus = {
        hasAccess,
        subscriptionActive,
        creditsBalance,
        loading: false,
        error: null,
      };

      setStatus(newStatus);
      return newStatus;
    } catch (error) {
      console.error('❌ Payment status check failed:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to check payment status';
      const errorStatus = {
        hasAccess: false,
        subscriptionActive: false,
        creditsBalance: 0,
        loading: false,
        error: errorMsg,
      };
      setStatus(errorStatus);
      return errorStatus;
    }
  }, [connected, publicKey]);

  /**
   * Verify access and optionally use credits
   */
  const verifyAccess = useCallback(async ({ requireCredits = 1, action = 'query' }: VerifyAccessParams = {}) => {
    if (!connected || !publicKey) {
      return {
        hasAccess: false,
        reason: 'wallet_not_connected',
        message: 'Please connect your wallet to access this feature',
      };
    }

    // Get fresh payment status
    const currentStatus = await checkPaymentStatus();

    console.log('🔐 Verify access:', { requireCredits, currentStatus });

    if (!currentStatus.hasAccess) {
      return {
        hasAccess: false,
        reason: 'no_payment',
        message: `You need a subscription or ${requireCredits} credit${requireCredits > 1 ? 's' : ''} to ${action}`,
      };
    }

    // If subscription is active, allow access without using credits
    if (currentStatus.subscriptionActive) {
      console.log('✅ Access granted via subscription');
      return {
        hasAccess: true,
        reason: 'subscription',
        message: 'Access granted via subscription',
      };
    }

    // Check if enough credits (use fresh status, not state)
    if (currentStatus.creditsBalance < requireCredits) {
      console.log('❌ Insufficient credits:', currentStatus.creditsBalance, 'need:', requireCredits);
      return {
        hasAccess: false,
        reason: 'insufficient_credits',
        message: `Insufficient credits. You need ${requireCredits} credit${requireCredits > 1 ? 's' : ''} but have ${currentStatus.creditsBalance}`,
      };
    }

    // Use credits via MCP server
    try {
      const walletAddress = publicKey.toBase58();
      console.log('💳 Using', requireCredits, 'credits for:', action);

      const result = await mcpClient.callTool('use_credits', {
        walletAddress,
        amount: requireCredits,
        purpose: action,
      }) as { success?: boolean; newBalance?: number; balance?: number };

      const newBalance = result?.newBalance ?? result?.balance ?? (currentStatus.creditsBalance - requireCredits);

      setStatus(prev => ({
        ...prev,
        creditsBalance: newBalance,
      }));

      console.log('✅ Credits used! New balance:', newBalance);

      return {
        hasAccess: true,
        reason: 'credits_used',
        message: `${requireCredits} credit${requireCredits > 1 ? 's' : ''} used`,
        creditsRemaining: newBalance,
      };
    } catch (error) {
      console.error('❌ Credit use failed:', error);
      // Still allow access but warn about deduction failure
      return {
        hasAccess: true,
        reason: 'credits_not_deducted',
        message: `Access granted (credit deduction may have failed)`,
        creditsRemaining: currentStatus.creditsBalance,
      };
    }
  }, [connected, publicKey, checkPaymentStatus]);

  return {
    status,
    checkPaymentStatus,
    verifyAccess,
  };
}
