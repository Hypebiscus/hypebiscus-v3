// src/app/api/mcp/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { globalRateLimiter, getClientIP } from '@/lib/utils/rateLimiter';
import { validateMCPRequest } from '@/lib/utils/validation';

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3001';

// Configure route to allow longer execution for Render cold starts
export const maxDuration = 90; // 90 seconds

export async function POST(request: NextRequest) {
  try {
    // Rate limiting (30 requests per minute per IP for MCP data fetching)
    const clientIp = getClientIP(request);
    const isAllowed = globalRateLimiter.isAllowed(clientIp);

    if (!isAllowed) {
      const retryAfter = Math.ceil(globalRateLimiter.getRemainingTime(clientIp) / 1000);
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          retryAfter
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter)
          }
        }
      );
    }

    // Parse request body
    const body = await request.json();

    // Validate request
    const validation = validateMCPRequest(body);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    // Transform MCP protocol format to HTTP bridge format
    let httpBridgeRequest;

    if (body.method === 'tools/call' && body.params?.name) {
      // MCP protocol: tools/call with name and arguments
      // Transform to: direct tool name with params
      httpBridgeRequest = {
        jsonrpc: body.jsonrpc,
        method: body.params.name,
        params: body.params.arguments || {},
        id: body.id,
      };
    } else {
      // Already in correct format or other method
      httpBridgeRequest = body;
    }

    // Forward transformed request to MCP server (Docker container)
    // Use 90s timeout to handle Render free tier cold start (30-60s)
    const mcpResponse = await fetch(MCP_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(httpBridgeRequest),
      signal: AbortSignal.timeout(90000), // 90 second timeout for Render cold start
    });

    if (!mcpResponse.ok) {
      throw new Error(`MCP server returned ${mcpResponse.status}`);
    }

    const mcpData = await mcpResponse.json();

    return NextResponse.json(mcpData, { status: 200 });

  } catch (error) {
    console.error('MCP API Error:', error);

    if (error instanceof Error) {
      if (error.name === 'TimeoutError') {
        return NextResponse.json(
          { error: 'MCP server request timeout' },
          { status: 504 }
        );
      }

      if (error.message.includes('ECONNREFUSED')) {
        return NextResponse.json(
          { error: 'MCP server unavailable. Is Docker container running?' },
          { status: 503 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET endpoint for health check
export async function GET() {
  try {
    // Use the health endpoint on MCP HTTP bridge
    const mcpRequest = {
      jsonrpc: '2.0',
      method: 'health',
      id: 'health-check',
    };

    const mcpResponse = await fetch(MCP_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mcpRequest),
      signal: AbortSignal.timeout(90000), // 90s timeout for Render cold start
    });

    if (!mcpResponse.ok) {
      return NextResponse.json(
        {
          status: 'unhealthy',
          error: 'MCP server unavailable'
        },
        { status: 503 }
      );
    }

    const mcpData = await mcpResponse.json() as { status?: string; ready?: boolean };

    // Check if MCP server reports healthy status
    if (mcpData.status === 'ok' && mcpData.ready) {
      // Include list of available tools (must match MCP server registration)
      const tools = [
        {
          name: 'get_pool_metrics',
          description: 'Get DLMM pool metrics and analysis',
          inputSchema: {
            type: 'object',
            properties: {
              poolAddress: { type: 'string' },
              userId: { type: 'string' },
              walletAddress: { type: 'string' }
            }
          }
        },
        {
          name: 'get_user_by_wallet',
          description: 'Get user data from database by wallet address',
          inputSchema: {
            type: 'object',
            properties: {
              walletAddress: { type: 'string' }
            },
            required: ['walletAddress']
          }
        },
        {
          name: 'get_wallet_performance',
          description: 'Get wallet performance metrics',
          inputSchema: {
            type: 'object',
            properties: {
              walletAddress: { type: 'string' }
            },
            required: ['walletAddress']
          }
        },
        {
          name: 'get_bin_distribution',
          description: 'Get liquidity distribution across bins',
          inputSchema: {
            type: 'object',
            properties: {
              poolAddress: { type: 'string' },
              rangeSize: { type: 'number' },
              includeEmptyBins: { type: 'boolean' }
            }
          }
        },
        {
          name: 'calculate_rebalance',
          description: 'Analyze position health and calculate rebalancing needs',
          inputSchema: {
            type: 'object',
            properties: {
              positionId: { type: 'string' },
              poolAddress: { type: 'string' },
              bufferBins: { type: 'number' }
            },
            required: ['positionId']
          }
        },
        {
          name: 'get_user_positions_with_sync',
          description: 'Get user positions with hybrid data sync (database + blockchain). Can filter to a single position using positionId.',
          inputSchema: {
            type: 'object',
            properties: {
              walletAddress: { type: 'string' },
              includeHistorical: { type: 'boolean' },
              includeLive: { type: 'boolean' },
              positionId: { type: 'string' }
            },
            required: ['walletAddress']
          }
        },
        {
          name: 'generate_wallet_link_token',
          description: 'Generate a wallet link token for Telegram integration',
          inputSchema: {
            type: 'object',
            properties: {
              walletAddress: { type: 'string' }
            },
            required: ['walletAddress']
          }
        },
        {
          name: 'link_wallet_by_short_token',
          description: 'Link wallet using short token',
          inputSchema: {
            type: 'object',
            properties: {
              shortToken: { type: 'string' },
              telegramUserId: { type: 'string' }
            },
            required: ['shortToken', 'telegramUserId']
          }
        },
        {
          name: 'link_wallet',
          description: 'Link wallet to Telegram account',
          inputSchema: {
            type: 'object',
            properties: {
              fullToken: { type: 'string' },
              walletAddress: { type: 'string' },
              telegramUserId: { type: 'string' }
            },
            required: ['fullToken', 'walletAddress', 'telegramUserId']
          }
        },
        {
          name: 'get_linked_account',
          description: 'Get linked account details',
          inputSchema: {
            type: 'object',
            properties: {
              telegramUserId: { type: 'string' }
            },
            required: ['telegramUserId']
          }
        },
        {
          name: 'unlink_wallet',
          description: 'Unlink wallet from Telegram account',
          inputSchema: {
            type: 'object',
            properties: {
              telegramUserId: { type: 'string' }
            },
            required: ['telegramUserId']
          }
        },
        {
          name: 'check_subscription',
          description: 'Check if wallet has active subscription',
          inputSchema: {
            type: 'object',
            properties: {
              walletAddress: { type: 'string' }
            },
            required: ['walletAddress']
          }
        },
        {
          name: 'get_credit_balance',
          description: 'Get credit balance for wallet',
          inputSchema: {
            type: 'object',
            properties: {
              walletAddress: { type: 'string' }
            },
            required: ['walletAddress']
          }
        },
        {
          name: 'purchase_credits',
          description: 'Purchase credits with payment',
          inputSchema: {
            type: 'object',
            properties: {
              walletAddress: { type: 'string' },
              creditsAmount: { type: 'number' },
              usdcAmountPaid: { type: 'number' },
              paymentTxSignature: { type: 'string' },
              x402PaymentProof: { type: 'string' }
            },
            required: ['walletAddress', 'creditsAmount', 'usdcAmountPaid', 'paymentTxSignature', 'x402PaymentProof']
          }
        },
        {
          name: 'use_credits',
          description: 'Deduct credits from wallet balance',
          inputSchema: {
            type: 'object',
            properties: {
              walletAddress: { type: 'string' },
              amount: { type: 'number' },
              purpose: { type: 'string' }
            },
            required: ['walletAddress', 'amount']
          }
        },
        {
          name: 'get_position_details',
          description: 'Get detailed position information',
          inputSchema: {
            type: 'object',
            properties: {
              positionId: { type: 'string' },
              poolAddress: { type: 'string' }
            },
            required: ['positionId']
          }
        },
        {
          name: 'get_dlmm_position',
          description: 'Get DLMM position from blockchain',
          inputSchema: {
            type: 'object',
            properties: {
              positionAddress: { type: 'string' },
              poolAddress: { type: 'string' }
            },
            required: ['positionAddress']
          }
        }
      ];

      return NextResponse.json({
        status: 'healthy',
        serverUrl: MCP_SERVER_URL,
        ready: true,
        tools,
      });
    }

    return NextResponse.json(
      {
        status: 'unhealthy',
        error: 'MCP server not ready'
      },
      { status: 503 }
    );

  } catch {
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: 'Failed to connect to MCP server'
      },
      { status: 503 }
    );
  }
}
