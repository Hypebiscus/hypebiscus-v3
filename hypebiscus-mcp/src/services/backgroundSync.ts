// Background Sync Service - Phase 2 of Hybrid Data Sync Implementation
// Automatically syncs wallet positions from blockchain to database every 5 minutes

import { Connection, PublicKey } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { config, logger } from '../config.js';
import { prisma, dbUtils } from './database.js';
import { priceApi } from './priceApi.js';
import { withRetry } from '../utils/errors.js';
import { TOKEN_MINTS } from '../tools/types.js';

interface SyncStatistics {
  usersProcessed: number;
  positionsUpdated: number;
  positionsClosed: number;
  errors: string[];
  duration: number;
}

/**
 * Background sync worker that keeps database positions synchronized with blockchain
 * Runs every 5 minutes (configurable) to:
 * - Fetch on-chain positions for all monitored wallets
 * - Update active positions (liquidity, fees, health)
 * - Mark positions as closed if no longer on-chain
 * - Calculate and update USD values
 */
export class BackgroundSyncService {
  private connection: Connection;
  private running = false;
  private intervalId: NodeJS.Timeout | null = null;
  private syncInterval: number;
  private isEnabled: boolean;

  constructor() {
    this.connection = new Connection(config.solanaRpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: config.requestTimeout,
    });

    // Get sync configuration from environment
    this.isEnabled = config.backgroundSyncEnabled;
    this.syncInterval = config.backgroundSyncInterval;

    logger.info(
      `Background sync service initialized (enabled: ${this.isEnabled}, interval: ${this.syncInterval}ms)`
    );
  }

  /**
   * Starts the background sync worker
   * Runs initial sync immediately, then schedules recurring syncs
   */
  start(): void {
    if (!this.isEnabled) {
      logger.info('Background sync service is disabled via configuration');
      return;
    }

    if (this.running) {
      logger.warn('Background sync worker already running');
      return;
    }

    this.running = true;
    logger.info(`Starting background sync worker (interval: ${this.syncInterval}ms)`);

    // Run initial sync immediately
    this.syncAllWallets()
      .then(() => logger.info('Initial sync completed'))
      .catch((err) => logger.error('Initial sync failed:', err));

    // Schedule recurring syncs
    this.intervalId = setInterval(() => {
      this.syncAllWallets().catch((err) => logger.error('Scheduled sync failed:', err));
    }, this.syncInterval);

    logger.info('Background sync worker started successfully');
  }

  /**
   * Stops the background sync worker gracefully
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    logger.info('Stopping background sync worker...');

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.running = false;
    logger.info('Background sync worker stopped');
  }

  /**
   * Checks if the worker is currently running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get all users eligible for position syncing
   * Users qualify if they have ANY of:
   * 1. isMonitoring = true (Telegram bot users - legacy)
   * 2. Credits balance > 0
   * 3. Active subscription
   */
  private async getEligibleUsers() {
    try {
      // 1. Get users with isMonitoring = true (Telegram bot users)
      const telegramUsers = await prisma.users.findMany({
        where: { isMonitoring: true },
        include: {
          wallets: {
            select: {
              publicKey: true,
            },
          },
        },
      });

      // 2. Get wallet addresses with credits > 0
      const walletsWithCredits = await prisma.user_credits.findMany({
        where: {
          balance: { gt: 0 },
        },
        select: {
          walletAddress: true,
        },
      });

      // 3. Get wallet addresses with active subscriptions
      const walletsWithSubscriptions = await prisma.user_subscriptions.findMany({
        where: {
          status: 'active',
          currentPeriodEnd: { gt: new Date() },
        },
        select: {
          walletAddress: true,
        },
      });

      // Collect all eligible wallet addresses
      const eligibleWalletAddresses = new Set<string>([
        ...walletsWithCredits.map((w) => w.walletAddress),
        ...walletsWithSubscriptions.map((w) => w.walletAddress),
      ]);

      // 4. Get users whose wallets match the eligible addresses
      const paidUsers = await prisma.users.findMany({
        where: {
          wallets: {
            publicKey: {
              in: Array.from(eligibleWalletAddresses),
            },
          },
        },
        include: {
          wallets: {
            select: {
              publicKey: true,
            },
          },
        },
      });

      // Combine telegram users and paid users (dedupe by user ID)
      const allEligibleUsersMap = new Map();

      for (const user of [...telegramUsers, ...paidUsers]) {
        allEligibleUsersMap.set(user.id, user);
      }

      const allEligibleUsers = Array.from(allEligibleUsersMap.values());

      logger.debug(
        `Eligibility breakdown: ${telegramUsers.length} Telegram, ` +
          `${walletsWithCredits.length} with credits, ` +
          `${walletsWithSubscriptions.length} with subscriptions, ` +
          `${allEligibleUsers.length} total unique users`
      );

      return allEligibleUsers;
    } catch (error) {
      logger.error('Error fetching eligible users:', error);
      return [];
    }
  }

  /**
   * Main sync logic - processes all monitored wallets
   * This is the entry point for each sync cycle
   *
   * Syncs users who meet ANY of these criteria:
   * 1. isMonitoring = true (Telegram bot users)
   * 2. Have credits (balance > 0)
   * 3. Have active subscription
   */
  private async syncAllWallets(): Promise<SyncStatistics> {
    const startTime = Date.now();
    const stats: SyncStatistics = {
      usersProcessed: 0,
      positionsUpdated: 0,
      positionsClosed: 0,
      errors: [],
      duration: 0,
    };

    try {
      logger.info('=== Starting background sync cycle ===');

      // Get all eligible users (Telegram monitoring OR credits OR subscription)
      const eligibleUsers = await this.getEligibleUsers();

      logger.info(`Found ${eligibleUsers.length} eligible users for sync`);

      if (eligibleUsers.length === 0) {
        logger.info('No eligible users found, sync complete');
        stats.duration = Date.now() - startTime;
        return stats;
      }

      // Process each user's positions
      for (const user of eligibleUsers) {
        if (!user.wallets) {
          logger.warn(`User ${user.id} has no wallet, skipping`);
          continue;
        }

        try {
          const walletStats = await this.syncWalletPositions(
            user.id,
            user.wallets.publicKey
          );

          stats.usersProcessed++;
          stats.positionsUpdated += walletStats.updated;
          stats.positionsClosed += walletStats.closed;

          logger.debug(
            `User ${user.id}: ${walletStats.updated} updated, ${walletStats.closed} closed`
          );
        } catch (error) {
          const errorMsg = `Failed to sync user ${user.id}: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(errorMsg);
          stats.errors.push(errorMsg);
        }
      }

      stats.duration = Date.now() - startTime;

      logger.info(
        `=== Sync cycle complete: ${stats.usersProcessed}/${eligibleUsers.length} users, ` +
          `${stats.positionsUpdated} positions updated, ${stats.positionsClosed} closed, ` +
          `${stats.errors.length} errors, ${stats.duration}ms ===`
      );

      return stats;
    } catch (error) {
      stats.duration = Date.now() - startTime;
      const errorMsg = `Sync cycle failed: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      stats.errors.push(errorMsg);
      throw error;
    }
  }

  /**
   * Syncs positions for a single wallet
   * @param userId - Database user ID
   * @param walletAddress - Solana wallet public key
   * @returns Statistics about updated and closed positions
   */
  private async syncWalletPositions(
    userId: string,
    walletAddress: string
  ): Promise<{ updated: number; closed: number }> {
    logger.debug(`Syncing positions for wallet: ${walletAddress}`);

    let updatedCount = 0;
    let closedCount = 0;

    try {
      const publicKey = new PublicKey(walletAddress);

      // Get user's wallet linking info for position tagging
      const user = await prisma.users.findUnique({
        where: { id: userId },
        select: { linkedWalletAddress: true },
      });

      const linkedWalletAddress = user?.linkedWalletAddress ?? null;

      // Fetch all on-chain positions for this wallet
      const livePositions = await withRetry(
        async () => {
          return await DLMM.getAllLbPairPositionsByUser(this.connection, publicKey);
        },
        3,
        2000
      );

      const livePositionIds = new Set<string>();

      // Get current token prices for USD calculations
      const prices = await priceApi.getMultiplePrices([
        { symbol: 'zBTC', address: TOKEN_MINTS.zBTC },
        { symbol: 'SOL', address: TOKEN_MINTS.SOL },
      ]);

      const zbtcPrice = prices.get('zBTC')?.price ?? 0;
      const solPrice = prices.get('SOL')?.price ?? 0;

      logger.debug(`Using prices: zBTC=$${zbtcPrice}, SOL=$${solPrice}`);

      // Process each pool's positions
      for (const [poolAddress, positionInfo] of livePositions.entries()) {
        const poolAddressStr = String(poolAddress);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const positions = (positionInfo as any).lbPairPositionsData || [];

        for (const pos of positions) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const positionId = (pos.publicKey?.toBase58?.() || String(pos.publicKey)) as string;
            livePositionIds.add(positionId);

            // Extract position data
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const positionData = pos.positionData as any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const bins = (positionData?.positionBinData || []) as any[];

            if (bins.length === 0) {
              logger.debug(`Position ${positionId} has no bins, skipping`);
              continue;
            }

            // Calculate token amounts (zBTC: 8 decimals, SOL: 9 decimals)
            const xAmount =
              parseFloat(String(positionData.totalXAmount || 0)) / Math.pow(10, 8);
            const yAmount =
              parseFloat(String(positionData.totalYAmount || 0)) / Math.pow(10, 9);
            const xFees = parseFloat(String(positionData.feeX || 0)) / Math.pow(10, 8);
            const yFees = parseFloat(String(positionData.feeY || 0)) / Math.pow(10, 9);

            // Get bin range
            const binIds = bins.map((bin) => Number(bin.binId));
            const minBinId = Math.min(...binIds);

            // Upsert position in database with source and linking info
            // Calculate deposit value for PnL tracking
            const depositValueUsd = xAmount * zbtcPrice + yAmount * solPrice;

            await prisma.positions.upsert({
              where: { positionId },
              create: {
                id: `pos-${Date.now()}-${Math.random().toString(36).substring(7)}`,
                userId,
                positionId,
                poolAddress: poolAddressStr,
                zbtcAmount: xAmount,
                solAmount: yAmount,
                entryPrice: zbtcPrice, // Store current price on creation
                entryBin: minBinId,
                isActive: true,
                zbtcFees: xFees,
                solFees: yFees,
                source: 'telegram', // Background sync is for Telegram bot wallets
                linkedWalletAddress, // Link to website wallet if exists
                createdAt: new Date(),
                lastChecked: new Date(),
                // Enhanced PnL tracking fields
                depositValueUsd,
                depositTokenXPrice: zbtcPrice,
                depositTokenYPrice: solPrice,
              },
              update: {
                zbtcAmount: xAmount,
                solAmount: yAmount,
                zbtcFees: xFees,
                solFees: yFees,
                isActive: true,
                linkedWalletAddress, // Update link in case it changed
                lastChecked: new Date(),
              },
            });

            updatedCount++;
          } catch (error) {
            logger.error(`Error processing position ${pos.publicKey}:`, error);
          }
        }
      }

      // Mark positions that are no longer on-chain as closed
      const dbPositions = await dbUtils.findPositionsByUserId(userId, false); // Only active

      for (const dbPos of dbPositions) {
        if (!livePositionIds.has(dbPos.positionId)) {
          logger.info(`Position ${dbPos.positionId} no longer on-chain, marking as closed`);

          // Calculate final PnL
          const exitValueUsd =
            (dbPos.zbtcAmount.toNumber() ?? 0) * zbtcPrice +
            (dbPos.solAmount.toNumber() ?? 0) * solPrice;
          const entryValueUsd =
            (dbPos.zbtcAmount.toNumber() ?? 0) * (dbPos.entryPrice.toNumber() ?? zbtcPrice) +
            (dbPos.solAmount.toNumber() ?? 0) * solPrice;

          const pnlUsd = exitValueUsd - entryValueUsd;
          const pnlPercent = entryValueUsd > 0 ? (pnlUsd / entryValueUsd) * 100 : 0;

          await prisma.positions.update({
            where: { id: dbPos.id },
            data: {
              isActive: false,
              closedAt: new Date(),
              exitPrice: zbtcPrice,
              exitBin: dbPos.entryBin, // Use entry bin as fallback
              zbtcReturned: dbPos.zbtcAmount,
              solReturned: dbPos.solAmount,
              pnlUsd,
              pnlPercent,
              lastChecked: new Date(),
            },
          });

          closedCount++;
        }
      }

      logger.debug(
        `Wallet ${walletAddress}: ${updatedCount} positions updated, ${closedCount} closed`
      );

      return { updated: updatedCount, closed: closedCount };
    } catch (error) {
      logger.error(`Failed to sync wallet ${walletAddress}:`, error);
      throw error;
    }
  }

  /**
   * Forces an immediate sync (for manual triggering)
   * @returns Sync statistics
   */
  async forceSync(): Promise<SyncStatistics> {
    logger.info('Manual sync triggered');
    return await this.syncAllWallets();
  }

  // NOTE: Position health calculation has been removed from background sync for performance reasons
  // Health is calculated on-demand in getUserPositionsWithSync tool
  // If needed in future, can be added back with database schema updates for health tracking
}

// Export singleton instance
export const backgroundSync = new BackgroundSyncService();
