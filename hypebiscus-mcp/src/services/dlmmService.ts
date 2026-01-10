// DLMM Service - On-chain interaction with Meteora DLMM pools
import DLMM from '@meteora-ag/dlmm';
import { Connection, PublicKey } from '@solana/web3.js';
import { config, logger } from '../config.js';
import { ErrorType, HypebiscusMCPError } from '../tools/types.js';
import { validateSolanaAddress } from '../utils/validation.js';
import { withRetry } from '../utils/errors.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DLMMInstance = any;

interface PositionBinData {
  binId: number;
  pricePerToken: string;
  xAmount: string;
  yAmount: string;
  supply: string;
  version: number;
  positionXAmount: string;
  positionYAmount: string;
}

interface DLMMPositionData {
  positionId: string;
  poolAddress: string;
  owner: string;
  binCount: number;
  minBinId: number;
  maxBinId: number;
  range: number;
  bins: PositionBinData[];
  totalXAmount: number;
  totalYAmount: number;
}

interface BinDistribution {
  binId: number;
  price: number;
  xAmount: number;
  yAmount: number;
  liquidityUSD: number;
  pricePerToken: number;
}

interface PoolStatus {
  currentPrice: number;
  activeBinId: number;
  binStep: number;
  tokenXDecimals: number;
  tokenYDecimals: number;
  tokenXMint: string;
  tokenYMint: string;
}

interface RebalanceRecommendation {
  shouldRebalance: boolean;
  reason: string;
  currentActiveBin: number;
  positionRange: { min: number; max: number };
  distanceFromRange: number;
  bufferBins: number;
  isInBufferZone: boolean;
  suggestedAction?: string;
}

export class DlmmService {
  private connection: Connection;
  private poolCache: Map<string, { pool: DLMMInstance; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly BUFFER_BINS = 2;

  constructor(rpcUrl?: string) {
    this.connection = new Connection(rpcUrl || config.solanaRpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: config.requestTimeout,
    });
    logger.info(`Initialized DLMM service with RPC: ${rpcUrl || config.solanaRpcUrl}`);
  }

  /**
   * Gets or creates a DLMM pool instance with caching
   * @param poolAddress - The pool address
   * @returns DLMM pool instance
   */
  private async getPoolInstance(poolAddress: string): Promise<DLMMInstance> {
    validateSolanaAddress(poolAddress);

    const cached = this.poolCache.get(poolAddress);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      logger.debug(`Using cached pool instance for ${poolAddress}`);
      return cached.pool;
    }

    logger.debug(`Creating new pool instance for ${poolAddress}`);

    return await withRetry(
      async () => {
        const poolPubkey = new PublicKey(poolAddress);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pool = await (DLMM as any).create(this.connection, poolPubkey);

        this.poolCache.set(poolAddress, { pool, timestamp: now });
        logger.info(`Successfully created DLMM pool instance for ${poolAddress}`);

        return pool;
      },
      3,
      2000
    );
  }

  /**
   * Gets pool status including active bin and price information
   * @param poolAddress - The pool address
   * @returns Pool status
   */
  async getPoolStatus(poolAddress: string): Promise<PoolStatus> {
    try {
      logger.info(`Fetching pool status for ${poolAddress}`);

      const pool = await this.getPoolInstance(poolAddress);
      const activeBin = await pool.getActiveBin();

      // Get pool state for additional metadata
      const poolState = pool.lbPair;

      return {
        currentPrice: parseFloat(activeBin.price),
        activeBinId: activeBin.binId,
        binStep: poolState.binStep,
        tokenXDecimals: poolState.tokenXMint.toBase58() === config.defaultPoolAddress ? 8 : 9,
        tokenYDecimals: 9,
        tokenXMint: poolState.tokenXMint.toBase58(),
        tokenYMint: poolState.tokenYMint.toBase58(),
      };
    } catch (error) {
      logger.error(`Failed to get pool status for ${poolAddress}:`, error);
      throw new HypebiscusMCPError(
        ErrorType.RPC_ERROR,
        `Failed to fetch pool status`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Gets detailed position data from on-chain
   * @param positionId - The position public key
   * @param poolAddress - Optional pool address (improves performance)
   * @returns Position details
   */
  async getPositionDetails(positionId: string, poolAddress?: string): Promise<DLMMPositionData | null> {
    try {
      logger.info(`Fetching position details for ${positionId}`);

      validateSolanaAddress(positionId);
      const positionPubkey = new PublicKey(positionId);

      // If pool address is provided, use it directly
      let pool: DLMMInstance;
      if (poolAddress) {
        pool = await this.getPoolInstance(poolAddress);
      } else {
        // Try default pool
        pool = await this.getPoolInstance(config.defaultPoolAddress);
      }

      const position = await pool.getPosition(positionPubkey);

      if (!position || !position.positionData) {
        logger.warn(`Position ${positionId} not found or already closed`);
        return null;
      }

      const positionBins = position.positionData.positionBinData || [];

      if (positionBins.length === 0) {
        logger.warn(`Position ${positionId} has no bins`);
        return null;
      }

      const binIds = positionBins.map((bin: PositionBinData) => bin.binId);
      const minBinId = Math.min(...binIds);
      const maxBinId = Math.max(...binIds);

      // Calculate total amounts
      let totalXAmount = 0;
      let totalYAmount = 0;

      for (const bin of positionBins) {
        totalXAmount += parseFloat(bin.positionXAmount || '0');
        totalYAmount += parseFloat(bin.positionYAmount || '0');
      }

      const result: DLMMPositionData = {
        positionId,
        poolAddress: pool.pubkey.toBase58(),
        owner: position.publicKey.toBase58(),
        binCount: positionBins.length,
        minBinId,
        maxBinId,
        range: maxBinId - minBinId,
        bins: positionBins,
        totalXAmount,
        totalYAmount,
      };

      logger.info(
        `Position ${positionId}: ${result.binCount} bins, range ${minBinId}-${maxBinId}`
      );

      return result;
    } catch (error) {
      logger.error(`Failed to get position details for ${positionId}:`, error);

      // Return null if position doesn't exist rather than throwing
      if (
        error instanceof Error &&
        (error.message.includes('not found') || error.message.includes('Account does not exist'))
      ) {
        return null;
      }

      throw new HypebiscusMCPError(
        ErrorType.RPC_ERROR,
        `Failed to fetch position details`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Gets bin distribution around active bin
   * @param poolAddress - The pool address
   * @param rangeSize - Number of bins to fetch on each side of active bin (default: 50)
   * @returns Array of bin distributions
   */
  async getBinDistribution(
    poolAddress: string,
    rangeSize: number = 50
  ): Promise<BinDistribution[]> {
    try {
      logger.info(`Fetching bin distribution for ${poolAddress} (range: ${rangeSize})`);

      const pool = await this.getPoolInstance(poolAddress);
      const activeBin = await pool.getActiveBin();
      const activeBinId = activeBin.binId;

      const fromBinId = Math.max(0, activeBinId - rangeSize);
      const toBinId = activeBinId + rangeSize;

      logger.debug(`Fetching bins from ${fromBinId} to ${toBinId}`);

      // Get bin arrays (use getBinArrays method from Meteora SDK)
      const binArrays = await pool.getBinArrays();

      const distributions: BinDistribution[] = [];

      // Process all bin arrays and filter by range
      for (const binArray of binArrays) {
        if (!binArray || !binArray.account || !binArray.account.bins) {
          continue;
        }

        for (const bin of binArray.account.bins) {
          const binId = bin.binId;

          // Only include bins within our requested range
          if (binId >= fromBinId && binId <= toBinId) {
            const xAmount = bin.amountX ? parseFloat(bin.amountX.toString()) : 0;
            const yAmount = bin.amountY ? parseFloat(bin.amountY.toString()) : 0;

            // Skip bins with no liquidity
            if (xAmount === 0 && yAmount === 0) {
              continue;
            }

            // Calculate price from bin ID
            const price = activeBin.binId === binId ? parseFloat(activeBin.price) :
              parseFloat(activeBin.price) * Math.pow(1.0001, (binId - activeBin.binId));

            // Calculate approximate USD value (simplified)
            const liquidityUSD = (xAmount / 1e8) * price + (yAmount / 1e9);

            distributions.push({
              binId,
              price,
              xAmount: xAmount / 1e8,
              yAmount: yAmount / 1e9,
              liquidityUSD,
              pricePerToken: price,
            });
          }
        }
      }

      // Sort by bin ID
      distributions.sort((a, b) => a.binId - b.binId);

      logger.info(
        `Found ${distributions.length} bins with liquidity around active bin ${activeBinId}`
      );

      return distributions;
    } catch (error) {
      logger.error(`Failed to get bin distribution for ${poolAddress}:`, error);
      throw new HypebiscusMCPError(
        ErrorType.RPC_ERROR,
        `Failed to fetch bin distribution`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Calculates whether a position needs rebalancing
   * @param positionId - The position ID
   * @param poolAddress - Optional pool address
   * @param bufferBins - Number of buffer bins before recommending rebalance (default: 10)
   * @returns Rebalance recommendation
   */
  async calculateRebalanceNeed(
    positionId: string,
    poolAddress?: string,
    bufferBins: number = this.BUFFER_BINS
  ): Promise<RebalanceRecommendation> {
    try {
      logger.info(`Calculating rebalance need for position ${positionId}`);

      // Get position details
      const position = await this.getPositionDetails(positionId, poolAddress);

      if (!position) {
        throw new HypebiscusMCPError(
          ErrorType.VALIDATION_ERROR,
          'Position not found or already closed'
        );
      }

      // Get current pool status
      const poolStatus = await this.getPoolStatus(position.poolAddress);
      const activeBinId = poolStatus.activeBinId;

      const minBinId = position.minBinId;
      const maxBinId = position.maxBinId;

      // Calculate effective range with buffer
      const effectiveMinBin = minBinId - bufferBins;
      const effectiveMaxBin = maxBinId + bufferBins;

      // Determine if out of range
      const isOutOfRange =
        activeBinId < effectiveMinBin || activeBinId > effectiveMaxBin;

      // Determine if in buffer zone
      const isInBufferZone =
        !isOutOfRange &&
        (activeBinId < minBinId || activeBinId > maxBinId);

      // Calculate distance from position range
      let distanceFromRange = 0;
      if (activeBinId < minBinId) {
        distanceFromRange = minBinId - activeBinId;
      } else if (activeBinId > maxBinId) {
        distanceFromRange = activeBinId - maxBinId;
      }

      // Generate recommendation
      let reason = '';
      let suggestedAction = '';

      if (isOutOfRange) {
        reason = `Position is significantly out of range. Active bin ${activeBinId} is outside buffer zone (${effectiveMinBin}-${effectiveMaxBin}). Distance: ${distanceFromRange} bins.`;
        suggestedAction = 'Close current position and create new position around active bin.';
      } else if (isInBufferZone) {
        reason = `Position is within buffer zone but outside active range. Active bin ${activeBinId} is ${distanceFromRange} bins away from position edge.`;
        suggestedAction = 'Monitor closely. Consider rebalancing if price continues moving away.';
      } else {
        reason = `Position is healthy. Active bin ${activeBinId} is within position range (${minBinId}-${maxBinId}).`;
        suggestedAction = 'No action needed. Continue monitoring.';
      }

      const recommendation: RebalanceRecommendation = {
        shouldRebalance: isOutOfRange,
        reason,
        currentActiveBin: activeBinId,
        positionRange: { min: minBinId, max: maxBinId },
        distanceFromRange,
        bufferBins,
        isInBufferZone,
        suggestedAction,
      };

      logger.info(
        `Rebalance analysis complete: ${recommendation.shouldRebalance ? 'REBALANCE NEEDED' : 'OK'}`
      );

      return recommendation;
    } catch (error) {
      if (error instanceof HypebiscusMCPError) {
        throw error;
      }

      logger.error(`Failed to calculate rebalance need for ${positionId}:`, error);
      throw new HypebiscusMCPError(
        ErrorType.RPC_ERROR,
        `Failed to calculate rebalance recommendation`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Checks if a position is out of range
   * @param positionId - The position ID
   * @param poolAddress - Optional pool address
   * @param bufferBins - Number of buffer bins (default: 10)
   * @returns True if position is out of range
   */
  async isPositionOutOfRange(
    positionId: string,
    poolAddress?: string,
    bufferBins: number = this.BUFFER_BINS
  ): Promise<boolean> {
    const recommendation = await this.calculateRebalanceNeed(
      positionId,
      poolAddress,
      bufferBins
    );
    return recommendation.shouldRebalance;
  }
}

// Export singleton instance
export const dlmmService = new DlmmService();
