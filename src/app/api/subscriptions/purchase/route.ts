/**
 * Subscription Purchase API Endpoint
 *
 * x402-protected endpoint for purchasing premium subscriptions.
 * Automatically handles HTTP 402 payment flow via middleware.
 *
 * Flow:
 * 1. Client makes request without X-PAYMENT header
 * 2. Middleware returns 402 with PaymentRequirements
 * 3. x402 SDK constructs payment and retries with X-PAYMENT header
 * 4. Middleware verifies payment with PayAI facilitator
 * 5. This handler creates subscription in database
 * 6. Returns success with subscription details
 */

import { NextRequest, NextResponse } from 'next/server';
import { createX402Middleware, type PaymentProof } from '@/lib/middleware/x402Middleware';

// Subscription pricing
const SUBSCRIPTION_PRICE_USD = 4.99;
const SUBSCRIPTION_DURATION_DAYS = 30;

// MCP server URL (for database operations)
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3001';

/**
 * Create subscription in database via direct database access
 * TODO: Refactor to use MCP tool when create_subscription tool is implemented
 */
async function createSubscriptionInDatabase(
  walletAddress: string,
  paymentProof: PaymentProof
): Promise<{
  id: string;
  tier: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
}> {
  // Calculate subscription period
  const now = new Date();
  const currentPeriodStart = now.toISOString();
  const currentPeriodEnd = new Date(now.getTime() + (SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000)).toISOString();

  // Call MCP server to create subscription
  // Note: This will need a new MCP tool "create_subscription"
  // For now, we'll use a workaround by calling the database directly via MCP

  const mcpResponse = await fetch(MCP_SERVER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'create_subscription', // TODO: This tool needs to be created in MCP server
      params: {
        walletAddress,
        tier: 'premium',
        paymentTxSignature: paymentProof.transactionSignature,
        x402PaymentProof: paymentProof.transactionSignature,
        currentPeriodStart,
        currentPeriodEnd,
      },
      id: Date.now(),
    }),
  });

  if (!mcpResponse.ok) {
    throw new Error(`MCP server returned ${mcpResponse.status}`);
  }

  const mcpData = await mcpResponse.json();

  if (mcpData.error) {
    // If create_subscription tool doesn't exist yet, provide helpful error
    if (mcpData.error.message?.includes('Unknown tool')) {
      throw new Error(
        'Subscription creation tool not yet implemented in MCP server. ' +
        'Please implement create_subscription tool in hypebiscus-mcp/src/tools/'
      );
    }
    throw new Error(mcpData.error.message || 'MCP server error');
  }

  // Parse MCP response
  const content = mcpData.result?.content?.[0]?.text;
  if (!content) {
    throw new Error('Empty response from MCP server');
  }

  const subscription = JSON.parse(content);
  return subscription;
}

/**
 * POST /api/subscriptions/purchase
 *
 * Protected by x402 middleware - requires payment to access
 */
export async function POST(req: NextRequest) {
  try {
    // Parse request body
    const body = await req.json();
    const { walletAddress, tier = 'premium' } = body;

    // Validate required fields
    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Missing required field: walletAddress' },
        { status: 400 }
      );
    }

    // Validate tier
    if (tier !== 'premium') {
      return NextResponse.json(
        { error: 'Invalid tier. Only "premium" is supported.' },
        { status: 400 }
      );
    }

    // Apply x402 middleware
    return createX402Middleware({
      priceUSD: SUBSCRIPTION_PRICE_USD,
      description: 'Hypebiscus Premium Subscription (30 days)',
      resource: '/api/subscriptions/purchase',
    })(req, async (paymentProof: PaymentProof) => {
      // Payment verified! Create subscription in database

      console.log('[subscription-purchase] Payment verified, creating subscription', {
        walletAddress,
        tier,
        transactionSignature: paymentProof.transactionSignature,
      });

      try {
        // Create subscription in database
        const subscription = await createSubscriptionInDatabase(walletAddress, paymentProof);

        console.log('[subscription-purchase] Subscription created successfully', {
          subscriptionId: subscription.id,
          walletAddress,
          tier: subscription.tier,
          expiresAt: subscription.currentPeriodEnd,
        });

        // Calculate days remaining
        const expiryDate = new Date(subscription.currentPeriodEnd);
        const daysRemaining = Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

        // Return success response
        return NextResponse.json({
          success: true,
          subscription: {
            id: subscription.id,
            tier: subscription.tier,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            daysRemaining,
          },
          payment: {
            transactionSignature: paymentProof.transactionSignature,
            amount: SUBSCRIPTION_PRICE_USD,
            currency: 'USDC',
          },
          message: `Successfully activated ${tier} subscription for 30 days`,
        });

      } catch (dbError) {
        console.error('[subscription-purchase] Error creating subscription in database:', dbError);

        // Payment was verified but database update failed
        // This is a critical error - user paid but didn't receive subscription
        return NextResponse.json(
          {
            error: 'Database error',
            message: 'Payment verified but failed to create subscription. Contact support with transaction signature.',
            transactionSignature: paymentProof.transactionSignature,
            support: 'support@hypebiscus.com',
            details: dbError instanceof Error ? dbError.message : 'Unknown error',
          },
          { status: 500 }
        );
      }
    });

  } catch (error) {
    console.error('[subscription-purchase] Error processing request:', error);

    return NextResponse.json(
      {
        error: 'Request processing error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
