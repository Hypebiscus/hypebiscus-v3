/**
 * Auto-Reposition Worker
 *
 * Background service that automatically repositions out-of-range positions for users
 * who have enabled auto-reposition in their settings.
 *
 * - Telegram users: Full automation (decrypts key, signs, executes)
 * - Website users: Creates notifications (requires manual approval)
 */

import { Connection, Keypair, Transaction } from '@solana/web3.js';
import { config, logger } from '../config.js';
import { database } from '../services/database.js';
import { repositionService } from '../services/repositionService.js';
import { encryptionService } from '../utils/encryption.js';

export class AutoRepositionWorker {
  private connection: Connection;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor() {
    this.connection = new Connection(config.solanaRpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: config.requestTimeout,
    });
  }

  /**
   * Start the auto-reposition worker
   * @param intervalMinutes - How often to check positions (default: 10 minutes)
   */
  start(intervalMinutes = 10): void {
    if (this.intervalId) {
      logger.warn('Auto-reposition worker already running');
      return;
    }

    const intervalMs = intervalMinutes * 60 * 1000;

    logger.info(`🤖 Starting auto-reposition worker (interval: ${intervalMinutes} minutes)`);

    // Run immediately on start
    this.run();

    // Then run on interval
    this.intervalId = setInterval(() => {
      this.run();
    }, intervalMs);
  }

  /**
   * Stop the auto-reposition worker
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('🛑 Auto-reposition worker stopped');
    }
  }

  /**
   * Main worker execution
   */
  private async run(): Promise<void> {
    if (this.isRunning) {
      logger.debug('Auto-reposition worker already running, skipping cycle');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    const prisma = database.getClient();
    let totalPositionsScanned = 0;
    let totalRepositioned = 0;
    let errorOccurred = false;
    let lastError: string | null = null;

    try {
      logger.info('=== Auto-Reposition Worker Cycle Started ===');

      // 1. Get all users with auto-reposition enabled
      const usersWithAutoReposition = await prisma.user_reposition_settings.findMany({
        where: {
          autoRepositionEnabled: true,
        },
        include: {
          user: {
            include: {
              wallets: true,
            },
          },
        },
      });

      logger.info(`Found ${usersWithAutoReposition.length} users with auto-reposition enabled`);

      let totalProcessed = 0;
      let totalNotifications = 0;

      // 2. Process each user
      for (const settings of usersWithAutoReposition) {
        try {
          const result = await this.processUser(settings);
          totalProcessed++;
          totalRepositioned += result.repositioned;
          totalNotifications += result.notifications;
          totalPositionsScanned += result.positionsScanned;
        } catch (error) {
          logger.error(`Failed to process user ${settings.userId}:`, error);
          errorOccurred = true;
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info('=== Auto-Reposition Worker Cycle Complete ===');
      logger.info(`Processed: ${totalProcessed} users`);
      logger.info(`Positions Scanned: ${totalPositionsScanned}`);
      logger.info(`Repositioned: ${totalRepositioned} positions`);
      logger.info(`Notifications: ${totalNotifications} created`);
      logger.info(`Duration: ${duration}s`);

      // 3. Update monitor state
      await this.updateMonitorState(
        totalPositionsScanned,
        totalRepositioned,
        errorOccurred,
        lastError
      );

      // 4. Log metrics
      await this.logMetrics(duration, totalPositionsScanned, totalRepositioned);
    } catch (error) {
      logger.error('Auto-reposition worker cycle failed:', error);
      errorOccurred = true;
      lastError = error instanceof Error ? error.message : String(error);

      // Update monitor state with error
      await this.updateMonitorState(totalPositionsScanned, totalRepositioned, true, lastError);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Process auto-reposition for a single user
   */
  private async processUser(settings: {
    userId: string;
    urgencyThreshold: string;
    maxGasCostSol: any;
    minFeesToCollectUsd: any;
    allowedStrategies: any;
    user: {
      id: string;
      linkedWalletAddress: string | null;
      wallets: {
        encrypted: string;
        iv: string;
        source: string;
      } | null;
    };
  }): Promise<{ repositioned: number; notifications: number; positionsScanned: number }> {
    const prisma = database.getClient();
    let repositionedCount = 0;
    let notificationCount = 0;
    let positionsScanned = 0;

    const walletAddress = settings.user.linkedWalletAddress;
    if (!walletAddress) {
      logger.debug(`User ${settings.userId} has no linked wallet, skipping`);
      return { repositioned: 0, notifications: 0, positionsScanned: 0 };
    }

    // Check if user has Telegram wallet (can auto-sign) or website wallet (notifications only)
    const canAutoSign =
      settings.user.wallets &&
      settings.user.wallets.encrypted &&
      settings.user.wallets.encrypted.length > 0 &&
      settings.user.wallets.source === 'telegram';

    if (!canAutoSign) {
      logger.debug(`User ${settings.userId} is website user, will create notifications only`);
    }

    // Get user's active positions
    // IMPORTANT: Filter out positions with data corruption (isActive=true AND closedAt is not null)
    const positions = await prisma.positions.findMany({
      where: {
        userId: settings.userId,
        isActive: true,
        closedAt: null, // Only truly active positions
      },
    });

    logger.debug(`User ${settings.userId} (${walletAddress.slice(0, 8)}...) has ${positions.length} active positions`);

    // Process each position
    for (const position of positions) {
      positionsScanned++;
      const result = await this.processPosition(
        position,
        walletAddress,
        settings,
        Boolean(canAutoSign)
      );

      repositionedCount += result.repositioned;
      notificationCount += result.notifications;
    }

    return { repositioned: repositionedCount, notifications: notificationCount, positionsScanned };
  }

  /**
   * Process a single position for auto-reposition
   */
  private async processPosition(
    position: any,
    walletAddress: string,
    settings: any,
    canAutoSign: boolean
  ): Promise<{ repositioned: number; notifications: number }> {
    let actionTaken = 'none';
    let notificationSent = false;

    try {
      // Analyze position and get health status
      // This will return null for analysis if position doesn't exist
      const { analysis, healthStatus } = await this.analyzePositionHealth(
        position.positionId,
        position.poolAddress
      );

      // Log initial position scan
      await this.logPositionScan(
        position.positionId,
        walletAddress,
        healthStatus,
        analysis.urgency,
        analysis.distanceFromRange,
        actionTaken,
        notificationSent
      );

      // Check if reposition is needed
      if (!analysis.shouldReposition) {
        return { repositioned: 0, notifications: 0 };
      }

      // Check if we should proceed with reposition
      if (!this.shouldProceedWithReposition(position, analysis, settings)) {
        return { repositioned: 0, notifications: 0 };
      }

      // Check credits
      const hasCredits = await this.hasEnoughCredits(walletAddress);
      if (!hasCredits) {
        await this.handleInsufficientCredits(
          settings.userId,
          walletAddress,
          position.positionId,
          analysis
        );
        return { repositioned: 0, notifications: 1 };
      }

      logger.info(
        `🎯 Position ${position.positionId.slice(0, 8)}... needs reposition (urgency: ${analysis.urgency})`
      );

      // Perform reposition (execute or notify)
      const result = await this.performReposition(
        position,
        walletAddress,
        settings,
        analysis,
        canAutoSign,
        healthStatus
      );

      return result;
    } catch (error) {
      // Check if position no longer exists on-chain
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes('Position not found') ||
        errorMessage.includes('already closed') ||
        errorMessage.includes('Unknown position account')
      ) {
        logger.warn(
          `⚠️ Position ${position.positionId} no longer exists on-chain, marking as inactive`
        );

        // Mark position as inactive in database
        await this.closeStalePosition(position.positionId);

        await this.logPositionScan(
          position.positionId,
          walletAddress,
          'closed',
          null,
          null,
          'auto_closed_stale',
          false
        );

        return { repositioned: 0, notifications: 0 };
      }

      logger.error(`Failed to process position ${position.positionId}:`, error);
      await this.logPositionScan(
        position.positionId,
        walletAddress,
        'unknown',
        null,
        null,
        'error',
        false
      );
      return { repositioned: 0, notifications: 0 };
    }
  }

  /**
   * Analyze position and determine health status
   */
  private async analyzePositionHealth(
    positionId: string,
    poolAddress: string
  ): Promise<{ analysis: any; healthStatus: string }> {
    const analysis = await repositionService.analyzePosition(positionId, poolAddress);

    let healthStatus = 'healthy';
    if (analysis.shouldReposition) {
      if (analysis.urgency === 'high') {
        healthStatus = 'critical';
      } else if (analysis.urgency === 'medium') {
        healthStatus = 'out_of_range';
      } else {
        healthStatus = 'warning';
      }
    }

    return { analysis, healthStatus };
  }

  /**
   * Check if reposition should proceed based on urgency and gas cost
   */
  private shouldProceedWithReposition(
    position: any,
    analysis: any,
    settings: any
  ): boolean {
    const urgencyLevels: Record<string, number> = { low: 1, medium: 2, high: 3 };
    const requiredUrgency = urgencyLevels[settings.urgencyThreshold] || 2;
    const actualUrgency = urgencyLevels[analysis.urgency] || 1;

    if (actualUrgency < requiredUrgency) {
      logger.debug(
        `Position ${position.positionId.slice(0, 8)}... urgency ${analysis.urgency} below threshold ${settings.urgencyThreshold}`
      );
      return false;
    }

    if (analysis.estimatedGasCost > settings.maxGasCostSol.toNumber()) {
      logger.debug(
        `Position ${position.positionId.slice(0, 8)}... gas cost ${analysis.estimatedGasCost} exceeds limit ${settings.maxGasCostSol.toNumber()}`
      );
      return false;
    }

    return true;
  }

  /**
   * Check if user has enough credits
   */
  private async hasEnoughCredits(walletAddress: string): Promise<boolean> {
    const prisma = database.getClient();
    const credits = await prisma.user_credits.findUnique({
      where: { walletAddress },
    });

    return credits !== null && credits.balance.toNumber() >= 1;
  }

  /**
   * Handle insufficient credits scenario
   */
  private async handleInsufficientCredits(
    userId: string,
    walletAddress: string,
    positionId: string,
    analysis: any
  ): Promise<void> {
    logger.warn(`User ${userId} has insufficient credits for auto-reposition`);

    await this.createNotification(
      userId,
      walletAddress,
      positionId,
      'insufficient_credits',
      'Auto-reposition paused: Insufficient credits. Please purchase credits to resume.'
    );

    await this.logPositionScan(
      positionId,
      walletAddress,
      'critical',
      analysis.urgency,
      analysis.distanceFromRange,
      'notified',
      true
    );
  }

  /**
   * Close a stale position that no longer exists on-chain
   */
  private async closeStalePosition(positionId: string): Promise<void> {
    try {
      const prisma = database.getClient();
      await prisma.positions.updateMany({
        where: { positionId },
        data: {
          isActive: false,
          closedAt: new Date(),
        },
      });

      logger.info(`✅ Marked stale position ${positionId} as inactive`);
    } catch (error) {
      logger.error(`Failed to close stale position ${positionId}:`, error);
      // Don't throw - we want to continue processing other positions
    }
  }

  /**
   * Perform reposition (execute or notify based on user type)
   */
  private async performReposition(
    position: any,
    walletAddress: string,
    settings: any,
    analysis: any,
    canAutoSign: boolean,
    healthStatus: string
  ): Promise<{ repositioned: number; notifications: number }> {
    let actionTaken = 'none';
    let notificationSent = false;
    let repositioned = 0;
    let notifications = 0;

    if (canAutoSign) {
      // Telegram user - execute automatically
      const success = await this.executeReposition(
        settings.user.wallets!,
        walletAddress,
        position.positionId,
        position.poolAddress,
        settings,
        analysis
      );

      if (success) {
        repositioned = 1;
        actionTaken = 'repositioned';
      }
    } else {
      // Website user - create notification
      await this.createNotification(
        settings.userId,
        walletAddress,
        position.positionId,
        'reposition_needed',
        `Position out of range! Urgency: ${analysis.urgency}. Estimated gas: ${analysis.estimatedGasCost.toFixed(4)} SOL.`,
        {
          urgency: analysis.urgency,
          estimatedGasCost: analysis.estimatedGasCost,
          recommendedStrategy: analysis.recommendedStrategy,
        }
      );
      notifications = 1;
      actionTaken = 'notified';
      notificationSent = true;
    }

    // Update monitoring log with final action
    await this.logPositionScan(
      position.positionId,
      walletAddress,
      healthStatus,
      analysis.urgency,
      analysis.distanceFromRange,
      actionTaken,
      notificationSent
    );

    return { repositioned, notifications };
  }

  /**
   * Execute reposition for Telegram users (auto-sign)
   */
  private async executeReposition(
    wallet: { encrypted: string; iv: string },
    walletAddress: string,
    positionId: string,
    poolAddress: string,
    settings: {
      userId: string;
      allowedStrategies: any;
      maxGasCostSol: any;
    },
    analysis?: {
      urgency: string;
      estimatedGasCost: number;
      reason: string;
    }
  ): Promise<boolean> {
    try {
      logger.info(`🔐 Executing auto-reposition for position ${positionId.slice(0, 8)}...`);

      // 1. Prepare unsigned transaction
      const unsignedTx = await repositionService.prepareRepositionTransaction({
        positionAddress: positionId,
        walletAddress,
        poolAddress,
        strategy: settings.allowedStrategies[0],
        maxGasCost: settings.maxGasCostSol.toNumber(),
        slippage: 100, // 1% default
      });

      // 2. Decrypt private key
      const privateKeyJson = encryptionService.decrypt(wallet.encrypted, wallet.iv);
      const secretKey = new Uint8Array(JSON.parse(privateKeyJson));
      const keypair = Keypair.fromSecretKey(secretKey);

      // 3. Deserialize and sign transaction
      const transaction = Transaction.from(Buffer.from(unsignedTx.transaction, 'base64'));
      transaction.sign(keypair);

      // 4. Send transaction
      const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      logger.info(`📤 Transaction sent: ${signature}`);

      // 5. Confirm transaction
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      logger.info(`✅ Transaction confirmed: ${signature}`);

      // 6. Deduct credits
      const prisma = database.getClient();
      await prisma.user_credits.update({
        where: { walletAddress },
        data: {
          balance: {
            decrement: 1,
          },
        },
      });

      // Record transaction
      const currentBalance = await prisma.user_credits.findUnique({
        where: { walletAddress },
        select: { balance: true },
      });

      await prisma.credit_transactions.create({
        data: {
          walletAddress,
          type: 'usage',
          amount: -1,
          balanceBefore: currentBalance?.balance || 1,
          balanceAfter: (currentBalance?.balance.toNumber() || 1) - 1,
          description: 'Auto-reposition execution',
          relatedResourceId: positionId,
          paymentTxSignature: signature,
        },
      });

      // 7. Send success notification
      await this.sendTelegramNotification(
        settings.userId,
        `✅ Position auto-repositioned!\n\nPosition: ${positionId.slice(0, 8)}...\nTransaction: ${signature.slice(0, 8)}...\n\nView on Solscan: https://solscan.io/tx/${signature}`,
        'reposition_success',
        {
          positionId,
          transactionSignature: signature,
          solscanUrl: `https://solscan.io/tx/${signature}`,
        }
      );

      logger.info(`🎉 Auto-reposition complete for position ${positionId.slice(0, 8)}...`);

      // Log successful execution
      await this.logRepositionExecution(
        walletAddress,
        positionId,
        true,
        unsignedTx.metadata.estimatedGasCost ?? null,
        null,
        signature,
        analysis?.reason || 'Position out of range',
        'auto'
      );

      return true;
    } catch (error) {
      logger.error(`Failed to execute auto-reposition for ${positionId}:`, error);

      // Log failed execution
      await this.logRepositionExecution(
        walletAddress,
        positionId,
        false,
        null,
        null,
        null,
        analysis?.reason || 'Position out of range',
        'auto',
        error instanceof Error ? error.message : 'Unknown error'
      );

      // Send error notification
      await this.sendTelegramNotification(
        settings.userId,
        `❌ Auto-reposition failed for position ${positionId.slice(0, 8)}...\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'reposition_failed',
        {
          positionId,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        }
      );

      return false;
    }
  }

  /**
   * Create notification for website users
   */
  private async createNotification(
    userId: string,
    walletAddress: string,
    positionId: string,
    type: string,
    message: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    const prisma = database.getClient();

    await prisma.reposition_notifications.create({
      data: {
        userId,
        walletAddress,
        positionId,
        type,
        message,
        metadata: metadata ? JSON.stringify(metadata) : null,
        isRead: false,
        createdAt: new Date(),
      },
    });

    logger.info(`📬 Created notification for user ${userId}: ${type}`);
  }

  /**
   * Send Telegram notification by queuing in database
   * The Telegram bot polls telegram_notifications table and sends messages
   */
  private async sendTelegramNotification(
    userId: string,
    message: string,
    type: 'reposition_success' | 'reposition_failed' | 'info' | 'warning' | 'error' = 'info',
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const prisma = database.getClient();

      // Get user's telegram ID
      const user = await prisma.users.findUnique({
        where: { id: userId },
        select: { telegramId: true },
      });

      if (!user || !user.telegramId) {
        logger.warn(`Cannot send Telegram notification: User ${userId} has no Telegram ID`);
        return;
      }

      // Queue notification in database for Telegram bot to pick up
      await prisma.telegram_notifications.create({
        data: {
          telegramId: user.telegramId,
          message,
          type,
          metadata: metadata ? JSON.stringify(metadata) : null,
          sent: false,
          createdAt: new Date(),
        },
      });

      logger.info(`📱 Queued Telegram notification for user ${user.telegramId} (type: ${type})`);
    } catch (error) {
      logger.error('Failed to queue Telegram notification:', error);
    }
  }

  /**
   * Log position scan to monitoring log
   */
  private async logPositionScan(
    positionAddress: string,
    walletAddress: string,
    healthStatus: string,
    urgencyLevel: string | null,
    distanceFromRange: number | null,
    actionTaken: string,
    notificationSent: boolean
  ): Promise<void> {
    try {
      const prisma = database.getClient();

      await prisma.position_monitoring_log.create({
        data: {
          positionAddress,
          walletAddress,
          healthStatus,
          urgencyLevel,
          distanceFromRange,
          feesAvailableUsd: null,
          actionTaken,
          notificationSent,
          createdAt: new Date(),
        },
      });
    } catch (error) {
      logger.error('Failed to log position scan:', error);
    }
  }

  /**
   * Log reposition execution
   */
  private async logRepositionExecution(
    walletAddress: string,
    positionAddress: string,
    success: boolean,
    gasCostSol: number | null,
    feesCollectedUsd: number | null,
    transactionSignature: string | null,
    executionReason: string,
    executionMode: string,
    error?: string
  ): Promise<void> {
    try {
      const prisma = database.getClient();

      await prisma.reposition_executions.create({
        data: {
          walletAddress,
          positionAddress,
          subscriptionId: null,
          success,
          gasCostSol,
          feesCollectedUsd,
          error: error || null,
          transactionSignature,
          executionReason,
          executionMode,
          createdAt: new Date(),
        },
      });

      logger.info(`📊 Logged reposition execution: ${success ? 'SUCCESS' : 'FAILED'}`);
    } catch (error) {
      logger.error('Failed to log reposition execution:', error);
    }
  }

  /**
   * Update monitor state
   */
  private async updateMonitorState(
    positionsScanned: number,
    repositionsTriggered: number,
    errorOccurred: boolean,
    lastError: string | null
  ): Promise<void> {
    try {
      const prisma = database.getClient();

      // Try to update existing state
      const existingState = await prisma.monitor_state.findUnique({
        where: { serviceType: 'auto_reposition_monitor' },
      });

      if (existingState) {
        await prisma.monitor_state.update({
          where: { serviceType: 'auto_reposition_monitor' },
          data: {
            isRunning: false,
            lastRunAt: new Date(),
            lastSuccessAt: errorOccurred ? existingState.lastSuccessAt : new Date(),
            positionsScanned: { increment: positionsScanned },
            repositionsTriggered: { increment: repositionsTriggered },
            errors: errorOccurred ? { increment: 1 } : existingState.errors,
            lastError: lastError || existingState.lastError,
            metadata: JSON.stringify({
              lastCycle: new Date().toISOString(),
              positionsInCycle: positionsScanned,
              repositionsInCycle: repositionsTriggered,
            }),
          },
        });
      } else {
        // Create initial state
        await prisma.monitor_state.create({
          data: {
            serviceType: 'auto_reposition_monitor',
            isRunning: false,
            lastRunAt: new Date(),
            lastSuccessAt: errorOccurred ? new Date() : new Date(),
            positionsScanned,
            repositionsTriggered,
            errors: errorOccurred ? 1 : 0,
            lastError,
            metadata: JSON.stringify({
              lastCycle: new Date().toISOString(),
              positionsInCycle: positionsScanned,
              repositionsInCycle: repositionsTriggered,
            }),
          },
        });
      }

      logger.debug('📊 Monitor state updated');
    } catch (error) {
      logger.error('Failed to update monitor state:', error);
    }
  }

  /**
   * Log metrics for monitoring dashboard
   */
  private async logMetrics(
    duration: string,
    positionsChecked: number,
    repositionsExecuted: number
  ): Promise<void> {
    try {
      const prisma = database.getClient();
      const now = new Date();

      // Log scan duration
      await prisma.monitoring_metrics.create({
        data: {
          metricType: 'scan_duration',
          metricValue: parseFloat(duration),
          labels: JSON.stringify({ unit: 'seconds' }),
          timestamp: now,
        },
      });

      // Log positions checked
      await prisma.monitoring_metrics.create({
        data: {
          metricType: 'positions_checked',
          metricValue: positionsChecked,
          labels: JSON.stringify({ unit: 'count' }),
          timestamp: now,
        },
      });

      // Log repositions executed
      if (repositionsExecuted > 0) {
        await prisma.monitoring_metrics.create({
          data: {
            metricType: 'repositions_executed',
            metricValue: repositionsExecuted,
            labels: JSON.stringify({ unit: 'count' }),
            timestamp: now,
          },
        });
      }

      logger.debug('📊 Metrics logged successfully');
    } catch (error) {
      logger.error('Failed to log metrics:', error);
    }
  }
}

// Export singleton instance
export const autoRepositionWorker = new AutoRepositionWorker();
