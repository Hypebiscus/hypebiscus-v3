/**
 * Credits Purchase API Endpoint
 *
 * x402-protected endpoint for purchasing credits.
 * Automatically handles HTTP 402 payment flow via middleware.
 *
 * Flow:
 * 1. Client makes request without X-PAYMENT header
 * 2. Middleware returns 402 with PaymentRequirements
 * 3. x402 SDK constructs payment and retries with X-PAYMENT header
 * 4. Middleware verifies payment with PayAI facilitator
 * 5. This handler adds credits to database
 * 6. Returns success with transaction signature
 */

import { NextRequest, NextResponse } from 'next/server';
import { createX402Middleware, type PaymentProof } from '@/lib/middleware/x402Middleware';

// Credit packages configuration (matches frontend)
const CREDIT_PACKAGES = {
  trial: { amount: 1, price: 0.01 },
  starter: { amount: 1000, price: 10.00 },
  power: { amount: 2500, price: 25.00 },
  pro: { amount: 5000, price: 50.00 },
} as const;

type CreditPackage = keyof typeof CREDIT_PACKAGES;

// MCP server URL (for database operations)
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3001';

/**
 * POST /api/credits/purchase
 *
 * Protected by x402 middleware - requires payment to access
 */
export async function POST(req: NextRequest) {
  try {
    // Parse request body
    const body = await req.json();
    const { walletAddress, package: packageName } = body;

    // Validate required fields
    if (!walletAddress || !packageName) {
      return NextResponse.json(
        { error: 'Missing required fields: walletAddress, package' },
        { status: 400 }
      );
    }

    // Validate package
    if (!CREDIT_PACKAGES[packageName as CreditPackage]) {
      return NextResponse.json(
        { error: 'Invalid package. Must be: trial, starter, power, or pro' },
        { status: 400 }
      );
    }

    const pkg = CREDIT_PACKAGES[packageName as CreditPackage];

    // Apply x402 middleware with dynamic pricing
    return createX402Middleware({
      priceUSD: pkg.price,
      description: `Purchase ${pkg.amount} credits (${packageName} package)`,
      resource: `/api/credits/purchase`,
    })(req, async (paymentProof: PaymentProof) => {
      // Payment verified! Add credits to database via MCP server

      console.log('[credits-purchase] Payment verified, adding credits to database', {
        walletAddress,
        package: packageName,
        amount: pkg.amount,
        transactionSignature: paymentProof.transactionSignature,
      });

      try {
        // Call MCP server to add credits
        const mcpResponse = await fetch(MCP_SERVER_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'purchase_credits',
            params: {
              walletAddress,
              creditsAmount: pkg.amount,
              paymentTxSignature: paymentProof.transactionSignature,
              usdcAmountPaid: pkg.price,
            },
            id: Date.now(),
          }),
        });

        if (!mcpResponse.ok) {
          throw new Error(`MCP server returned ${mcpResponse.status}`);
        }

        const mcpData = await mcpResponse.json();

        if (mcpData.error) {
          throw new Error(mcpData.error.message || 'MCP server error');
        }

        // Parse MCP response
        const content = mcpData.result?.content?.[0]?.text;
        if (!content) {
          throw new Error('Empty response from MCP server');
        }

        const purchaseResult = JSON.parse(content);

        console.log('[credits-purchase] Credits added successfully', {
          newBalance: purchaseResult.balance,
          totalPurchased: purchaseResult.totalPurchased,
        });

        // Return success response
        return NextResponse.json({
          success: true,
          package: packageName,
          creditsAmount: pkg.amount,
          usdcPaid: pkg.price,
          transactionSignature: paymentProof.transactionSignature,
          balance: purchaseResult.balance,
          totalPurchased: purchaseResult.totalPurchased,
          totalUsed: purchaseResult.totalUsed,
          message: `Successfully purchased ${pkg.amount} credits for $${pkg.price} USDC`,
        });

      } catch (mcpError) {
        console.error('[credits-purchase] Error adding credits to database:', mcpError);

        // Payment was verified but database update failed
        // This is a critical error - user paid but didn't receive credits
        return NextResponse.json(
          {
            error: 'Database error',
            message: 'Payment verified but failed to add credits. Contact support with transaction signature.',
            transactionSignature: paymentProof.transactionSignature,
            support: 'support@hypebiscus.com',
          },
          { status: 500 }
        );
      }
    });

  } catch (error) {
    console.error('[credits-purchase] Error processing request:', error);

    return NextResponse.json(
      {
        error: 'Request processing error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
