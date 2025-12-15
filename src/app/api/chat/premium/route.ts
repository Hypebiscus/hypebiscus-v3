import { NextResponse, NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { chatRateLimiter, getClientIP } from '@/lib/utils/rateLimiter';
import { validateChatRequest, validateRequestSize, ValidationError } from '@/lib/utils/validation';

/**
 * Premium Chat API Route
 *
 * Features:
 * - Uses Claude Opus (better model) for deeper analysis
 * - Requires 1 credit per request OR active subscription
 * - Deducts credits after successful response
 * - Provides more detailed, in-depth analysis
 *
 * Cost: 1 credit ($0.01) per request
 */

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if user has access via subscription or credits
 */
async function checkAccessControl(
  walletAddress: string,
  mcpUrl: string,
  request: NextRequest
): Promise<{ hasAccess: boolean; accessType: 'subscription' | 'credits'; error?: NextResponse }> {
  try {
    // Check subscription first (premium users have unlimited access)
    const subscriptionResponse = await fetch(`${request.nextUrl.protocol}//${request.nextUrl.host}${mcpUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'check_subscription',
          arguments: { walletAddress },
        },
        id: Date.now(),
      }),
    });

    const subscriptionData = await subscriptionResponse.json();
    const subscriptionText = subscriptionData.result?.content?.[0]?.text;
    const subscription = subscriptionText ? JSON.parse(subscriptionText) : null;

    let hasAccess = subscription?.isActive === true;
    let accessType: 'subscription' | 'credits' = 'subscription';

    // If no active subscription, check credit balance
    if (!hasAccess) {
      const creditsResponse = await fetch(`${request.nextUrl.protocol}//${request.nextUrl.host}${mcpUrl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'get_credit_balance',
            arguments: { walletAddress },
          },
          id: Date.now() + 1,
        }),
      });

      const creditsData = await creditsResponse.json();
      const creditsText = creditsData.result?.content?.[0]?.text;
      const credits = creditsText ? JSON.parse(creditsText) : null;

      hasAccess = credits?.balance > 0;
      accessType = 'credits';
    }

    // Deny access if no subscription and no credits
    if (!hasAccess) {
      const error = NextResponse.json(
        {
          error: 'Payment required',
          message: 'Premium AI analysis requires 1 credit or active subscription. Purchase credits to continue.',
          requiresPayment: true,
          cost: {
            credits: 1,
            usd: 0.01,
          }
        },
        { status: 402 } // HTTP 402 Payment Required
      );
      return { hasAccess: false, accessType, error };
    }

    return { hasAccess: true, accessType };
  } catch (mcpError) {
    console.error('[Premium API] MCP check failed:', mcpError);
    const error = NextResponse.json(
      { error: 'Failed to verify payment status' },
      { status: 500 }
    );
    return { hasAccess: false, accessType: 'credits', error };
  }
}

/**
 * Build enhanced system prompt for premium analysis
 */
function buildSystemPrompt(poolData?: Record<string, unknown>): string {
  let systemPrompt = `You are an expert DeFi analyst for Hypebiscus, specializing in deep technical analysis of cryptocurrency liquidity pools, positions, and market dynamics. Provide comprehensive, data-driven insights with:

1. **Technical Depth**: Analyze underlying mechanisms, smart contract risks, and protocol dynamics
2. **Risk Assessment**: Detailed evaluation of impermanent loss, liquidity depth, volatility exposure
3. **Market Context**: Historical performance, competitive positioning, macro trends
4. **Actionable Insights**: Clear recommendations backed by quantitative analysis

Be thorough yet concise. Use bullet points for clarity. Include specific metrics and calculations when relevant.`;

  // If pool data is provided, enhance prompt for pool analysis
  if (poolData) {
    systemPrompt += `\n\nWhen analyzing liquidity pools, provide:
- **Bin Step Analysis**: Explain fee tier implications and suitability for trading patterns
- **APY Breakdown**: Separate trading fees from rewards, analyze sustainability
- **TVL & Volume**: Assess liquidity depth vs trading activity efficiency
- **Risk Factors**: Impermanent loss scenarios, pool composition risks, protocol-specific concerns
- **Optimal Strategy**: Entry/exit points, position sizing, rebalancing triggers

Format analysis with clear sections and actionable conclusions.`;
  }

  return systemPrompt;
}

/**
 * Format messages for Anthropic API with optional pool data
 */
function formatMessagesForAnthropic(
  messages: { role: string; content: string }[],
  poolData?: Record<string, unknown>,
  portfolioStyle?: string
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const formattedMessages = messages.map((msg) => ({
    role: msg.role as "user" | "assistant",
    content: msg.content
  }));

  const allMessages = [
    ...formattedMessages,
    // Add pool data if provided
    ...(poolData ? [{
      role: 'user' as const,
      content: `Provide a deep technical analysis of this ${portfolioStyle || 'general'} liquidity pool: ${JSON.stringify(poolData)}.

                  Include:
                  1. Technical assessment of bin step (${poolData.binStep}) and its implications
                  2. APY sustainability analysis (current: ${poolData.apy}%)
                  3. TVL and volume efficiency evaluation
                  4. Detailed risk assessment with specific scenarios
                  5. Optimal position management strategy

                  Be thorough and data-driven.`
    }] : [])
  ];

  // Ensure we have at least one message
  if (allMessages.length === 0) {
    allMessages.push({
      role: 'user' as const,
      content: 'Provide an introduction to DeFi liquidity pools on Solana and key concepts to understand.'
    });
  }

  return allMessages;
}

/**
 * Create streaming response from Anthropic
 */
async function createStreamingResponse(
  anthropic: Anthropic,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<ReadableStream> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        const stream = await anthropic.messages.create({
          model: 'claude-opus-4-20250514', // Premium model (Opus 4)
          max_tokens: 2048, // More tokens for detailed analysis
          system: systemPrompt,
          messages,
          stream: true,
        });

        // Process streaming chunks
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }

        controller.close();
      } catch (error) {
        console.error('[Premium API] Streaming error:', error instanceof Error ? error.message : 'Unknown');
        controller.error(error);
      }
    }
  });
}

/**
 * Deduct credit in background after successful response
 * Only deducts if user is not on active subscription
 */
async function deductCreditInBackground(
  walletAddress: string,
  mcpUrl: string,
  request: NextRequest
): Promise<void> {
  try {
    // Check if user has active subscription
    const subscriptionCheck = await fetch(`${request.nextUrl.protocol}//${request.nextUrl.host}${mcpUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'check_subscription',
          arguments: { walletAddress },
        },
        id: Date.now(),
      }),
    });

    const subData = await subscriptionCheck.json();
    const subText = subData.result?.content?.[0]?.text;
    const sub = subText ? JSON.parse(subText) : null;

    // Only deduct credits if no active subscription
    if (!sub?.isActive) {
      await fetch(`${request.nextUrl.protocol}//${request.nextUrl.host}${mcpUrl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'use_credits',
            arguments: {
              walletAddress,
              amount: 1,
              description: 'Premium AI analysis',
              relatedResourceId: 'premium_chat',
            },
          },
          id: Date.now() + 2,
        }),
      });

      console.log('[Premium API] Deducted 1 credit from', walletAddress.substring(0, 8) + '...');
    }
  } catch (deductError) {
    console.error('[Premium API] Credit deduction failed:', deductError);
    // Don't fail the request if credit deduction fails
    // This is logged for manual reconciliation
  }
}
// ============================================================================
// Main Route Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // 1. Validate request size
    validateRequestSize(request);

    // 2. Rate limiting
    const clientIP = getClientIP(request);
    if (!chatRateLimiter.isAllowed(clientIP)) {
      const remainingTime = Math.ceil(chatRateLimiter.getRemainingTime(clientIP) / 1000);
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          message: `Too many requests. Please try again in ${remainingTime} seconds.`
        },
        {
          status: 429,
          headers: {
            'Retry-After': remainingTime.toString(),
            'X-RateLimit-Limit': '10',
            'X-RateLimit-Remaining': '0'
          }
        }
      );
    }

    // 3. Check API key configuration
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('Premium API: ANTHROPIC_API_KEY not set');
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      );
    }

    // 4. Parse and validate request body
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    let validatedData;
    try {
      validatedData = validateChatRequest(body);
    } catch (error) {
      if (error instanceof ValidationError) {
        return NextResponse.json(
          {
            error: 'Validation failed',
            message: error.message,
            field: error.field
          },
          { status: 400 }
        );
      }
      throw error;
    }

    const { messages, poolData, portfolioStyle, walletAddress } = validatedData;

    // 5. Verify wallet address (required for premium features)
    if (!walletAddress || typeof walletAddress !== 'string') {
      return NextResponse.json(
        {
          error: 'Wallet required',
          message: 'Please connect your wallet to use premium features'
        },
        { status: 401 }
      );
    }

    // 6. Check access control (subscription or credits)
    const mcpUrl = process.env.NEXT_PUBLIC_MCP_API_URL || '/api/mcp';
    const accessResult = await checkAccessControl(walletAddress, mcpUrl, request);

    if (!accessResult.hasAccess && accessResult.error) {
      return accessResult.error;
    }

    console.log('[Premium API] Access granted via', accessResult.accessType);

    // 7. Initialize Anthropic client and prepare messages
    const anthropic = new Anthropic({ apiKey });
    const systemPrompt = buildSystemPrompt(poolData);
    const formattedMessages = formatMessagesForAnthropic(messages, poolData, portfolioStyle);

    // 8. Create streaming response
    const stream = await createStreamingResponse(anthropic, systemPrompt, formattedMessages);

    // 9. Deduct credit in background (only if using credits, not subscription)
    deductCreditInBackground(walletAddress, mcpUrl, request);

    // 10. Return streaming response
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Premium-Feature': 'true',
        'X-Model': 'claude-opus-4',
      },
    });
  } catch (error) {
    console.error('[Premium API] Error:', error instanceof Error ? error.message : 'Unknown');

    if (error instanceof ValidationError) {
      return NextResponse.json({
        error: 'Validation failed',
        message: error.message
      }, { status: 400 });
    }

    return NextResponse.json({
      error: 'Internal server error',
      message: 'Something went wrong. Please try again later.'
    }, { status: 500 });
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: "Premium API route is working",
    model: "claude-opus-4",
    cost: {
      credits: 1,
      usd: 0.01,
    }
  });
}
