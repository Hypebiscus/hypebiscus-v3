"use client";

import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useAppKitWallet";
import { PublicKey } from "@solana/web3.js";
import DLMM from "@meteora-ag/dlmm";
import { Loader2, AlertTriangle, CheckCircle, RefreshCw } from "lucide-react";
import RepositionModal from "./RepositionModal";
import { useMeteoraDlmmService } from "@/lib/meteora/meteoraDlmmService";
import { useHybridPositions } from "@/hooks/useHybridPositions";
import type { HybridPosition } from "@/types/hybrid-sync";

// Types for raw position data (needed for RepositionModal)
interface PositionDataLike {
  totalXAmount?: unknown;
  totalYAmount?: unknown;
  feeX?: unknown;
  feeY?: unknown;
  lowerBinId?: unknown;
  upperBinId?: unknown;
  positionBinData?: unknown;
  [key: string]: unknown;
}

interface PositionLike {
  publicKey: PublicKey;
  positionData: PositionDataLike;
  tokenXDecimals?: unknown;
  tokenYDecimals?: unknown;
  [key: string]: unknown;
}

interface PoolType {
  activeId?: number;
  tokenXMint?: unknown;
  tokenYMint?: unknown;
  tokenXDecimals?: number;
  tokenYDecimals?: number;
  [key: string]: unknown;
}

interface TokenMeta {
  symbol: string;
  icon: string;
  usdPrice?: string | number;
  decimals?: number;
}

// Raw position data for RepositionModal
interface RawPositionData {
  position: PositionLike;
  pool: PoolType;
  tokenXMeta: TokenMeta | null;
  tokenYMeta: TokenMeta | null;
}

interface UserPositionsListProps {
  onRefresh?: () => void;
  isLoading?: boolean;
  aiResponse?: string;
}

// Helper to fetch token meta
async function fetchTokenMeta(mint: string): Promise<TokenMeta | null> {
  try {
    const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`);
    const data = await res.json();
    return data[0] || null;
  } catch {
    return null;
  }
}

const UserPositionsList: React.FC<UserPositionsListProps> = ({
  onRefresh,
  isLoading: externalLoading,
  aiResponse,
}) => {
  const { publicKey, connected } = useWallet();
  const { service: dlmmService } = useMeteoraDlmmService();

  // Use SWR-cached hook for positions (reduces RPC calls)
  const {
    activePositions,
    isLoading: isLoadingPositions,
    error: positionsError,
    refresh: refreshPositions
  } = useHybridPositions(publicKey?.toBase58(), {
    includeHistorical: false,
    includeLive: true,
    refreshInterval: 60000, // 60 seconds
  });

  // State for reposition modal
  const [selectedPosition, setSelectedPosition] = useState<HybridPosition | null>(null);
  const [rawPositionData, setRawPositionData] = useState<RawPositionData | null>(null);
  const [isRepositionModalOpen, setIsRepositionModalOpen] = useState(false);
  const [isFetchingRawData, setIsFetchingRawData] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch raw position data only when user clicks Reposition (lazy loading)
  const fetchRawPositionData = useCallback(async (position: HybridPosition) => {
    if (!publicKey || !dlmmService) return null;

    setIsFetchingRawData(true);
    setFetchError(null);

    try {
      const connection = dlmmService.connection;
      const poolPubkey = new PublicKey(position.poolAddress);

      // Create DLMM pool instance
      const dlmmPool = await DLMM.create(connection, poolPubkey);

      // Get user's position in this specific pool
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(publicKey);

      // Find the specific position
      const rawPosition = userPositions.find(
        (p) => p.publicKey.toBase58() === position.positionId
      );

      if (!rawPosition) {
        throw new Error('Position not found on-chain');
      }

      // Get pool data with activeId
      const activeBin = await dlmmPool.getActiveBin();
      const pool = dlmmPool.lbPair as PoolType;
      pool.activeId = activeBin.binId;

      // Get token mints
      type MaybeBase58 = { toBase58?: () => string };
      const xMint = pool.tokenXMint && typeof (pool.tokenXMint as MaybeBase58).toBase58 === "function"
        ? (pool.tokenXMint as MaybeBase58).toBase58!()
        : String(pool.tokenXMint);
      const yMint = pool.tokenYMint && typeof (pool.tokenYMint as MaybeBase58).toBase58 === "function"
        ? (pool.tokenYMint as MaybeBase58).toBase58!()
        : String(pool.tokenYMint);

      // Fetch token metadata
      const [tokenXMeta, tokenYMeta] = await Promise.all([
        fetchTokenMeta(xMint),
        fetchTokenMeta(yMint)
      ]);

      return {
        position: rawPosition as unknown as PositionLike,
        pool,
        tokenXMeta,
        tokenYMeta
      };
    } catch (error) {
      console.error('Failed to fetch raw position data:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to load position details';
      setFetchError(errorMsg);
      return null;
    } finally {
      setIsFetchingRawData(false);
    }
  }, [publicKey, dlmmService]);

  // Handle reposition click - fetch raw data then open modal
  const handleReposition = useCallback(async (position: HybridPosition) => {
    setSelectedPosition(position);

    const rawData = await fetchRawPositionData(position);
    if (rawData) {
      setRawPositionData(rawData);
      setIsRepositionModalOpen(true);
    }
  }, [fetchRawPositionData]);

  const handleRepositionSuccess = useCallback(() => {
    setIsRepositionModalOpen(false);
    setSelectedPosition(null);
    setRawPositionData(null);
    refreshPositions();
    onRefresh?.();
  }, [refreshPositions, onRefresh]);

  const handleCloseModal = useCallback(() => {
    setIsRepositionModalOpen(false);
    setSelectedPosition(null);
    setRawPositionData(null);
    setFetchError(null);
  }, []);

  // Render health badge
  const renderHealthBadge = (health: HybridPosition['health']) => {
    if (!health) {
      return (
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs bg-gray-500/20 text-gray-400 border-gray-500/50">
          <span className="font-medium">Unknown</span>
        </div>
      );
    }

    const statusConfig = {
      healthy: {
        label: 'In Range',
        bgColor: 'bg-green-500/20',
        textColor: 'text-green-400',
        borderColor: 'border-green-500/50',
        icon: <CheckCircle className="w-3 h-3" />
      },
      'at-edge': {
        label: 'At Edge',
        bgColor: 'bg-yellow-500/20',
        textColor: 'text-yellow-400',
        borderColor: 'border-yellow-500/50',
        icon: <AlertTriangle className="w-3 h-3" />
      },
      'out-of-range': {
        label: 'Out of Range',
        bgColor: 'bg-red-500/20',
        textColor: 'text-red-400',
        borderColor: 'border-red-500/50',
        icon: <AlertTriangle className="w-3 h-3" />
      }
    };

    const config = statusConfig[health.status];

    return (
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs ${config.bgColor} ${config.textColor} ${config.borderColor}`}>
        {config.icon}
        <span className="font-medium">{config.label}</span>
        {!health.isInRange && (
          <span className="opacity-80">({health.distanceFromActiveBin} bins)</span>
        )}
      </div>
    );
  };

  // Loading state
  if (isLoadingPositions || externalLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-gray-400">Loading your positions...</p>
      </div>
    );
  }

  // Error state
  if (positionsError) {
    return (
      <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-center">
        <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
        <p className="text-red-400">{positionsError.message || 'Failed to load positions'}</p>
        <Button variant="secondary" onClick={() => refreshPositions()} className="mt-3">
          Try Again
        </Button>
      </div>
    );
  }

  // Not connected state
  if (!connected) {
    return (
      <div className="text-center py-6">
        <p className="text-gray-400">Connect your wallet to view positions</p>
      </div>
    );
  }

  // No positions state
  if (activePositions.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-gray-400 mb-2">You don&apos;t have any active positions yet.</p>
        <p className="text-sm text-gray-500">Start by adding liquidity to a pool!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* AI Response */}
      {aiResponse && (
        <div className="prose prose-invert max-w-none text-sm mb-4">
          <p className="text-gray-300 whitespace-pre-wrap">{aiResponse}</p>
        </div>
      )}

      {/* Fetch error for reposition */}
      {fetchError && (
        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-center">
          <p className="text-red-400 text-sm">{fetchError}</p>
          <Button variant="ghost" size="sm" onClick={() => setFetchError(null)} className="mt-2">
            Dismiss
          </Button>
        </div>
      )}

      {/* Positions List */}
      <div className="space-y-3">
        {activePositions.map((position) => (
          <div
            key={position.positionId}
            className="bg-card-foreground border border-border rounded-lg p-4"
          >
            {/* Header: Token pair + Health badge */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="font-semibold">
                  {position.tokenX.symbol} / {position.tokenY.symbol}
                </span>
              </div>
              {renderHealthBadge(position.health)}
            </div>

            {/* Position details */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <div className="text-xs text-gray-500 mb-1">Total Value</div>
                <div className="font-semibold text-lg">
                  ${position.totalLiquidityUSD.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Balances</div>
                <div className="text-sm font-mono">
                  <div>{position.tokenX.amount.toFixed(6)} {position.tokenX.symbol}</div>
                  <div>{position.tokenY.amount.toFixed(4)} {position.tokenY.symbol}</div>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              {position.health && (position.health.status === 'out-of-range' || position.health.status === 'at-edge') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 border-primary text-primary hover:bg-primary/10 gap-2"
                  onClick={() => handleReposition(position)}
                  disabled={isFetchingRawData && selectedPosition?.positionId === position.positionId}
                >
                  {isFetchingRawData && selectedPosition?.positionId === position.positionId ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      Reposition
                    </>
                  )}
                </Button>
              )}
              {position.health?.status === 'healthy' && (
                <div className="flex-1 text-center text-sm text-green-400 py-2">
                  Position is earning fees
                </div>
              )}
              {!position.health && (
                <div className="flex-1 text-center text-sm text-gray-400 py-2">
                  Unable to determine position status
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Refresh button */}
      <div className="flex justify-center pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refreshPositions()}
          className="text-gray-400 hover:text-white gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh Positions
        </Button>
      </div>

      {/* Reposition Modal */}
      {rawPositionData && selectedPosition && (
        <RepositionModal
          isOpen={isRepositionModalOpen}
          onClose={handleCloseModal}
          position={rawPositionData.position as unknown as Parameters<typeof RepositionModal>[0]['position']}
          pool={rawPositionData.pool}
          lbPairAddress={selectedPosition.poolAddress}
          tokenXMeta={rawPositionData.tokenXMeta}
          tokenYMeta={rawPositionData.tokenYMeta}
          onSuccess={handleRepositionSuccess}
        />
      )}
    </div>
  );
};

export default UserPositionsList;
