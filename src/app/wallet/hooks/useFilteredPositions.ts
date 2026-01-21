import { useState, useEffect, useRef } from 'react';
import type { PositionInfoType } from './useWalletPositions';

export type MaybeBase58 = { toBase58?: () => string };

// Helper function to check if a pool is a valid BTC pool
function isValidBTCPool(tokenXSymbol: string, tokenYSymbol: string): boolean {
  const pairName = `${tokenXSymbol?.toLowerCase()}-${tokenYSymbol?.toLowerCase()}`;

  return (
    pairName === 'wbtc-sol' ||
    pairName === 'sol-wbtc' ||
    pairName === 'zbtc-sol' ||
    pairName === 'sol-zbtc' ||
    pairName === 'cbbtc-sol' ||
    pairName === 'sol-cbbtc'
  );
}

// Token metadata cache
const tokenMetaCache: Record<string, TokenMeta> = {};

interface TokenMeta {
  icon: string;
  symbol: string;
  usdPrice?: number;
  [key: string]: unknown;
}

async function fetchTokenMeta(mint: string): Promise<TokenMeta | null> {
  if (tokenMetaCache[mint]) return tokenMetaCache[mint];
  const res = await fetch(
    `https://lite-api.jup.ag/tokens/v2/search?query=${mint}`
  );
  const data = await res.json();
  const token = data[0];
  tokenMetaCache[mint] = token;
  return token;
}

// Stable empty map to avoid creating new references
const EMPTY_MAP = new Map<string, PositionInfoType>();

export function useFilteredPositions(positions: Map<string, PositionInfoType>) {
  const [filteredPositions, setFilteredPositions] = useState<Map<string, PositionInfoType>>(
    EMPTY_MAP
  );
  const prevPositionKeysRef = useRef<string>('');

  // Create a stable key from positions to detect actual changes
  const positionKeys = Array.from(positions.keys()).sort().join(',');

  useEffect(() => {
    // Skip if positions haven't actually changed
    if (positionKeys === prevPositionKeysRef.current) {
      return;
    }
    prevPositionKeysRef.current = positionKeys;

    if (positions.size === 0) {
      setFilteredPositions(EMPTY_MAP);
      return;
    }

    let cancelled = false;

    const filterBTCPositions = async () => {
      const btcPositionsMap = new Map<string, PositionInfoType>();

      for (const [lbPairAddress, positionInfo] of positions.entries()) {
        const pool = positionInfo.lbPair;

        // Get token mint addresses
        const xMint =
          pool.tokenXMint &&
          typeof (pool.tokenXMint as MaybeBase58).toBase58 === 'function'
            ? (pool.tokenXMint as MaybeBase58).toBase58!()
            : pool.tokenXMint;
        const yMint =
          pool.tokenYMint &&
          typeof (pool.tokenYMint as MaybeBase58).toBase58 === 'function'
            ? (pool.tokenYMint as MaybeBase58).toBase58!()
            : pool.tokenYMint;

        try {
          const tokenXMeta = await fetchTokenMeta(xMint as string);
          const tokenYMeta = await fetchTokenMeta(yMint as string);

          if (
            tokenXMeta &&
            tokenYMeta &&
            isValidBTCPool(tokenXMeta.symbol, tokenYMeta.symbol)
          ) {
            btcPositionsMap.set(lbPairAddress, positionInfo);
          }
        } catch (error) {
          console.error(`Error filtering pool ${lbPairAddress}:`, error);
        }
      }

      if (!cancelled) {
        setFilteredPositions(btcPositionsMap.size > 0 ? btcPositionsMap : EMPTY_MAP);
      }
    };

    filterBTCPositions();

    return () => {
      cancelled = true;
    };
  }, [positions, positionKeys]);

  return filteredPositions;
}

// Export for reuse
export { fetchTokenMeta, isValidBTCPool };
export type { TokenMeta };
