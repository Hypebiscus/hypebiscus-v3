"use client";

import PageTemplate from "@/components/PageTemplate";
import React, { useState, useEffect } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import DLMM from "@meteora-ag/dlmm";
import { RangeBar } from "@/components/profile-components/RangeBar";
import BN from "bn.js";
import { showToast } from "@/lib/utils/showToast";
import {
  ChartLineUpIcon,
  InfoIcon,
  SquaresFourIcon,
  TableIcon,
  WalletIcon,
  LinkIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Image from "next/image";
import type { PositionType } from "@/lib/meteora/meteoraDlmmService";
import { WalletLinkingCard } from "@/components/mcp-components/WalletLinkingCard";
import { WalletDeletionDialog } from "@/components/mcp-components/WalletDeletionDialog";
import { mcpClient, type PositionPnLResult, type UserTierInfo } from "@/lib/mcp-client";

// ===================== JUPITER LITE API INTEGRATION =====================
// This section uses the Jupiter Lite API (https://lite-api.jup.ag) to fetch
// token metadata (symbol, name, icon, usdPrice) for each token mint address.
// The results are cached in a local object to avoid redundant requests.
// ========================================================================

const tokenMetaCache: Record<string, TokenMeta> = {};

async function fetchTokenMeta(mint: string) {
  if (tokenMetaCache[mint]) return tokenMetaCache[mint];
  const res = await fetch(
    `https://lite-api.jup.ag/tokens/v2/search?query=${mint}`
  );
  const data = await res.json();
  // The API returns an array, take the first match
  const token = data[0];
  tokenMetaCache[mint] = token;
  return token;
}

// Helper function to check if a pool is a valid BTC pool
// Based on poolSearchService.ts validation logic
function isValidBTCPool(tokenXSymbol: string, tokenYSymbol: string): boolean {
  const pairName = `${tokenXSymbol?.toLowerCase()}-${tokenYSymbol?.toLowerCase()}`;

  // Check if it matches valid BTC-SOL pairs (from poolSearchService)
  return (
    pairName === "wbtc-sol" ||
    pairName === "sol-wbtc" ||
    pairName === "zbtc-sol" ||
    pairName === "sol-zbtc" ||
    pairName === "cbbtc-sol" ||
    pairName === "sol-cbbtc"
  );
}

// Helper to format balance with dynamic superscript for leading zeros after decimal
function formatBalanceWithSub(balance: number, decimals = 6) {
  if (balance === 0) return "0";
  const str = balance.toFixed(decimals);
  // Match: int part, all zeros after decimal, rest
  const match = str.match(/^([0-9]+)\.(0+)(\d*)$/);
  if (!match) return str;
  const [, intPart, zeros, rest] = match;
  // Show the first zero after the decimal, then subscript the total count of zeros (not zeros.length - 1)
  return (
    <>
      {intPart}.0{sub(zeros.length)}
      {rest}
    </>
  );
  function sub(n: number | null) {
    return n && n > 1 ? (
      <sub style={{ fontSize: "0.7em", verticalAlign: "baseline" }}>{n}</sub>
    ) : null;
  }
}

// Define a type for token meta fetched from Jupiter API
interface TokenMeta {
  icon: string;
  symbol: string;
  usdPrice?: number;
  [key: string]: unknown;
}

// Minimal interfaces for pool and binData
interface PoolWithActiveId {
  activeId?: number;
  tokenXMint?: unknown;
  tokenYMint?: unknown;
  currentMarketPrice?: number;
  [key: string]: unknown;
}
type BinData = { binId: number; pricePerToken?: string | number };

type MaybeBase58 = { toBase58?: () => string };
// Custom hook to fetch token meta for a pool
function useTokenMeta(pool: PoolWithActiveId) {
  const [tokenXMeta, setTokenXMeta] = React.useState<TokenMeta | null>(null);
  const [tokenYMeta, setTokenYMeta] = React.useState<TokenMeta | null>(null);
  React.useEffect(() => {
    if (!pool) return;
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
    fetchTokenMeta(xMint as string).then(setTokenXMeta);
    fetchTokenMeta(yMint as string).then(setTokenYMeta);
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
          if (!txSignature) txSignature = sig; // Store first signature
        }
      } else {
        txSignature = await sendTransaction(txOrTxs, connection);
      }

      showToast.success(
        "Position closed on blockchain",
        "Calculating PnL..."
      );

      // Call MCP to calculate PnL and update database
      // Following Garden Bot pattern: closeOnBlockchain=false (already closed above)
      try {
        const mcpResult = await mcpClient.closePosition({
          positionId: posKey.toBase58(),
          walletAddress: publicKey.toBase58(),
          closeOnBlockchain: false,
          transactionSignature: txSignature,
        });

        if (mcpResult.success && mcpResult.pnl) {
          // Update PnL state
          if (onPnLUpdate) {
            onPnLUpdate(posKey.toBase58(), mcpResult.pnl);
          }

          // Show PnL summary
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

      // Add delay to allow blockchain state to update before refreshing
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
        // Add delay to allow blockchain state to update before refreshing
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

// Custom hook for extracting and formatting position display data
function usePositionDisplayData(
  pos: PositionType,
  pool: PoolWithActiveId,
  tokenXMeta: TokenMeta | null,
  tokenYMeta: TokenMeta | null,
  positionInfo?: PositionInfoLike
) {
  const binData = pos.positionData.positionBinData as BinData[];
  const minPrice =
    binData && binData.length > 0 && binData[0].pricePerToken !== undefined
      ? Number(binData[0].pricePerToken)
      : 0;
  const maxPrice =
    binData &&
    binData.length > 0 &&
    binData[binData.length - 1].pricePerToken !== undefined
      ? Number(binData[binData.length - 1].pricePerToken)
      : 0;
  // Get current market price - use the fetched current market price if available
  let currentPrice = 0;

  // First, check if we have the actual current market price attached
  if (pool.currentMarketPrice !== undefined) {
    currentPrice = Number(pool.currentMarketPrice);
  }
  // Fallback: try to find active bin in position binData
  else if (binData && binData.length > 0 && pool.activeId !== undefined) {
    const activeBin = binData.find((b: BinData) => b.binId === pool.activeId);
    if (activeBin && activeBin.pricePerToken !== undefined) {
      currentPrice = Number(activeBin.pricePerToken);
    } else {
      // Final fallback: use middle of position range
      const mid = Math.floor(binData.length / 2);
      currentPrice =
        binData[mid] && binData[mid].pricePerToken !== undefined
          ? Number(binData[mid].pricePerToken)
          : 0;
    }
  }
  // Improved fallback for decimals
  let xDecimals: number = 0;
  if (typeof pos.tokenXDecimals === "number") xDecimals = pos.tokenXDecimals;
  else if (typeof pool.tokenXDecimals === "number")
    xDecimals = pool.tokenXDecimals;
  else if (typeof positionInfo?.tokenX?.mint?.decimals === "number")
    xDecimals = positionInfo.tokenX.mint.decimals;
  else xDecimals = 0;

  let yDecimals: number = 0;
  if (typeof pos.tokenYDecimals === "number") yDecimals = pos.tokenYDecimals;
  else if (typeof pool.tokenYDecimals === "number")
    yDecimals = pool.tokenYDecimals;
  else if (typeof positionInfo?.tokenY?.mint?.decimals === "number")
    yDecimals = positionInfo.tokenY.mint.decimals;
  else yDecimals = 0;

  const xBalance = pos.positionData.totalXAmount
    ? Number(pos.positionData.totalXAmount) / Math.pow(10, xDecimals)
    : 0;
  const yBalance = pos.positionData.totalYAmount
    ? Number(pos.positionData.totalYAmount) / Math.pow(10, yDecimals)
    : 0;
  const xFee = pos.positionData.feeX
    ? Number(pos.positionData.feeX) / Math.pow(10, xDecimals)
    : 0;
  const yFee = pos.positionData.feeY
    ? Number(pos.positionData.feeY) / Math.pow(10, yDecimals)
    : 0;
  const totalLiquidityUSD =
    tokenXMeta && tokenYMeta
      ? xBalance * Number(tokenXMeta.usdPrice || 0) +
        yBalance * Number(tokenYMeta.usdPrice || 0)
      : 0;
  const claimedFeeX = pos.positionData.totalClaimedFeeXAmount
    ? Number(pos.positionData.totalClaimedFeeXAmount) / Math.pow(10, xDecimals)
    : 0;
  const claimedFeeY = pos.positionData.totalClaimedFeeYAmount
    ? Number(pos.positionData.totalClaimedFeeYAmount) / Math.pow(10, yDecimals)
    : 0;
  const claimedFeesUSD =
    tokenXMeta && tokenYMeta
      ? claimedFeeX * Number(tokenXMeta.usdPrice || 0) +
        claimedFeeY * Number(tokenYMeta.usdPrice || 0)
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
// A unified component that can render as either a card or table row
// based on the viewMode prop. This eliminates code duplication while
// maintaining the Rules of Hooks compliance.
// ===============================================================

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

  // Use shared hook for actions
  const {
    closing,
    claiming,
    handleCloseAndWithdraw,
    handleClaimFees,
    publicKey,
  } = usePositionActions(lbPairAddress, pos, refreshPositions, onPnLUpdate);

  // Use shared hook for display data
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
      {/* REBALANCE BUTTON */}
      {/* <Button variant="thirdary" className="{size}"><ScalesIcon />
        Rebalance
      </Button> */}
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
        {/* Position/Pool Section */}
        <div className="flex items-center gap-2 mb-4">
          <TokenPairDisplay />
        </div>

        {/* Summary Cards */}
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

        {/* Range */}
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

        {/* Position Liquidity Section */}
        <div className="bg-card-foreground border border-border rounded-lg p-4">
          <div className="text-lg font-semibold mb-2">Position Liquidity</div>
          <div className="flex flex-col md:flex-row gap-6">
            {/* Current Balance */}
            <div>
              <div className="text-sm text-gray-500 mb-1">Current Balance</div>
              <BalanceDisplay showIcons={true} />
            </div>
            {/* Unclaimed Swap Fee */}
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

const WalletPage = () => {
  const { publicKey, connected, connecting } = useWallet();
  const [positions, setPositions] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "card">(
    typeof window !== "undefined" && window.innerWidth < 640 ? "card" : "table"
  );
  const [activeTab, setActiveTab] = useState<"positions" | "link">("positions");
  const [pnlData, setPnlData] = useState<Map<string, PositionPnLResult>>(new Map());
  const [loadingPnl, setLoadingPnl] = useState(false);
  const [userTier, setUserTier] = useState<UserTierInfo | null>(null);

  // Check for tab query parameter
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      if (tab === 'link') {
        setActiveTab('link');
      }
    }
  }, []);

  // Fetch user tier when wallet connects
  useEffect(() => {
    const fetchUserTier = async () => {
      if (!publicKey || !connected) {
        setUserTier(null);
        return;
      }

      setLoadingTier(true);
      try {
        const tierInfo = await mcpClient.getUserTier(publicKey.toBase58());
        setUserTier(tierInfo);
        console.log(`👤 User tier: ${tierInfo.tier} | Subscription: ${tierInfo.hasActiveSubscription} | Credits: ${tierInfo.creditBalance}`);
      } catch (error) {
        console.error('Failed to fetch user tier:', error);
        // Default to free tier on error
        setUserTier({
          tier: 'free',
          hasActiveSubscription: false,
          creditBalance: 0,
          canAccessFullPnL: false,
          canAccessAdvancedFeatures: false,
        });
      } finally {
        setLoadingTier(false);
      }
    };

    fetchUserTier();
  }, [connected, publicKey]);

  // Responsive: switch to card view on mobile by default
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 640) setViewMode("card");
      else setViewMode("table");
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Fetch positions when wallet connects
  useEffect(() => {
    if (connected && publicKey) {
      fetchPositions(publicKey);
    } else {
      setPositions(new Map());
    }
  }, [connected, publicKey]);

  const fetchPositions = async (userPubKey: PublicKey) => {
    try {
      setLoading(true);
      setError("");

      // Use your QuickNode RPC endpoint
      const connection = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
          "https://api.mainnet-beta.solana.com"
      );

      // Continue with your logic...
      const userPositions = await DLMM.getAllLbPairPositionsByUser(
        connection,
        userPubKey
      );

      // Fetch actual current market price for each pool
      for (const [lbPairAddress, positionInfo] of userPositions.entries()) {
        try {
          // Create DLMM instance to get current price
          const dlmmPool = await DLMM.create(
            connection,
            new PublicKey(lbPairAddress)
          );

          // Get the active bin with current market price
          const activeBin = await dlmmPool.getActiveBin();

          // Attach the current market price to the pool object
          if (activeBin && activeBin.pricePerToken) {
            // Type assertion to add currentMarketPrice to the pool object
            const pool = positionInfo.lbPair as PoolWithActiveId;
            pool.currentMarketPrice = Number(activeBin.pricePerToken);
          }
        } catch (error) {
          console.error(
            `Error fetching current price for pool ${lbPairAddress}:`,
            error
          );
        }
      }

      setPositions(userPositions);

      // Temporary: Set empty positions until DLMM is imported
      // setPositions(new Map());
    } catch (err) {
      setError("Failed to fetch positions: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const refreshPositions = () => {
    if (publicKey) {
      fetchPositions(publicKey);
    }
  };

  // Define the position info type
  type PositionInfoType = {
    lbPair: PoolWithActiveId;
    lbPairPositionsData: PositionType[];
    [key: string]: unknown;
  };

  // Filter positions to only show BTC pools
  const [filteredPositions, setFilteredPositions] = useState<
    Map<string, PositionInfoType>
  >(new Map());

  // Fetch PnL data for all positions
  const fetchPnLData = React.useCallback(async (positionsMap: Map<string, unknown>) => {
    if (!publicKey) return;

    setLoadingPnl(true);
    const newPnlData = new Map<string, PositionPnLResult>();

    try {
      // Step 1: Sync positions to MCP database first
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
        // Continue anyway - fallback will handle it
      }

      // Step 2: Calculate PnL for each position
      for (const [, positionInfo] of positionsMap.entries()) {
        const typedPositionInfo = positionInfo as PositionInfoType;
        const positions = typedPositionInfo.lbPairPositionsData;

        for (const pos of positions) {
          const positionId = pos.publicKey.toBase58();

          try {
            // Try MCP (accurate PnL with deposit tracking from database)
            const pnl = await mcpClient.calculatePositionPnL({
              positionId,
            });

            newPnlData.set(positionId, pnl);
            console.log(`✅ MCP PnL calculated for ${positionId.substring(0, 8)}... | PnL: $${pnl.realizedPnlUsd.toFixed(2)}`);
          } catch (mcpError) {
            console.warn(`⚠️ MCP PnL failed for ${positionId.substring(0, 8)} - Position may lack deposit tracking`);
            console.warn(`   Error:`, mcpError instanceof Error ? mcpError.message : mcpError);

            // Fallback: Calculate estimated PnL from blockchain data only
            // Note: This shows current value + fees but cannot calculate true PnL
            try {
              const estimatedPnl = await calculateEstimatedPnL(pos, typedPositionInfo.lbPair);
              newPnlData.set(positionId, estimatedPnl);
              console.log(`📊 Estimated PnL for ${positionId.substring(0, 8)}... | Value: $${estimatedPnl.currentValueUsd.toFixed(2)}`);
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
  }, [publicKey]);

  // Calculate estimated PnL when deposit tracking is not available
  const calculateEstimatedPnL = async (pos: PositionType, pool: PoolWithActiveId): Promise<PositionPnLResult> => {
    // Fetch token metadata
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

    // Get current amounts
    const xDecimals = 8; // zBTC
    const yDecimals = 9; // SOL
    const currentXAmount = Number(pos.positionData.totalXAmount) / Math.pow(10, xDecimals);
    const currentYAmount = Number(pos.positionData.totalYAmount) / Math.pow(10, yDecimals);

    // Get current prices
    const xPrice = Number(tokenXMeta?.usdPrice || 0);
    const yPrice = Number(tokenYMeta?.usdPrice || 0);

    // Calculate current value
    const currentValueUsd = (currentXAmount * xPrice) + (currentYAmount * yPrice);

    // Get fees
    const xFee = Number(pos.positionData.feeX || 0) / Math.pow(10, xDecimals);
    const yFee = Number(pos.positionData.feeY || 0) / Math.pow(10, yDecimals);
    const feesEarnedUsd = (xFee * xPrice) + (yFee * yPrice);

    // Since we don't have deposit data, show current value only
    // Mark PnL as unknown/estimated
    return {
      positionId: pos.publicKey.toBase58(),
      status: 'open',
      depositValueUsd: currentValueUsd, // Estimated - same as current
      currentValueUsd,
      realizedPnlUsd: 0, // Can't calculate without deposit data
      realizedPnlPercent: 0,
      impermanentLoss: {
        usd: 0, // Can't calculate without deposit data
        percent: 0,
      },
      feesEarnedUsd,
      rewardsEarnedUsd: 0,
    };
  };

  // Update PnL for a specific position (called after closing)
  const updatePnL = (positionId: string, pnl: PositionPnLResult) => {
    setPnlData(prev => {
      const newMap = new Map(prev);
      newMap.set(positionId, pnl);
      return newMap;
    });
  };

  // Filter positions when they change
  useEffect(() => {
    const filterBTCPositions = async () => {
      const btcPositionsMap = new Map<string, PositionInfoType>();

      for (const [lbPairAddress, positionInfo] of positions.entries()) {
        const typedPositionInfo = positionInfo as PositionInfoType;

        const pool = typedPositionInfo.lbPair;

        // Get token mint addresses
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

        try {
          // Fetch token metadata to get symbols
          const tokenXMeta = await fetchTokenMeta(xMint as string);
          const tokenYMeta = await fetchTokenMeta(yMint as string);

          // Check if this is a valid BTC pool using poolSearchService logic
          if (
            tokenXMeta &&
            tokenYMeta &&
            isValidBTCPool(tokenXMeta.symbol, tokenYMeta.symbol)
          ) {
            btcPositionsMap.set(lbPairAddress, typedPositionInfo);
          }
        } catch (error) {
          console.error(`Error filtering pool ${lbPairAddress}:`, error);
        }
      }

      setFilteredPositions(btcPositionsMap);
    };

    if (positions.size > 0) {
      filterBTCPositions();
    } else {
      setFilteredPositions(new Map());
    }
  }, [positions]);

  // Fetch PnL data when filtered positions change
  useEffect(() => {
    if (filteredPositions.size > 0) {
      fetchPnLData(filteredPositions);
    } else {
      setPnlData(new Map());
    }
  }, [filteredPositions, publicKey, fetchPnLData]);

  const positionsArray = Array.from(filteredPositions.entries());

  // Calculate portfolio-level totals from PnL data
  const portfolioTotals = React.useMemo(() => {
    if (pnlData.size === 0) {
      return {
        totalPnlUsd: 0,
        totalPnlPercent: 0,
        totalFeesEarnedUsd: 0,
        totalRewardsEarnedUsd: 0,
        totalImpermanentLossUsd: 0,
        totalDepositValueUsd: 0,
        totalCurrentValueUsd: 0,
        activePositionsCount: 0,
      };
    }

    let totalPnlUsd = 0;
    let totalFeesEarnedUsd = 0;
    let totalRewardsEarnedUsd = 0;
    let totalImpermanentLossUsd = 0;
    let totalDepositValueUsd = 0;
    let totalCurrentValueUsd = 0;

    for (const pnl of pnlData.values()) {
      totalPnlUsd += pnl.realizedPnlUsd;
      totalFeesEarnedUsd += pnl.feesEarnedUsd;
      totalRewardsEarnedUsd += pnl.rewardsEarnedUsd;
      totalImpermanentLossUsd += pnl.impermanentLoss.usd;
      totalDepositValueUsd += pnl.depositValueUsd;
      totalCurrentValueUsd += pnl.currentValueUsd;
    }

    const totalPnlPercent = totalDepositValueUsd > 0
      ? (totalPnlUsd / totalDepositValueUsd) * 100
      : 0;

    return {
      totalPnlUsd,
      totalPnlPercent,
      totalFeesEarnedUsd,
      totalRewardsEarnedUsd,
      totalImpermanentLossUsd,
      totalDepositValueUsd,
      totalCurrentValueUsd,
      activePositionsCount: pnlData.size,
    };
  }, [pnlData]);

  return (
    <PageTemplate>
      <div className="">
        <div className="mx-auto">
          {/* Portfolio Performance Summary - Always on top */}
          {connected && pnlData.size > 0 && (
            <div className="space-y-4 mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                    <ChartLineUpIcon size={28} className="text-primary" weight="fill" />
                    Portfolio Performance
                  </h2>
                  {/* User Tier Badge */}
                  {userTier && (
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      userTier.tier === 'premium'
                        ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 text-yellow-400 border border-yellow-500/30'
                        : userTier.tier === 'credits'
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'bg-gray-700/50 text-gray-400 border border-gray-600'
                    }`}>
                      {userTier.tier === 'premium' && '👑 Premium'}
                      {userTier.tier === 'credits' && `💳 ${userTier.creditBalance} Credits`}
                      {userTier.tier === 'free' && '🆓 Free'}
                    </span>
                  )}
                </div>
                {loadingPnl && (
                  <span className="text-sm text-gray-400">Calculating PnL...</span>
                )}
              </div>

              {/* Free User - Upgrade Prompt */}
              {userTier && !userTier.canAccessFullPnL && (
                <div className="relative">
                  {/* Blurred PnL Preview */}
                  <div className="filter blur-sm pointer-events-none select-none">
                    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
                      <Card className="bg-gray-900/50 border-border">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium text-gray-400">Total Value</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold text-white">$XX,XXX.XX</div>
                          <p className="text-xs text-gray-500 mt-2">Locked</p>
                        </CardContent>
                      </Card>
                      <Card className="bg-gray-900/50 border-border">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium text-gray-400">Total PnL</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold text-gray-400">$XXX.XX</div>
                          <p className="text-xs text-gray-500 mt-2">+XX.XX%</p>
                        </CardContent>
                      </Card>
                      <Card className="bg-gray-900/50 border-border">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium text-gray-400">Fees Earned</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold text-gray-400">$XX.XX</div>
                          <p className="text-xs text-gray-500 mt-2">Locked</p>
                        </CardContent>
                      </Card>
                    </div>
                  </div>

                  {/* Upgrade Overlay */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-lg">
                    <div className="text-center p-8 max-w-md">
                      <div className="text-4xl mb-4">🔒</div>
                      <h3 className="text-xl font-bold text-white mb-2">Unlock Full PnL Tracking</h3>
                      <p className="text-gray-400 mb-6">
                        Get detailed profit & loss analysis, fee tracking, and impermanent loss calculations
                      </p>
                      <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <Button
                          className="bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white font-semibold"
                          onClick={() => {
                            // TODO: Navigate to subscription page
                            showToast.info("Coming Soon", "Premium subscription page is under development");
                          }}
                        >
                          👑 Subscribe ($9.99/mo)
                        </Button>
                        <Button
                          variant="outline"
                          className="border-blue-500 text-blue-400 hover:bg-blue-500/10"
                          onClick={() => {
                            // TODO: Navigate to credits page
                            showToast.info("Coming Soon", "Credits purchase page is under development");
                          }}
                        >
                          💳 Buy Credits
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Premium/Credits Users - Full PnL Display */}
              {userTier && userTier.canAccessFullPnL && (
                <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
                  {/* Total Portfolio Value */}
                  <Card className="bg-gray-900/50 border-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-400">Total Value</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-white">
                      ${portfolioTotals.totalCurrentValueUsd.toFixed(2)}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Deposited: ${portfolioTotals.totalDepositValueUsd.toFixed(2)}
                    </p>
                  </CardContent>
                </Card>

                {/* Total PnL */}
                <Card className="bg-gray-900/50 border-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-400">Total PnL</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={`text-2xl font-bold ${portfolioTotals.totalPnlUsd >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {portfolioTotals.totalPnlUsd >= 0 ? '+' : ''}${portfolioTotals.totalPnlUsd.toFixed(2)}
                    </div>
                    <p className={`text-xs mt-2 ${portfolioTotals.totalPnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {portfolioTotals.totalPnlPercent >= 0 ? '+' : ''}{portfolioTotals.totalPnlPercent.toFixed(2)}%
                    </p>
                  </CardContent>
                </Card>

                {/* Total Fees Earned */}
                <Card className="bg-gray-900/50 border-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-400">Fees Earned</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-500">
                      ${portfolioTotals.totalFeesEarnedUsd.toFixed(2)}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Swap fees</p>
                  </CardContent>
                </Card>

                {/* Total Rewards - only show if > 0 */}
                {portfolioTotals.totalRewardsEarnedUsd > 0 && (
                  <Card className="bg-gray-900/50 border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-gray-400">Rewards</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-green-500">
                        ${portfolioTotals.totalRewardsEarnedUsd.toFixed(2)}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">Trading rewards</p>
                    </CardContent>
                  </Card>
                )}

                {/* Total Impermanent Loss */}
                <Card className="bg-gray-900/50 border-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-400">Impermanent Loss</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={`text-2xl font-bold ${portfolioTotals.totalImpermanentLossUsd >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {portfolioTotals.totalImpermanentLossUsd >= 0 ? '+' : ''}${Math.abs(portfolioTotals.totalImpermanentLossUsd).toFixed(2)}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">vs. HODL</p>
                  </CardContent>
                </Card>

                {/* Active Positions */}
                <Card className="bg-gray-900/50 border-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-400">Active Positions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-white">
                      {portfolioTotals.activePositionsCount}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">BTC pools</p>
                  </CardContent>
                </Card>
              </div>
              )}
            </div>
          )}

          {/* Tab Navigation */}
          <div className="flex justify-between items-center mb-6">
            <div className="flex gap-4">
              <button
                type="button"
                className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                  activeTab === "positions"
                    ? "bg-primary text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
                onClick={() => setActiveTab("positions")}
              >
                <WalletIcon size={20} />
                Positions
              </button>
              <button
                type="button"
                className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                  activeTab === "link"
                    ? "bg-primary text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
                onClick={() => setActiveTab("link")}
              >
                <LinkIcon size={20} />
                Link Telegram
              </button>
            </div>

            {/* View Toggle - only show on positions tab */}
            {activeTab === "positions" && (
              <div className="inline-flex gap-4" role="group">
                <button
                  type="button"
                  className={`text-sm flex items-center gap-2 ${
                    viewMode === "table" ? "font-semibold" : "font-normal"
                  }`}
                  onClick={() => setViewMode("table")}
                >
                  <TableIcon size={21} /> Table
                </button>
                <button
                  type="button"
                  className={`text-sm flex items-center gap-2 ${
                    viewMode === "card" ? "font-semibold" : "font-normal"
                  }`}
                  onClick={() => setViewMode("card")}
                >
                  <SquaresFourIcon size={21} /> Card
                </button>
              </div>
            )}
          </div>

          {/* Tab Content */}
          {activeTab === "link" ? (
            <div className="max-w-4xl mx-auto">
              <WalletLinkingCard
                onLinkSuccess={() => {
                  showToast.success("Success!", "Your wallet has been linked to Telegram");
                }}
                onLinkError={(error) => {
                  showToast.error("Link Failed", error.message);
                }}
              />

              {/* Wallet Deletion Section */}
              {connected && publicKey && (
                <div className="mt-8">
                  <WalletDeletionDialog
                    walletAddress={publicKey.toBase58()}
                    onDeleteSuccess={() => {
                      showToast.success("Wallet Deleted", "All wallet data has been removed");
                    }}
                    onDeleteError={(error) => {
                      showToast.error("Deletion Failed", error.message);
                    }}
                  />
                </div>
              )}
            </div>
          ) : (
            <>
              {/* View Toggle Title - positions tab */}
              <div className="flex justify-between mb-4">
                <h1 className="text-2xl font-bold">Your Positions</h1>
              </div>

          {/* Error Message */}
          {error && (
            <div className="bg-primary/10 border border-primary rounded-lg p-4 mb-6">
              <div className="flex items-center space-x-2">
                <InfoIcon className="w-5 h-5 text-primary" />
                <span className="text-primary">{error}</span>
              </div>
            </div>
          )}

          {/* PnL Loading Indicator */}
          {loadingPnl && connected && positionsArray.length > 0 && (
            <div className="bg-blue-500/10 border border-blue-500 rounded-lg p-3 mb-4">
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                <span className="text-blue-500 text-sm">Loading PnL data...</span>
              </div>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="rounded-lg shadow-sm p-8 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-sub-text">Loading positions...</p>
            </div>
          )}

          {/* Positions List */}
          {!loading &&
            connected &&
            positionsArray.length > 0 &&
            (viewMode === "table" ? (
              <div className="overflow-x-auto styled-scrollbar">
                <table className="min-w-full divide-y divide-border border border-border rounded-xl">
                  <thead>
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Position/Pool
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Total Liquidity
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Fees Earned (Claimed)
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Current Balance
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Unclaimed Swap Fee
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Range
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="border-b border-border">
                    {positionsArray.map(([lbPairAddress, positionInfo]) =>
                      positionInfo.lbPairPositionsData.map(
                        (pos: PositionType, idx: number) => (
                          <PositionItem
                            key={`${lbPairAddress}-${idx}`}
                            lbPairAddress={lbPairAddress}
                            positionInfo={positionInfo}
                            positionIndex={idx}
                            refreshPositions={refreshPositions}
                            viewMode={viewMode}
                            pnl={pnlData.get(pos.publicKey.toBase58())}
                            onPnLUpdate={updatePnL}
                          />
                        )
                      )
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {positionsArray.map(([lbPairAddress, positionInfo]) =>
                  positionInfo.lbPairPositionsData.map(
                    (pos: PositionType, idx: number) => (
                      <PositionItem
                        key={`${lbPairAddress}-${idx}`}
                        lbPairAddress={lbPairAddress}
                        positionInfo={positionInfo}
                        positionIndex={idx}
                        refreshPositions={refreshPositions}
                        viewMode={viewMode}
                        pnl={pnlData.get(pos.publicKey.toBase58())}
                        onPnLUpdate={updatePnL}
                      />
                    )
                  )
                )}
              </div>
            ))}

          {/* Empty State */}
          {!loading && connected && positionsArray.length === 0 && (
            <div className="rounded-lg shadow-sm p-8 text-center">
              <ChartLineUpIcon className="w-12 h-12 text-white mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">
                No Positions Found
              </h3>
              <p className="text-sub-text">
                You don&apos;t have any LB pair positions yet.
              </p>
            </div>
          )}

          {/* Not Connected State */}
          {!connected && !connecting && (
            <div className="rounded-lg shadow-sm p-8 text-center">
              <WalletIcon className="w-12 h-12 text-white mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">
                Connect Your Wallet
              </h3>
              <p className="text-sub-text">
                Please connect your wallet to view your LB pair positions.
              </p>
            </div>
          )}
            </>
          )}
        </div>
      </div>
    </PageTemplate>
  );
};

export default WalletPage;
