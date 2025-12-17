import { Telegraf, Context } from 'telegraf';
import { Agent as HttpsAgent } from 'https';
import express from 'express';
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

/**
 * Webhook-based Telegram Bot for Production Deployment on Render
 *
 * WEBHOOK MODE BENEFITS:
 * - More reliable for cloud deployments
 * - Better suited for Render's network environment
 * - No long-running polling connections that can timeout
 * - Lower resource usage
 * - Faster message delivery
 */
export class TelegramBotWebhook {
  private bot: Telegraf;
  private walletService: WalletService;
  private dlmmService: DlmmService;
  private monitoringService: MonitoringService;
  private syncService: PositionSyncService;
  private walletHandler: WalletHandler;
  private positionHandler: PositionHandler;
  private sessions: Map<number, any> = new Map();
  private app: express.Application;
  private webhookPort: number;
  private webhookDomain: string;

  constructor(token: string, rpcUrl: string, webhookDomain: string, port: number = 3000) {
    this.webhookDomain = webhookDomain;
    this.webhookPort = port;

    // Create HTTPS agent for API calls
    const httpsAgent = new HttpsAgent({
      keepAlive: true,
      timeout: 30000,
      keepAliveMsecs: 10000,
      maxSockets: 10,
    });

    // Configure Telegraf for webhook mode
    this.bot = new Telegraf(token, {
      telegram: {
        apiRoot: 'https://api.telegram.org',
        agent: httpsAgent,
        webhookReply: true, // Enable webhook mode
      },
      handlerTimeout: 90_000,
    });

    // Session middleware
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

    // Initialize Express app for webhook
    this.app = express();
    this.app.use(express.json());

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Copy all handlers from original bot.ts (same as lines 106-457)
    // ... [handlers code identical to original bot.ts] ...

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

    // Add all other handlers here (copy from original bot.ts lines 134-457)
    // ... [rest of handlers] ...

    this.bot.catch((err, ctx) => {
      console.error('Bot error:', err);
      ctx.reply('❌ Something went wrong. Please try again.');
    });
  }

  async start(): Promise<void> {
    console.log('🚀 Starting Telegram bot in WEBHOOK mode...');

    try {
      // Initialize DLMM service
      await this.dlmmService.initializePool();
      console.log('✅ DLMM service initialized');

      // Configure webhook
      const webhookPath = `/telegram-webhook/${process.env.TELEGRAM_BOT_TOKEN}`;
      // Remove trailing slash from webhookDomain if present
      const cleanDomain = this.webhookDomain.replace(/\/$/, '');
      const webhookUrl = `${cleanDomain}${webhookPath}`;

      console.log(`🌐 Setting up webhook: ${webhookUrl}`);

      // Delete any existing webhook
      await this.bot.telegram.deleteWebhook({ drop_pending_updates: true });
      console.log('✅ Old webhook deleted');

      // Set new webhook
      await this.bot.telegram.setWebhook(webhookUrl, {
        drop_pending_updates: false,
        allowed_updates: ['message', 'callback_query'],
      });
      console.log('✅ Webhook configured successfully');

      // Setup Express webhook endpoint
      this.app.post(webhookPath, (req, res) => {
        this.bot.handleUpdate(req.body, res);
      });

      // Health check endpoint
      this.app.get('/health', (req, res) => {
        res.json({ status: 'ok', mode: 'webhook' });
      });

      // Start Express server
      this.app.listen(this.webhookPort, () => {
        console.log(`✅ Webhook server listening on port ${this.webhookPort}`);
        console.log(`📡 Webhook endpoint: ${webhookUrl}`);
      });

      // Verify webhook info
      const webhookInfo = await this.bot.telegram.getWebhookInfo();
      console.log('📊 Webhook Info:', {
        url: webhookInfo.url,
        pending_update_count: webhookInfo.pending_update_count,
        has_custom_certificate: webhookInfo.has_custom_certificate,
      });

      // Start monitoring service
      this.monitoringService.start();
      console.log('✅ Monitoring service started');

      // Graceful shutdown handlers
      process.once('SIGINT', () => this.stop('SIGINT'));
      process.once('SIGTERM', () => this.stop('SIGTERM'));

    } catch (error) {
      console.error('❌ Failed to start bot:', error);
      throw error;
    }
  }

  async stop(signal: string): Promise<void> {
    console.log(`\n🛑 Shutting down (${signal})...`);
    this.monitoringService.stop();
    await this.bot.telegram.deleteWebhook();
    process.exit(0);
  }
}
