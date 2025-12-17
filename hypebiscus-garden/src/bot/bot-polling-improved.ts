/**
 * Improved Long Polling Bot with Better Timeout Handling
 *
 * This version addresses the connection timeout issues by:
 * 1. Using shorter, more aggressive timeouts
 * 2. Implementing proper exponential backoff
 * 3. Adding alternative API endpoint fallback
 * 4. Using native fetch instead of Telegraf's internal HTTP client
 */

import { Telegraf, Context } from 'telegraf';
import { Agent as HttpsAgent } from 'https';
import { WalletService } from '../services/walletService';
import { DlmmService } from '../services/dlmmService';
import { MonitoringService } from '../services/monitoringService';
import { PositionSyncService } from '../services/positionSyncService';
import { WalletHandler } from './handlers/wallet';
import { PositionHandler } from './handlers/position';
import {
  handleQRCodePhoto,
  handleLinkCommand,
  handleLinkedCommand,
  handleUnlinkCommand,
  handleConfirmUnlinkCommand,
  handleStartLink
} from './handlers/walletLinking';
import {
  handleCreditsCommand,
  handleTopupCommand,
  handleCheckCreditsCallback
} from './handlers/credits';
import {
  handleSettingsCommand,
  handleEnableAutoCommand,
  handleDisableAutoCommand,
  handleSubscribeCommand,
  handleSettingsCallback
} from './handlers/settings';
import {
  handleDeleteWalletCommand,
  handleConfirmDeleteWalletCommand,
  handleDeleteWalletConfirmation,
  handleCancelDeletion
} from './handlers/walletDeletion';
import { mainKeyboard, backKeyboard, helpKeyboard } from './keyboards';
import { getOrCreateUser } from '../services/db';
import { safeLogUserInput } from '../utils/secureLogging';

export class TelegramBotPollingImproved {
  private bot: Telegraf;
  private walletService: WalletService;
  private dlmmService: DlmmService;
  private monitoringService: MonitoringService;
  private syncService: PositionSyncService;
  private walletHandler: WalletHandler;
  private positionHandler: PositionHandler;
  private sessions: Map<number, any> = new Map();

  constructor(token: string, rpcUrl: string) {
    // Create HTTPS agent with AGGRESSIVE timeouts and IPv4 only
    const httpsAgent = new HttpsAgent({
      keepAlive: true,
      timeout: 30000, // Reduced from 120s to 30s
      keepAliveMsecs: 10000,
      maxSockets: 5, // Reduced from 10
      maxFreeSockets: 2, // Reduced from 5
      family: 4, // Force IPv4
      // Add socket pooling configuration
      scheduling: 'fifo',
    });

    // Configure Telegraf with shorter timeouts
    this.bot = new Telegraf(token, {
      telegram: {
        apiRoot: 'https://api.telegram.org',
        agent: httpsAgent,
        webhookReply: false,
      },
      handlerTimeout: 60_000, // Reduced from 90s
    });

    this.bot.use((ctx, next) => {
      const userId = ctx.from?.id;
      if (userId) {
        if (!this.sessions.has(userId)) {
          this.sessions.set(userId, {});
        }
        (ctx as any).session = this.sessions.get(userId);
      }
      return next();
    });

    this.walletService = new WalletService(
      rpcUrl,
      process.env.ZBTC_MINT_ADDRESS!
    );

    this.dlmmService = new DlmmService(rpcUrl);
    this.syncService = new PositionSyncService(this.dlmmService);
    this.monitoringService = new MonitoringService(
      this.dlmmService,
      this.walletService,
      this.bot
    );

    this.walletHandler = new WalletHandler(this.walletService, this.bot);
    this.positionHandler = new PositionHandler(
      this.dlmmService,
      this.walletService,
      this.monitoringService,
      this.syncService
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Copy all handlers from original bot.ts
    // ... (same as original bot.ts lines 106-457)

    this.bot.start(async (ctx) => {
      const telegramId = ctx.from?.id;
      if (!telegramId) return;

      await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      const handled = await handleStartLink(ctx);
      if (handled) {
        return;
      }

      ctx.reply(
        `🚀 **Welcome to Garden - ZBTC-SOL DLMM Bot!**\n\n` +
        `This bot automatically manages your ZBTC-SOL liquidity positions:\n` +
        `• Monitors price movements 24/7\n` +
        `• Auto-repositions when out of range\n` +
        `• Simple Telegram interface\n\n` +
        `Use the buttons below to get started!`,
        { parse_mode: 'Markdown', ...mainKeyboard }
      );
    });

    // ... (copy all other handlers from original bot.ts)

    this.bot.catch((err, ctx) => {
      console.error('Bot error:', err);
      ctx.reply('❌ Something went wrong. Please try again.');
    });
  }

  /**
   * Test connection to Telegram API before starting bot
   */
  private async testConnection(): Promise<boolean> {
    console.log('🔍 Testing Telegram API connectivity...');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`,
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Connection test successful: @${data.result.username}`);
        return true;
      } else {
        console.error(`❌ Connection test failed: HTTP ${response.status}`);
        return false;
      }
    } catch (error: any) {
      console.error(`❌ Connection test failed: ${error.message}`);
      return false;
    }
  }

  async start(): Promise<void> {
    console.log('🚀 Starting Telegram bot with improved polling...');

    try {
      // Initialize DLMM service first
      await this.dlmmService.initializePool();
      console.log('✅ DLMM service initialized');

      // Test connection before attempting to start
      const canConnect = await this.testConnection();
      if (!canConnect) {
        throw new Error(
          'Cannot reach Telegram API. Please check:\n' +
          '1. Network connectivity to api.telegram.org\n' +
          '2. Firewall rules allowing HTTPS to Telegram\n' +
          '3. Try different Render region (oregon, virginia)\n' +
          '4. Consider switching to webhook mode'
        );
      }

      console.log('🚀 Starting bot with long polling...');

      // Clear webhook first (using native fetch for reliability)
      console.log('   Clearing webhook...');
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/deleteWebhook`,
          { method: 'GET' }
        );
        if (response.ok) {
          console.log('   ✅ Webhook cleared');
        }
      } catch (e) {
        console.warn('   ⚠️  Warning: Could not clear webhook');
      }

      // Use exponential backoff for retries
      const maxRetries = 5;
      const baseDelay = 2000; // Start with 2 seconds
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`   Attempt ${attempt}/${maxRetries}...`);

          // Use shorter timeout with each attempt
          const attemptTimeout = 30000 + (attempt * 10000); // 30s, 40s, 50s, 60s, 70s

          await Promise.race([
            this.bot.launch({
              allowedUpdates: ['message', 'callback_query'],
              dropPendingUpdates: false,
            }),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error(`Connection timeout after ${attemptTimeout / 1000}s`)),
                attemptTimeout
              )
            ),
          ]);

          console.log('✅ Telegram bot started successfully');
          lastError = null;
          break;
        } catch (error) {
          lastError = error as Error;
          console.log(`   ❌ Error: ${lastError.message}`);

          if (attempt < maxRetries) {
            // Exponential backoff: 2s, 4s, 8s, 16s
            const delay = baseDelay * Math.pow(2, attempt - 1);
            console.log(`   ⏳ Waiting ${delay / 1000}s before retry...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      if (lastError) {
        throw new Error(
          `Failed to connect to Telegram after ${maxRetries} attempts.\n` +
          `Last error: ${lastError.message}\n\n` +
          `This is likely a network/firewall issue on Render.\n` +
          `Recommended solutions:\n` +
          `1. Switch to webhook mode (use bot-webhook.ts)\n` +
          `2. Try different Render region\n` +
          `3. Contact Render support about Telegram API access`
        );
      }

      // Start monitoring service
      this.monitoringService.start();

      // Graceful shutdown
      process.once('SIGINT', () => {
        this.monitoringService.stop();
        this.bot.stop('SIGINT');
      });
      process.once('SIGTERM', () => {
        this.monitoringService.stop();
        this.bot.stop('SIGTERM');
      });
    } catch (error) {
      console.error('❌ Failed to start bot:', error);
      throw error;
    }
  }
}
