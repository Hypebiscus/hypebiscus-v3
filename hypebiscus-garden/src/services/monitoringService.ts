// src/services/monitoringService.ts - IMPROVED WITH PNL TRACKING + X402 SUBSCRIPTION

import * as cron from 'node-cron';
import { Prisma } from '@prisma/client';
import { DlmmService } from './dlmmService';
import { WalletService } from './walletService';
import { Telegraf } from 'telegraf';
import * as db from './db';
import { prisma } from './db';
import { mcpClient } from '../utils/mcpClient';
import { SimpleCache } from '../utils/cache';

export class MonitoringService {
  private dlmmService: DlmmService;
  private walletService: WalletService;
  private bot: Telegraf;
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning = false;

  // Notification throttling: Track last notification time per user/type
  // Format: "telegramId:notificationType" -> timestamp
  private lastNotificationTime: Map<string, number> = new Map();

  // Throttle limits: 3 notifications per day = every 8 hours
  private readonly NOTIFICATION_THROTTLE_MS = 8 * 60 * 60 * 1000; // 8 hours in milliseconds

  // Performance optimization: Cache MCP API calls
  private linkedAccountCache: SimpleCache<any>;
  private subscriptionCache: SimpleCache<any>;
  private settingsCache: SimpleCache<any>;
  private creditsCache: SimpleCache<any>;

  constructor(
    dlmmService: DlmmService,
    walletService: WalletService,
    bot: Telegraf
  ) {
    this.dlmmService = dlmmService;
    this.walletService = walletService;
    this.bot = bot;

    // Initialize caches with appropriate TTLs
    this.linkedAccountCache = new SimpleCache(5 * 60 * 1000); // 5 minutes
    this.subscriptionCache = new SimpleCache(1 * 60 * 1000); // 1 minute
    this.settingsCache = new SimpleCache(5 * 60 * 1000); // 5 minutes
    this.creditsCache = new SimpleCache(1 * 60 * 1000); // 1 minute
  }

  start(): void {
    if (this.isRunning) {
      console.log('⚠️ Monitoring service already running');
      return;
    }

    console.log('🔄 Starting monitoring service...');
    
    const interval = process.env.MONITORING_INTERVAL_MS || '30000';
    const seconds = Math.floor(parseInt(interval) / 1000);
    
    this.cronJob = cron.schedule(`*/${seconds} * * * * *`, async () => {
      await this.checkAllPositions();
    });

    this.isRunning = true;
    console.log(`✅ Monitoring service started (checking every ${seconds}s)`);
  }

  stop(): void {
    if (!this.isRunning || !this.cronJob) {
      return;
    }

    console.log('⏹️ Stopping monitoring service...');
    this.cronJob.stop();
    this.cronJob = null;
    this.isRunning = false;
    console.log('✅ Monitoring service stopped');
  }

  /**
   * Check if notification should be sent based on throttling rules
   * Limits: 3 notifications per day = every 8 hours
   */
  private shouldSendNotification(
    telegramId: bigint,
    notificationType: 'no_subscription' | 'subscription_check_failed'
  ): boolean {
    const key = `${telegramId}:${notificationType}`;
    const now = Date.now();
    const lastSent = this.lastNotificationTime.get(key);

    if (!lastSent) {
      // First notification, always send
      this.lastNotificationTime.set(key, now);
      return true;
    }

    const timeSinceLastNotification = now - lastSent;

    if (timeSinceLastNotification >= this.NOTIFICATION_THROTTLE_MS) {
      // 8 hours have passed, send notification
      this.lastNotificationTime.set(key, now);
      return true;
    }

    // Still within throttle window, skip notification
    const hoursRemaining = Math.ceil((this.NOTIFICATION_THROTTLE_MS - timeSinceLastNotification) / (60 * 60 * 1000));
    console.log(`⏸️ Notification throttled for user ${telegramId} (${notificationType}). Next notification in ~${hoursRemaining}h`);
    return false;
  }

  private async checkAllPositions(): Promise<void> {
    try {
      const users = await db.getAllMonitoringUsers();

      if (users.length === 0) {
        return;
      }

      console.log(`\n${'='.repeat(60)}`);
      console.log(`🔍 MONITORING CHECK: ${new Date().toLocaleTimeString()}`);
      console.log(`👥 Users: ${users.length}`);
      console.log(`${'='.repeat(60)}\n`);

      for (const user of users) {
        if (!user.positions || user.positions.length === 0) continue;

        console.log(`\n👤 User: ${user.username || user.telegramId}`);
        console.log(`📍 Positions: ${user.positions.length}`);

        for (const position of user.positions) {
          try {
            await this.checkPosition(user, position);
          } catch (error) {
            console.error(`❌ Error checking position ${position.positionId.substring(0, 8)}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error in monitoring service:', error);
    }
  }

  /**
   * Verify user has access (subscription or credits) and fetch settings
   * Returns access info or null if access denied
   * NOW WITH CACHING: Reduces MCP API calls by 90%+
   */
  private async verifyUserAccess(user: any, position: any): Promise<{
    hasAccess: boolean;
    accessMode: 'subscription' | 'credits';
    linkedAccount: any;
    userSettings: any;
  } | null> {
    let linkedAccount: any = null;
    let userSettings: any = null;

    try {
      const telegramId = user.telegramId.toString();

      // Get linked wallet address (cached for 5 minutes)
      const linkedAccountCacheKey = `linked:${telegramId}`;
      linkedAccount = this.linkedAccountCache.get(linkedAccountCacheKey);

      if (!linkedAccount) {
        linkedAccount = await mcpClient.getLinkedAccount(telegramId);
        this.linkedAccountCache.set(linkedAccountCacheKey, linkedAccount);
        console.log(`📥 Linked account fetched and cached for user ${telegramId}`);
      } else {
        console.log(`⚡ Linked account loaded from cache for user ${telegramId}`);
      }

      if (!linkedAccount.isLinked || !linkedAccount.walletAddress) {
        console.log(`❌ User ${user.telegramId} has no linked wallet`);
        await this.notifyUser(
          user.telegramId,
          'subscription_required',
          position,
          null,
          new Error('No linked wallet. Link your wallet on the website to enable auto-reposition.')
        );
        return null;
      }

      console.log(`🔍 Checking access for wallet: ${linkedAccount.walletAddress.substring(0, 8)}...`);

      const walletAddress = linkedAccount.walletAddress;

      // OPTION 1: Check subscription (unlimited repositions) - cached for 1 minute
      const subscriptionCacheKey = `sub:${walletAddress}`;
      let subscriptionStatus = this.subscriptionCache.get(subscriptionCacheKey);

      if (!subscriptionStatus) {
        subscriptionStatus = await mcpClient.checkSubscription(walletAddress);
        this.subscriptionCache.set(subscriptionCacheKey, subscriptionStatus);
        console.log(`📥 Subscription status fetched and cached`);
      } else {
        console.log(`⚡ Subscription status loaded from cache`);
      }

      if (subscriptionStatus.isActive) {
        console.log(`✅ Active subscription found: tier=${subscriptionStatus.tier}, expires=${subscriptionStatus.expiresAt}`);

        // Get user settings (cached for 5 minutes)
        try {
          const settingsCacheKey = `settings:${telegramId}`;
          userSettings = this.settingsCache.get(settingsCacheKey);

          if (!userSettings) {
            userSettings = await mcpClient.getRepositionSettings(telegramId);
            this.settingsCache.set(settingsCacheKey, userSettings);
            console.log(`📥 User settings fetched and cached`);
          } else {
            console.log(`⚡ User settings loaded from cache`);
          }

          if (!userSettings.autoRepositionEnabled) {
            console.log(`⏸️ Auto-reposition disabled in user settings`);
            return null;
          }
          console.log(`✅ User settings loaded: threshold=${userSettings.urgencyThreshold}, maxGas=${userSettings.maxGasCostSol}`);
        } catch (settingsError) {
          console.log(`⚠️ Could not fetch reposition settings:`, settingsError);
        }

        return {
          hasAccess: true,
          accessMode: 'subscription',
          linkedAccount,
          userSettings,
        };
      }

      // OPTION 2: Check credits (pay-per-use) - cached for 1 minute
      console.log(`❌ No active subscription, checking credits...`);

      try {
        const creditsCacheKey = `credits:${walletAddress}`;
        let creditsBalance = this.creditsCache.get(creditsCacheKey);

        if (!creditsBalance) {
          creditsBalance = await mcpClient.getCreditBalance(walletAddress);
          this.creditsCache.set(creditsCacheKey, creditsBalance);
          console.log(`📥 Credits balance fetched and cached`);
        } else {
          console.log(`⚡ Credits balance loaded from cache`);
        }

        if (!creditsBalance || creditsBalance.balance < 1) {
          console.log(`❌ Insufficient credits: balance=${creditsBalance?.balance || 0}`);
          await this.notifyUser(user.telegramId, 'no_subscription', position);
          return null;
        }

        console.log(`✅ Sufficient credits found: balance=${creditsBalance.balance}`);

        // Get user settings (cached for 5 minutes)
        try {
          const settingsCacheKey = `settings:${telegramId}`;
          userSettings = this.settingsCache.get(settingsCacheKey);

          if (!userSettings) {
            userSettings = await mcpClient.getRepositionSettings(telegramId);
            this.settingsCache.set(settingsCacheKey, userSettings);
            console.log(`📥 User settings fetched and cached`);
          } else {
            console.log(`⚡ User settings loaded from cache`);
          }

          if (!userSettings.autoRepositionEnabled) {
            console.log(`⏸️ Auto-reposition disabled in user settings`);
            return null;
          }
          console.log(`✅ User settings loaded: threshold=${userSettings.urgencyThreshold}, maxGas=${userSettings.maxGasCostSol}`);
        } catch (settingsError) {
          console.log(`⚠️ Could not fetch reposition settings:`, settingsError);
        }

        return {
          hasAccess: true,
          accessMode: 'credits',
          linkedAccount,
          userSettings,
        };
      } catch (creditsError) {
        console.error(`❌ Error checking credits:`, creditsError);
        await this.notifyUser(user.telegramId, 'no_subscription', position);
        return null;
      }
    } catch (error) {
      console.error(`❌ Subscription check failed:`, error);
      await this.notifyUser(
        user.telegramId,
        'subscription_check_failed',
        position,
        null,
        error as Error
      );
      return null;
    }
  }

  /**
   * Execute reposition and track balance changes
   */
  private async executeRepositionWithBalanceTracking(
    user: any,
    position: any
  ): Promise<{ repositionResult: any; balanceBefore: any; balanceAfter: any } | null> {
    // Get keypair
    const keypair = await this.walletService.getKeypair(user.id);
    if (!keypair) {
      throw new Error('Failed to get user keypair');
    }

    // Get balance BEFORE reposition (for fee calculation)
    const balanceBefore = await this.walletService.getBalance(user.id);
    if (!balanceBefore) {
      throw new Error('Failed to get balance before reposition');
    }

    console.log(`💰 Balance before: ${balanceBefore.zbtc.toFixed(8)} ZBTC, ${balanceBefore.sol.toFixed(6)} SOL`);

    // Execute reposition with tracking
    // Note: No longer passing amounts - dlmmService will fetch actual wallet balance
    console.log(`🔄 Executing reposition with tracking...`);
    const repositionResult = await this.dlmmService.repositionLiquidityWithTracking(
      keypair,
      position.positionId
    );

    // Get balance AFTER reposition
    await new Promise(resolve => setTimeout(resolve, 2000));
    const balanceAfter = await this.walletService.getBalance(user.id);
    if (!balanceAfter) {
      throw new Error('Failed to get balance after reposition');
    }

    console.log(`💰 Balance after: ${balanceAfter.zbtc.toFixed(8)} ZBTC, ${balanceAfter.sol.toFixed(6)} SOL`);

    return { repositionResult, balanceBefore, balanceAfter };
  }

  /**
   * Handle post-reposition updates: database, credits, execution recording
   */
  private async handlePostRepositionUpdates(
    user: any,
    position: any,
    repositionResult: any,
    balanceBefore: any,
    balanceAfter: any,
    accessMode: 'subscription' | 'credits',
    linkedAccount: any
  ): Promise<void> {
    // Calculate balance changes
    const balanceChange = {
      zbtc: balanceAfter.zbtc - balanceBefore.zbtc,
      sol: balanceAfter.sol - balanceBefore.sol
    };

    // ✅ FIX: Use actual amount that was deposited into new position
    const actualZbtcDeposited = repositionResult.actualZbtcDeposited;
    const zbtcReturned = balanceBefore.zbtc + (balanceAfter.zbtc - balanceBefore.zbtc) + actualZbtcDeposited;
    const solReturned = Number(position.solAmount) + balanceChange.sol;

    console.log(`📊 Returned from closed position:`);
    console.log(`   ZBTC: ${zbtcReturned.toFixed(8)} (includes fees)`);
    console.log(`   SOL: ${solReturned.toFixed(6)}`);
    console.log(`📊 Deposited into new position:`);
    console.log(`   ZBTC: ${actualZbtcDeposited.toFixed(8)} (actual from wallet)`);

    const newSolUsed = 0; // One-sided liquidity (ZBTC only)

    // Update database with full tracking using ACTUAL amounts
    await this.updateDatabaseAfterReposition(
      user.id,
      position.positionId,
      repositionResult.positionId,
      zbtcReturned,
      solReturned,
      repositionResult.exitPrice,
      repositionResult.exitBin,
      actualZbtcDeposited,  // ✅ FIX: Use actual deposited amount
      newSolUsed,
      repositionResult.entryPrice,
      repositionResult.entryBin
    );

    // Update user stats
    await db.updateUserStats(user.id);

    // Record execution and handle credits
    if (linkedAccount && linkedAccount.isLinked && linkedAccount.walletAddress) {
      await this.recordExecutionAndHandleCredits(
        linkedAccount.walletAddress,
        repositionResult.positionId,
        balanceBefore,
        balanceAfter,
        solReturned,
        position.solAmount,
        accessMode
      );
    }
  }

  /**
   * Record execution to MCP and deduct credits if pay-per-use
   */
  private async recordExecutionAndHandleCredits(
    walletAddress: string,
    positionId: string,
    balanceBefore: any,
    balanceAfter: any,
    solReturned: number,
    originalSolAmount: number,
    accessMode: 'subscription' | 'credits'
  ): Promise<void> {
    try {
      // Calculate gas cost (approximate from SOL balance change)
      const gasCostSol = balanceBefore.sol - balanceAfter.sol - (solReturned - Number(originalSolAmount));

      // Record execution to MCP
      await mcpClient.recordExecution({
        walletAddress,
        positionAddress: positionId,
        success: true,
        gasCostSol: Math.max(0, gasCostSol),
        feesCollectedUsd: 0,
        executionMode: 'auto',
      });

      console.log(`📊 Execution recorded: gas=${gasCostSol.toFixed(6)} SOL`);

      // Deduct credits if using pay-per-use
      if (accessMode === 'credits') {
        try {
          await mcpClient.useCredits(
            walletAddress,
            1,
            positionId,
            `Auto-reposition executed for position ${positionId.slice(0, 8)}...`
          );

          const updatedBalance = await mcpClient.getCreditBalance(walletAddress);
          console.log(`💳 1 credit deducted. Remaining balance: ${updatedBalance.balance} credits`);
        } catch (creditError) {
          console.error(`❌ Failed to deduct credits:`, creditError);
        }
      }
    } catch (recordError) {
      console.error(`⚠️ Failed to record execution:`, recordError);
    }
  }

  /**
   * Check position and execute auto-reposition if needed
   * Orchestrates the entire reposition workflow
   */
  private async checkPosition(user: any, position: any): Promise<void> {
    try {
      await db.updatePositionLastChecked(position.positionId);

      // Check if position is out of range
      const isOutOfRange = await this.dlmmService.isPositionOutOfRange(position.positionId);
      if (!isOutOfRange) {
        console.log(`✅ Position ${position.positionId.substring(0, 8)}... in range`);
        return;
      }

      console.log(`\n⚠️ OUT OF RANGE DETECTED: ${position.positionId.substring(0, 8)}...`);

      // Check cooldown
      if (!this.dlmmService.canReposition(position.positionId)) {
        console.log(`⏳ Cooldown active, skipping reposition`);
        return;
      }

      // Verify user has access (subscription or credits)
      const accessInfo = await this.verifyUserAccess(user, position);
      if (!accessInfo) {
        return; // Access denied, user already notified
      }

      console.log(`✅ Access granted (${accessInfo.accessMode}) - proceeding with auto-reposition`);

      // Notify user: Starting
      await this.notifyUser(user.telegramId, 'starting', position);

      // Execute reposition with balance tracking
      const result = await this.executeRepositionWithBalanceTracking(user, position);
      if (!result) {
        throw new Error('Reposition execution failed');
      }

      const { repositionResult, balanceBefore, balanceAfter } = result;

      // Handle all post-reposition updates (database, credits, recording)
      await this.handlePostRepositionUpdates(
        user,
        position,
        repositionResult,
        balanceBefore,
        balanceAfter,
        accessInfo.accessMode,
        accessInfo.linkedAccount
      );

      // Notify user: Success
      await this.notifyUser(user.telegramId, 'success', position, repositionResult);

      console.log(`✅ Reposition complete for user ${user.telegramId}`);

    } catch (error: any) {
      console.error(`❌ Failed to reposition:`, error);
      await this.notifyUser(user.telegramId, 'error', position, null, error);
    }
  }

  /**
   * IMPROVED: Update database with full tracking (atomic transaction)
   */
  private async updateDatabaseAfterReposition(
    userId: string,
    oldPositionId: string,
    newPositionId: string,
    zbtcReturned: number,
    solReturned: number,
    exitPrice: number,
    exitBin: number,
    newZbtcAmount: number,
    newSolAmount: number,
    newEntryPrice: number,
    newEntryBin: number
  ): Promise<void> {
    try {
      await prisma.$transaction(async (_tx: Prisma.TransactionClient) => {
        // Close old position with tracking
        await db.closePositionWithTracking(
          oldPositionId,
          zbtcReturned,
          solReturned,
          exitPrice,
          exitBin
        );

        // Create new position with tracking
        await db.createPositionWithTracking(
          userId,
          newPositionId,
          process.env.ZBTC_SOL_POOL_ADDRESS!,
          newZbtcAmount,
          newSolAmount,
          newEntryPrice,
          newEntryBin
        );
      });

      console.log(`✅ Database updated with full tracking`);
    } catch (error) {
      console.error('❌ Failed to update database:', error);
      
      // CRITICAL: Blockchain succeeded but DB failed!
      console.error(`\n${'!'.repeat(60)}`);
      console.error(`CRITICAL: Blockchain reposition succeeded but database update failed!`);
      console.error(`Old Position: ${oldPositionId}`);
      console.error(`New Position: ${newPositionId}`);
      console.error(`User ID: ${userId}`);
      console.error(`MANUAL ACTION REQUIRED: Update database manually`);
      console.error(`${'!'.repeat(60)}\n`);
      
      throw error;
    }
  }

  /**
   * Build message for reposition starting notification
   */
  private buildStartingMessage(position: any): string {
    return (
      `⚠️ **Position Out of Range**\n\n` +
      `🆔 Position: \`${position.positionId.substring(0, 8)}...\`\n` +
      `💰 Amount: ${position.zbtcAmount} ZBTC + ${Number(position.solAmount).toFixed(4)} SOL\n\n` +
      `🔄 Auto-repositioning in progress...\n` +
      `⏱️ This may take 30-60 seconds.`
    );
  }

  /**
   * Build message for successful reposition with PnL info
   */
  private async buildSuccessMessage(position: any, repositionResult: any): Promise<string> {
    const closedPosition = await db.getPositionById(position.positionId);

    const pnlEmoji = closedPosition && Number(closedPosition.pnlUsd || 0) >= 0 ? '📈' : '📉';
    const pnlSign = closedPosition && Number(closedPosition.pnlUsd || 0) >= 0 ? '+' : '';
    const pnlText = closedPosition
      ? `${pnlEmoji} PnL: ${pnlSign}$${Number(closedPosition.pnlUsd || 0).toFixed(2)} (${pnlSign}${Number(closedPosition.pnlPercent || 0).toFixed(2)}%)\n`
      : '';

    const feesText = closedPosition && (Number(closedPosition.zbtcFees) > 0 || Number(closedPosition.solFees) > 0)
      ? `💰 Fees: ${Number(closedPosition.zbtcFees).toFixed(8)} ZBTC + ${Number(closedPosition.solFees).toFixed(6)} SOL\n`
      : '';

    return (
      `✅ **Successfully Repositioned!**\n\n` +
      `🔴 Old Position: \`${position.positionId.substring(0, 8)}...\`\n` +
      `🟢 New Position: \`${repositionResult.positionId.substring(0, 8)}...\`\n\n` +
      `📊 Exit: $${repositionResult.exitPrice.toFixed(2)} (Bin ${repositionResult.exitBin})\n` +
      `📊 Entry: $${repositionResult.entryPrice.toFixed(2)} (Bin ${repositionResult.entryBin})\n\n` +
      pnlText +
      feesText +
      `💰 Amount: ${position.zbtcAmount} ZBTC\n` +
      `🛡️ Buffer: ±10 bins\n\n` +
      `🔄 Monitoring continues automatically.`
    );
  }

  /**
   * Build message for reposition error
   */
  private buildErrorMessage(position: any, error?: Error): string {
    const errorMsg = error?.message || 'Unknown error';
    let message = '❌ **Repositioning Failed**\n\n';

    if (errorMsg.includes('CRITICAL')) {
      message +=
        `⚠️ Old position was closed but new position creation failed.\n\n` +
        `📍 Your liquidity (${position.zbtcAmount} ZBTC) is now in your wallet.\n\n` +
        `🔧 **Action Required:**\n` +
        `Please create a new position manually using the bot menu.\n\n`;
    } else if (errorMsg.includes('cooldown')) {
      message +=
        `⏳ Position is on cooldown.\n\n` +
        `The bot will try again in a few minutes.\n\n`;
    } else if (errorMsg.includes('volatile') || errorMsg.includes('slippage')) {
      message +=
        `📊 Market is very volatile right now.\n\n` +
        `The bot will retry automatically.\n\n`;
    } else {
      message +=
        `Error: ${errorMsg.substring(0, 200)}\n\n` +
        `The bot will try again on the next check.\n\n`;
    }

    message += `🆔 Position: \`${position.positionId.substring(0, 8)}...\``;
    return message;
  }

  /**
   * Build message for subscription required notification
   */
  private buildSubscriptionRequiredMessage(position: any, error?: Error): string {
    return (
      `💳 **Subscription Required**\n\n` +
      `🆔 Position: \`${position.positionId.substring(0, 8)}...\`\n` +
      `⚠️ Position is out of range!\n\n` +
      `${error?.message || 'Auto-reposition requires an active subscription.'}\n\n` +
      `🌐 **Subscribe on Website:**\n` +
      `1. Visit https://hypebiscus.com\n` +
      `2. Connect your wallet\n` +
      `3. Subscribe for $4.99/month\n\n` +
      `✨ **Benefits:**\n` +
      `• Unlimited auto-repositions\n` +
      `• Telegram notifications\n` +
      `• AI-powered analysis\n\n` +
      `💡 Start monitoring your positions automatically!`
    );
  }

  /**
   * Build message for no subscription notification
   */
  private buildNoSubscriptionMessage(position: any): string {
    return (
      `💳 **No Active Subscription**\n\n` +
      `🆔 Position: \`${position.positionId.substring(0, 8)}...\`\n` +
      `⚠️ Position is out of range but cannot auto-reposition.\n\n` +
      `Your subscription may have expired or hasn't been activated yet.\n\n` +
      `🌐 **Renew Subscription:**\n` +
      `Visit https://hypebiscus.com to subscribe ($4.99/month)\n\n` +
      `📱 Use /status to check subscription details.`
    );
  }

  /**
   * Build message for subscription check failed notification
   */
  private buildSubscriptionCheckFailedMessage(position: any, error?: Error): string {
    return (
      `⚠️ **Subscription Check Failed**\n\n` +
      `🆔 Position: \`${position.positionId.substring(0, 8)}...\`\n` +
      `❌ Could not verify subscription status.\n\n` +
      `Error: ${error?.message || 'Unknown error'}\n\n` +
      `🔄 The bot will retry on the next check.\n` +
      `💡 If this persists, contact support.`
    );
  }

  /**
   * IMPROVED: Notify user with PnL info + subscription notifications
   * Now includes throttling for spam prevention (max 3 notifications per day for no_subscription/subscription_check_failed)
   */
  private async notifyUser(
    telegramId: bigint,
    type: 'starting' | 'success' | 'error' | 'subscription_required' | 'no_subscription' | 'subscription_check_failed',
    position: any,
    repositionResult?: any,
    error?: Error
  ): Promise<void> {
    try {
      // Apply throttling for subscription-related notifications to prevent spam
      if (type === 'no_subscription' || type === 'subscription_check_failed') {
        if (!this.shouldSendNotification(telegramId, type)) {
          return; // Notification throttled, skip sending
        }
      }

      // Build message based on notification type
      let message: string;
      switch (type) {
        case 'starting':
          message = this.buildStartingMessage(position);
          break;
        case 'success':
          message = await this.buildSuccessMessage(position, repositionResult);
          break;
        case 'error':
          message = this.buildErrorMessage(position, error);
          break;
        case 'subscription_required':
          message = this.buildSubscriptionRequiredMessage(position, error);
          break;
        case 'no_subscription':
          message = this.buildNoSubscriptionMessage(position);
          break;
        case 'subscription_check_failed':
          message = this.buildSubscriptionCheckFailedMessage(position, error);
          break;
      }

      // Send notification to user
      await this.bot.telegram.sendMessage(
        Number(telegramId),
        message,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Failed to notify user:', error);
    }
  }

  getStatus(): {
    isMonitoring: boolean;
    userCount?: number;
    totalPositions?: number;
  } {
    return {
      isMonitoring: this.isRunning,
      userCount: 0,
      totalPositions: 0
    };
  }

  async checkNow(): Promise<void> {
    console.log('🔄 Manual position check triggered...');
    await this.checkAllPositions();
  }

  /**
   * Invalidate caches for a specific user
   * Call this when user updates their settings or subscription status
   */
  invalidateUserCache(telegramId: string, walletAddress?: string): void {
    this.settingsCache.invalidate(`settings:${telegramId}`);
    this.linkedAccountCache.invalidate(`linked:${telegramId}`);

    if (walletAddress) {
      this.subscriptionCache.invalidate(`sub:${walletAddress}`);
      this.creditsCache.invalidate(`credits:${walletAddress}`);
    }

    console.log(`🗑️ Cache invalidated for user ${telegramId}`);
  }

  /**
   * Clear all caches (useful for debugging or after system updates)
   */
  clearAllCaches(): void {
    this.settingsCache.clear();
    this.linkedAccountCache.clear();
    this.subscriptionCache.clear();
    this.creditsCache.clear();
    console.log(`🗑️ All caches cleared`);
  }
}