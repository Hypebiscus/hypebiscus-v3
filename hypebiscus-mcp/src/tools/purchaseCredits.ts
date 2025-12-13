/**
 * Purchase Credits Tool
 *
 * Purchases credits after payment has been verified by the resource server.
 * This is a backend service that trusts the Next.js resource server's payment verification.
 *
 * Architecture:
 * - Next.js API (Resource Server): Verifies payment with x402 facilitator
 * - MCP Server (Backend): Adds credits to database (NO payment verification)
 */

import { z } from 'zod';
import { creditsService } from '../services/creditsService.js';
import { logger } from '../config.js';

// Input schema - simplified (no x402 verification here)
export const PurchaseCreditsSchema = z.object({
  walletAddress: z.string().describe('The Solana wallet address purchasing credits'),
  creditsAmount: z.number().positive().describe('Number of credits to purchase'),
  paymentTxSignature: z.string().describe('Solana transaction signature from verified payment'),
  usdcAmountPaid: z.number().positive().describe('USDC amount paid for these credits'),
});

export type PurchaseCreditsInput = z.infer<typeof PurchaseCreditsSchema>;

// Result type
export interface PurchaseCreditsResult {
  success: boolean;
  balance: number;
  totalPurchased: number;
  totalUsed: number;
  creditsPurchased: number;
  usdcPaid: number;
  transactionSignature: string;
  message: string;
}

/**
 * Purchase credits - backend database operation only
 *
 * IMPORTANT: This function does NOT verify payment!
 * Payment verification happens in the Next.js resource server.
 * This function trusts that the resource server has already verified the payment.
 */
export async function purchaseCredits(
  input: PurchaseCreditsInput
): Promise<PurchaseCreditsResult> {
  try {
    logger.info('Processing credit purchase (payment already verified by resource server)', {
      walletAddress: input.walletAddress.slice(0, 8) + '...',
      creditsAmount: input.creditsAmount,
      usdcPaid: input.usdcAmountPaid,
      txSignature: input.paymentTxSignature.slice(0, 16) + '...',
    });

    // Trust the resource server - add credits to database
    const result = await creditsService.purchaseCredits({
      walletAddress: input.walletAddress,
      creditsAmount: input.creditsAmount,
      usdcAmountPaid: input.usdcAmountPaid,
      paymentTxSignature: input.paymentTxSignature,
      x402PaymentProof: input.paymentTxSignature, // Use signature as proof
    });

    logger.info('Credits added successfully', {
      newBalance: result.balance,
      creditsPurchased: input.creditsAmount,
    });

    return {
      success: true,
      balance: result.balance,
      totalPurchased: result.totalPurchased,
      totalUsed: result.totalUsed,
      creditsPurchased: input.creditsAmount,
      usdcPaid: input.usdcAmountPaid,
      transactionSignature: input.paymentTxSignature,
      message: `Successfully purchased ${input.creditsAmount} credits for $${input.usdcAmountPaid.toFixed(2)} USDC. New balance: ${result.balance} credits.`,
    };
  } catch (error) {
    logger.error('Error purchasing credits:', error);
    throw new Error(`Failed to purchase credits: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
