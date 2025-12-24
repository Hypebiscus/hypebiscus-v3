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
import { getOrCreateUser, getActivePositions } from '../services/db';
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

      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      const handled = await handleStartLink(ctx);
      if (handled) {
        return;
      }

      // Get user's actual monitoring status
      const activePositions = await getActivePositions(user.id);
      const monitoringStatus = user.isMonitoring ? '✅ Enabled' : '❌ Disabled';

      ctx.reply(
        `🚀 **Welcome to Garden - ZBTC-SOL DLMM Bot!**\n\n` +
        `This bot automatically manages your ZBTC-SOL liquidity positions:\n` +
        `• Monitors price movements 24/7\n` +
        `• Smart auto-repositioning\n` +
        `• Simple Telegram interface\n\n` +
        `📊 **Your Status:**\n` +
        `🔄 Auto-Reposition: ${monitoringStatus}\n` +
        `📍 Active Positions: ${activePositions.length}\n\n` +
        `Use the buttons below to get started!`,
        { parse_mode: 'Markdown', ...mainKeyboard }
      );
    });

    this.bot.help((ctx) => {
      ctx.reply(
        `🤖 **ZBTC-SOL DLMM Bot Help**\n\n` +
        `Choose a category to see available commands:`,
        { parse_mode: 'Markdown', ...helpKeyboard }
      );
    });

    this.bot.command('status', async (ctx) => {
      const telegramId = ctx.from?.id;
      if (!telegramId) return;

      try {
        const user = await getOrCreateUser(
          telegramId,
          ctx.from?.username,
          ctx.from?.first_name,
          ctx.from?.last_name
        );

        const activePositions = await getActivePositions(user.id);
        const status = this.monitoringService.getStatus();
        const poolStatus = await this.dlmmService.getPoolStatus();

        ctx.reply(
          `📊 **Monitoring Status**\n\n` +
          `👤 **Your Account:**\n` +
          `🔄 Auto-Reposition: ${user.isMonitoring ? '✅ Enabled' : '❌ Disabled'}\n` +
          `📍 Active Positions: ${activePositions.length}\n\n` +
          `🤖 **Bot System:**\n` +
          `🔄 System Status: ${status.isMonitoring ? '✅ Running' : '❌ Stopped'}\n\n` +
          `💰 **ZBTC-SOL Pool:**\n` +
          `📈 Current Price: $${poolStatus.currentPrice.toFixed(6)}\n` +
          `🆔 Active Bin: ${poolStatus.activeBinId}\n` +
          `📊 24h Change: ${poolStatus.priceChange24h.toFixed(2)}%\n\n` +
          `🕒 Last Updated: ${new Date().toLocaleTimeString()}`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('Error getting status:', error);
        ctx.reply('❌ Failed to get status. Try again later.');
      }
    });

    this.bot.command('balance', async (ctx) => {
      const telegramId = ctx.from?.id;
      if (!telegramId) return;

      try {
        const user = await getOrCreateUser(
          telegramId,
          ctx.from?.username,
          ctx.from?.first_name,
          ctx.from?.last_name
        );

        if (!user.wallet) {
          ctx.reply('❌ No wallet found. Create a wallet first using the menu.');
          return;
        }

        const balance = await this.walletService.getBalance(user.id);
        if (balance) {
          ctx.reply(
            `💰 **Your Balance**\n\n` +
            `💎 SOL: ${balance.sol.toFixed(4)}\n` +
            `🟡 ZBTC: ${balance.zbtc.toFixed(6)}`,
            { parse_mode: 'Markdown' }
          );
        } else {
          ctx.reply('❌ Failed to fetch balance.');
        }
      } catch (error) {
        console.error('Error getting balance:', error);
        ctx.reply('❌ Failed to get balance. Try again.');
      }
    });

    // Wallet linking commands
    this.bot.command('link', handleLinkCommand);
    this.bot.command('linked', handleLinkedCommand);
    this.bot.command('unlink', handleUnlinkCommand);
    this.bot.command('confirm_unlink', handleConfirmUnlinkCommand);

    // Credits and subscription commands
    this.bot.command('credits', handleCreditsCommand);
    this.bot.command('topup', handleTopupCommand);
    this.bot.command('settings', handleSettingsCommand);
    this.bot.command('enableauto', handleEnableAutoCommand);
    this.bot.command('disableauto', handleDisableAutoCommand);
    this.bot.command('subscribe', handleSubscribeCommand);

    // Wallet deletion commands
    this.bot.command('deletewallet', handleDeleteWalletCommand);
    this.bot.command('confirmdeletewallet', handleConfirmDeleteWalletCommand);
    this.bot.command('cancel', handleCancelDeletion);

    // Photo handler for QR code scanning
    this.bot.on('photo', handleQRCodePhoto);

    this.bot.action('main_menu', (ctx) => {
      ctx.editMessageText(
        '🏠 **Main Menu**\n\nChoose an option:',
        { parse_mode: 'Markdown', ...mainKeyboard }
      );
    });

    this.bot.action('wallet_info', (ctx) => {
      this.walletHandler.handleWalletInfo(ctx);
    });

    this.bot.action('create_wallet', (ctx) => {
      this.walletHandler.handleCreateWallet(ctx);
    });

    this.bot.action('import_wallet', (ctx) => {
      this.walletHandler.handleImportWallet(ctx);
    });

    this.bot.action('export_key', (ctx) => {
      this.walletHandler.handleExportPrivateKey(ctx);
    });

    this.bot.action(/^confirm_export_(.+)$/, (ctx) => {
      const userId = ctx.match[1];
      this.walletHandler.handleConfirmExport(ctx, userId);
    });

    this.bot.action('create_position', (ctx) => {
      this.positionHandler.handleCreatePosition(ctx);
    });

    this.bot.action('view_positions', (ctx) => {
      this.positionHandler.handleViewPositions(ctx);
    });

    this.bot.action('view_history', (ctx) => {
      this.positionHandler.handleViewHistory(ctx);
    });

    this.bot.action('toggle_monitoring', (ctx) => {
      this.positionHandler.handleToggleMonitoring(ctx);
    });

    this.bot.action('close_position', (ctx) => {
      this.positionHandler.handleClosePosition(ctx);
    });

    this.bot.action(/^close_pos_(.+)$/, (ctx) => {
      const positionId = ctx.match[1];
      this.positionHandler.handleConfirmClosePosition(ctx, positionId);
    });

    this.bot.action(/^confirm_close_(.+)$/, (ctx) => {
      const positionId = ctx.match[1];
      this.positionHandler.handleExecuteClose(ctx, positionId);
    });

    // Credits and settings callback handlers
    this.bot.action('check_credits', handleCheckCreditsCallback);
    this.bot.action('enable_auto', handleSettingsCallback);
    this.bot.action('disable_auto', handleSettingsCallback);
    this.bot.action('refresh_settings', handleSettingsCallback);
    this.bot.action('subscribe', handleSettingsCallback);
    this.bot.action('refresh_subscription', handleSettingsCallback);
    this.bot.action('use_credits', handleSettingsCallback);
    this.bot.action('change_threshold', handleSettingsCallback);
    this.bot.action('change_gas', handleSettingsCallback);
    this.bot.action('toggle_notifications', handleSettingsCallback);

    this.bot.action('pool_status', async (ctx) => {
      try {
        const poolStatus = await this.dlmmService.getPoolStatus();
        ctx.editMessageText(
          `📈 **ZBTC-SOL Pool Status**\n\n` +
          `💰 Current Price: ${poolStatus.currentPrice.toFixed(6)}\n` +
          `🆔 Active Bin ID: ${poolStatus.activeBinId}\n` +
          `📊 24h Change: ${poolStatus.priceChange24h.toFixed(2)}%\n` +
          `💧 Total Liquidity: ${poolStatus.totalLiquidity}\n\n` +
          `🔄 Last Updated: ${new Date().toLocaleTimeString()}`,
          { parse_mode: 'Markdown', ...backKeyboard }
        );
      } catch (error) {
        console.error('Error getting pool status:', error);
        ctx.editMessageText(
          '❌ Failed to fetch pool status. Try again later.',
          backKeyboard
        );
      }
    });

    this.bot.action('delete_pk_msg', async (ctx) => {
      try {
        await ctx.deleteMessage();
        await ctx.reply(
          '✅ Message deleted!\n\nMake sure you saved your private key.',
          mainKeyboard
        );
      } catch (error) {
        console.error('Error deleting message:', error);
        await ctx.answerCbQuery('❌ Failed to delete message');
      }
    });

    // Help category handlers
    this.bot.action('help_wallet', (ctx) => {
      ctx.editMessageText(
        `👛 **Wallet Commands**\n\n` +
        `**/balance** - Check wallet balance\n` +
        `**Wallet Info** button - View wallet details\n` +
        `**Create Wallet** - Generate new wallet\n` +
        `**Import Wallet** - Import existing wallet\n` +
        `**Export Key** - Export private key\n\n` +
        `💡 Supports 5 import formats:\n` +
        `• Base58 (Phantom/Solflare)\n` +
        `• JSON array\n` +
        `• Hex (with/without 0x)\n` +
        `• Mnemonic (12/24 words)\n` +
        `• Comma-separated numbers`,
        { parse_mode: 'Markdown', ...helpKeyboard }
      );
    });

    this.bot.action('help_positions', (ctx) => {
      ctx.editMessageText(
        `💼 **Position Commands**\n\n` +
        `**Create Position** - Open new DLMM position\n` +
        `**View Positions** - See active positions\n` +
        `**Close Position** - Close a position\n` +
        `**Position History** - View past positions\n` +
        `**/status** - Show bot & pool status\n\n` +
        `📊 Features:\n` +
        `• Real-time position tracking\n` +
        `• PnL calculation\n` +
        `• Fee earnings monitoring\n` +
        `• Historical performance`,
        { parse_mode: 'Markdown', ...helpKeyboard }
      );
    });

    this.bot.action('help_settings', (ctx) => {
      ctx.editMessageText(
        `⚙️ **Settings & Auto-Reposition**\n\n` +
        `**/settings** - View/edit all settings\n` +
        `**/enableauto** - Enable auto-repositioning\n` +
        `**/disableauto** - Disable auto-repositioning\n` +
        `**Reposition** button - Toggle monitoring\n\n` +
        `🤖 Auto-Reposition Features:\n` +
        `• 24/7 position monitoring\n` +
        `• Automatic out-of-range detection\n` +
        `• Smart repositioning\n` +
        `• Real-time notifications\n\n` +
        `⚠️ Requires imported wallet with private key`,
        { parse_mode: 'Markdown', ...helpKeyboard }
      );
    });

    this.bot.action('help_payment', (ctx) => {
      ctx.editMessageText(
        `💳 **Payment & Credits**\n\n` +
        `**/credits** - Check credit balance\n` +
        `**/topup** - Purchase credits\n` +
        `**/subscribe** - Subscribe to premium\n\n` +
        `💰 Payment Options:\n` +
        `• Pay-per-use (credits)\n` +
        `• Monthly subscription\n` +
        `• Premium features access\n\n` +
        `🎁 Benefits:\n` +
        `• Unlimited auto-repositions\n` +
        `• Priority support\n` +
        `• Advanced analytics`,
        { parse_mode: 'Markdown', ...helpKeyboard }
      );
    });

    this.bot.action('help_linking', (ctx) => {
      ctx.editMessageText(
        `🔗 **Wallet Linking**\n\n` +
        `**/link <CODE>** - Link website wallet\n` +
        `**/linked** - Check link status\n` +
        `**/unlink** - Unlink wallet\n\n` +
        `🌐 How It Works:\n` +
        `1. Connect wallet on website\n` +
        `2. Scan QR code or use link code\n` +
        `3. Get notifications in Telegram\n\n` +
        `🚀 Upgrade to Full Access:\n` +
        `• Import same wallet's private key\n` +
        `• Enables auto-repositioning\n` +
        `• Same wallet everywhere\n\n` +
        `**Wallet Deletion:**\n` +
        `**/deletewallet** - Delete wallet (PERMANENT)\n` +
        `**/confirmdeletewallet** - Confirm deletion\n` +
        `**/cancel** - Cancel deletion`,
        { parse_mode: 'Markdown', ...helpKeyboard }
      );
    });

    this.bot.on('text', async (ctx) => {
      const text = ctx.text;
      const userId = ctx.from?.id;
      if (!userId) return;

      const session = this.sessions.get(userId) || {};

      // Safely log user input (censors private keys automatically)
      safeLogUserInput(userId, text);
      console.log(`🔍 Session state:`, session);

      if (session.waitingForPrivateKey) {
        await this.walletHandler.handlePrivateKeyInput(ctx, text);
        this.sessions.delete(userId);
        return;
      }

      if (session.waitingForAmount) {
        console.log(`✅ Processing amount input: ${text}`);
        await this.positionHandler.handleAmountInput(ctx, text);
        this.sessions.delete(userId);
        return;
      }

      // Check if user is confirming wallet deletion
      if (session.awaitingWalletDeletion) {
        await handleDeleteWalletConfirmation(ctx);
        return;
      }

      console.log(`❌ No session handler found for user ${userId}`);
      ctx.reply(
        '❓ I didn\'t understand that. Use /help to see available commands or use the buttons below.',
        mainKeyboard
      );
    });

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
