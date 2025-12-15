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

    try {
      logger.info('=== Auto-Reposition Worker Cycle Started ===');

      const prisma = database.getClient();

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
      let totalRepositioned = 0;
      let totalNotifications = 0;

      // 2. Process each user
      for (const settings of usersWithAutoReposition) {
        try {
          const result = await this.processUser(settings);
          totalProcessed++;
          totalRepositioned += result.repositioned;
          totalNotifications += result.notifications;
        } catch (error) {
          logger.error(`Failed to process user ${settings.userId}:`, error);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info('=== Auto-Reposition Worker Cycle Complete ===');
      logger.info(`Processed: ${totalProcessed} users`);
      logger.info(`Repositioned: ${totalRepositioned} positions`);
      logger.info(`Notifications: ${totalNotifications} created`);
      logger.info(`Duration: ${duration}s`);
    } catch (error) {
      logger.error('Auto-reposition worker cycle failed:', error);
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
  }): Promise<{ repositioned: number; notifications: number }> {
    const prisma = database.getClient();
    let repositionedCount = 0;
    let notificationCount = 0;

    const walletAddress = settings.user.linkedWalletAddress;
    if (!walletAddress) {
      logger.debug(`User ${settings.userId} has no linked wallet, skipping`);
      return { repositioned: 0, notifications: 0 };
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
    const positions = await prisma.positions.findMany({
      where: {
        userId: settings.userId,
        isActive: true,
      },
    });

    logger.debug(`User ${settings.userId} (${walletAddress.slice(0, 8)}...) has ${positions.length} active positions`);

    // Process each position
    for (const position of positions) {
      try {
        // Analyze if reposition is needed
        const analysis = await repositionService.analyzePosition(
          position.positionId,
          position.poolAddress
        );

        // Check if reposition is recommended
        if (!analysis.shouldReposition) {
          continue;
        }

        // Check urgency threshold
        const urgencyLevels = { low: 1, medium: 2, high: 3 };
        const requiredUrgency = urgencyLevels[settings.urgencyThreshold as keyof typeof urgencyLevels] || 2;
        const actualUrgency = urgencyLevels[analysis.urgency];

        if (actualUrgency < requiredUrgency) {
          logger.debug(
            `Position ${position.positionId.slice(0, 8)}... urgency ${analysis.urgency} below threshold ${settings.urgencyThreshold}`
          );
          continue;
        }

        // Check gas cost limit
        if (analysis.estimatedGasCost > settings.maxGasCostSol.toNumber()) {
          logger.debug(
            `Position ${position.positionId.slice(0, 8)}... gas cost ${analysis.estimatedGasCost} exceeds limit ${settings.maxGasCostSol.toNumber()}`
          );
          continue;
        }

        // Check credits
        const credits = await prisma.user_credits.findUnique({
          where: { walletAddress },
        });

        if (!credits || credits.balance.toNumber() < 1) {
          logger.warn(`User ${settings.userId} has insufficient credits for auto-reposition`);

          // Create notification about insufficient credits
          await this.createNotification(
            settings.userId,
            walletAddress,
            position.positionId,
            'insufficient_credits',
            'Auto-reposition paused: Insufficient credits. Please purchase credits to resume.'
          );
          notificationCount++;
          continue;
        }

        logger.info(
          `🎯 Position ${position.positionId.slice(0, 8)}... needs reposition (urgency: ${analysis.urgency})`
        );

        // Execute reposition based on user type
        if (canAutoSign) {
          // Telegram user - execute automatically
          const success = await this.executeReposition(
            settings.user.wallets!,
            walletAddress,
            position.positionId,
            position.poolAddress,
            settings
          );

          if (success) {
            repositionedCount++;
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
          notificationCount++;
        }
      } catch (error) {
        logger.error(`Failed to process position ${position.positionId}:`, error);
      }
    }

    return { repositioned: repositionedCount, notifications: notificationCount };
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
      return true;
    } catch (error) {
      logger.error(`Failed to execute auto-reposition for ${positionId}:`, error);

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
}

// Export singleton instance
export const autoRepositionWorker = new AutoRepositionWorker();
