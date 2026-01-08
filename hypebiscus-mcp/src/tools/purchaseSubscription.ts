/**
 * Purchase Subscription Tool
 *
 * Creates a premium subscription after payment has been verified by the resource server.
 * This is a backend service that trusts the Next.js resource server's payment verification.
 *
 * Architecture:
 * - Next.js API (Resource Server): Verifies payment with x402 facilitator
 * - MCP Server (Backend): Creates subscription in database (NO payment verification)
 */

import { z } from 'zod';
import { subscriptionService } from '../services/subscriptionService.js';
import { logger } from '../config.js';

// Input schema - simplified (no x402 verification here)
export const PurchaseSubscriptionSchema = z.object({
  walletAddress: z.string().describe('The Solana wallet address purchasing subscription'),
  paymentTxSignature: z.string().describe('Solana transaction signature from verified payment'),
  x402PaymentProof: z.string().describe('x402 payment proof header for audit trail'),
  tier: z.enum(['premium']).default('premium').optional().describe('Subscription tier (currently only premium is supported)'),
});

export type PurchaseSubscriptionInput = z.infer<typeof PurchaseSubscriptionSchema>;

// Result type
export interface PurchaseSubscriptionResult {
  success: boolean;
  subscription: {
    id: string;
    tier: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    daysRemaining: number;
  };
  payment: {
    transactionSignature: string;
  };
  message: string;
}

/**
 * Purchase subscription - backend database operation only
 *
 * IMPORTANT: This function does NOT verify payment!
 * Payment verification happens in the Next.js resource server.
 * This function trusts that the resource server has already verified the payment.
 */
export async function purchaseSubscription(
  input: PurchaseSubscriptionInput
): Promise<PurchaseSubscriptionResult> {
  try {
    logger.info('Processing subscription purchase (payment already verified by resource server)', {
      walletAddress: input.walletAddress.slice(0, 8) + '...',
      tier: input.tier || 'premium',
      txSignature: input.paymentTxSignature.slice(0, 16) + '...',
    });

    // Check if subscription already exists (handle duplicate payments)
    const existingSubscription = await subscriptionService.getSubscription(input.walletAddress);

    let subscription;

    if (existingSubscription) {
      // Renew existing subscription
      logger.info('Renewing existing subscription', {
        walletAddress: input.walletAddress.slice(0, 8) + '...',
        currentExpiry: existingSubscription.currentPeriodEnd.toISOString(),
      });

      subscription = await subscriptionService.renewSubscription(
        input.walletAddress,
        input.paymentTxSignature,
        input.x402PaymentProof
      );

      if (!subscription) {
        throw new Error('Failed to renew subscription');
      }
    } else {
      // Create new subscription
      logger.info('Creating new subscription', {
        walletAddress: input.walletAddress.slice(0, 8) + '...',
      });

      subscription = await subscriptionService.createSubscription({
        walletAddress: input.walletAddress,
        paymentTxSignature: input.paymentTxSignature,
        x402PaymentProof: input.x402PaymentProof,
      });
    }

    // Calculate days remaining
    const now = new Date();
    const daysRemaining = Math.ceil(
      (subscription.currentPeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    logger.info('Subscription created/renewed successfully', {
      subscriptionId: subscription.id,
      tier: subscription.tier,
      expiresAt: subscription.currentPeriodEnd.toISOString(),
      daysRemaining,
    });

    return {
      success: true,
      subscription: {
        id: subscription.id,
        tier: subscription.tier,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart.toISOString(),
        currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
        daysRemaining,
      },
      payment: {
        transactionSignature: input.paymentTxSignature,
      },
      message: existingSubscription
        ? `Successfully renewed premium subscription for 30 days. New expiry: ${subscription.currentPeriodEnd.toISOString()}`
        : `Successfully activated premium subscription for 30 days. Expires: ${subscription.currentPeriodEnd.toISOString()}`,
    };
  } catch (error) {
    logger.error('Error purchasing subscription:', error);
    throw new Error(
      `Failed to purchase subscription: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
