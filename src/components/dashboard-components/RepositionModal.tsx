import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, CheckCircle, ArrowRight, RefreshCw } from "lucide-react";
import { useWallet } from '@/hooks/useAppKitWallet';
import { useMeteoraDlmmService } from "@/lib/meteora/meteoraDlmmService";
import { useMeteoraPositionService } from "@/lib/meteora/meteoraPositionService";
import type { ExistingBinRange } from "@/lib/meteora/meteoraPositionService";
import { BN } from 'bn.js';
import { StrategyType } from '@meteora-ag/dlmm';
import { PublicKey } from '@solana/web3.js';
import DLMM from "@meteora-ag/dlmm";
import { showToast } from "@/lib/utils/showToast";
import Image from 'next/image';

// Bin range cache (shared pattern with AddLiquidityModal)
const binRangesCache = new Map<string, {
  data: ExistingBinRange[];
  timestamp: number;
  activeBinId: number;
}>();
const CACHE_DURATION = 60000; // 60 seconds

// Position type from wallet page (flexible to accept unknown types)
interface PositionData {
  totalXAmount: unknown;
  totalYAmount: unknown;
  feeX: unknown;
  feeY: unknown;
  lowerBinId: unknown;
  upperBinId: unknown;
  totalClaimedFeeXAmount: unknown;
  totalClaimedFeeYAmount: unknown;
  positionBinData: unknown;
  [key: string]: unknown;
}

interface PositionType {
  publicKey: PublicKey;
  positionData: PositionData;
  tokenXDecimals?: unknown;
  tokenYDecimals?: unknown;
  [key: string]: unknown;
}

interface PoolType {
  activeId?: number;
  currentMarketPrice?: number;
  tokenXMint?: unknown;
  tokenYMint?: unknown;
  tokenXDecimals?: number;
  tokenYDecimals?: number;
  binStep?: number;
  [key: string]: unknown;
}

interface TokenMeta {
  symbol: string;
  icon: string;
  usdPrice?: string | number;
  decimals?: number;
}

interface RepositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: PositionType | null;
  pool: PoolType | null;
  lbPairAddress: string;
  tokenXMeta: TokenMeta | null;
  tokenYMeta: TokenMeta | null;
  onSuccess: () => void;
}

// Note: BalanceInfo removed - closing position returns rent SOL, so balance check not needed

// Position health calculation
function calculatePositionHealth(
  position: PositionType,
  pool: PoolType
): { isInRange: boolean; status: 'healthy' | 'at-edge' | 'out-of-range'; distanceFromActiveBin: number } {
  const activeId = pool.activeId;
  if (activeId === undefined) {
    return { isInRange: true, status: 'healthy', distanceFromActiveBin: 0 };
  }

  // Cast to number since they may come as unknown from wallet page
  const lowerBinId = Number(position.positionData.lowerBinId);
  const upperBinId = Number(position.positionData.upperBinId);

  const isInRange = activeId >= lowerBinId && activeId <= upperBinId;

  let distanceFromActiveBin = 0;
  if (activeId < lowerBinId) {
    distanceFromActiveBin = lowerBinId - activeId;
  } else if (activeId > upperBinId) {
    distanceFromActiveBin = activeId - upperBinId;
  } else {
    // In range - calculate distance from edge
    distanceFromActiveBin = Math.min(activeId - lowerBinId, upperBinId - activeId);
  }

  let status: 'healthy' | 'at-edge' | 'out-of-range' = 'healthy';
  if (!isInRange) {
    status = 'out-of-range';
  } else if (distanceFromActiveBin <= 5) {
    status = 'at-edge';
  }

  return { isInRange, status, distanceFromActiveBin };
}

// Timing constants
const TIMING = {
  MODAL_CLOSE_DELAY: 5500,
} as const;

const RepositionModal: React.FC<RepositionModalProps> = ({
  isOpen,
  onClose,
  position,
  pool,
  lbPairAddress,
  tokenXMeta,
  tokenYMeta,
  onSuccess,
}) => {
  const { publicKey, sendTransaction } = useWallet();
  const { service: dlmmService } = useMeteoraDlmmService();
  const { service: positionService } = useMeteoraPositionService();

  // State management
  const [step, setStep] = useState<'review' | 'closing' | 'adding' | 'success' | 'error'>('review');
  const [isLoading, setIsLoading] = useState(false);
  const [existingBinRanges, setExistingBinRanges] = useState<ExistingBinRange[]>([]);
  const [isLoadingBins, setIsLoadingBins] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [withdrawnAmounts, setWithdrawnAmounts] = useState<{ x: number; y: number } | null>(null);
  const [newPositionAddress, setNewPositionAddress] = useState<string | null>(null);

  // Refs
  const findingBinsRef = useRef(false);
  const initializingRef = useRef(false);

  // Calculate position health
  const positionHealth = useMemo(() => {
    if (!position || !pool) return null;
    return calculatePositionHealth(position, pool);
  }, [position, pool]);

  // Calculate current position value
  const positionValue = useMemo(() => {
    if (!position || !tokenXMeta || !tokenYMeta) return { x: 0, y: 0, totalUsd: 0 };

    // Handle unknown types by casting to number
    const xDecimals = Number(position.tokenXDecimals) || Number(pool?.tokenXDecimals) || 8;
    const yDecimals = Number(position.tokenYDecimals) || Number(pool?.tokenYDecimals) || 9;

    const xAmount = Number(position.positionData.totalXAmount) / Math.pow(10, xDecimals);
    const yAmount = Number(position.positionData.totalYAmount) / Math.pow(10, yDecimals);

    const xPrice = Number(tokenXMeta.usdPrice || 0);
    const yPrice = Number(tokenYMeta.usdPrice || 0);

    return {
      x: xAmount,
      y: yAmount,
      totalUsd: xAmount * xPrice + yAmount * yPrice
    };
  }, [position, pool, tokenXMeta, tokenYMeta]);

  // Note: SOL balance check removed - closing position returns rent SOL

  // Find new bin ranges for repositioning (with caching)
  // Uses same 69-bin full range approach as AddLiquidityModal
  const findNewBinRanges = useCallback(async () => {
    if (!pool || !positionService || !lbPairAddress || !dlmmService || findingBinsRef.current) return;

    // Check cache first
    const cached = binRangesCache.get(lbPairAddress);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      // Verify active bin hasn't changed significantly
      if (pool.activeId === undefined || Math.abs(cached.activeBinId - pool.activeId) <= 5) {
        setExistingBinRanges(cached.data);
        return;
      }
    }

    findingBinsRef.current = true;
    setIsLoadingBins(true);

    try {
      // Use 69 bins range like AddLiquidityModal (full range conservative approach)
      const ranges = await positionService.findExistingBinRanges(
        lbPairAddress,
        69, // Full range like AddLiquidityModal
        'conservative' // Conservative for maximum range coverage
      );

      let finalRanges: ExistingBinRange[];

      if (ranges.length > 0) {
        finalRanges = ranges;
      } else {
        // Fallback: Use 69 bins ABOVE active bin for one-sided zBTC liquidity
        const activeBinId = pool.activeId || 0;
        const fallbackRange: ExistingBinRange = {
          minBinId: activeBinId,
          maxBinId: activeBinId + 68,
          existingBins: Array.from({ length: 69 }, (_, i) => activeBinId + i),
          liquidityDepth: 69,
          isPopular: false,
          description: 'Full range above current market price'
        };
        finalRanges = [fallbackRange];
      }

      setExistingBinRanges(finalRanges);

      // Cache the result
      binRangesCache.set(lbPairAddress, {
        data: finalRanges,
        timestamp: now,
        activeBinId: pool.activeId || 0
      });
    } catch (error) {
      console.error('Failed to find bin ranges:', error);
      // Emergency fallback: Use 69 bins ABOVE active bin for one-sided zBTC liquidity
      const activeBinId = pool.activeId || 0;
      const emergencyRange: ExistingBinRange = {
        minBinId: activeBinId,
        maxBinId: activeBinId + 68,
        existingBins: Array.from({ length: 69 }, (_, i) => activeBinId + i),
        liquidityDepth: 69,
        isPopular: false,
        description: 'Full range above current market price'
      };
      setExistingBinRanges([emergencyRange]);
    } finally {
      setIsLoadingBins(false);
      findingBinsRef.current = false;
    }
  }, [pool, positionService, lbPairAddress, dlmmService]);

  // Initialize on open - with rate limiting protection
  useEffect(() => {
    if (isOpen && position && pool && !initializingRef.current) {
      initializingRef.current = true;
      setStep('review');
      setErrorMessage('');
      setWithdrawnAmounts(null);
      setNewPositionAddress(null);

      // Find bin ranges for new position
      // Note: SOL balance check removed - closing position returns rent SOL
      findNewBinRanges();
    }

    // Reset refs when modal closes
    if (!isOpen) {
      initializingRef.current = false;
      findingBinsRef.current = false;
    }
  }, [isOpen, position, pool, findNewBinRanges]);

  // Handle close position
  const handleClosePosition = async () => {
    if (!publicKey || !position || !lbPairAddress || !dlmmService) return;

    setStep('closing');
    setIsLoading(true);

    try {
      // Use shared connection from dlmmService to reduce RPC calls
      const connection = dlmmService.connection;

      const dlmmPool = await DLMM.create(connection, new PublicKey(lbPairAddress));

      const lowerBinId = Number(position.positionData.lowerBinId);
      const upperBinId = Number(position.positionData.upperBinId);

      // Remove liquidity and close position
      const txOrTxs = await dlmmPool.removeLiquidity({
        user: publicKey,
        position: position.publicKey,
        fromBinId: lowerBinId,
        toBinId: upperBinId,
        bps: new BN(10000), // 100%
        shouldClaimAndClose: true,
      });

      // Execute transaction(s) and wait for confirmation
      let lastSignature: string = '';
      if (Array.isArray(txOrTxs)) {
        for (const tx of txOrTxs) {
          lastSignature = await sendTransaction(tx, connection);
        }
      } else {
        lastSignature = await sendTransaction(txOrTxs, connection);
      }

      // Wait for transaction confirmation to ensure SOL rent is returned
      showToast.success("Position Closed", "Waiting for confirmation...");

      try {
        await connection.confirmTransaction(lastSignature, 'confirmed');
      } catch {
        // If confirmation times out, wait a bit longer as fallback
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      // Store withdrawn amounts for re-adding
      setWithdrawnAmounts({
        x: positionValue.x,
        y: positionValue.y
      });

      showToast.success("Confirmed!", "Now re-adding liquidity to new range...");

      // Small additional delay to ensure balance updates
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Proceed to add liquidity
      await handleAddLiquidity();

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(errorMsg);
      setStep('error');
      showToast.error("Failed to close position", errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle add liquidity to new range
  const handleAddLiquidity = async () => {
    if (!publicKey || !positionService || !dlmmService || !lbPairAddress || !pool) {
      setErrorMessage('Missing required data for adding liquidity');
      setStep('error');
      return;
    }

    setStep('adding');
    setIsLoading(true);

    try {
      const xDecimals = Number(position?.tokenXDecimals) || Number(pool?.tokenXDecimals) || 8;
      const yDecimals = Number(position?.tokenYDecimals) || Number(pool?.tokenYDecimals) || 9;

      // Get withdrawn amounts (or current position value as fallback)
      const xAmount = withdrawnAmounts?.x || positionValue.x;
      const yAmount = withdrawnAmounts?.y || positionValue.y;

      // Determine which token to use based on what has value
      // If zBTC > 0, use zBTC (one-sided X token, bins above active)
      // If SOL > 0 and zBTC = 0, use SOL (one-sided Y token, bins below active)
      const useXToken = xAmount > 0.000001; // zBTC has value
      const useYToken = !useXToken && yAmount > 0.000001; // Only SOL has value

      if (!useXToken && !useYToken) {
        throw new Error('No tokens available for repositioning');
      }

      const activeBinId = pool.activeId || 0;

      // Determine bin range and amounts based on token type
      const minBinId = useXToken ? activeBinId : activeBinId - 68;
      const maxBinId = useXToken ? activeBinId + 68 : activeBinId;
      const totalXAmount = useXToken ? new BN(Math.floor(xAmount * Math.pow(10, xDecimals))) : new BN(0);
      const totalYAmount = useXToken ? new BN(0) : new BN(Math.floor(yAmount * Math.pow(10, yDecimals)));

      // Create bin range for the position
      const selectedRange = {
        minBinId,
        maxBinId,
        existingBins: Array.from({ length: 69 }, (_, i) => minBinId + i),
        liquidityDepth: 69,
        isPopular: true,
        description: useXToken ? 'Full range above current price (zBTC)' : 'Full range below current price (SOL)'
      };

      // Create new position
      const result = await positionService.createPositionWithExistingBins({
        poolAddress: lbPairAddress,
        userPublicKey: publicKey,
        totalXAmount,
        totalYAmount,
        minBinId: selectedRange.minBinId,
        maxBinId: selectedRange.maxBinId,
        strategyType: StrategyType.BidAsk,
        useAutoFill: false
      }, selectedRange);

      // Sign and send transaction(s)
      const connection = dlmmService.connection;

      if (Array.isArray(result.transaction)) {
        for (const tx of result.transaction) {
          await sendTransaction(tx, connection, {
            signers: [result.positionKeypair]
          });
        }
      } else {
        await sendTransaction(result.transaction, connection, {
          signers: [result.positionKeypair]
        });
      }

      setNewPositionAddress(result.positionKeypair.publicKey.toBase58());
      setStep('success');

      showToast.success(
        "Repositioned Successfully!",
        `Your liquidity has been moved to the new active range.`
      );

      // Close modal and refresh after delay
      setTimeout(() => {
        onSuccess();
        onClose();
      }, TIMING.MODAL_CLOSE_DELAY);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(errorMsg);
      setStep('error');
      showToast.error("Failed to add liquidity", errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  // Render position health badge
  const renderHealthBadge = () => {
    if (!positionHealth) return null;

    const statusConfig = {
      healthy: {
        label: 'In Range',
        bgColor: 'bg-green-500/20',
        textColor: 'text-green-400',
        borderColor: 'border-green-500/50',
        icon: <CheckCircle className="w-4 h-4" />
      },
      'at-edge': {
        label: 'At Edge',
        bgColor: 'bg-yellow-500/20',
        textColor: 'text-yellow-400',
        borderColor: 'border-yellow-500/50',
        icon: <AlertTriangle className="w-4 h-4" />
      },
      'out-of-range': {
        label: 'Out of Range',
        bgColor: 'bg-red-500/20',
        textColor: 'text-red-400',
        borderColor: 'border-red-500/50',
        icon: <AlertTriangle className="w-4 h-4" />
      }
    };

    const config = statusConfig[positionHealth.status];

    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${config.bgColor} ${config.textColor} ${config.borderColor}`}>
        {config.icon}
        <span className="font-medium">{config.label}</span>
        {!positionHealth.isInRange && (
          <span className="text-xs opacity-80">({positionHealth.distanceFromActiveBin} bins out)</span>
        )}
      </div>
    );
  };

  // Render step content
  const renderContent = () => {
    switch (step) {
      case 'review':
        return (
          <div className="space-y-6">
            {/* Position Health Status */}
            <div className="flex flex-col items-center gap-3">
              {renderHealthBadge()}
              {positionHealth && !positionHealth.isInRange && (
                <p className="text-sm text-gray-400 text-center">
                  Your position is no longer earning fees. Reposition to start earning again.
                </p>
              )}
            </div>

            {/* Current Position Value */}
            <div className="bg-card-foreground border border-border rounded-lg p-4">
              <h4 className="text-sm text-gray-400 mb-3">Current Position Value</h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {tokenXMeta && (
                      <Image
                        src={tokenXMeta.icon}
                        alt={tokenXMeta.symbol}
                        width={24}
                        height={24}
                        className="rounded-full"
                        unoptimized
                      />
                    )}
                    <span className="font-medium">{tokenXMeta?.symbol || 'Token X'}</span>
                  </div>
                  <span className="font-mono">{positionValue.x.toFixed(8)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {tokenYMeta && (
                      <Image
                        src={tokenYMeta.icon}
                        alt={tokenYMeta.symbol}
                        width={24}
                        height={24}
                        className="rounded-full"
                        unoptimized
                      />
                    )}
                    <span className="font-medium">{tokenYMeta?.symbol || 'Token Y'}</span>
                  </div>
                  <span className="font-mono">{positionValue.y.toFixed(6)}</span>
                </div>
                <div className="border-t border-border pt-2 mt-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Total Value</span>
                    <span className="font-semibold">${positionValue.totalUsd.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Reposition Flow Explanation */}
            <div className="bg-secondary/30 border border-border rounded-lg p-4">
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                What will happen:
              </h4>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold">1</div>
                  <div>
                    <p className="font-medium">Close current position</p>
                    <p className="text-sm text-gray-400">Withdraw all liquidity and claim fees</p>
                  </div>
                </div>
                <div className="flex justify-center">
                  <ArrowRight className="w-4 h-4 text-gray-500" />
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold">2</div>
                  <div>
                    <p className="font-medium">Add to full range</p>
                    <p className="text-sm text-gray-400">Re-add liquidity with full range (69 bins) around active price</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Note: SOL balance check removed - closing position returns rent SOL */}

            {/* New Bin Range Info */}
            {isLoadingBins ? (
              <div className="flex items-center justify-center gap-2 text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Finding optimal range...</span>
              </div>
            ) : existingBinRanges.length > 0 && (
              <div className="text-sm text-gray-400 text-center">
                New position will be created with {existingBinRanges[0].maxBinId - existingBinRanges[0].minBinId + 1} bins
                around the current active price.
              </div>
            )}
          </div>
        );

      case 'closing':
        return (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-lg font-medium">Closing position...</p>
            <p className="text-sm text-gray-400">Please confirm the transaction in your wallet</p>
          </div>
        );

      case 'adding':
        return (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-lg font-medium">Adding liquidity to new range...</p>
            <p className="text-sm text-gray-400">Please confirm the transaction in your wallet</p>
          </div>
        );

      case 'success':
        return (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-green-400" />
            </div>
            <p className="text-lg font-medium text-green-400">Repositioned Successfully!</p>
            <p className="text-sm text-gray-400 text-center">
              Your liquidity has been moved to the new active range.
              You will start earning fees again.
            </p>
            {newPositionAddress && (
              <p className="text-xs text-gray-500 font-mono break-all">
                New position: {newPositionAddress.slice(0, 8)}...{newPositionAddress.slice(-8)}
              </p>
            )}
          </div>
        );

      case 'error':
        return (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertTriangle className="w-10 h-10 text-red-400" />
            </div>
            <p className="text-lg font-medium text-red-400">Reposition Failed</p>
            <p className="text-sm text-gray-400 text-center max-w-sm">
              {errorMessage || 'Something went wrong. Please try again.'}
            </p>
            <Button
              variant="secondary"
              onClick={() => setStep('review')}
              className="mt-2"
            >
              Try Again
            </Button>
          </div>
        );
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg bg-background border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5" />
            Reposition Liquidity
          </DialogTitle>
          <DialogDescription>
            {tokenXMeta && tokenYMeta
              ? `${tokenXMeta.symbol} / ${tokenYMeta.symbol}`
              : 'Close and re-add liquidity to a new price range'
            }
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {renderContent()}
        </div>

        {step === 'review' && (
          <DialogFooter className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              onClick={handleClosePosition}
              disabled={isLoading || isLoadingBins || existingBinRanges.length === 0}
              className="gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Reposition Now
                </>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RepositionModal;
