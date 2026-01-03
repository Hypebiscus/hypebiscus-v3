import React, { useMemo } from 'react';
import { ChartLineUpIcon } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/utils/showToast';
import type { PositionPnLResult, UserTierInfo } from '@/lib/mcp-client';

interface PortfolioTotals {
  totalPnlUsd: number;
  totalPnlPercent: number;
  totalFeesEarnedUsd: number;
  totalRewardsEarnedUsd: number;
  totalImpermanentLossUsd: number;
  totalDepositValueUsd: number;
  totalCurrentValueUsd: number;
  activePositionsCount: number;
}

interface PortfolioSummaryProps {
  pnlData: Map<string, PositionPnLResult>;
  loadingPnl: boolean;
  loading: boolean;
  userTier: UserTierInfo | null;
}

function calculatePortfolioTotals(pnlData: Map<string, PositionPnLResult>): PortfolioTotals {
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

  const totalPnlPercent =
    totalDepositValueUsd > 0 ? (totalPnlUsd / totalDepositValueUsd) * 100 : 0;

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
}

function UserTierBadge({ tier }: { tier: UserTierInfo }) {
  const badgeClass =
    tier.tier === 'premium'
      ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 text-yellow-400 border border-yellow-500/30'
      : tier.tier === 'credits'
      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
      : 'bg-gray-700/50 text-gray-400 border border-gray-600';

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${badgeClass}`}>
      {tier.tier === 'premium' && '👑 Premium'}
      {tier.tier === 'credits' && `💳 ${tier.creditBalance} Credits`}
      {tier.tier === 'free' && '🆓 Free'}
    </span>
  );
}

function UpgradePrompt() {
  return (
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
                showToast.info('Coming Soon', 'Premium subscription page is under development');
              }}
            >
              👑 Subscribe ($9.99/mo)
            </Button>
            <Button
              variant="outline"
              className="border-blue-500 text-blue-400 hover:bg-blue-500/10"
              onClick={() => {
                showToast.info('Coming Soon', 'Credits purchase page is under development');
              }}
            >
              💳 Buy Credits
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PnLCards({ totals }: { totals: PortfolioTotals }) {
  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
      {/* Total Portfolio Value */}
      <Card className="bg-gray-900/50 border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-gray-400">Total Value</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-white">
            ${totals.totalCurrentValueUsd.toFixed(2)}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Deposited: ${totals.totalDepositValueUsd.toFixed(2)}
          </p>
        </CardContent>
      </Card>

      {/* Total PnL */}
      <Card className="bg-gray-900/50 border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-gray-400">Total PnL</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold ${
              totals.totalPnlUsd >= 0 ? 'text-green-500' : 'text-red-500'
            }`}
          >
            {totals.totalPnlUsd >= 0 ? '+' : ''}${totals.totalPnlUsd.toFixed(2)}
          </div>
          <p
            className={`text-xs mt-2 ${
              totals.totalPnlPercent >= 0 ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {totals.totalPnlPercent >= 0 ? '+' : ''}
            {totals.totalPnlPercent.toFixed(2)}%
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
            ${totals.totalFeesEarnedUsd.toFixed(2)}
          </div>
          <p className="text-xs text-gray-500 mt-2">Swap fees</p>
        </CardContent>
      </Card>

      {/* Total Rewards - only show if > 0 */}
      {totals.totalRewardsEarnedUsd > 0 && (
        <Card className="bg-gray-900/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Rewards</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              ${totals.totalRewardsEarnedUsd.toFixed(2)}
            </div>
            <p className="text-xs text-gray-500 mt-2">Trading rewards</p>
          </CardContent>
        </Card>
      )}

      {/* Total Impermanent Loss */}
      <Card className="bg-gray-900/50 border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-gray-400">
            Impermanent Loss
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold ${
              totals.totalImpermanentLossUsd >= 0 ? 'text-green-500' : 'text-red-500'
            }`}
          >
            {totals.totalImpermanentLossUsd >= 0 ? '+' : ''}$
            {Math.abs(totals.totalImpermanentLossUsd).toFixed(2)}
          </div>
          <p className="text-xs text-gray-500 mt-2">vs. HODL</p>
        </CardContent>
      </Card>

      {/* Active Positions */}
      <Card className="bg-gray-900/50 border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-gray-400">
            Active Positions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-white">
            {totals.activePositionsCount}
          </div>
          <p className="text-xs text-gray-500 mt-2">BTC pools</p>
        </CardContent>
      </Card>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6 animate-pulse">
      {[...Array(6)].map((_, i) => (
        <Card key={i} className="bg-gray-900/50 border-border">
          <CardHeader className="pb-2">
            <div className="h-4 bg-gray-700 rounded w-24" />
          </CardHeader>
          <CardContent>
            <div className="h-8 bg-gray-700 rounded w-32 mb-2" />
            <div className="h-3 bg-gray-800 rounded w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function PortfolioSummary({ pnlData, loadingPnl, loading, userTier }: PortfolioSummaryProps) {
  const portfolioTotals = useMemo(() => calculatePortfolioTotals(pnlData), [pnlData]);

  // Only hide if not loading and truly no data
  if (!loading && !loadingPnl && pnlData.size === 0) {
    return null;
  }

  return (
    <div className="space-y-4 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <ChartLineUpIcon size={28} className="text-primary" weight="fill" />
            Portfolio Performance
          </h2>
          {userTier && <UserTierBadge tier={userTier} />}
        </div>
        {(loading || loadingPnl) && (
          <span className="text-sm text-gray-400">
            {loading ? 'Loading positions...' : 'Calculating PnL...'}
          </span>
        )}
      </div>

      {/* Loading State */}
      {(loading || loadingPnl) && <LoadingSkeleton />}

      {/* Free User - Upgrade Prompt */}
      {!loading && !loadingPnl && userTier && !userTier.canAccessFullPnL && <UpgradePrompt />}

      {/* Premium/Credits Users - Full PnL Display */}
      {!loading && !loadingPnl && userTier && userTier.canAccessFullPnL && <PnLCards totals={portfolioTotals} />}
    </div>
  );
}
