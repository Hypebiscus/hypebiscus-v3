// Enhanced meteoraPositionService.ts - FIXED VERSION with efficient bin detection
// No more intensive RPC calls for bin existence checking

import DLMM, { StrategyType, autoFillYByStrategy } from '@meteora-ag/dlmm';
import { Connection, PublicKey, Keypair, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { useWallet } from '@solana/wallet-adapter-react';

export type DlmmType = DLMM;

interface DLMMPool {
  getActiveBin(): Promise<{
    binId: number;
    price: string;
    xAmount: string;
    yAmount: string;
  }>;
  getBin(binId: number): Promise<unknown>;
  getExistingBinArray(binArrayIndex: number): Promise<unknown>;
  initializePositionAndAddLiquidityByStrategy(params: {
    positionPubKey: PublicKey;
    user: PublicKey;
    totalXAmount: BN;
    totalYAmount: BN;
    strategy: {
      maxBinId: number;
      minBinId: number;
      strategyType: StrategyType;
    };
  }): Promise<Transaction | Transaction[]>;
  addLiquidityByStrategy(params: {
    positionPubKey: PublicKey;
    user: PublicKey;
    totalXAmount: BN;
    totalYAmount: BN;
    strategy: {
      maxBinId: number;
      minBinId: number;
      strategyType: StrategyType;
    };
  }): Promise<Transaction | Transaction[]>;
  removeLiquidity(params: {
    position: PublicKey;
    user: PublicKey;
    fromBinId: number;
    toBinId: number;
    liquiditiesBpsToRemove: BN[];
    shouldClaimAndClose: boolean;
  }): Promise<Transaction | Transaction[]>;
  claimSwapFee(params: {
    owner: PublicKey;
    position: PublicKey;
  }): Promise<Transaction>;
  claimAllSwapFee(params: {
    owner: PublicKey;
    positions: PositionData[];
  }): Promise<Transaction | Transaction[]>;
  closePosition(params: {
    owner: PublicKey;
    position: PublicKey;
  }): Promise<Transaction>;
  getPosition(positionPubKey: PublicKey): Promise<unknown>;
  getPositionsByUserAndLbPair(userPublicKey: PublicKey): Promise<{
    userPositions: PositionData[];
  }>;
  lbPair: {
    binStep: number;
  };
  [key: string]: unknown;
}

interface PositionData {
  publicKey: PublicKey;
  positionData: {
    positionBinData: Array<{
      binId: number;
      xAmount: { toString(): string };
      yAmount: { toString(): string };
      liquidityAmount: { toString(): string };
    }>;
  };
  [key: string]: unknown;
}

// Enhanced interface for position creation parameters
export interface CreatePositionParams {
  poolAddress: string;
  userPublicKey: PublicKey;
  totalXAmount: BN;
  totalYAmount?: BN;
  minBinId: number;
  maxBinId: number;
  strategyType: StrategyType;
  useAutoFill?: boolean;
}

export interface PositionManagementParams {
  poolAddress: string;
  positionPubkey: string;
  userPublicKey: PublicKey;
}

export interface RemoveLiquidityParams extends PositionManagementParams {
  fromBinId: number;
  toBinId: number;
  liquiditiesBpsToRemove: BN[];
  shouldClaimAndClose: boolean;
}

// Simplified cost estimation - only position rent since we use existing bins
export interface SimplifiedCostEstimation {
  positionRent: number;
  transactionFees: number;
  total: number;
  breakdown: {
    existingBinsUsed: number;
    noBinCreationNeeded: boolean;
    estimatedComputeUnits: number;
  };
}

export interface CreatePositionResult {
  transaction: Transaction | Transaction[];
  positionKeypair: Keypair;
  estimatedCost: SimplifiedCostEstimation;
}

// Interface for existing bin ranges
export interface ExistingBinRange {
  minBinId: number;
  maxBinId: number;
  existingBins: number[];
  liquidityDepth: number;
  isPopular: boolean;
  description: string;
}

// Cache for bin ranges to avoid repeated API calls
const binRangeCache = new Map<string, { 
  ranges: ExistingBinRange[]; 
  timestamp: number; 
  activeBinId: number;
}>();
const CACHE_DURATION = 120000; // 2 minutes cache

/**
 * Enhanced Service for managing DLMM positions - EXISTING BINS ONLY
 * This version uses smart heuristics instead of intensive RPC calls
 */
export class MeteoraPositionService {
  private connection: Connection;
  private poolInstances: Map<string, DlmmType> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Initialize a DLMM pool
   */
  async initializePool(poolAddress: string): Promise<DlmmType> {
    try {
      if (this.poolInstances.has(poolAddress)) {
        return this.poolInstances.get(poolAddress)!;
      }

      const pubkey = new PublicKey(poolAddress);
      const pool = await DLMM.create(this.connection, pubkey);
      this.poolInstances.set(poolAddress, pool);
      return pool;
    } catch (error) {
      console.error('Error initializing Meteora DLMM pool:', error);
      throw error;
    }
  }

  /**
   * FIXED: Find existing bin ranges using smart heuristics based on portfolio style
   * This eliminates the rate limiting issues while respecting user's risk preference
   */
  async findExistingBinRanges(
    poolAddress: string,
    maxRangeWidth: number = 20,
    portfolioStyle: string = 'conservative'
  ): Promise<ExistingBinRange[]> {
    try {
      // Check cache first (include portfolio style in cache key)
      const cacheKey = `${poolAddress}-${portfolioStyle}`;
      const cached = binRangeCache.get(cacheKey);
      const now = Date.now();
      
      if (cached && (now - cached.timestamp) < CACHE_DURATION) {
        return cached.ranges;
      }

      const pool = await this.initializePool(poolAddress);
      const typedPool = pool as unknown as DLMMPool;
      const activeBin = await typedPool.getActiveBin();
      
      
      // FIXED: Use portfolio-specific smart heuristics
      const existingRanges = this.createSmartBinRanges(activeBin.binId, maxRangeWidth, portfolioStyle);
      
      
      // Cache the results with portfolio style
      binRangeCache.set(cacheKey, {
        ranges: existingRanges,
        timestamp: now,
        activeBinId: activeBin.binId
      });
      
      return existingRanges;
      
    } catch (error) {
      console.error('Error finding existing bin ranges:', error);
      throw new Error('Unable to find existing bin ranges for safe liquidity provision');
    }
  }

  /**
   * MODIFIED: Create smart bin ranges based on portfolio style using mathematical heuristics
   * Updated with specific bin counts: Aggressive 60-63, Moderate 64-66, Conservative 67-69
   */
  private createSmartBinRanges(activeBinId: number, maxRangeWidth: number, portfolioStyle: string): ExistingBinRange[] {
    const ranges: ExistingBinRange[] = [];
    
    // MODIFIED: Portfolio-specific bin counts
    // Aggressive: 60-63 bins, Moderate: 64-66 bins, Conservative: 67-69 bins
    
    let rangePatterns: Array<{ width: number; offset: number; name: string; popularity: number }>;
    
    switch (portfolioStyle.toLowerCase()) {
      case 'conservative':
        rangePatterns = [
          // Conservative: 67-69 bins (widest range, safest)
          { width: 69, offset: 0, name: 'Conservative Wide Range', popularity: 0.9 },
          { width: 68, offset: 0, name: 'Conservative Standard Range', popularity: 0.8 },
          { width: 67, offset: 0, name: 'Conservative Tight Range', popularity: 0.7 },
        ];
        break;
        
      case 'moderate':
        rangePatterns = [
          // Moderate: 64-66 bins (balanced range)
          { width: 66, offset: 0, name: 'Moderate Wide Range', popularity: 0.9 },
          { width: 65, offset: 0, name: 'Moderate Standard Range', popularity: 0.8 },
          { width: 64, offset: 0, name: 'Moderate Tight Range', popularity: 0.7 },
        ];
        break;
        
      case 'aggressive':
        rangePatterns = [
          // Aggressive: 60-63 bins (tighter range, more concentrated)
          { width: 63, offset: 0, name: 'Aggressive Wide Range', popularity: 0.9 },
          { width: 62, offset: 0, name: 'Aggressive Standard Range', popularity: 0.8 },
          { width: 60, offset: 0, name: 'Aggressive Tight Range', popularity: 0.7 },
        ];
        break;
        
      default:
        rangePatterns = [
          { width: 65, offset: 0, name: 'Default Range', popularity: 0.8 },
        ];
    }
    
    for (const pattern of rangePatterns) {
      if (pattern.width > maxRangeWidth) continue;

      // Place range ABOVE active bin for one-sided zBTC liquidity
      // This allows zBTC to fill ALL bins (zBTC can only be placed in bins >= active)
      const minBinId = activeBinId;
      const maxBinId = activeBinId + pattern.width - 1;

      // Generate all bins in the range
      const existingBins = this.generateLikelyExistingBins(
        minBinId,
        maxBinId,
        activeBinId,
        portfolioStyle
      );
      
      if (existingBins.length >= 3) { // Require at least 3 bins for safety
        ranges.push({
          minBinId,
          maxBinId,
          existingBins,
          liquidityDepth: existingBins.length,
          isPopular: pattern.popularity > 0.6,
          description: `${pattern.name} (${existingBins.length} estimated bins)`
        });
      }
    }
    
    // Sort by estimated popularity and bin count
    ranges.sort((a, b) => {
      if (a.isPopular !== b.isPopular) {
        return a.isPopular ? -1 : 1;
      }
      return b.existingBins.length - a.existingBins.length;
    });
    
    return ranges;
  }

  /**
   * Generate all bins in the specified range - deterministic for full range coverage
   * For full range positions, we include all bins between minBinId and maxBinId
   */
  private generateLikelyExistingBins(
    minBinId: number,
    maxBinId: number,
    _activeBinId: number,
    _portfolioStyle: string
  ): number[] {
    // For full range coverage, include ALL bins in the range
    // This ensures consistent behavior and full 69-bin positions
    const allBins: number[] = [];

    for (let binId = minBinId; binId <= maxBinId; binId++) {
      allBins.push(binId);
    }

    return allBins;
  }

  /**
   * Simplified cost estimation - only position rent since we use existing bins
   */
  async getSimplifiedCostEstimation(
    poolAddress: string,
    existingBinsCount: number = 5
  ): Promise<SimplifiedCostEstimation> {
    const positionRent = 0.057; // Standard position rent (refundable)
    const transactionFees = 0.015; // Estimated transaction fees
    const total = positionRent + transactionFees;
    
    return {
      positionRent,
      transactionFees,
      total,
      breakdown: {
        existingBinsUsed: existingBinsCount,
        noBinCreationNeeded: true,
        estimatedComputeUnits: 50000 // Much lower since no bin creation
      }
    };
  }

  /**
   * Validate user balance for existing-bins-only strategy
   */
  async validateUserBalance(
    userPublicKey: PublicKey,
    requiredSolAmount: number,
    estimatedCost: SimplifiedCostEstimation
  ): Promise<{ isValid: boolean; currentBalance: number; shortfall?: number; error?: string }> {
    try {
      const solBalanceLamports = await this.connection.getBalance(userPublicKey);
      const solBalance = solBalanceLamports / LAMPORTS_PER_SOL;
      
      const totalRequired = requiredSolAmount + estimatedCost.total;
      
      if (solBalance < totalRequired) {
        return {
          isValid: false,
          currentBalance: solBalance,
          shortfall: totalRequired - solBalance,
          error: `Insufficient SOL balance. Required: ${totalRequired.toFixed(4)} SOL, Available: ${solBalance.toFixed(4)} SOL`
        };
      }
      
      return {
        isValid: true,
        currentBalance: solBalance
      };
      
    } catch (error) {
      return {
        isValid: false,
        currentBalance: 0,
        error: 'Failed to check balance: ' + (error instanceof Error ? error.message : String(error))
      };
    }
  }

  /**
   * Create a position using ONLY existing bins (with smart heuristics)
   */
  async createPositionWithExistingBins(
    params: CreatePositionParams,
    existingBinRange: ExistingBinRange
  ): Promise<CreatePositionResult> {
    try {
      // Get simplified cost estimation
      const estimatedCost = await this.getSimplifiedCostEstimation(
        params.poolAddress,
        existingBinRange.existingBins.length
      );


      // Validate user balance
      const estimatedSolForLiquidity = params.totalXAmount.toNumber() / Math.pow(10, 9);
      const balanceValidation = await this.validateUserBalance(
        params.userPublicKey,
        estimatedSolForLiquidity,
        estimatedCost
      );

      if (!balanceValidation.isValid) {
        throw new Error(balanceValidation.error || 'Insufficient balance');
      }


      // Initialize pool and create position
      const pool = await this.initializePool(params.poolAddress);
      const newPosition = new Keypair();
      const typedPool = pool as unknown as DLMMPool;

      let totalYAmount = params.totalYAmount || new BN(0);

      // Use autoFillYByStrategy for balanced positions if requested
      if (params.useAutoFill !== false && totalYAmount.isZero()) {
        try {
          const activeBin = await typedPool.getActiveBin();
          
          totalYAmount = autoFillYByStrategy(
            activeBin.binId,
            typedPool.lbPair.binStep,
            params.totalXAmount,
            new BN(activeBin.xAmount),
            new BN(activeBin.yAmount),
            existingBinRange.minBinId,
            existingBinRange.maxBinId,
            params.strategyType
          );

        } catch (autoFillError) {
          console.warn('AutoFill failed, using provided or zero Y amount:', autoFillError);
          totalYAmount = params.totalYAmount || new BN(0);
        }
      }

      const createPositionTx = await typedPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: newPosition.publicKey,
        user: params.userPublicKey,
        totalXAmount: params.totalXAmount,
        totalYAmount,
        strategy: {
          maxBinId: existingBinRange.maxBinId,
          minBinId: existingBinRange.minBinId,
          strategyType: params.strategyType,
        },
      });


      return {
        transaction: createPositionTx,
        positionKeypair: newPosition,
        estimatedCost
      };
    } catch (error) {
      console.error('Error creating position with smart bin ranges:', error);
      
      if (error instanceof Error) {
        if (error.message.includes('insufficient lamports')) {
          throw new Error('Insufficient SOL balance for position creation. Please add more SOL to your wallet.');
        }
        
        if (error.message.includes('Transaction simulation failed')) {
          throw new Error('Position creation failed during simulation. The selected range might have restrictions.');
        }
      }
      
      throw error;
    }
  }

  /**
   * Create a one-sided position using portfolio-specific smart bin ranges
   */
  async createOneSidedPosition(
    params: CreatePositionParams,
    useTokenX: boolean
  ): Promise<CreatePositionResult> {
    try {
      // First find smart bin ranges based on portfolio style
      const portfolioStyle = params.strategyType === StrategyType.BidAsk ? 'conservative' : 'moderate';
      const existingRanges = await this.findExistingBinRanges(params.poolAddress, 20, portfolioStyle);
      
      if (existingRanges.length === 0) {
        throw new Error('No suitable bin ranges found. Cannot create position.');
      }

      // Use the best existing range (first one, as they're sorted by popularity)
      const selectedRange = existingRanges[0];
      

      // Get cost estimation
      const estimatedCost = await this.getSimplifiedCostEstimation(
        params.poolAddress,
        selectedRange.existingBins.length
      );

      const pool = await this.initializePool(params.poolAddress);
      const newPosition = new Keypair();
      const typedPool = pool as unknown as DLMMPool;
      
      // For one-sided position, set either X or Y amount to 0
      const totalXAmount = useTokenX ? params.totalXAmount : new BN(0);
      const totalYAmount = useTokenX ? new BN(0) : (params.totalYAmount || params.totalXAmount);

      // Adjust bin range for one-sided positions within smart bins
      let minBinId = selectedRange.minBinId;
      let maxBinId = selectedRange.maxBinId;

      if (useTokenX) {
        // For X token only, position should be above current price
        const activeBin = await typedPool.getActiveBin();
        const activeBinIndex = selectedRange.existingBins.findIndex(bin => bin >= activeBin.binId);
        
        if (activeBinIndex !== -1) {
          // Use bins above the active bin
          const binsAbove = selectedRange.existingBins.slice(activeBinIndex);
          if (binsAbove.length > 0) {
            minBinId = Math.min(...binsAbove);
            maxBinId = Math.max(...binsAbove);
          }
        }
      }


      const createPositionTx = await typedPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: newPosition.publicKey,
        user: params.userPublicKey,
        totalXAmount,
        totalYAmount,
        strategy: {
          maxBinId,
          minBinId,
          strategyType: params.strategyType,
        },
      });

      return {
        transaction: createPositionTx,
        positionKeypair: newPosition,
        estimatedCost
      };
    } catch (error) {
      console.error('Error creating one-sided position with smart ranges:', error);
      throw error;
    }
  }

  /**
   * Get safe range recommendations using smart heuristics
   */
  async getSafeRangeRecommendations(poolAddress: string): Promise<{
    conservative: ExistingBinRange;
    balanced: ExistingBinRange;
    aggressive: ExistingBinRange;
    all: ExistingBinRange[];
  }> {
    try {
      const existingRanges = await this.findExistingBinRanges(poolAddress);
      
      if (existingRanges.length === 0) {
        throw new Error('No suitable bin ranges found for recommendations');
      }
      
      // Conservative: Range with most bins (safest)
      const conservative = existingRanges.reduce((prev, curr) => 
        prev.existingBins.length > curr.existingBins.length ? prev : curr
      );
      
      // Balanced: Medium range with good bin coverage
      const balanced = existingRanges.find(range => 
        range.existingBins.length >= 5 && range.existingBins.length <= 10
      ) || conservative;
      
      // Aggressive: Smaller range but still safe
      const aggressive = existingRanges.find(range => 
        range.existingBins.length >= 3 && range.existingBins.length <= 7
      ) || conservative;
      
      return {
        conservative,
        balanced,
        aggressive,
        all: existingRanges
      };
    } catch (error) {
      console.error('Error getting safe range recommendations:', error);
      throw error;
    }
  }

  // Keep all existing methods for compatibility but ensure they use smart ranges
  async addLiquidity(
    params: PositionManagementParams,
    totalXAmount: BN,
    totalYAmount: BN,
    minBinId: number,
    maxBinId: number,
    strategyType: StrategyType,
    useAutoFill: boolean = true
  ): Promise<Transaction | Transaction[]> {
    try {
      
      const pool = await this.initializePool(params.poolAddress);
      const typedPool = pool as unknown as DLMMPool;
      const positionPubKey = new PublicKey(params.positionPubkey);
      
      let finalTotalYAmount = totalYAmount;

      if (useAutoFill && totalYAmount.isZero()) {
        try {
          const activeBin = await typedPool.getActiveBin();
          
          finalTotalYAmount = autoFillYByStrategy(
            activeBin.binId,
            typedPool.lbPair.binStep,
            totalXAmount,
            new BN(activeBin.xAmount),
            new BN(activeBin.yAmount),
            minBinId,
            maxBinId,
            strategyType
          );
        } catch (autoFillError) {
          console.warn('AutoFill failed for add liquidity, using zero Y amount:', autoFillError);
          finalTotalYAmount = new BN(0);
        }
      }
      
      const addLiquidityTx = await typedPool.addLiquidityByStrategy({
        positionPubKey,
        user: params.userPublicKey,
        totalXAmount,
        totalYAmount: finalTotalYAmount,
        strategy: {
          maxBinId,
          minBinId,
          strategyType,
        },
      });

      return addLiquidityTx;
    } catch (error) {
      console.error('Error adding liquidity with smart ranges:', error);
      throw error;
    }
  }

  // Keep all other existing methods unchanged
  async removeLiquidity(params: RemoveLiquidityParams): Promise<Transaction | Transaction[]> {
    try {
      const pool = await this.initializePool(params.poolAddress);
      const positionPubKey = new PublicKey(params.positionPubkey);
      const typedPool = pool as unknown as DLMMPool;
      
      const removeLiquidityTx = await typedPool.removeLiquidity({
        position: positionPubKey,
        user: params.userPublicKey,
        fromBinId: params.fromBinId,
        toBinId: params.toBinId,
        liquiditiesBpsToRemove: params.liquiditiesBpsToRemove,
        shouldClaimAndClose: params.shouldClaimAndClose,
      });

      return removeLiquidityTx;
    } catch (error) {
      console.error('Error removing liquidity:', error);
      throw error;
    }
  }

  async removeLiquidityFromPosition(
    params: PositionManagementParams,
    percentageToRemove: number = 100,
    shouldClaimAndClose: boolean = true
  ): Promise<Transaction | Transaction[]> {
    try {
      const pool = await this.initializePool(params.poolAddress);
      const positionPubKey = new PublicKey(params.positionPubkey);
      const typedPool = pool as unknown as DLMMPool;

      const { userPositions } = await typedPool.getPositionsByUserAndLbPair(params.userPublicKey);
      
      const userPosition = userPositions.find((pos: PositionData) => 
        pos.publicKey.equals(positionPubKey)
      );

      if (!userPosition) {
        throw new Error('Position not found');
      }

      const binIdsToRemove = userPosition.positionData.positionBinData.map((bin) => bin.binId);
      
      if (binIdsToRemove.length === 0) {
        throw new Error('No bins found in position');
      }

      const fromBinId = Math.min(...binIdsToRemove);
      const toBinId = Math.max(...binIdsToRemove);
      
      const bpsToRemove = new BN(percentageToRemove * 100);
      const liquiditiesBpsToRemove = new Array(binIdsToRemove.length).fill(bpsToRemove);

      const removeLiquidityTx = await typedPool.removeLiquidity({
        position: positionPubKey,
        user: params.userPublicKey,
        fromBinId,
        toBinId,
        liquiditiesBpsToRemove,
        shouldClaimAndClose,
      });

      return removeLiquidityTx;
    } catch (error) {
      console.error('Error removing liquidity from position:', error);
      throw error;
    }
  }

  async claimFees(params: PositionManagementParams): Promise<Transaction> {
    try {
      const pool = await this.initializePool(params.poolAddress);
      const positionPubKey = new PublicKey(params.positionPubkey);
      const typedPool = pool as unknown as DLMMPool;
      
      const claimFeeTx = await typedPool.claimSwapFee({
        owner: params.userPublicKey,
        position: positionPubKey,
      });

      return claimFeeTx;
    } catch (error) {
      console.error('Error claiming fees:', error);
      throw error;
    }
  }

  async claimAllFees(poolAddress: string, userPublicKey: PublicKey): Promise<Transaction[]> {
    try {
      const pool = await this.initializePool(poolAddress);
      const typedPool = pool as unknown as DLMMPool;

      const { userPositions } = await typedPool.getPositionsByUserAndLbPair(userPublicKey);

      const claimFeeTxs = await typedPool.claimAllSwapFee({
        owner: userPublicKey,
        positions: userPositions,
      });

      return Array.isArray(claimFeeTxs) ? claimFeeTxs : [claimFeeTxs];
    } catch (error) {
      console.error('Error claiming all fees:', error);
      throw error;
    }
  }

  async closePosition(params: PositionManagementParams): Promise<Transaction> {
    try {
      const pool = await this.initializePool(params.poolAddress);
      const positionPubKey = new PublicKey(params.positionPubkey);
      const typedPool = pool as unknown as DLMMPool;
      
      const closePositionTx = await typedPool.closePosition({
        owner: params.userPublicKey,
        position: positionPubKey,
      });

      return closePositionTx;
    } catch (error) {
      console.error('Error closing position:', error);
      throw error;
    }
  }

  async getPositionInfo(poolAddress: string, positionPubkey: string): Promise<unknown> {
    try {
      const pool = await this.initializePool(poolAddress);
      const positionPubKey = new PublicKey(positionPubkey);
      const typedPool = pool as unknown as DLMMPool;

      const positionInfo = await typedPool.getPosition(positionPubKey);
      return positionInfo;
    } catch (error) {
      console.error('Error getting position info:', error);
      throw error;
    }
  }
}

// Enhanced hook for smart bin ranges only strategy
export function useMeteoraPositionService() {
  const { publicKey, sendTransaction } = useWallet();
  
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl);
  
  const service = new MeteoraPositionService(connection);

  return {
    service,
    publicKey,
    sendTransaction,
    // Helper function to handle errors gracefully
    handlePositionError: (error: unknown): string => {
      if (error instanceof Error) {
        if (error.message.includes('insufficient lamports')) {
          return 'Insufficient SOL balance for this transaction.';
        }
        if (error.message.includes('Transaction simulation failed')) {
          return 'Transaction simulation failed. The selected bin range might have restrictions.';
        }
        if (error.message.includes('No suitable bin ranges found')) {
          return 'No suitable price ranges available. Please try a different pool or check back later.';
        }
        if (error.message.includes('bin range')) {
          return 'Cannot use the selected price range - only safe ranges are allowed.';
        }
        return error.message;
      }
      return 'An unexpected error occurred. Please try again.';
    }
  };
}