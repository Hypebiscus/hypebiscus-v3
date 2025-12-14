/**
 * Manual Wallet Position Sync Tool
 *
 * Allows users to manually trigger position sync to database.
 * Requires: Credits balance > 0 OR active subscription
 *
 * This tool is for website users who need on-demand sync.
 * Telegram users are automatically synced via background worker.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { config, logger } from '../config.js';
import { database } from '../services/database.js';
import { priceApi } from '../services/priceApi.js';
import { withRetry } from '../utils/errors.js';
import { TOKEN_MINTS } from './types.js';

interface SyncWalletPositionsInput {
  walletAddress: string;
}

interface SyncWalletPositionsOutput {
  success: boolean;
  positionsSynced: number;
  hasAccess: boolean;
  reason?: string;
  message: string;
}

/**
 * Check if user has access to position syncing
 * Access granted if: credits > 0 OR active subscription
 */
async function checkSyncAccess(walletAddress: string): Promise<{
  hasAccess: boolean;
  reason: string;
}> {
  const prisma = database.getClient();

  try {
    // Check credits
    const credits = await prisma.user_credits.findUnique({
      where: { walletAddress },
    });

    if (credits && credits.balance.toNumber() > 0) {
      return {
        hasAccess: true,
        reason: 'credits',
      };
    }

    // Check subscription
    const subscription = await prisma.user_subscriptions.findFirst({
      where: {
        walletAddress,
        status: 'active',
        currentPeriodEnd: { gt: new Date() },
      },
    });

    if (subscription) {
      return {
        hasAccess: true,
        reason: 'subscription',
      };
    }

    // No access
    return {
      hasAccess: false,
      reason: 'no_payment',
    };
  } catch (error) {
    logger.error('Error checking sync access:', error);
    return {
      hasAccess: false,
      reason: 'error',
    };
  }
}

/**
 * Sync wallet positions to database
 * Same logic as background sync but for single wallet
 */
async function performPositionSync(
  walletAddress: string
): Promise<{ synced: number; errors: number }> {
  const prisma = database.getClient();
  const connection = new Connection(config.solanaRpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: config.requestTimeout,
  });

  let syncedCount = 0;
  let errorCount = 0;

  try {
    const publicKey = new PublicKey(walletAddress);

    // Get or create wallet and user
    let wallet = await prisma.wallets.findUnique({
      where: { publicKey: walletAddress },
      include: { users: true },
    });

    // Auto-create user and wallet if they don't exist (for website users)
    if (!wallet) {
      logger.info(`Creating user and wallet records for ${walletAddress.slice(0, 8)}...`);

      // Generate unique user ID and telegram ID for website users
      const userId = `user-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      // Use negative timestamp for website user telegram IDs to avoid conflicts
      const websiteTelegramId = BigInt(-Date.now());

      // Create user first
      const newUser = await prisma.users.create({
        data: {
          id: userId,
          telegramId: websiteTelegramId,
          username: `web-${walletAddress.slice(0, 8)}`,
          linkedWalletAddress: walletAddress,
          isMonitoring: false,
          createdAt: new Date(),
        },
      });

      // Create wallet linked to user
      // Website users use browser wallets, so we don't store encrypted keys
      const newWallet = await prisma.wallets.create({
        data: {
          id: `wallet-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          publicKey: walletAddress,
          userId: newUser.id,
          encrypted: '', // No private key for browser wallet users
          iv: '', // No encryption IV needed
          source: 'website',
          isActive: true,
          createdAt: new Date(),
        },
        include: { users: true },
      });

      wallet = newWallet;
      logger.info(`Created user ${newUser.id} and wallet for ${walletAddress.slice(0, 8)}`);
    }

    // Double-check user exists
    if (!wallet || !wallet.users) {
      logger.error(`Wallet exists but no user found for ${walletAddress}`);
      return { synced: 0, errors: 1 };
    }

    const userId = wallet.userId;
    const linkedWalletAddress = wallet.users.linkedWalletAddress ?? null;

    // Fetch all on-chain positions
    const livePositions = await withRetry(
      async () => {
        return await DLMM.getAllLbPairPositionsByUser(connection, publicKey);
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

    logger.debug(`Syncing positions with prices: zBTC=$${zbtcPrice}, SOL=$${solPrice}`);

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
          const xAmount = parseFloat(String(positionData.totalXAmount || 0)) / Math.pow(10, 8);
          const yAmount = parseFloat(String(positionData.totalYAmount || 0)) / Math.pow(10, 9);
          const xFees = parseFloat(String(positionData.feeX || 0)) / Math.pow(10, 8);
          const yFees = parseFloat(String(positionData.feeY || 0)) / Math.pow(10, 9);

          // Get bin range
          const binIds = bins.map((bin) => Number(bin.binId));
          const minBinId = Math.min(...binIds);

          // Calculate deposit value for PnL tracking
          const depositValueUsd = xAmount * zbtcPrice + yAmount * solPrice;

          // Upsert position in database
          await prisma.positions.upsert({
            where: { positionId },
            create: {
              id: `pos-${Date.now()}-${Math.random().toString(36).substring(7)}`,
              userId,
              positionId,
              poolAddress: poolAddressStr,
              zbtcAmount: xAmount,
              solAmount: yAmount,
              entryPrice: zbtcPrice,
              entryBin: minBinId,
              isActive: true,
              zbtcFees: xFees,
              solFees: yFees,
              source: 'website', // Manual sync is for website users
              linkedWalletAddress,
              createdAt: new Date(),
              lastChecked: new Date(),
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
              linkedWalletAddress,
              lastChecked: new Date(),
            },
          });

          syncedCount++;
        } catch (error) {
          logger.error(`Error syncing position ${pos.publicKey}:`, error);
          errorCount++;
        }
      }
    }

    // Mark positions that are no longer on-chain as closed
    const dbPositions = await prisma.positions.findMany({
      where: {
        userId,
        isActive: true,
      },
    });

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
            exitBin: dbPos.entryBin,
            zbtcReturned: dbPos.zbtcAmount,
            solReturned: dbPos.solAmount,
            pnlUsd,
            pnlPercent,
            lastChecked: new Date(),
          },
        });
      }
    }

    return { synced: syncedCount, errors: errorCount };
  } catch (error) {
    logger.error(`Failed to sync wallet ${walletAddress}:`, error);
    return { synced: syncedCount, errors: errorCount + 1 };
  }
}

/**
 * Main tool function: Sync wallet positions to database
 *
 * @param input - Wallet address to sync
 * @returns Sync result with access status
 */
export async function syncWalletPositions(
  input: SyncWalletPositionsInput
): Promise<SyncWalletPositionsOutput> {
  logger.info(`Manual sync requested for wallet: ${input.walletAddress.slice(0, 8)}...`);

  try {
    // 1. Check access (credits or subscription)
    const accessCheck = await checkSyncAccess(input.walletAddress);

    if (!accessCheck.hasAccess) {
      logger.warn(`Access denied for wallet ${input.walletAddress}: ${accessCheck.reason}`);
      return {
        success: false,
        positionsSynced: 0,
        hasAccess: false,
        reason: accessCheck.reason,
        message:
          'Position sync requires credits or an active subscription. Purchase credits to enable position tracking, historical PnL, and advanced features.',
      };
    }

    // 2. Perform sync
    logger.info(
      `Access granted via ${accessCheck.reason}, syncing positions for ${input.walletAddress.slice(0, 8)}...`
    );

    const result = await performPositionSync(input.walletAddress);

    if (result.errors > 0) {
      logger.warn(
        `Sync completed with errors: ${result.synced} synced, ${result.errors} errors`
      );
    }

    return {
      success: true,
      positionsSynced: result.synced,
      hasAccess: true,
      reason: accessCheck.reason,
      message: `Successfully synced ${result.synced} position${result.synced !== 1 ? 's' : ''} to database. ${result.errors > 0 ? `${result.errors} error(s) occurred.` : ''}`,
    };
  } catch (error) {
    logger.error('Sync wallet positions failed:', error);
    return {
      success: false,
      positionsSynced: 0,
      hasAccess: false,
      reason: 'error',
      message: `Failed to sync positions: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// Export types
export type { SyncWalletPositionsInput, SyncWalletPositionsOutput };
