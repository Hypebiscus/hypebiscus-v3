/**
 * x402 Payment Middleware for Next.js API Routes
 *
 * Provides HTTP 402 Payment Required functionality using the x402 protocol.
 * Integrates with PayAI Network facilitator for payment verification.
 *
 * Usage:
 * ```typescript
 * import { createX402Middleware } from '@/lib/middleware/x402Middleware';
 *
 * export async function POST(req: NextRequest) {
 *   return createX402Middleware({
 *     priceUSD: 25.00,
 *     description: 'Purchase 2500 credits'
 *   })(req, async (paymentProof) => {
 *     // Your protected endpoint logic here
 *     // paymentProof contains the verified transaction signature
 *     return NextResponse.json({ success: true });
 *   });
 * }
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';
import { X402PaymentHandler } from '@payai/x402-solana/server';
import type { PaymentRequirements } from '@payai/x402-solana/server';

// USDC mint addresses (6 decimals)
const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

// Network configuration from environment
const NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta' ? 'solana' : 'solana-devnet';
const USDC_MINT = NETWORK === 'solana' ? USDC_MAINNET : USDC_DEVNET;
const TREASURY_WALLET = process.env.TREASURY_WALLET || 'YV2C7YyrkH67jTRZHvwovJfSK6BqiJJMycmRSXSWEy2';
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://facilitator.payai.network';
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

// Payment verification result
interface PaymentProof {
  verified: boolean;
  transactionSignature?: string;
  error?: string;
}

// Middleware configuration
export interface X402MiddlewareConfig {
  priceUSD: number;
  description: string;
  resource?: string;
  maxTimeoutSeconds?: number;
}

// Handler function type
type ProtectedHandler = (paymentProof: PaymentProof) => Promise<NextResponse>;

/**
 * Singleton x402 payment handler instance
 * Initialized lazily on first use
 */
let paymentHandler: X402PaymentHandler | null = null;

function getPaymentHandler(): X402PaymentHandler {
  if (!paymentHandler) {
    console.log('[x402-middleware] Initializing X402PaymentHandler', {
      network: NETWORK,
      treasury: TREASURY_WALLET.slice(0, 8) + '...',
      facilitator: FACILITATOR_URL,
    });

    paymentHandler = new X402PaymentHandler({
      network: NETWORK as 'solana' | 'solana-devnet',
      treasuryAddress: TREASURY_WALLET,
      facilitatorUrl: FACILITATOR_URL,
      rpcUrl: RPC_URL,
      // USDC has 6 decimals on both mainnet and devnet
      defaultToken: {
        address: USDC_MINT,
        decimals: 6,
      },
    });
  }

  return paymentHandler;
}

/**
 * Convert USD amount to USDC micro-units (6 decimals)
 * @param usd - USD amount (e.g., 25.00)
 * @returns USDC micro-units as string (e.g., "25000000")
 */
function usdToMicroUSDC(usd: number): string {
  return Math.floor(usd * 1_000_000).toString();
}

/**
 * Note: extractPayment is now handled by the X402PaymentHandler.extractPayment() method
 * This follows the official x402-solana SDK pattern
 */

/**
 * Create x402 middleware for Next.js API routes
 *
 * This middleware implements the x402 payment protocol:
 * 1. If no X-PAYMENT header: return HTTP 402 with PaymentRequirements
 * 2. If X-PAYMENT header present: verify payment with facilitator
 * 3. If payment valid: execute protected handler
 * 4. If payment invalid: return HTTP 402 with error
 *
 * @param config - Middleware configuration
 * @returns Middleware function
 */
export function createX402Middleware(config: X402MiddlewareConfig) {
  return async (
    req: NextRequest,
    handler: ProtectedHandler
  ): Promise<NextResponse> => {
    try {
      const handler402 = getPaymentHandler();

      // Get resource URL (use from request if not provided)
      const resource = config.resource || req.url;

      // Create payment requirements
      // CRITICAL: resource must be full URL (not just path)
      // asset should NOT include eip712 for Solana (that's Ethereum-only)
      const fullResourceUrl = resource.startsWith('http')
        ? resource
        : `${BASE_URL}${resource.startsWith('/') ? resource : '/' + resource}`;

      const requirements = await handler402.createPaymentRequirements({
        price: {
          amount: usdToMicroUSDC(config.priceUSD),
          asset: {
            address: USDC_MINT,
            decimals: 6,  // USDC has 6 decimals
          },
        },
        network: NETWORK,
        config: {
          description: config.description,
          resource: fullResourceUrl as `${string}://${string}`,  // Full URL required
          mimeType: 'application/json',
        },
      });

      // Extract X-PAYMENT header using official SDK method
      const paymentHeader = handler402.extractPayment(req.headers);

      // No payment header: return 402 Payment Required
      if (!paymentHeader) {
        console.log('[x402-middleware] No X-PAYMENT header, returning 402');

        const response402 = handler402.create402Response(requirements);

        return NextResponse.json(response402.body, {
          status: 402,
          headers: {
            'Content-Type': 'application/json',
          },
        });
      }

      // Verify payment with facilitator
      console.log('[x402-middleware] Verifying payment with facilitator...');

      // Decode payment header to inspect transaction
      try {
        const decoded = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
        console.log('[x402-middleware] Decoded payment header:', JSON.stringify(decoded, null, 2));
      } catch (e) {
        console.log('[x402-middleware] Could not decode payment header:', e);
      }

      console.log('[x402-middleware] Requirements:', JSON.stringify(requirements, null, 2));

      const verifyResult = await handler402.verifyPayment(paymentHeader, requirements);
      console.log('[x402-middleware] Verify result:', verifyResult);

      // @payai/x402-solana@0.1.0 returns boolean (true/false)
      if (!verifyResult) {
        console.log('[x402-middleware] Payment verification failed');

        const response402 = handler402.create402Response(requirements);

        return NextResponse.json(
          {
            ...response402.body,
            error: 'Payment verification failed',
          },
          {
            status: 402,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      }

      console.log('[x402-middleware] Payment verified successfully');

      // Extract transaction signature from payment header or verify result
      // The actual transaction signature may be in the payment header payload
      let transactionSignature: string | undefined;
      try {
        // Try to parse payment header to get transaction
        const paymentData = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf-8'));
        if (paymentData.payload?.transaction) {
          transactionSignature = paymentData.payload.transaction;
        }
      } catch (e) {
        console.warn('[x402-middleware] Could not parse payment header for transaction:', e);
      }

      // Execute protected handler
      const response = await handler({
        verified: true,
        transactionSignature,
      });

      // Settle payment with facilitator (async, don't block response)
      // @payai/x402-solana@0.1.0 returns boolean
      handler402.settlePayment(paymentHeader, requirements)
        .then((settleResult) => {
          if (settleResult) {
            console.log('[x402-middleware] Payment settled successfully');
          } else {
            console.warn('[x402-middleware] Payment settlement failed');
          }
        })
        .catch((error) => {
          console.error('[x402-middleware] Payment settlement error:', error);
        });

      // Add X-PAYMENT-RESPONSE header with receipt
      if (transactionSignature) {
        const receiptData = {
          transaction: transactionSignature,
          network: NETWORK,
          verified: true,
        };

        response.headers.set(
          'X-Payment-Response',
          Buffer.from(JSON.stringify(receiptData)).toString('base64')
        );
      }

      return response;

    } catch (error) {
      console.error('[x402-middleware] Error in x402 middleware:', error);

      return NextResponse.json(
        {
          error: 'Payment processing error',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }
  };
}

/**
 * Utility: Create payment requirements without middleware
 * Useful for custom 402 response handling
 */
export async function createPaymentRequirements(
  config: X402MiddlewareConfig,
  resource: string
) {
  const handler402 = getPaymentHandler();

  // Ensure resource is full URL
  const fullResourceUrl = resource.startsWith('http')
    ? resource
    : `${BASE_URL}${resource.startsWith('/') ? resource : '/' + resource}`;

  return handler402.createPaymentRequirements({
    price: {
      amount: usdToMicroUSDC(config.priceUSD),
      asset: {
        address: USDC_MINT,
        decimals: 6,  // USDC has 6 decimals
      },
    },
    network: NETWORK,
    config: {
      description: config.description,
      resource: fullResourceUrl as `${string}://${string}`,
      mimeType: 'application/json',
    },
  });
}

/**
 * Utility: Create 402 response body
 */
export function create402Response(requirements: PaymentRequirements) {
  const handler402 = getPaymentHandler();
  return handler402.create402Response(requirements);
}

// Export types
export type { PaymentRequirements, PaymentProof };
