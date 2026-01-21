import { useState, useEffect, useCallback, useRef } from 'react';
import { PublicKey } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { useMeteoraDlmmService } from '@/lib/meteora/meteoraDlmmService';

export interface PoolWithActiveId {
  activeId?: number;
  tokenXMint?: unknown;
  tokenYMint?: unknown;
  currentMarketPrice?: number;
  [key: string]: unknown;
}

export interface PositionInfoType {
  lbPair: PoolWithActiveId;
  lbPairPositionsData: unknown[];
  [key: string]: unknown;
}

// Cache for positions to avoid refetching on every render
const positionsCache = new Map<string, {
  data: Map<string, PositionInfoType>;
  timestamp: number;
}>();
const CACHE_DURATION = 30000; // 30 seconds

// Stable empty map to avoid creating new references
const EMPTY_POSITIONS_MAP = new Map<string, PositionInfoType>();

export function useWalletPositions(publicKey: PublicKey | null, connected: boolean) {
  const [positions, setPositions] = useState(EMPTY_POSITIONS_MAP);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { service: dlmmService } = useMeteoraDlmmService();
  const fetchingRef = useRef(false);

  const fetchPositions = useCallback(async (userPubKey: PublicKey, forceRefresh = false) => {
    if (!dlmmService || fetchingRef.current) return;

    const cacheKey = userPubKey.toBase58();
    const cached = positionsCache.get(cacheKey);
    const now = Date.now();

    // Use cache if available and not forcing refresh
    if (!forceRefresh && cached && (now - cached.timestamp) < CACHE_DURATION) {
      setPositions(cached.data);
      return;
    }

    fetchingRef.current = true;
    setLoading(true);
    setError('');

    try {
      // Use shared connection from dlmmService
      const connection = dlmmService.connection;

      const userPositions = await DLMM.getAllLbPairPositionsByUser(
        connection,
        userPubKey
      );

      // Fetch active bins in PARALLEL instead of sequential
      const poolAddresses = Array.from(userPositions.keys());

      await Promise.all(
        poolAddresses.map(async (lbPairAddress) => {
          try {
            const positionInfo = userPositions.get(lbPairAddress);
            if (!positionInfo) return;

            const dlmmPool = await DLMM.create(
              connection,
              new PublicKey(lbPairAddress)
            );

            const activeBin = await dlmmPool.getActiveBin();

            if (activeBin && activeBin.pricePerToken) {
              const pool = positionInfo.lbPair as PoolWithActiveId;
              pool.currentMarketPrice = Number(activeBin.pricePerToken);
              pool.activeId = activeBin.binId;
            }
          } catch (err) {
            console.error(
              `Error fetching current price for pool ${lbPairAddress}:`,
              err
            );
          }
        })
      );

      // Update cache
      positionsCache.set(cacheKey, {
        data: userPositions as unknown as Map<string, PositionInfoType>,
        timestamp: now
      });

      setPositions(userPositions as unknown as Map<string, PositionInfoType>);
    } catch (err) {
      setError('Failed to fetch positions: ' + (err as Error).message);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [dlmmService]);

  const refreshPositions = useCallback(() => {
    if (publicKey) {
      fetchPositions(publicKey, true); // Force refresh
    }
  }, [publicKey, fetchPositions]);

  useEffect(() => {
    if (connected && publicKey && dlmmService) {
      fetchPositions(publicKey);
    } else {
      setPositions(EMPTY_POSITIONS_MAP);
    }
  }, [connected, publicKey, dlmmService, fetchPositions]);

  return {
    positions,
    loading,
    error,
    refreshPositions,
  };
}
