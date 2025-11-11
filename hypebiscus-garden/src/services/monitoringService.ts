// src/services/monitoringService.ts - IMPROVED WITH PNL TRACKING + X402 SUBSCRIPTION

import * as cron from 'node-cron';
import { Prisma } from '@prisma/client';
import { DlmmService } from './dlmmService';
import { WalletService } from './walletService';
import { Telegraf } from 'telegraf';
import * as db from './db';
import { prisma } from './db';
import { mcpClient } from '../utils/mcpClient';

export class MonitoringService {
  private dlmmService: DlmmService;
  private walletService: WalletService;
  private bot: Telegraf;
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning = false;

  constructor(
    dlmmService: DlmmService,
    walletService: WalletService,
    bot: Telegraf
  ) {
    this.dlmmService = dlmmService;
    this.walletService = walletService;
    this.bot = bot;
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
   * IMPROVED: Check position with PnL tracking
   */
  private async checkPosition(user: any, position: any): Promise<void> {
    try {
      await db.updatePositionLastChecked(position.positionId);

      const isOutOfRange = await this.dlmmService.isPositionOutOfRange(
        position.positionId
      );

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

      // ===== X402 SUBSCRIPTION OR CREDITS CHECK =====
      // Check if user has active subscription OR sufficient credits
      let hasAccess = false;
      let accessMode: 'subscription' | 'credits' = 'subscription';
      let userSettings: any = null;
      let linkedAccount: any = null;

      try {
        // Get linked wallet address
        linkedAccount = await mcpClient.getLinkedAccount(user.telegramId.toString());

        if (!linkedAccount.isLinked || !linkedAccount.walletAddress) {
          console.log(`❌ User ${user.telegramId} has no linked wallet`);
          await this.notifyUser(
            user.telegramId,
            'subscription_required',
            position,
            null,
            new Error('No linked wallet. Link your wallet on the website to enable auto-reposition.')
          );
          return;
        }

        console.log(`🔍 Checking access for wallet: ${linkedAccount.walletAddress.substring(0, 8)}...`);

        // OPTION 1: Check subscription (unlimited repositions)
        const subscriptionStatus = await mcpClient.checkSubscription(linkedAccount.walletAddress);

        if (subscriptionStatus.isActive) {
          console.log(`✅ Active subscription found: tier=${subscriptionStatus.tier}, expires=${subscriptionStatus.expiresAt}`);
          hasAccess = true;
          accessMode = 'subscription';
        } else {
          // OPTION 2: Check credits (pay-per-use)
          console.log(`❌ No active subscription, checking credits...`);

          try {
            const creditsBalance = await mcpClient.getCreditBalance(linkedAccount.walletAddress!);

            if (creditsBalance && creditsBalance.balance >= 1) {
              console.log(`✅ Sufficient credits found: balance=${creditsBalance.balance}`);
              hasAccess = true;
              accessMode = 'credits';
            } else {
              console.log(`❌ Insufficient credits: balance=${creditsBalance?.balance || 0}`);
              await this.notifyUser(user.telegramId, 'no_subscription', position);
              return;
            }
          } catch (creditsError) {
            console.error(`❌ Error checking credits:`, creditsError);
            await this.notifyUser(user.telegramId, 'no_subscription', position);
            return;
          }
        }

        // Get user reposition settings
        try {
          userSettings = await mcpClient.getRepositionSettings(user.telegramId.toString());

          // Check if auto-reposition is enabled in settings
          if (!userSettings.autoRepositionEnabled) {
            console.log(`⏸️ Auto-reposition disabled in user settings`);
            return; // Silent skip - user disabled it
          }

          console.log(`✅ User settings loaded: threshold=${userSettings.urgencyThreshold}, maxGas=${userSettings.maxGasCostSol}`);
        } catch (settingsError) {
          console.log(`⚠️ Could not fetch reposition settings:`, settingsError);
          // Continue with default settings if fetch fails
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
        return;
      }

      if (!hasAccess) {
        console.log(`❌ User ${user.telegramId} has no active subscription or credits`);
        await this.notifyUser(user.telegramId, 'no_subscription', position);
        return;
      }

      console.log(`✅ Access granted (${accessMode}) - proceeding with auto-reposition`);
      // ===== END SUBSCRIPTION CHECK =====

      // Notify user: Starting
      await this.notifyUser(user.telegramId, 'starting', position);

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
      console.log(`🔄 Executing reposition with tracking...`);
      const repositionResult = await this.dlmmService.repositionLiquidityWithTracking(
        keypair,
        position.positionId,
        Number(position.zbtcAmount),
        Number(position.solAmount)
      );

      // Get balance AFTER reposition
      await new Promise(resolve => setTimeout(resolve, 2000));
      const balanceAfter = await this.walletService.getBalance(user.id);
      
      if (!balanceAfter) {
        throw new Error('Failed to get balance after reposition');
      }

      console.log(`💰 Balance after: ${balanceAfter.zbtc.toFixed(8)} ZBTC, ${balanceAfter.sol.toFixed(6)} SOL`);

      // Calculate what was returned from closing position
      // Balance change = (original + fees returned) - amount used for new position
      const balanceChange = {
        zbtc: balanceAfter.zbtc - balanceBefore.zbtc,
        sol: balanceAfter.sol - balanceBefore.sol
      };

      // Amounts returned = original + balance change
      const zbtcReturned = Number(position.zbtcAmount) + balanceChange.zbtc;
      const solReturned = Number(position.solAmount) + balanceChange.sol;

      console.log(`📊 Returned from closed position:`);
      console.log(`   ZBTC: ${zbtcReturned.toFixed(8)}`);
      console.log(`   SOL: ${solReturned.toFixed(6)}`);

      // Calculate SOL used for new position
      const newSolUsed = Number(position.solAmount) - balanceChange.sol;

      // Update database with full tracking
      await this.updateDatabaseAfterReposition(
        user.id,
        position.positionId,
        repositionResult.positionId,
        zbtcReturned,
        solReturned,
        repositionResult.exitPrice,
        repositionResult.exitBin,
        Number(position.zbtcAmount),
        newSolUsed,
        repositionResult.entryPrice,
        repositionResult.entryBin
      );

      // Update user stats
      await db.updateUserStats(user.id);

      // ===== RECORD EXECUTION TO MCP =====
      // Record this reposition execution for usage tracking
      try {
        if (linkedAccount && linkedAccount.isLinked && linkedAccount.walletAddress) {
          // Calculate gas cost (approximate from SOL balance change)
          const gasCostSol = balanceBefore.sol - balanceAfter.sol - (solReturned - Number(position.solAmount));

          // Record execution to MCP
          await mcpClient.recordExecution({
            walletAddress: linkedAccount.walletAddress,
            positionAddress: repositionResult.positionId,
            success: true,
            gasCostSol: Math.max(0, gasCostSol), // Ensure non-negative
            feesCollectedUsd: 0, // TODO: Calculate fees collected
            executionMode: 'auto',
          });

          console.log(`📊 Execution recorded: gas=${gasCostSol.toFixed(6)} SOL`);

          // ===== DEDUCT CREDITS IF USING PAY-PER-USE =====
          if (accessMode === 'credits') {
            try {
              await mcpClient.useCredits(
                linkedAccount.walletAddress!,
                1,
                repositionResult.positionId,
                `Auto-reposition executed for position ${repositionResult.positionId.slice(0, 8)}...`
              );

              // Get updated balance to show user
              const updatedBalance = await mcpClient.getCreditBalance(linkedAccount.walletAddress!);

              console.log(`💳 1 credit deducted. Remaining balance: ${updatedBalance.balance} credits`);
            } catch (creditError) {
              console.error(`❌ Failed to deduct credits:`, creditError);
              // Log but don't fail the reposition since it already executed successfully
            }
          }
          // ===== END CREDITS DEDUCTION =====
        }
      } catch (recordError) {
        console.error(`⚠️ Failed to record execution:`, recordError);
        // Don't fail the reposition if recording fails
      }
      // ===== END EXECUTION RECORDING =====

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
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
   * IMPROVED: Notify user with PnL info + subscription notifications
   */
  private async notifyUser(
    telegramId: bigint,
    type: 'starting' | 'success' | 'error' | 'subscription_required' | 'no_subscription' | 'subscription_check_failed',
    position: any,
    repositionResult?: any,
    error?: Error
  ): Promise<void> {
    try {
      let message = '';
      
      switch (type) {
        case 'starting':
          message = 
            `⚠️ **Position Out of Range**\n\n` +
            `🆔 Position: \`${position.positionId.substring(0, 8)}...\`\n` +
            `💰 Amount: ${position.zbtcAmount} ZBTC + ${Number(position.solAmount).toFixed(4)} SOL\n\n` +
            `🔄 Auto-repositioning in progress...\n` +
            `⏱️ This may take 30-60 seconds.`;
          break;
          
        case 'success':
          // Get position from DB to show PnL
          const closedPosition = await db.getPositionById(position.positionId);
          
          const pnlEmoji = closedPosition && Number(closedPosition.pnlUsd || 0) >= 0 ? '📈' : '📉';
          const pnlSign = closedPosition && Number(closedPosition.pnlUsd || 0) >= 0 ? '+' : '';
          const pnlText = closedPosition 
            ? `${pnlEmoji} PnL: ${pnlSign}$${Number(closedPosition.pnlUsd || 0).toFixed(2)} (${pnlSign}${Number(closedPosition.pnlPercent || 0).toFixed(2)}%)\n`
            : '';
          
          const feesText = closedPosition && (Number(closedPosition.zbtcFees) > 0 || Number(closedPosition.solFees) > 0)
            ? `💰 Fees: ${Number(closedPosition.zbtcFees).toFixed(8)} ZBTC + ${Number(closedPosition.solFees).toFixed(6)} SOL\n`
            : '';

          message = 
            `✅ **Successfully Repositioned!**\n\n` +
            `🔴 Old Position: \`${position.positionId.substring(0, 8)}...\`\n` +
            `🟢 New Position: \`${repositionResult.positionId.substring(0, 8)}...\`\n\n` +
            `📊 Exit: $${repositionResult.exitPrice.toFixed(2)} (Bin ${repositionResult.exitBin})\n` +
            `📊 Entry: $${repositionResult.entryPrice.toFixed(2)} (Bin ${repositionResult.entryBin})\n\n` +
            pnlText +
            feesText +
            `💰 Amount: ${position.zbtcAmount} ZBTC\n` +
            `🛡️ Buffer: ±10 bins\n\n` +
            `🔄 Monitoring continues automatically.`;
          break;
          
        case 'error':
          const errorMsg = error?.message || 'Unknown error';
          let userMessage = '❌ **Repositioning Failed**\n\n';
          
          if (errorMsg.includes('CRITICAL')) {
            userMessage += 
              `⚠️ Old position was closed but new position creation failed.\n\n` +
              `📍 Your liquidity (${position.zbtcAmount} ZBTC) is now in your wallet.\n\n` +
              `🔧 **Action Required:**\n` +
              `Please create a new position manually using the bot menu.\n\n`;
          } else if (errorMsg.includes('cooldown')) {
            userMessage += 
              `⏳ Position is on cooldown.\n\n` +
              `The bot will try again in a few minutes.\n\n`;
          } else if (errorMsg.includes('volatile') || errorMsg.includes('slippage')) {
            userMessage += 
              `📊 Market is very volatile right now.\n\n` +
              `The bot will retry automatically.\n\n`;
          } else {
            userMessage += 
              `Error: ${errorMsg.substring(0, 200)}\n\n` +
              `The bot will try again on the next check.\n\n`;
          }
          
          userMessage += `🆔 Position: \`${position.positionId.substring(0, 8)}...\``;
          message = userMessage;
          break;

        case 'subscription_required':
          message =
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
            `💡 Start monitoring your positions automatically!`;
          break;

        case 'no_subscription':
          message =
            `💳 **No Active Subscription**\n\n` +
            `🆔 Position: \`${position.positionId.substring(0, 8)}...\`\n` +
            `⚠️ Position is out of range but cannot auto-reposition.\n\n` +
            `Your subscription may have expired or hasn't been activated yet.\n\n` +
            `🌐 **Renew Subscription:**\n` +
            `Visit https://hypebiscus.com to subscribe ($4.99/month)\n\n` +
            `📱 Use /status to check subscription details.`;
          break;

        case 'subscription_check_failed':
          message =
            `⚠️ **Subscription Check Failed**\n\n` +
            `🆔 Position: \`${position.positionId.substring(0, 8)}...\`\n` +
            `❌ Could not verify subscription status.\n\n` +
            `Error: ${error?.message || 'Unknown error'}\n\n` +
            `🔄 The bot will retry on the next check.\n` +
            `💡 If this persists, contact support.`;
          break;
      }

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
}