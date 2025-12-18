import { useState, useCallback, useEffect } from 'react';
import { PublicKey } from '@solana/web3.js';
import { mcpClient, type PositionPnLResult } from '@/lib/mcp-client';
import type { PositionInfoType, PoolWithActiveId } from './useWalletPositions';
import type { MaybeBase58 } from './useFilteredPositions';
import { fetchTokenMeta } from './useFilteredPositions';

// Helper to delay between API calls
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface PositionType {
  publicKey: PublicKey;
  positionData: {
    totalXAmount: unknown;
    totalYAmount: unknown;
    feeX: unknown;
    feeY: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// Calculate estimated PnL when deposit tracking is not available
async function calculateEstimatedPnL(
  pos: PositionType,
  pool: PoolWithActiveId
): Promise<PositionPnLResult> {
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

  const [tokenXMeta, tokenYMeta] = await Promise.all([
    fetchTokenMeta(xMint as string),
    fetchTokenMeta(yMint as string),
  ]);

  const xDecimals = 8; // zBTC
  const yDecimals = 9; // SOL
  const currentXAmount = Number(pos.positionData.totalXAmount) / Math.pow(10, xDecimals);
  const currentYAmount = Number(pos.positionData.totalYAmount) / Math.pow(10, yDecimals);

  const xPrice = Number(tokenXMeta?.usdPrice || 0);
  const yPrice = Number(tokenYMeta?.usdPrice || 0);

  const currentValueUsd = currentXAmount * xPrice + currentYAmount * yPrice;

  const xFee = Number(pos.positionData.feeX || 0) / Math.pow(10, xDecimals);
  const yFee = Number(pos.positionData.feeY || 0) / Math.pow(10, yDecimals);
  const feesEarnedUsd = xFee * xPrice + yFee * yPrice;

  return {
    positionId: pos.publicKey.toBase58(),
    status: 'open',
    depositValueUsd: currentValueUsd,
    currentValueUsd,
    realizedPnlUsd: 0,
    realizedPnlPercent: 0,
    impermanentLoss: {
      usd: 0,
      percent: 0,
    },
    feesEarnedUsd,
    rewardsEarnedUsd: 0,
  };
}

export function usePnLData(
  publicKey: PublicKey | null,
  filteredPositions: Map<string, PositionInfoType>
) {
  const [pnlData, setPnlData] = useState<Map<string, PositionPnLResult>>(new Map());
  const [loadingPnl, setLoadingPnl] = useState(false);

  const fetchPnLData = useCallback(
    async (positionsMap: Map<string, PositionInfoType>) => {
      if (!publicKey) return;

      setLoadingPnl(true);
      const newPnlData = new Map<string, PositionPnLResult>();

      try {
        // Sync positions to MCP database first
        console.log(`🔄 Syncing ${positionsMap.size} positions to MCP database...`);
        try {
          await mcpClient.getUserPositionsWithSync({
            walletAddress: publicKey.toBase58(),
            includeHistorical: false,
            includeLive: true,
          });
          console.log(`✅ Position sync completed`);
        } catch (syncError) {
          console.warn(`⚠️ Position sync failed:`, syncError);
        }

        // Calculate PnL for each position (with delay to avoid rate limiting)
        let positionIndex = 0;
        for (const [, positionInfo] of positionsMap.entries()) {
          const positions = positionInfo.lbPairPositionsData as PositionType[];

          for (const pos of positions) {
            const positionId = pos.publicKey.toBase58();

            // Add 300ms delay between position calculations (except first one)
            if (positionIndex > 0) {
              await delay(300);
            }
            positionIndex++;

            try {
              const pnl = await mcpClient.calculatePositionPnL({
                positionId,
              });

              newPnlData.set(positionId, pnl);
              console.log(
                `✅ MCP PnL calculated for ${positionId.substring(0, 8)}... | PnL: $${pnl.realizedPnlUsd.toFixed(2)}`
              );
            } catch (mcpError) {
              console.warn(
                `⚠️ MCP PnL failed for ${positionId.substring(0, 8)} - Position may lack deposit tracking`
              );

              try {
                const estimatedPnl = await calculateEstimatedPnL(pos, positionInfo.lbPair);
                newPnlData.set(positionId, estimatedPnl);
                console.log(
                  `📊 Estimated PnL for ${positionId.substring(0, 8)}... | Value: $${estimatedPnl.currentValueUsd.toFixed(2)}`
                );
              } catch (estError) {
                console.error(`❌ Failed to calculate any PnL for ${positionId}:`, estError);
              }
            }
          }
        }

        setPnlData(newPnlData);
      } catch (error) {
        console.error('Error fetching PnL data:', error);
      } finally {
        setLoadingPnl(false);
      }
    },
    [publicKey]
  );

  const updatePnL = (positionId: string, pnl: PositionPnLResult) => {
    setPnlData((prev) => {
      const newMap = new Map(prev);
      newMap.set(positionId, pnl);
      return newMap;
    });
  };

  useEffect(() => {
    if (filteredPositions.size > 0) {
      fetchPnLData(filteredPositions);
    } else {
      setPnlData(new Map());
    }
  }, [filteredPositions, fetchPnLData]);

  return {
    pnlData,
    loadingPnl,
    updatePnL,
  };
}
