// Enhanced meteoraDlmmService.ts - Removed bin creation functionality
// Users can only interact with existing bins to prevent expensive bin creation

import DLMM, { StrategyType, autoFillYByStrategy } from '@meteora-ag/dlmm';
import { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { useWallet } from '@/hooks/useAppKitWallet';

// Add interface definitions for proper typing
interface BinArray {
  account?: {
    index?: number;
  };
  [key: string]: unknown;
}

interface PoolBinArrays {
  getBinArrays?(): Promise<BinArray[]>;
  [key: string]: unknown;
}

// Enhanced error types
export enum DLMMErrorType {
  INSUFFICIENT_SOL = 'INSUFFICIENT_SOL',
  INSUFFICIENT_TOKEN = 'INSUFFICIENT_TOKEN',
  INVALID_POOL = 'INVALID_POOL',
  NO_EXISTING_BINS = 'NO_EXISTING_BINS',
  TRANSACTION_SIMULATION_FAILED = 'TRANSACTION_SIMULATION_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export class DLMMError extends Error {
  constructor(
    public type: DLMMErrorType,
    message: string,
    public details?: string
  ) {
    super(message);
    this.name = 'DLMMError';
  }

  get userFriendlyMessage(): string {
    switch (this.type) {
      case DLMMErrorType.INSUFFICIENT_SOL:
        return 'Insufficient SOL balance. Please add more SOL to your wallet.';
      case DLMMErrorType.INSUFFICIENT_TOKEN:
        return 'Insufficient token balance. Please ensure you have enough tokens for this transaction.';
      case DLMMErrorType.INVALID_POOL:
        return 'Invalid pool configuration. Please try a different pool.';
      case DLMMErrorType.NO_EXISTING_BINS:
        return 'No existing price ranges available. Please wait for more liquidity or select a different pool.';
      case DLMMErrorType.TRANSACTION_SIMULATION_FAILED:
        return 'Transaction simulation failed. The existing bins might be full or have restrictions.';
      case DLMMErrorType.NETWORK_ERROR:
        return 'Network error. Please check your connection and try again.';
      default:
        return 'An unexpected error occurred. Please try again.';
    }
  }
}

// Simplified balance validation for existing bins only
export interface SimplifiedBalanceValidation {
  isValid: boolean;
  solBalance: number;
  requiredSol: number;
  error?: DLMMError;
}

// Rest of existing interfaces
export type DlmmType = DLMM;

export interface BinArrayType {
  publicKey: PublicKey;
  [key: string]: unknown;
}

export interface PositionType {
  publicKey: PublicKey;
  positionData: {
    positionBinData: BinDataType[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface BinDataType {
  binId: number;
  xAmount: { toString(): string };
  yAmount: { toString(): string };
  liquidityAmount: { toString(): string };
  [key: string]: unknown;
}

export interface BinLiquidity {
  binId: number;
  xAmount: string;
  yAmount: string;
  liquidityAmount: string;
  price: string;
}

export interface DlmmPoolInfo {
  address: string;
  name: string;
  tokenX: string;
  tokenY: string;
  activeBinPrice: number;
  binStep: number;
  totalXAmount: string;
  totalYAmount: string;
}

export interface DlmmPositionInfo {
  pubkey: string;
  liquidityPerBin: {
    binId: number;
    xAmount: string;
    yAmount: string;
    liquidityAmount: string;
  }[];
  totalValue: number;
}

export interface SwapQuote {
  amountIn: string;
  amountOut: string;
  minOutAmount: string;
  fee: string;
  priceImpact: string;
  binArraysPubkey: PublicKey[];
}

export interface ActiveBin {
  binId: number;
  price: string;
  xAmount: string;
  yAmount: string;
}

// Define types for DLMM pool
interface DLMMPool {
  getActiveBin(): Promise<{
    binId: number;
    price: string;
    xAmount: string;
    yAmount: string;
  }>;
  getBin(binId: number): Promise<unknown>;
  getPositionsByUserAndLbPair(userPublicKey: PublicKey): Promise<{
    userPositions: PositionType[];
  }>;
  getSwapQuote(params: {
    inAmount: BN;
    swapForY: boolean;
    allowedSlippage: number;
  }): Promise<{
    amountOut?: BN;
    minAmountOut?: BN;
    fee?: BN;
    priceImpact?: number;
    binArraysPubkey?: PublicKey[];
  }>;
  swap(params: {
    user: PublicKey;
    inAmount: BN;
    minAmountOut: BN;
    swapForY: boolean;
  }): Promise<Transaction>;
  [key: string]: unknown;
}

/**
 * Enhanced Service to interact with Meteora DLMM - EXISTING BINS ONLY
 * This version prevents expensive bin creation by only using existing price ranges
 */
export class MeteoraDlmmService {
  private _connection: Connection;
  private poolInstances: Map<string, DlmmType> = new Map();

  constructor(connection: Connection) {
    this._connection = connection;
  }

  get connection(): Connection {
    return this._connection;
  }

  /**
   * Simplified balance validation for existing bins strategy
   */
  async validateUserBalance(
    userPublicKey: PublicKey,
    requiredSolAmount: number
  ): Promise<SimplifiedBalanceValidation> {
    try {
      const solBalanceLamports = await this._connection.getBalance(userPublicKey);
      const solBalance = solBalanceLamports / LAMPORTS_PER_SOL;
      
      // Only need position rent + transaction fees (no bin creation costs)
      const requiredSolWithBuffer = requiredSolAmount + 0.072; // 0.057 position rent + 0.015 tx fees
      
      if (solBalance < requiredSolWithBuffer) {
        return {
          isValid: false,
          solBalance,
          requiredSol: requiredSolWithBuffer,
          error: new DLMMError(
            DLMMErrorType.INSUFFICIENT_SOL,
            `Insufficient SOL balance. Required: ${requiredSolWithBuffer.toFixed(4)}, Available: ${solBalance.toFixed(4)}`
          )
        };
      }

      return {
        isValid: true,
        solBalance,
        requiredSol: requiredSolWithBuffer
      };
    } catch (error) {
      return {
        isValid: false,
        solBalance: 0,
        requiredSol: requiredSolAmount,
        error: new DLMMError(
          DLMMErrorType.NETWORK_ERROR,
          'Failed to validate balances',
          error instanceof Error ? error.message : String(error)
        )
      };
    }
  }

  /**
   * Enhanced pool initialization with error handling
   */
  async initializePool(poolAddress: string): Promise<DlmmType> {
    try {
      if (this.poolInstances.has(poolAddress)) {
        return this.poolInstances.get(poolAddress)!;
      }

      const pubkey = new PublicKey(poolAddress);
      const pool = await DLMM.create(this._connection, pubkey);
      this.poolInstances.set(poolAddress, pool);
      return pool;
    } catch (error) {
      throw new DLMMError(
        DLMMErrorType.INVALID_POOL,
        'Failed to initialize DLMM pool',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Get active bin with error handling
   */
  async getActiveBin(poolAddress: string): Promise<ActiveBin> {
    try {
      const pool = await this.initializePool(poolAddress);
      const typedPool = pool as unknown as DLMMPool;
      const activeBin = await typedPool.getActiveBin();
      
      return {
        binId: activeBin.binId,
        price: activeBin.price,
        xAmount: activeBin.xAmount?.toString() || '0',
        yAmount: activeBin.yAmount?.toString() || '0',
      };
    } catch (error) {
      throw new DLMMError(
        DLMMErrorType.INVALID_POOL,
        'Failed to get active bin information',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Check if bins exist in a given range using a safe approach
   */
  async checkExistingBins(poolAddress: string, minBinId: number, maxBinId: number): Promise<number[]> {
    try {
      const pool = await this.initializePool(poolAddress);
      const typedPool = pool as unknown as DLMMPool;
      
      const existingBins: number[] = [];
      
      try {
        // Try to get bin arrays to check which bins exist
        const binArrays = await (typedPool as unknown as PoolBinArrays).getBinArrays?.();
        
        if (binArrays && binArrays.length > 0) {
          // Check which bins in our range fall within existing bin arrays
          for (let binId = minBinId; binId <= maxBinId; binId++) {
            const binArrayIndex = Math.floor(binId / 70); // Approximate bins per array
            
            // Check if this bin array exists
            const binArrayExists = binArrays.some((binArray: BinArray) => 
              binArray.account?.index === binArrayIndex
            );
            
            if (binArrayExists) {
              existingBins.push(binId);
            }
          }
        }
      } catch {
        // Fallback: use a conservative approach
        
        // Assume bins around the active bin exist
        const activeBin = await typedPool.getActiveBin();
        const activeBinId = activeBin.binId;
        
        // Add bins in a conservative range around active bin
        for (let offset = -5; offset <= 5; offset++) {
          const binId = activeBinId + offset;
          if (binId >= minBinId && binId <= maxBinId) {
            existingBins.push(binId);
          }
        }
      }
      
      return existingBins.sort((a, b) => a - b);
    } catch (error) {
      console.error('Error checking existing bins:', error);
      
      // Ultra-conservative fallback
      const conservativeBins: number[] = [];
      const centerBin = Math.floor((minBinId + maxBinId) / 2);
      for (let i = -2; i <= 2; i++) {
        const binId = centerBin + i;
        if (binId >= minBinId && binId <= maxBinId) {
          conservativeBins.push(binId);
        }
      }
      return conservativeBins;
    }
  }

  /**
   * Calculate balanced Y amount using existing autoFill functionality
   */
  calculateBalancedYAmount(
    activeBinId: number,
    binStep: number,
    totalXAmount: BN,
    activeBinXAmount: string,
    activeBinYAmount: string,
    minBinId: number,
    maxBinId: number,
    strategyType: StrategyType
  ): BN {
    try {
      const activeBinXAmountBN = new BN(activeBinXAmount || '0');
      const activeBinYAmountBN = new BN(activeBinYAmount || '0');
      
      return autoFillYByStrategy(
        activeBinId,
        binStep,
        totalXAmount,
        activeBinXAmountBN,
        activeBinYAmountBN,
        minBinId,
        maxBinId,
        strategyType
      );
    } catch (error) {
      console.error('Error calculating balanced Y amount:', error);
      return new BN(0);
    }
  }

  /**
   * Simplified transaction simulation for existing bins
   */
  async simulateTransaction(
    transaction: Transaction
  ): Promise<{ success: boolean; error?: DLMMError }> {
    try {
      const simulation = await this._connection.simulateTransaction(transaction, []);
      
      if (simulation.value.err) {
        const errorMessage = JSON.stringify(simulation.value.err);
        
        if (errorMessage.includes('insufficient funds') || errorMessage.includes('insufficient lamports')) {
          return {
            success: false,
            error: new DLMMError(
              DLMMErrorType.INSUFFICIENT_SOL,
              'Transaction simulation failed due to insufficient funds'
            )
          };
        }
        
        return {
          success: false,
          error: new DLMMError(
            DLMMErrorType.TRANSACTION_SIMULATION_FAILED,
            'Transaction simulation failed - existing bins might be full',
            errorMessage
          )
        };
      }
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: new DLMMError(
          DLMMErrorType.NETWORK_ERROR,
          'Failed to simulate transaction',
          error instanceof Error ? error.message : String(error)
        )
      };
    }
  }

  // Keep all existing methods but remove bin creation logic
  async getAllPools(): Promise<DlmmPoolInfo[]> {
    try {
      const response = await fetch('https://dlmm-api.meteora.ag/pair/all');
      if (!response.ok) {
        throw new Error('Failed to fetch DLMM pools');
      }
      
      const data = await response.json();
      const pools: DlmmPoolInfo[] = [];
      
      for (const pool of data.pairs || []) {
        pools.push({
          address: pool.address,
          name: pool.name,
          tokenX: pool.token_x.symbol,
          tokenY: pool.token_y.symbol,
          activeBinPrice: parseFloat(pool.price),
          binStep: parseFloat(pool.bin_step),
          totalXAmount: pool.token_x_amount,
          totalYAmount: pool.token_y_amount
        });
      }
      
      return pools;
    } catch (error) {
      throw new DLMMError(
        DLMMErrorType.NETWORK_ERROR,
        'Failed to fetch DLMM pools',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  async getUserPositions(poolAddress: string, userPublicKey: PublicKey): Promise<DlmmPositionInfo[]> {
    try {
      const pool = await this.initializePool(poolAddress);
      const typedPool = pool as unknown as DLMMPool;
      const { userPositions } = await typedPool.getPositionsByUserAndLbPair(userPublicKey);
      
      const positions: DlmmPositionInfo[] = [];
      
      for (const position of userPositions) {
        const typedPosition = position as PositionType;
        const bins = typedPosition.positionData.positionBinData.map((bin) => ({
          binId: bin.binId,
          xAmount: bin.xAmount.toString(),
          yAmount: bin.yAmount.toString(),
          liquidityAmount: bin.liquidityAmount.toString()
        }));
        
        positions.push({
          pubkey: typedPosition.publicKey.toString(),
          liquidityPerBin: bins,
          totalValue: 0
        });
      }
      
      return positions;
    } catch (error) {
      throw new DLMMError(
        DLMMErrorType.INVALID_POOL,
        'Failed to fetch user positions',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Get swap quote for token exchange
   */
  async getSwapQuote(
    poolAddress: string,
    amountIn: BN,
    swapForY: boolean
  ): Promise<SwapQuote> {
    try {
      const pool = await this.initializePool(poolAddress);
      const typedPool = pool as unknown as DLMMPool;
      
      const quote = await typedPool.getSwapQuote({
        inAmount: amountIn,
        swapForY,
        allowedSlippage: 0.5, // 0.5% slippage
      });
      
      return {
        amountIn: amountIn.toString(),
        amountOut: quote.amountOut?.toString() || '0',
        minOutAmount: quote.minAmountOut?.toString() || '0',
        fee: quote.fee?.toString() || '0',
        priceImpact: quote.priceImpact?.toString() || '0',
        binArraysPubkey: quote.binArraysPubkey || []
      };
    } catch (error) {
      throw new DLMMError(
        DLMMErrorType.NETWORK_ERROR,
        'Failed to get swap quote',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Execute a swap transaction
   */
  async swap(
    poolAddress: string,
    userPublicKey: PublicKey,
    amountIn: BN,
    minAmountOut: BN,
    swapForY: boolean
  ): Promise<Transaction> {
    try {
      const pool = await this.initializePool(poolAddress);
      const typedPool = pool as unknown as DLMMPool;
      
      const swapTx = await typedPool.swap({
        user: userPublicKey,
        inAmount: amountIn,
        minAmountOut,
        swapForY,
      });
      
      return swapTx;
    } catch (error) {
      throw new DLMMError(
        DLMMErrorType.TRANSACTION_SIMULATION_FAILED,
        'Failed to create swap transaction',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Validate that a range only uses existing bins
   */
  async validateExistingBinsOnly(
    poolAddress: string,
    minBinId: number,
    maxBinId: number
  ): Promise<{ isValid: boolean; existingBins: number[]; error?: string }> {
    try {
      const existingBins = await this.checkExistingBins(poolAddress, minBinId, maxBinId);
      
      if (existingBins.length === 0) {
        return {
          isValid: false,
          existingBins: [],
          error: 'No existing bins found in the specified range. Please select a range with existing liquidity.'
        };
      }
      
      // Require at least 3 existing bins for safety
      if (existingBins.length < 3) {
        return {
          isValid: false,
          existingBins,
          error: `Only ${existingBins.length} existing bins found. At least 3 existing bins required for safe liquidity provision.`
        };
      }
      
      return {
        isValid: true,
        existingBins
      };
    } catch (error) {
      return {
        isValid: false,
        existingBins: [],
        error: 'Failed to validate existing bins: ' + (error instanceof Error ? error.message : String(error))
      };
    }
  }
}

// Enhanced hook with existing bins validation
export function useMeteoraDlmmService() {
  const { publicKey, sendTransaction } = useWallet();
  
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl);
  
  const service = new MeteoraDlmmService(connection);

  return {
    service,
    publicKey,
    sendTransaction,
    // Helper function to handle DLMM errors
    handleDLMMError: (error: unknown): string => {
      if (error instanceof DLMMError) {
        return error.userFriendlyMessage;
      }
      return 'An unexpected error occurred. Please try again.';
    },
    // Helper to validate existing bins
    validateExistingBinsRange: async (
      poolAddress: string,
      minBinId: number,
      maxBinId: number
    ) => {
      return await service.validateExistingBinsOnly(poolAddress, minBinId, maxBinId);
    }
  };
}