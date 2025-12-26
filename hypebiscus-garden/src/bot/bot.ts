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
import { getOrCreateUser, getActivePositions } from '../services/db';
import { safeLogUserInput } from '../utils/secureLogging';

export class TelegramBot {
  private bot: Telegraf;
  private walletService: WalletService;
  private dlmmService: DlmmService;
  private monitoringService: MonitoringService;
  private syncService: PositionSyncService;
  private walletHandler: WalletHandler;
  private positionHandler: PositionHandler;
  private sessions: Map<number, any> = new Map();

  constructor(token: string, rpcUrl: string) {
    // Create HTTPS agent with longer timeout for slow networks
    const httpsAgent = new HttpsAgent({
      keepAlive: true,
      timeout: 120000, // 120 seconds connection timeout
      keepAliveMsecs: 30000,
      maxSockets: 10,
      maxFreeSockets: 5,
      family: 4, // Force IPv4 only (IPv6 may be blocked)
    });

    // Configure Telegraf with custom agent and timeouts
    this.bot = new Telegraf(token, {
      telegram: {
        apiRoot: 'https://api.telegram.org',
        agent: httpsAgent,
        webhookReply: false, // Use long polling (not webhook)
      },
      handlerTimeout: 90_000, // 90 seconds for handler execution
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
    this.bot.start(async (ctx) => {
      const telegramId = ctx.from?.id;
      if (!telegramId) return;

      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      // Check if this is a deep link for wallet linking
      const handled = await handleStartLink(ctx);
      if (handled) {
        return; // Deep link was handled, don't show welcome message
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
        `🤖 **Auto-Reposition Features:**\n` +
        `• 24/7 position monitoring\n` +
        `• Automatic out-of-range detection\n` +
        `• Smart repositioning\n` +
        `• Real-time notifications\n\n` +
        `💳 **Requirements:**\n` +
        `• Active subscription OR credits\n` +
        `• Wallet linked to Telegram\n` +
        `• Active positions to monitor\n\n` +
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
        `**/disableauto** - Disable auto-repositioning\n\n` +
        `🤖 Auto-Reposition Features:\n` +
        `• 24/7 position monitoring\n` +
        `• Automatic out-of-range detection\n` +
        `• Smart repositioning\n` +
        `• Real-time notifications\n\n` +
        `💳 Requirements:\n` +
        `• Active subscription OR credits\n` +
        `• Wallet linked to Telegram\n` +
        `• Active positions to monitor`,
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
    console.log('🚀 Starting Telegram bot...');

    try {
      await this.dlmmService.initializePool();
      console.log('✅ DLMM service initialized');

      console.log('🚀 Connecting to Telegram API...');

      // WORKAROUND: Manually delete webhook using native HTTPS instead of Telegraf
      // This avoids the node-fetch timeout issue
      console.log('   Clearing webhook manually...');
      try {
        const https = require('https');
        const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/deleteWebhook`;
        await new Promise((resolve, reject) => {
          https.get(url, {timeout: 30000}, (res: any) => {
            let data = '';
            res.on('data', (chunk: any) => data += chunk);
            res.on('end', () => {
              console.log('   ✅ Webhook cleared successfully');
              resolve(data);
            });
          }).on('error', (e: Error) => {
            console.warn('   ⚠️  Warning: Failed to clear webhook:', e.message);
            resolve(null); // Continue anyway
          });
        });
      } catch (e) {
        console.warn('   ⚠️  Warning: Webhook clear failed, continuing anyway');
      }

      // Retry logic for Telegram connection (for slow networks)
      let retries = 3;
      let lastError: Error | null = null;

      while (retries > 0) {
        try {
          console.log(`   Attempt ${4 - retries}/3...`);
          await Promise.race([
            this.bot.launch({
              // Explicitly use long polling mode
              allowedUpdates: ['message', 'callback_query'],
              dropPendingUpdates: false, // Don't drop updates - webhook already cleared
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Connection timeout after 120s')), 120000)
            )
          ]);
          console.log('✅ Telegram bot started successfully');
          lastError = null;
          break;
        } catch (error) {
          lastError = error as Error;
          console.log(`   ❌ Error: ${lastError.message}`);
          console.log(`   Error type: ${lastError.name}, Code: ${(lastError as any).code}`);
          retries--;
          if (retries > 0) {
            console.log(`   ⚠️  Retrying in 5 seconds... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      }

      if (lastError) {
        throw new Error(`Failed to connect to Telegram after 3 attempts: ${lastError.message}`);
      }
      
      this.monitoringService.start();
      
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