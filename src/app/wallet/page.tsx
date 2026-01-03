"use client";

import PageTemplate from "@/components/PageTemplate";
import React, { useState, useEffect } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import DLMM from "@meteora-ag/dlmm";
import { RangeBar } from "@/components/profile-components/RangeBar";
import BN from "bn.js";
import { showToast } from "@/lib/utils/showToast";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { mcpClient, type PositionPnLResult } from "@/lib/mcp-client";

// Position type from DLMM (unknown structure from external library)
interface PositionType {
  publicKey: PublicKey;
  positionData: {
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
  };
  tokenXDecimals?: unknown;
  tokenYDecimals?: unknown;
  [key: string]: unknown;
}

// Hooks
import { useWalletPositions } from "./hooks/useWalletPositions";
import { useFilteredPositions, type TokenMeta } from "./hooks/useFilteredPositions";
import { usePnLData } from "./hooks/usePnLData";
import { useUserTier } from "./hooks/useUserTier";
import type { PositionInfoType, PoolWithActiveId } from "./hooks/useWalletPositions";

// Components
import { PortfolioSummary } from "./components/PortfolioSummary";
import { ViewToggle } from "./components/ViewToggle";
import { PositionsList } from "./components/PositionsList";
import { ErrorMessage } from "./components/ErrorMessage";
import { SyncPositionsButton } from "./components/SyncPositionsButton";
import {
  NoPositionsState,
  WalletNotConnectedState,
  LoadingState,
  PnLLoadingIndicator,
} from "./components/EmptyStates";

// Utils
import { formatBalanceWithSub } from "./utils/formatBalance";

type MaybeBase58 = { toBase58?: () => string };
type BinData = { binId: number; pricePerToken?: string | number };

// ===================== CUSTOM HOOKS =====================

// Custom hook to fetch token meta for a pool
function useTokenMeta(pool: PoolWithActiveId) {
  const [tokenXMeta, setTokenXMeta] = React.useState<TokenMeta | null>(null);
  const [tokenYMeta, setTokenYMeta] = React.useState<TokenMeta | null>(null);

  React.useEffect(() => {
    if (!pool) return;

    const fetchTokenMetaFromCache = async (mint: string) => {
      const res = await fetch(
        `https://lite-api.jup.ag/tokens/v2/search?query=${mint}`
      );
      const data = await res.json();
      return data[0];
    };

    const xMint =
      pool.tokenXMint &&
      typeof (pool.tokenXMint as MaybeBase58).toBase58 === "function"
        ? (pool.tokenXMint as MaybeBase58).toBase58!()
        : pool.tokenXMint;
    const yMint =
      pool.tokenYMint &&
      typeof (pool.tokenYMint as MaybeBase58).toBase58 === "function"
        ? (pool.tokenYMint as MaybeBase58).toBase58!()
        : pool.tokenYMint;

    fetchTokenMetaFromCache(xMint as string).then(setTokenXMeta);
    fetchTokenMetaFromCache(yMint as string).then(setTokenYMeta);
  }, [pool]);

  return { tokenXMeta, tokenYMeta };
}

// Custom hook for position actions
function usePositionActions(
  lbPairAddress: string,
  pos: PositionType,
  refreshPositions: () => void,
  onPnLUpdate?: (positionId: string, pnl: PositionPnLResult) => void
) {
  const [closing, setClosing] = React.useState(false);
  const [claiming, setClaiming] = React.useState(false);
  const { publicKey, sendTransaction } = useWallet();

  async function handleCloseAndWithdraw() {
    if (!publicKey) return;
    setClosing(true);
    let txSignature: string | undefined;

    try {
      const posKey = pos.publicKey;
      const user = publicKey;
      const lowerBinId = Number(pos.positionData.lowerBinId);
      const upperBinId = Number(pos.positionData.upperBinId);
      const connection = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
          "https://api.mainnet-beta.solana.com"
      );
      const dlmmPool = await DLMM.create(
        connection,
        new PublicKey(lbPairAddress)
      );
      const txOrTxs = await dlmmPool.removeLiquidity({
        user,
        position: posKey,
        fromBinId: lowerBinId,
        toBinId: upperBinId,
        bps: new BN(10000),
        shouldClaimAndClose: true,
      });

      // Execute transaction(s) and get signature
      if (Array.isArray(txOrTxs)) {
        for (const tx of txOrTxs) {
          const sig = await sendTransaction(tx, connection);
          if (!txSignature) txSignature = sig;
        }
      } else {
        txSignature = await sendTransaction(txOrTxs, connection);
      }

      showToast.success(
        "Position closed on blockchain",
        "Calculating PnL..."
      );

      // Call MCP to calculate PnL and update database
      try {
        const mcpResult = await mcpClient.closePosition({
          positionId: posKey.toBase58(),
          walletAddress: publicKey.toBase58(),
          closeOnBlockchain: false,
          transactionSignature: txSignature,
        });

        if (mcpResult.success && mcpResult.pnl) {
          if (onPnLUpdate) {
            onPnLUpdate(posKey.toBase58(), mcpResult.pnl);
          }

          const pnl = mcpResult.pnl;
          const pnlSign = pnl.realizedPnlUsd >= 0 ? '+' : '';
          showToast.success(
            "Position Closed Successfully!",
            `PnL: ${pnlSign}$${pnl.realizedPnlUsd.toFixed(2)} (${pnlSign}${pnl.realizedPnlPercent.toFixed(2)}%)\nFees: $${pnl.feesEarnedUsd.toFixed(2)}\nIL: $${pnl.impermanentLoss.usd.toFixed(2)}`
          );
        }
      } catch (mcpError) {
        console.error('MCP PnL calculation failed:', mcpError);
        showToast.error(
          "Position closed, but PnL calculation failed",
          "Position was closed on blockchain successfully, but we couldn't calculate the final PnL."
        );
      }

      setTimeout(() => {
        refreshPositions();
      }, 10000);
    } catch (err) {
      showToast.error("Failed to close position", (err as Error).message);
    } finally {
      setClosing(false);
    }
  }

  async function handleClaimFees() {
    if (!publicKey) return;
    setClaiming(true);
    try {
      const posKey = pos.publicKey;
      const user = publicKey;
      const connection = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
          "https://api.mainnet-beta.solana.com"
      );
      const dlmmPool = await DLMM.create(
        connection,
        new PublicKey(lbPairAddress)
      );
      const position = await dlmmPool.getPosition(posKey);
      const tx = await dlmmPool.claimSwapFee({
        owner: user,
        position,
      });
      if (tx) {
        await sendTransaction(tx, connection);
        showToast.success(
          "Transaction successful",
          "Your fees have been claimed."
        );
        setTimeout(() => {
          refreshPositions();
        }, 10000);
      } else {
        showToast.error(
          "No fees to claim",
          "You don't have any fees to claim."
        );
      }
    } catch (err) {
      showToast.error("Failed to claim fees", (err as Error).message);
    } finally {
      setClaiming(false);
    }
  }

  return {
    closing,
    claiming,
    handleCloseAndWithdraw,
    handleClaimFees,
    publicKey,
  };
}

type PositionInfoLike = {
  tokenX?: { mint?: { decimals?: number } };
  tokenY?: { mint?: { decimals?: number } };
  [key: string]: unknown;
};

// Helper functions
function extractPriceRange(binData: BinData[]): { minPrice: number; maxPrice: number } {
  if (!binData || binData.length === 0) {
    return { minPrice: 0, maxPrice: 0 };
  }

  const minPrice = binData[0].pricePerToken !== undefined
    ? Number(binData[0].pricePerToken)
    : 0;
  const maxPrice = binData[binData.length - 1].pricePerToken !== undefined
    ? Number(binData[binData.length - 1].pricePerToken)
    : 0;

  return { minPrice, maxPrice };
}

function calculateCurrentPrice(
  pool: PoolWithActiveId,
  binData: BinData[]
): number {
  if (pool.currentMarketPrice !== undefined) {
    return Number(pool.currentMarketPrice);
  }

  if (binData && binData.length > 0 && pool.activeId !== undefined) {
    const activeBin = binData.find((b: BinData) => b.binId === pool.activeId);
    if (activeBin && activeBin.pricePerToken !== undefined) {
      return Number(activeBin.pricePerToken);
    }
  }

  if (binData && binData.length > 0) {
    const mid = Math.floor(binData.length / 2);
    if (binData[mid] && binData[mid].pricePerToken !== undefined) {
      return Number(binData[mid].pricePerToken);
    }
  }

  return 0;
}

function resolveDecimals(
  posDecimals: unknown,
  poolDecimals: unknown,
  positionInfo: PositionInfoLike | undefined,
  tokenKey: 'tokenX' | 'tokenY'
): number {
  if (typeof posDecimals === "number") return posDecimals;
  if (typeof poolDecimals === "number") return poolDecimals;

  const infoDecimals = positionInfo?.[tokenKey]?.mint?.decimals;
  if (typeof infoDecimals === "number") return infoDecimals;

  return 0;
}

function calculateTokenAmount(rawAmount: unknown, decimals: number): number {
  return rawAmount ? Number(rawAmount) / Math.pow(10, decimals) : 0;
}

function calculateUSDValue(
  amount1: number,
  price1: number,
  amount2: number,
  price2: number
): number {
  return amount1 * price1 + amount2 * price2;
}

// Custom hook for extracting and formatting position display data
function usePositionDisplayData(
  pos: PositionType,
  pool: PoolWithActiveId,
  tokenXMeta: TokenMeta | null,
  tokenYMeta: TokenMeta | null,
  positionInfo?: PositionInfoLike
) {
  const binData = pos.positionData.positionBinData as BinData[];

  const { minPrice, maxPrice } = extractPriceRange(binData);
  const currentPrice = calculateCurrentPrice(pool, binData);

  const xDecimals = resolveDecimals(
    pos.tokenXDecimals,
    pool.tokenXDecimals,
    positionInfo,
    'tokenX'
  );
  const yDecimals = resolveDecimals(
    pos.tokenYDecimals,
    pool.tokenYDecimals,
    positionInfo,
    'tokenY'
  );

  const xBalance = calculateTokenAmount(pos.positionData.totalXAmount, xDecimals);
  const yBalance = calculateTokenAmount(pos.positionData.totalYAmount, yDecimals);

  const xFee = calculateTokenAmount(pos.positionData.feeX, xDecimals);
  const yFee = calculateTokenAmount(pos.positionData.feeY, yDecimals);

  const claimedFeeX = calculateTokenAmount(pos.positionData.totalClaimedFeeXAmount, xDecimals);
  const claimedFeeY = calculateTokenAmount(pos.positionData.totalClaimedFeeYAmount, yDecimals);

  const xPrice = Number(tokenXMeta?.usdPrice || 0);
  const yPrice = Number(tokenYMeta?.usdPrice || 0);

  const totalLiquidityUSD = tokenXMeta && tokenYMeta
    ? calculateUSDValue(xBalance, xPrice, yBalance, yPrice)
    : 0;

  const claimedFeesUSD = tokenXMeta && tokenYMeta
    ? calculateUSDValue(claimedFeeX, xPrice, claimedFeeY, yPrice)
    : 0;

  return {
    minPrice,
    maxPrice,
    currentPrice,
    xBalance,
    yBalance,
    xFee,
    yFee,
    totalLiquidityUSD,
    claimedFeesUSD,
    xDecimals,
    yDecimals,
    claimedFeeX,
    claimedFeeY,
  };
}

// ===================== POSITION ITEM COMPONENT =====================

function PositionItem({
  lbPairAddress,
  positionInfo,
  refreshPositions,
  viewMode,
  positionIndex = 0,
  pnl,
  onPnLUpdate,
}: {
  lbPairAddress: string;
  positionInfo: {
    lbPair: PoolWithActiveId;
    lbPairPositionsData: PositionType[];
    [key: string]: unknown;
  };
  refreshPositions: () => void;
  viewMode: "table" | "card";
  positionIndex?: number;
  pnl?: PositionPnLResult;
  onPnLUpdate?: (positionId: string, pnl: PositionPnLResult) => void;
}) {
  const pos = positionInfo.lbPairPositionsData[positionIndex];
  const pool = positionInfo.lbPair;
  const { tokenXMeta, tokenYMeta } = useTokenMeta(pool);

  const {
    closing,
    claiming,
    handleCloseAndWithdraw,
    handleClaimFees,
    publicKey,
  } = usePositionActions(lbPairAddress, pos, refreshPositions, onPnLUpdate);

  const {
    minPrice,
    maxPrice,
    currentPrice,
    xBalance,
    yBalance,
    xFee,
    yFee,
    totalLiquidityUSD,
    claimedFeesUSD,
  } = usePositionDisplayData(pos, pool, tokenXMeta, tokenYMeta, positionInfo);

  // Shared token pair display
  const TokenPairDisplay = () => (
    <div className="flex flex-col items-start">
      <div className="flex items-start">
        {tokenXMeta && (
          <Image
            src={tokenXMeta.icon}
            alt={tokenXMeta.symbol}
            width={32}
            height={32}
            className="rounded-full border-2 border-border"
            unoptimized
          />
        )}
        {tokenYMeta && (
          <Image
            src={tokenYMeta.icon}
            alt={tokenYMeta.symbol}
            width={32}
            height={32}
            className="rounded-full border-2 border-border -ml-2"
            unoptimized
          />
        )}
      </div>
      <span className={`font-semibold ${viewMode === "card" ? "text-lg" : ""}`}>
        {tokenXMeta && tokenYMeta
          ? `${tokenXMeta.symbol} / ${tokenYMeta.symbol}`
          : ""}
      </span>
    </div>
  );

  // Shared balance display
  const BalanceDisplay = ({
    showIcons = false,
    size = "text-lg",
  }: {
    showIcons?: boolean;
    size?: string;
  }) => (
    <>
      <div className="flex items-center gap-2 mb-1">
        {showIcons && tokenXMeta && (
          <Image
            src={tokenXMeta.icon}
            alt={tokenXMeta.symbol}
            width={20}
            height={20}
            className="rounded-full border-2 border-border"
            unoptimized
          />
        )}
        <span className={`font-mono font-semibold ${size}`}>
          {xBalance === 0 ? "0" : formatBalanceWithSub(xBalance, 6)}{" "}
          {tokenXMeta ? tokenXMeta.symbol : ""}
        </span>
        {tokenXMeta && xBalance !== 0 && (
          <span className="text-xs text-gray-500 ml-1">
            (${(xBalance * Number(tokenXMeta.usdPrice || 0)).toFixed(2)})
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {showIcons && tokenYMeta && (
          <Image
            src={tokenYMeta.icon}
            alt={tokenYMeta.symbol}
            width={20}
            height={20}
            className="rounded-full border-2 border-border"
            unoptimized
          />
        )}
        <span className={`font-mono font-semibold ${size}`}>
          {yBalance === 0 ? "0" : formatBalanceWithSub(yBalance, 6)}{" "}
          {tokenYMeta ? tokenYMeta.symbol : ""}
        </span>
        {tokenYMeta && yBalance !== 0 && (
          <span className="text-xs text-gray-500 ml-1">
            (${(yBalance * Number(tokenYMeta.usdPrice || 0)).toFixed(2)})
          </span>
        )}
      </div>
    </>
  );

  // Shared fee display
  const FeeDisplay = ({
    showIcons = false,
    size = "text-lg",
  }: {
    showIcons?: boolean;
    size?: string;
  }) => (
    <>
      <div className="flex items-center gap-2 mb-1">
        {showIcons && tokenXMeta && (
          <Image
            src={tokenXMeta.icon}
            alt={tokenXMeta.symbol}
            width={20}
            height={20}
            className="rounded-full border-2 border-border"
            unoptimized
          />
        )}
        <span className={`font-mono font-semibold ${size}`}>
          {xFee === 0 ? "0" : formatBalanceWithSub(xFee, 6)}{" "}
          {tokenXMeta ? tokenXMeta.symbol : ""}
        </span>
        {tokenXMeta && xFee !== 0 && (
          <span className="text-xs text-gray-500 ml-1">
            (${(xFee * Number(tokenXMeta.usdPrice || 0)).toFixed(2)})
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {showIcons && tokenYMeta && (
          <Image
            src={tokenYMeta.icon}
            alt={tokenYMeta.symbol}
            width={20}
            height={20}
            className="rounded-full border-2 border-border"
            unoptimized
          />
        )}
        <span className={`font-mono font-semibold ${size}`}>
          {yFee === 0 ? "0" : formatBalanceWithSub(yFee, 6)}{" "}
          {tokenYMeta ? tokenYMeta.symbol : ""}
        </span>
        {tokenYMeta && yFee !== 0 && (
          <span className="text-xs text-gray-500 ml-1">
            (${(yFee * Number(tokenYMeta.usdPrice || 0)).toFixed(2)})
          </span>
        )}
      </div>
    </>
  );

  // Shared action buttons
  const ActionButtons = ({ size = "text-sm" }: { size?: string }) => (
    <div
      className={`flex ${
        viewMode === "card" ? "flex-col md:flex-row" : "flex-col"
      } justify-end gap-2 ${viewMode === "card" ? "mt-6" : ""}`}
    >
      <Button
        variant="secondary"
        className={size}
        onClick={handleClaimFees}
        disabled={claiming || !publicKey}
      >
        {claiming ? "Claiming..." : "Claim Fees"}
      </Button>
      <Button
        className={size}
        onClick={handleCloseAndWithdraw}
        disabled={closing || !publicKey}
      >
        {closing ? "Closing..." : "Close & Withdraw"}
      </Button>
    </div>
  );

  if (viewMode === "card") {
    return (
      <div className="rounded-lg shadow-sm overflow-hidden p-4 mb-4 border border-border">
        <div className="flex items-center gap-2 mb-4">
          <TokenPairDisplay />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div>
            <div className="text-sm text-gray-400 mb-1">Total Liquidity</div>
            <div className="text-xl font-semibold text-white">
              ${totalLiquidityUSD.toFixed(4)}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-1">
              Fees Earned (Claimed)
            </div>
            <div className="text-xl font-semibold text-white">
              ${claimedFeesUSD.toFixed(8)}
            </div>
          </div>
          {pnl && (
            <>
              <div>
                <div className="text-sm text-gray-400 mb-1">PnL</div>
                <div className={`text-xl font-semibold ${pnl.realizedPnlUsd >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {pnl.realizedPnlUsd >= 0 ? '+' : ''}${pnl.realizedPnlUsd.toFixed(2)}
                  <span className="text-sm ml-1">
                    ({pnl.realizedPnlPercent >= 0 ? '+' : ''}{pnl.realizedPnlPercent.toFixed(2)}%)
                  </span>
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-400 mb-1">Impermanent Loss</div>
                <div className={`text-xl font-semibold ${pnl.impermanentLoss.usd >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {pnl.impermanentLoss.usd >= 0 ? '+' : ''}${pnl.impermanentLoss.usd.toFixed(2)}
                  <span className="text-sm ml-1">
                    ({pnl.impermanentLoss.percent >= 0 ? '+' : ''}{pnl.impermanentLoss.percent.toFixed(2)}%)
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="mb-4">
          <span className="block font-semibold mb-1">Range</span>
          <RangeBar
            min={minPrice}
            max={maxPrice}
            current={currentPrice}
            xBalance={xBalance}
            yBalance={yBalance}
          />
        </div>

        <div className="bg-card-foreground border border-border rounded-lg p-4">
          <div className="text-lg font-semibold mb-2">Position Liquidity</div>
          <div className="flex flex-col md:flex-row gap-6">
            <div>
              <div className="text-sm text-gray-500 mb-1">Current Balance</div>
              <BalanceDisplay showIcons={true} />
            </div>
            <div>
              <div className="text-sm text-gray-500 mb-1">
                Your Unclaimed Swap Fee
              </div>
              <FeeDisplay showIcons={true} />
            </div>
          </div>
          <ActionButtons />
        </div>
      </div>
    );
  }

  // Table row format
  return (
    <tr key={lbPairAddress}>
      <td className="px-4 py-3 whitespace-nowrap">
        <TokenPairDisplay />
      </td>
      <td className="px-4 py-3 whitespace-nowrap font-mono">
        ${totalLiquidityUSD.toFixed(4)}
      </td>
      <td className="px-4 py-3 whitespace-nowrap font-mono">
        ${claimedFeesUSD.toFixed(8)}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <BalanceDisplay size="text-sm" />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <FeeDisplay size="text-sm" />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <RangeBar
          min={minPrice}
          max={maxPrice}
          current={currentPrice}
          xBalance={xBalance}
          yBalance={yBalance}
        />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex justify-center gap-2">
          <ActionButtons size="text-xs" />
        </div>
      </td>
    </tr>
  );
}

// ===================== MAIN WALLET PAGE COMPONENT =====================

const WalletPage = () => {
  const { publicKey, connected, connecting } = useWallet();
  const [viewMode, setViewMode] = useState<"table" | "card">(
    typeof window !== "undefined" && window.innerWidth < 640 ? "card" : "table"
  );

  // Custom hooks for state management
  const { positions, loading, error, refreshPositions } = useWalletPositions(
    publicKey,
    connected
  );
  const filteredPositions = useFilteredPositions(positions);
  const { pnlData, loadingPnl, updatePnL } = usePnLData(publicKey, filteredPositions);
  const { userTier } = useUserTier(publicKey, connected);

  // Responsive: switch to card view on mobile by default
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 640) setViewMode("card");
      else setViewMode("table");
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const positionsArray = Array.from(filteredPositions.entries());

  return (
    <PageTemplate>
      <div className="">
        <div className="mx-auto">
          {/* Portfolio Performance Summary */}
          {connected && (
            <PortfolioSummary
              pnlData={pnlData}
              loadingPnl={loadingPnl}
              userTier={userTier}
            />
          )}

          {/* View Toggle */}
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold">Your Positions</h1>
            <div className="flex items-center gap-3">
              {connected && publicKey && (
                <SyncPositionsButton
                  walletAddress={publicKey.toBase58()}
                  onSyncComplete={refreshPositions}
                />
              )}
              <ViewToggle viewMode={viewMode} onViewModeChange={setViewMode} />
            </div>
          </div>

          {/* Error Message */}
          <ErrorMessage error={error} />

          {/* PnL Loading Indicator */}
          {loadingPnl && connected && positionsArray.length > 0 && (
            <PnLLoadingIndicator />
          )}

          {/* Loading State */}
          {loading && <LoadingState />}

          {/* Positions List */}
          {!loading && connected && positionsArray.length > 0 && (
            <PositionsList
              positionsArray={positionsArray}
              viewMode={viewMode}
              pnlData={pnlData}
              onPnLUpdate={updatePnL}
              refreshPositions={refreshPositions}
              PositionItemComponent={PositionItem as React.ComponentType<unknown>}
            />
          )}

          {/* Empty State */}
          {!loading && connected && positionsArray.length === 0 && (
            <NoPositionsState />
          )}

          {/* Not Connected State */}
          {!connected && !connecting && <WalletNotConnectedState />}
        </div>
      </div>
    </PageTemplate>
  );
};

export default WalletPage;
