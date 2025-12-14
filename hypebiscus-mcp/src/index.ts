#!/usr/bin/env node

// Hypebiscus MCP Server - Main entry point
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { config, logger } from './config.js';
import { database } from './services/database.js';
import { backgroundSync } from './services/backgroundSync.js';
import { getPoolMetrics, formatToolError } from './tools/getPoolMetrics.js';
import { getUserByWallet, formatUserInfo, formatUserError } from './tools/getUserByWallet.js';
import { getWalletPerformance, formatWalletPerformance, formatPerformanceError } from './tools/getWalletPerformance.js';
import { getBinDistribution, formatBinDistribution, formatBinDistributionError } from './tools/getBinDistribution.js';
import { calculateRebalance, formatCalculateRebalance, formatCalculateRebalanceError } from './tools/calculateRebalance.js';
import { getUserPositionsWithSync, formatSyncPositionsError } from './tools/getUserPositionsWithSync.js';
import { analyzeReposition, formatAnalyzeReposition, formatAnalyzeRepositionError } from './tools/analyzeReposition.js';
import { prepareReposition, formatPrepareReposition, formatPrepareRepositionError } from './tools/prepareReposition.js';
import { getPositionChain, formatPositionChain, formatPositionChainError } from './tools/getPositionChain.js';
import { getWalletRepositionStats, formatWalletRepositionStats, formatWalletRepositionStatsError } from './tools/getWalletRepositionStats.js';
import { generateWalletLinkToken, formatGenerateWalletLinkToken, formatGenerateWalletLinkTokenError } from './tools/generateWalletLinkToken.js';
import { linkWallet, formatLinkWallet, formatLinkWalletError } from './tools/linkWallet.js';
import { linkWalletByShortToken, formatLinkWalletByShortToken, formatLinkWalletByShortTokenError } from './tools/linkWalletByShortToken.js';
import { getLinkedAccount, formatGetLinkedAccount, formatGetLinkedAccountError } from './tools/getLinkedAccount.js';
import { unlinkWallet, formatUnlinkWallet, formatUnlinkWalletError } from './tools/unlinkWallet.js';
import { deleteWalletCompletely, DeleteWalletCompletelySchema, DeleteWalletCompletelyInput } from './tools/deleteWalletCompletely.js';
import { getRepositionSettings, formatGetRepositionSettings, formatGetRepositionSettingsError } from './tools/getRepositionSettings.js';
import { updateRepositionSettings, formatUpdateRepositionSettings, formatUpdateRepositionSettingsError } from './tools/updateRepositionSettings.js';
import { checkSubscription as checkSubscriptionTool, CheckSubscriptionSchema, CheckSubscriptionInput } from './tools/checkSubscription.js';
import { recordExecution, RecordExecutionSchema, RecordExecutionInput } from './tools/recordExecution.js';
import { getCreditBalance, GetCreditBalanceSchema, GetCreditBalanceInput } from './tools/getCreditBalance.js';
import { purchaseCredits, PurchaseCreditsSchema, PurchaseCreditsInput } from './tools/purchaseCredits.js';
import { useCredits, UseCreditsSchema, UseCreditsInput } from './tools/useCredits.js';
import { calculatePositionPnL_tool, formatCalculatePnLError, CalculatePositionPnLInput } from './tools/calculatePositionPnL.js';
import { closePosition_tool, formatClosePositionError, ClosePositionInput } from './tools/closePosition.js';
import { getWalletPnL_tool, formatWalletPnL, formatWalletPnLError, GetWalletPnLInput } from './tools/getWalletPnL.js';
import { syncWalletPositions, SyncWalletPositionsInput } from './tools/syncWalletPositions.js';
import { PoolMetricsInput } from './tools/types.js';
import {
  GetUserByWalletInput,
  GetWalletPerformanceInput,
} from './types/database.js';
import { SyncPositionInput } from './types/sync.js';
import { RepositionInput } from './types/reposition.js';
import {
  GenerateWalletLinkTokenInput,
  LinkWalletInput,
  GetLinkedAccountInput,
  UnlinkWalletInput,
  GetRepositionSettingsInput,
  UpdateRepositionSettingsInput,
} from './types/wallet-linking.js';
import { checkSubscription, formatSubscriptionError } from './middleware/subscriptionMiddleware.js';

// Server info
const SERVER_NAME = 'hypebiscus-mcp';
const SERVER_VERSION = '1.0.0';

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: 'get_pool_metrics',
    description:
      'Fetches real-time metrics for a Meteora DLMM pool including APY, liquidity, fees, volume, and token prices. Optionally includes personalized insights if user context is provided.',
    inputSchema: {
      type: 'object',
      properties: {
        poolAddress: {
          type: 'string',
          description:
            'Solana address of the DLMM pool (optional, defaults to main zBTC-SOL pool: 2onAYHGyxUV4JuYeUQbFwbKmKUXyTA9v5aKiDgZMyCeL)',
        },
        userId: {
          type: 'string',
          description: 'Optional: User ID to include personalized insights',
        },
        walletAddress: {
          type: 'string',
          description: 'Optional: Wallet address to include personalized insights (alternative to userId)',
        },
      },
    },
  },
  {
    name: 'get_user_by_wallet',
    description:
      'Gets user information and statistics by Solana wallet address including profile, position counts, and performance metrics',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Solana wallet public key address',
        },
      },
      required: ['walletAddress'],
    },
  },
  {
    name: 'get_wallet_performance',
    description:
      'Gets aggregated performance metrics for a wallet including total PnL, fees collected, win rate, and active positions',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Solana wallet public key address',
        },
      },
      required: ['walletAddress'],
    },
  },
  {
    name: 'get_bin_distribution',
    description:
      'Gets current bin liquidity distribution around active price for DLMM pool analysis, showing where liquidity is concentrated',
    inputSchema: {
      type: 'object',
      properties: {
        poolAddress: {
          type: 'string',
          description: 'Solana address of the DLMM pool (optional, defaults to main zBTC-SOL pool)',
        },
        rangeSize: {
          type: 'number',
          description: 'Number of bins to fetch on each side of active bin (default: 50, max: 200)',
        },
        includeEmptyBins: {
          type: 'boolean',
          description: 'Include bins with no liquidity (default: false)',
        },
      },
    },
  },
  {
    name: 'calculate_rebalance',
    description:
      'Analyzes position health and calculates whether rebalancing is needed based on active bin distance from position range',
    inputSchema: {
      type: 'object',
      properties: {
        positionId: {
          type: 'string',
          description: 'On-chain position public key',
        },
        poolAddress: {
          type: 'string',
          description: 'Optional: Pool address for improved performance',
        },
        bufferBins: {
          type: 'number',
          description: 'Number of buffer bins before recommending rebalance (default: 10)',
        },
      },
      required: ['positionId'],
    },
  },
  {
    name: 'get_user_positions_with_sync',
    description:
      'Fetches user positions with hybrid data sync, merging database (historical) and blockchain (real-time) data for comprehensive position tracking',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Solana wallet address',
        },
        includeHistorical: {
          type: 'boolean',
          description: 'Include closed positions from database (default: true)',
        },
        includeLive: {
          type: 'boolean',
          description: 'Include active positions from blockchain (default: true)',
        },
        positionId: {
          type: 'string',
          description: 'Optional: Filter to specific position ID',
        },
      },
      required: ['walletAddress'],
    },
  },
  {
    name: 'analyze_reposition',
    description:
      'Analyzes a DLMM position and determines if repositioning is recommended. Provides urgency level, recommended strategy, and estimated costs.',
    inputSchema: {
      type: 'object',
      properties: {
        positionAddress: {
          type: 'string',
          description: 'On-chain position public key to analyze',
        },
        poolAddress: {
          type: 'string',
          description: 'Optional: Pool address for improved performance',
        },
      },
      required: ['positionAddress'],
    },
  },
  {
    name: 'prepare_reposition',
    description:
      'Prepares an unsigned transaction for repositioning an out-of-range position. Returns serialized transaction for client wallet to sign. SECURITY: MCP server never signs transactions.',
    inputSchema: {
      type: 'object',
      properties: {
        positionAddress: {
          type: 'string',
          description: 'Position to reposition',
        },
        walletAddress: {
          type: 'string',
          description: 'Owner wallet address',
        },
        poolAddress: {
          type: 'string',
          description: 'Optional: Pool address',
        },
        strategy: {
          type: 'string',
          description: 'Liquidity distribution strategy: one-sided-x, one-sided-y, or balanced (default: auto-detect)',
          enum: ['one-sided-x', 'one-sided-y', 'balanced'],
        },
        binRange: {
          type: 'number',
          description: 'Number of bins to spread liquidity (default: 10)',
        },
        slippage: {
          type: 'number',
          description: 'Slippage tolerance in basis points (100 = 1%, default: 100)',
        },
      },
      required: ['positionAddress', 'walletAddress'],
    },
  },
  {
    name: 'get_position_chain',
    description:
      'Retrieves the complete reposition history chain for a position, showing all previous repositions and total fees collected',
    inputSchema: {
      type: 'object',
      properties: {
        positionAddress: {
          type: 'string',
          description: 'Position address (can be current or any position in the chain)',
        },
      },
      required: ['positionAddress'],
    },
  },
  {
    name: 'get_wallet_reposition_stats',
    description:
      'Gets aggregated reposition statistics for a wallet including total repositions, fees collected, and gas costs',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Wallet address',
        },
      },
      required: ['walletAddress'],
    },
  },
  {
    name: 'generate_wallet_link_token',
    description:
      'Generates a secure token for linking website wallet with Telegram account. Returns QR code data for bot scanning.',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Website wallet address requesting link',
        },
        expiresInMinutes: {
          type: 'number',
          description: 'Token expiration time in minutes (default: 5)',
        },
      },
      required: ['walletAddress'],
    },
  },
  {
    name: 'link_wallet',
    description:
      'Links a Telegram user account with a website wallet using a valid token. Creates bidirectional connection for cross-platform sync.',
    inputSchema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'Link token from website QR code',
        },
        walletAddress: {
          type: 'string',
          description: 'Wallet address from QR code',
        },
        telegramUserId: {
          type: 'string',
          description: 'Telegram user ID to link',
        },
        expiresAt: {
          type: 'string',
          description: 'Expiration timestamp from QR code (ISO format)',
        },
      },
      required: ['token', 'walletAddress', 'telegramUserId', 'expiresAt'],
    },
  },
  {
    name: 'link_wallet_by_short_token',
    description:
      'Links a Telegram user account with a website wallet using an 8-character short token. Simpler alternative to QR code scanning for manual entry.',
    inputSchema: {
      type: 'object',
      properties: {
        shortToken: {
          type: 'string',
          description: '8-character code from website (uppercase, alphanumeric)',
        },
        telegramUserId: {
          type: 'string',
          description: 'Telegram user ID to link',
        },
      },
      required: ['shortToken', 'telegramUserId'],
    },
  },
  {
    name: 'get_linked_account',
    description:
      'Checks if a wallet or Telegram user has a cross-platform link. Returns linked account information if exists.',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Website wallet address to check',
        },
        telegramUserId: {
          type: 'string',
          description: 'Telegram user ID to check',
        },
      },
    },
  },
  {
    name: 'unlink_wallet',
    description:
      'Removes the link between a Telegram account and website wallet. Clears cross-platform sync connection.',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Website wallet address to unlink',
        },
        telegramUserId: {
          type: 'string',
          description: 'Telegram user ID to unlink',
        },
      },
    },
  },
  {
    name: 'delete_wallet_completely',
    description:
      'DESTRUCTIVE: Completely deletes a wallet and all associated data including credits, subscriptions, transactions, position links, and bot-generated wallet keys. This action cannot be undone. Use with extreme caution.',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Wallet address to completely delete',
        },
        telegramId: {
          type: 'string',
          description: 'Telegram user ID to delete wallet for',
        },
      },
    },
  },
  {
    name: 'get_reposition_settings',
    description:
      'Fetches or creates default auto-reposition settings for a user. Returns settings including auto-reposition enabled status, thresholds, and notification preferences.',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Website wallet address',
        },
        telegramUserId: {
          type: 'string',
          description: 'Telegram user ID',
        },
      },
    },
  },
  {
    name: 'update_reposition_settings',
    description:
      'Updates user auto-reposition settings from either platform. Changes are synced across Telegram and website.',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Website wallet address',
        },
        telegramUserId: {
          type: 'string',
          description: 'Telegram user ID',
        },
        settings: {
          type: 'object',
          description: 'Settings to update',
          properties: {
            autoRepositionEnabled: {
              type: 'boolean',
              description: 'Enable/disable auto-repositioning',
            },
            urgencyThreshold: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              description: 'Minimum urgency level to trigger reposition',
            },
            maxGasCostSol: {
              type: 'number',
              description: 'Maximum gas cost in SOL (0-1)',
            },
            minFeesToCollectUsd: {
              type: 'number',
              description: 'Minimum fees to collect before repositioning (USD)',
            },
            allowedStrategies: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['one-sided-x', 'one-sided-y', 'balanced'],
              },
              description: 'Allowed reposition strategies',
            },
            telegramNotifications: {
              type: 'boolean',
              description: 'Enable Telegram notifications',
            },
            websiteNotifications: {
              type: 'boolean',
              description: 'Enable website notifications',
            },
          },
        },
        updatedFrom: {
          type: 'string',
          enum: ['telegram', 'website'],
          description: 'Platform making the update',
        },
      },
      required: ['settings', 'updatedFrom'],
    },
  },
  {
    name: 'check_subscription',
    description:
      'Checks if a wallet address has an active subscription for premium features (auto-reposition, unlimited usage).',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Solana wallet address to check subscription for',
        },
      },
      required: ['walletAddress'],
    },
  },
  {
    name: 'record_execution',
    description:
      'Records a reposition execution for usage tracking and analytics. Used by auto-reposition monitor.',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Solana wallet address',
        },
        positionAddress: {
          type: 'string',
          description: 'Position address that was repositioned',
        },
        success: {
          type: 'boolean',
          description: 'Whether the reposition was successful',
        },
        gasCostSol: {
          type: 'number',
          description: 'Gas cost in SOL',
        },
        feesCollectedUsd: {
          type: 'number',
          description: 'Fees collected in USD',
        },
        error: {
          type: 'string',
          description: 'Error message if failed',
        },
        transactionSignature: {
          type: 'string',
          description: 'Transaction signature',
        },
        executionMode: {
          type: 'string',
          enum: ['auto', 'manual'],
          description: 'Execution mode (auto or manual)',
        },
      },
      required: ['walletAddress', 'positionAddress', 'success'],
    },
  },
  {
    name: 'get_credit_balance',
    description:
      'Retrieves the current credit balance for a wallet. Shows total balance, total purchased, and total used credits.',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Solana wallet address to check credits for',
        },
      },
      required: ['walletAddress'],
    },
  },
  {
    name: 'purchase_credits',
    description:
      'Purchases credits using x402 payment protocol. Validates payment and adds credits to wallet balance. $0.01 USDC per credit.',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Solana wallet address purchasing credits',
        },
        creditsAmount: {
          type: 'number',
          description: 'Number of credits to purchase (minimum 1)',
        },
        x402PaymentHeader: {
          type: 'string',
          description: 'x402 payment proof header (X-Payment header value)',
        },
      },
      required: ['walletAddress', 'creditsAmount', 'x402PaymentHeader'],
    },
  },
  {
    name: 'use_credits',
    description:
      'Deducts credits from wallet balance for a reposition. Internal tool used after successful repositions. 1 credit per reposition.',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Solana wallet address using credits',
        },
        amount: {
          type: 'number',
          description: 'Number of credits to deduct',
        },
        positionAddress: {
          type: 'string',
          description: 'Position address this credit usage is for',
        },
        description: {
          type: 'string',
          description: 'Optional description of credit usage',
        },
      },
      required: ['walletAddress', 'amount', 'positionAddress'],
    },
  },
  {
    name: 'calculate_position_pnl',
    description:
      'Calculates production-grade PnL for a single position including realized/unrealized PnL, impermanent loss, fees earned, and rewards. Uses stored deposit prices for accurate historical tracking.',
    inputSchema: {
      type: 'object',
      properties: {
        positionId: {
          type: 'string',
          description: 'Position address (Solana public key)',
        },
      },
      required: ['positionId'],
    },
  },
  {
    name: 'close_position',
    description:
      'Closes a position with production-grade PnL tracking. Records withdrawal prices, calculates final PnL, and updates position and user stats in database. Note: Blockchain execution requires keypair from client.',
    inputSchema: {
      type: 'object',
      properties: {
        positionId: {
          type: 'string',
          description: 'Position address to close',
        },
        walletAddress: {
          type: 'string',
          description: 'Owner wallet address',
        },
        closeOnBlockchain: {
          type: 'boolean',
          description: 'If true, close on blockchain (requires keypair). If false, just record in DB (position already closed)',
        },
        transactionSignature: {
          type: 'string',
          description: 'Optional transaction signature if position was already closed on-chain',
        },
      },
      required: ['positionId', 'walletAddress'],
    },
  },
  {
    name: 'get_wallet_pnl',
    description:
      'Gets aggregated PnL for all positions in a wallet with detailed breakdown. Includes total PnL, impermanent loss, fees, rewards, and position-by-position analysis. Sorted by status (active first) then by PnL.',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Solana wallet address',
        },
        includeClosedPositions: {
          type: 'boolean',
          description: 'Include closed positions in results (default: true)',
        },
      },
      required: ['walletAddress'],
    },
  },
  {
    name: 'sync_wallet_positions',
    description:
      'Manually syncs wallet positions to database for historical tracking and PnL calculation. Requires credits or active subscription. Returns sync status and number of positions synced.',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Solana wallet address to sync positions for',
        },
      },
      required: ['walletAddress'],
    },
  },
];

// Zod schemas for input validation
const GetPoolMetricsSchema = z.object({
  poolAddress: z.string().optional(),
  userId: z.string().optional(),
  walletAddress: z.string().optional(),
});

const GetUserByWalletSchema = z.object({
  walletAddress: z.string(),
});

const GetWalletPerformanceSchema = z.object({
  walletAddress: z.string(),
});

const GetBinDistributionSchema = z.object({
  poolAddress: z.string().optional(),
  rangeSize: z.number().min(1).max(200).optional(),
  includeEmptyBins: z.boolean().optional(),
});

const CalculateRebalanceSchema = z.object({
  positionId: z.string(),
  poolAddress: z.string().optional(),
  bufferBins: z.number().min(1).max(50).optional(),
});

const GetUserPositionsWithSyncSchema = z.object({
  walletAddress: z.string(),
  includeHistorical: z.boolean().optional(),
  includeLive: z.boolean().optional(),
  positionId: z.string().optional(),
});

const AnalyzeRepositionSchema = z.object({
  positionAddress: z.string(),
  poolAddress: z.string().optional(),
});

const PrepareRepositionSchema = z.object({
  positionAddress: z.string(),
  walletAddress: z.string(),
  poolAddress: z.string().optional(),
  strategy: z.enum(['one-sided-x', 'one-sided-y', 'balanced']).optional(),
  binRange: z.number().min(1).max(100).optional(),
  slippage: z.number().min(1).max(10000).optional(),
});

const GetPositionChainSchema = z.object({
  positionAddress: z.string(),
});

const GetWalletRepositionStatsSchema = z.object({
  walletAddress: z.string(),
});

const GenerateWalletLinkTokenSchema = z.object({
  walletAddress: z.string(),
  expiresInMinutes: z.number().min(1).max(60).optional(),
});

const LinkWalletSchema = z.object({
  token: z.string(),
  walletAddress: z.string(),
  telegramUserId: z.string(),
  expiresAt: z.string(),
});

const LinkWalletByShortTokenSchema = z.object({
  shortToken: z.string().length(8),
  telegramUserId: z.string(),
});

const GetLinkedAccountSchema = z.object({
  walletAddress: z.string().optional(),
  telegramUserId: z.string().optional(),
});

const UnlinkWalletSchema = z.object({
  walletAddress: z.string().optional(),
  telegramUserId: z.string().optional(),
});

const GetRepositionSettingsSchema = z.object({
  walletAddress: z.string().optional(),
  telegramUserId: z.string().optional(),
});

const UpdateRepositionSettingsSchema = z.object({
  walletAddress: z.string().optional(),
  telegramUserId: z.string().optional(),
  settings: z.object({
    autoRepositionEnabled: z.boolean().optional(),
    urgencyThreshold: z.enum(['low', 'medium', 'high']).optional(),
    maxGasCostSol: z.number().min(0).max(1).optional(),
    minFeesToCollectUsd: z.number().min(0).optional(),
    allowedStrategies: z.array(z.enum(['one-sided-x', 'one-sided-y', 'balanced'])).optional(),
    telegramNotifications: z.boolean().optional(),
    websiteNotifications: z.boolean().optional(),
  }),
  updatedFrom: z.enum(['telegram', 'website']),
});

const CalculatePositionPnLSchema = z.object({
  positionId: z.string(),
});

const ClosePositionSchema = z.object({
  positionId: z.string(),
  walletAddress: z.string(),
  closeOnBlockchain: z.boolean().optional(),
  transactionSignature: z.string().optional(),
});

const GetWalletPnLSchema = z.object({
  walletAddress: z.string(),
  includeClosedPositions: z.boolean().optional(),
});

const SyncWalletPositionsSchema = z.object({
  walletAddress: z.string(),
});

/**
 * Main server class
 */
class HypebiscusMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    logger.info(`${SERVER_NAME} v${SERVER_VERSION} initialized`);
  }

  /**
   * Sets up request handlers
   */
  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('Listing available tools');
      return {
        tools: TOOLS,
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      logger.info(`Tool called: ${name}`);
      logger.debug(`Arguments: ${JSON.stringify(args)}`);

      try {
        switch (name) {
          case 'get_pool_metrics': {
            const validatedInput = GetPoolMetricsSchema.parse(args);
            const result = await getPoolMetrics(validatedInput as PoolMetricsInput);

            // Return JSON data for frontend consumption
            const jsonOutput = JSON.stringify(result, null, 2);

            return {
              content: [
                {
                  type: 'text',
                  text: jsonOutput,
                },
              ],
            };
          }

          case 'get_user_by_wallet': {
            const validatedInput = GetUserByWalletSchema.parse(args);
            const result = await getUserByWallet(validatedInput as GetUserByWalletInput);
            const formattedOutput = formatUserInfo(result);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'get_wallet_performance': {
            const validatedInput = GetWalletPerformanceSchema.parse(args);
            const result = await getWalletPerformance(validatedInput as GetWalletPerformanceInput);
            const formattedOutput = formatWalletPerformance(result);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'get_bin_distribution': {
            const validatedInput = GetBinDistributionSchema.parse(args);
            const result = await getBinDistribution(validatedInput);
            const formattedOutput = formatBinDistribution(result);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'calculate_rebalance': {
            const validatedInput = CalculateRebalanceSchema.parse(args);
            const result = await calculateRebalance(validatedInput);
            const formattedOutput = formatCalculateRebalance(result);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'get_user_positions_with_sync': {
            const validatedInput = GetUserPositionsWithSyncSchema.parse(args);
            const result = await getUserPositionsWithSync(validatedInput as SyncPositionInput);

            // Return JSON data for frontend consumption
            // The frontend expects: { positions: [...], summary: {...} }
            const jsonOutput = JSON.stringify(result, null, 2);

            return {
              content: [
                {
                  type: 'text',
                  text: jsonOutput,
                },
              ],
            };
          }

          case 'analyze_reposition': {
            const validatedInput = AnalyzeRepositionSchema.parse(args);
            const result = await analyzeReposition(validatedInput);
            const formattedOutput = formatAnalyzeReposition(result);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'prepare_reposition': {
            const validatedInput = PrepareRepositionSchema.parse(args);

            // Check subscription before executing premium tool
            const subscriptionCheck = await checkSubscription(name, validatedInput);
            if (!subscriptionCheck.allowed) {
              const errorMessage = formatSubscriptionError(subscriptionCheck);
              return {
                content: [
                  {
                    type: 'text',
                    text: errorMessage,
                  },
                ],
                isError: true,
              };
            }

            const result = await prepareReposition(validatedInput as RepositionInput);
            const formattedOutput = formatPrepareReposition(result);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'get_position_chain': {
            const validatedInput = GetPositionChainSchema.parse(args);
            const result = await getPositionChain(validatedInput);
            const formattedOutput = formatPositionChain(result);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'get_wallet_reposition_stats': {
            const validatedInput = GetWalletRepositionStatsSchema.parse(args);
            const result = await getWalletRepositionStats(validatedInput);
            const formattedOutput = formatWalletRepositionStats(result);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'generate_wallet_link_token': {
            const validatedInput = GenerateWalletLinkTokenSchema.parse(args);
            const result = await generateWalletLinkToken(validatedInput as GenerateWalletLinkTokenInput);
            const formattedOutput = formatGenerateWalletLinkToken(result);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'link_wallet': {
            const validatedInput = LinkWalletSchema.parse(args);
            const result = await linkWallet(validatedInput as LinkWalletInput);
            const formattedOutput = formatLinkWallet(result);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'link_wallet_by_short_token': {
            const validatedInput = LinkWalletByShortTokenSchema.parse(args);
            const result = await linkWalletByShortToken(validatedInput);
            const formattedOutput = formatLinkWalletByShortToken(result);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'get_linked_account': {
            const validatedInput = GetLinkedAccountSchema.parse(args);
            const result = await getLinkedAccount(validatedInput as GetLinkedAccountInput);
            const formattedOutput = formatGetLinkedAccount(result);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'unlink_wallet': {
            const validatedInput = UnlinkWalletSchema.parse(args);
            const result = await unlinkWallet(validatedInput as UnlinkWalletInput);
            const formattedOutput = formatUnlinkWallet(result);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'delete_wallet_completely': {
            const validatedInput = DeleteWalletCompletelySchema.parse(args);
            const result = await deleteWalletCompletely(validatedInput as DeleteWalletCompletelyInput);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'get_reposition_settings': {
            const validatedInput = GetRepositionSettingsSchema.parse(args);
            const result = await getRepositionSettings(validatedInput as GetRepositionSettingsInput);
            const formattedOutput = formatGetRepositionSettings(result);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'update_reposition_settings': {
            const validatedInput = UpdateRepositionSettingsSchema.parse(args);
            const result = await updateRepositionSettings(validatedInput as UpdateRepositionSettingsInput);
            const formattedOutput = formatUpdateRepositionSettings(result);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'check_subscription': {
            const validatedInput = CheckSubscriptionSchema.parse(args);
            const result = await checkSubscriptionTool(validatedInput as CheckSubscriptionInput);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'record_execution': {
            const validatedInput = RecordExecutionSchema.parse(args);
            const result = await recordExecution(validatedInput as RecordExecutionInput);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'get_credit_balance': {
            const validatedInput = GetCreditBalanceSchema.parse(args);
            const result = await getCreditBalance(validatedInput as GetCreditBalanceInput);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'purchase_credits': {
            const validatedInput = PurchaseCreditsSchema.parse(args);
            const result = await purchaseCredits(validatedInput as PurchaseCreditsInput);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'use_credits': {
            const validatedInput = UseCreditsSchema.parse(args);
            const result = await useCredits(validatedInput as UseCreditsInput);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'calculate_position_pnl': {
            const validatedInput = CalculatePositionPnLSchema.parse(args);
            const result = await calculatePositionPnL_tool(validatedInput as CalculatePositionPnLInput);

            // Return JSON data for programmatic consumption by Garden Bot
            const jsonOutput = JSON.stringify(result, null, 2);

            return {
              content: [
                {
                  type: 'text',
                  text: jsonOutput,
                },
              ],
            };
          }

          case 'close_position': {
            const validatedInput = ClosePositionSchema.parse(args);
            const result = await closePosition_tool(validatedInput as ClosePositionInput);

            // Return JSON data for programmatic consumption by Garden Bot
            const jsonOutput = JSON.stringify(result, null, 2);

            return {
              content: [
                {
                  type: 'text',
                  text: jsonOutput,
                },
              ],
            };
          }

          case 'get_wallet_pnl': {
            const validatedInput = GetWalletPnLSchema.parse(args);
            const result = await getWalletPnL_tool(validatedInput as GetWalletPnLInput);
            const formattedOutput = formatWalletPnL(result);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'sync_wallet_positions': {
            const validatedInput = SyncWalletPositionsSchema.parse(args);
            const result = await syncWalletPositions(validatedInput as SyncWalletPositionsInput);

            // Return JSON data for frontend consumption
            const jsonOutput = JSON.stringify(result, null, 2);

            return {
              content: [
                {
                  type: 'text',
                  text: jsonOutput,
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        logger.error(`Error executing tool ${name}:`, error);

        // Use appropriate error formatter based on tool
        let errorMessage: string;
        switch (name) {
          case 'get_user_by_wallet':
            errorMessage = formatUserError(error);
            break;
          case 'get_wallet_performance':
            errorMessage = formatPerformanceError(error);
            break;
          case 'get_bin_distribution':
            errorMessage = formatBinDistributionError(error);
            break;
          case 'calculate_rebalance':
            errorMessage = formatCalculateRebalanceError(error);
            break;
          case 'get_user_positions_with_sync':
            errorMessage = formatSyncPositionsError(error);
            break;
          case 'analyze_reposition':
            errorMessage = formatAnalyzeRepositionError(error);
            break;
          case 'prepare_reposition':
            errorMessage = formatPrepareRepositionError(error);
            break;
          case 'get_position_chain':
            errorMessage = formatPositionChainError(error);
            break;
          case 'get_wallet_reposition_stats':
            errorMessage = formatWalletRepositionStatsError(error);
            break;
          case 'generate_wallet_link_token':
            errorMessage = formatGenerateWalletLinkTokenError(error);
            break;
          case 'link_wallet':
            errorMessage = formatLinkWalletError(error);
            break;
          case 'link_wallet_by_short_token':
            errorMessage = formatLinkWalletByShortTokenError(error);
            break;
          case 'get_linked_account':
            errorMessage = formatGetLinkedAccountError(error);
            break;
          case 'unlink_wallet':
            errorMessage = formatUnlinkWalletError(error);
            break;
          case 'delete_wallet_completely':
            errorMessage = `Error deleting wallet: ${error instanceof Error ? error.message : 'Unknown error'}`;
            break;
          case 'get_reposition_settings':
            errorMessage = formatGetRepositionSettingsError(error);
            break;
          case 'update_reposition_settings':
            errorMessage = formatUpdateRepositionSettingsError(error);
            break;
          case 'check_subscription':
            errorMessage = `Error checking subscription: ${error instanceof Error ? error.message : 'Unknown error'}`;
            break;
          case 'record_execution':
            errorMessage = `Error recording execution: ${error instanceof Error ? error.message : 'Unknown error'}`;
            break;
          case 'calculate_position_pnl':
            errorMessage = formatCalculatePnLError(error);
            break;
          case 'close_position':
            errorMessage = formatClosePositionError(error);
            break;
          case 'get_wallet_pnl':
            errorMessage = formatWalletPnLError(error);
            break;
          case 'sync_wallet_positions':
            errorMessage = `Error syncing wallet positions: ${error instanceof Error ? error.message : 'Unknown error'}`;
            break;
          default:
            errorMessage = formatToolError(error);
        }

        return {
          content: [
            {
              type: 'text',
              text: errorMessage,
            },
          ],
          isError: true,
        };
      }
    });

    logger.info('Request handlers configured');
  }

  /**
   * Starts the server
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();

    logger.info('Starting MCP server with stdio transport');
    logger.info(`Solana RPC: ${config.solanaRpcUrl}`);
    logger.info(`Default Pool: ${config.defaultPoolAddress}`);
    logger.info(`Cache TTL: ${config.cacheTtl}s`);
    logger.info(`Birdeye API: ${config.birdeyeApiKey ? 'Enabled' : 'Disabled (using Jupiter fallback)'}`);

    // Connect to database
    try {
      await database.connect();
      logger.info('Database connection initialized');
    } catch (error) {
      logger.warn('Failed to connect to database - user context features will be unavailable:', error);
    }

    // Start background sync service (if enabled)
    if (config.backgroundSyncEnabled) {
      try {
        backgroundSync.start();
        logger.info('Background sync service started');
      } catch (error) {
        logger.error('Failed to start background sync service:', error);
        // Continue without background sync
      }
    } else {
      logger.info('Background sync service is disabled');
    }

    await this.server.connect(transport);

    logger.info('MCP server started successfully');
    logger.info('Waiting for requests...');
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down MCP server...');

    // Stop background sync worker
    try {
      backgroundSync.stop();
      logger.info('Background sync worker stopped');
    } catch (error) {
      logger.error('Error stopping background sync worker:', error);
    }

    // Disconnect database
    try {
      await database.disconnect();
      logger.info('Database connection closed');
    } catch (error) {
      logger.error('Error closing database connection:', error);
    }

    await this.server.close();
    logger.info('MCP server stopped');
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const server = new HypebiscusMCPServer();

  // Handle process signals
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT signal');
    await server.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM signal');
    await server.shutdown();
    process.exit(0);
  });

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });

  try {
    await server.start();
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Run the server
main();
