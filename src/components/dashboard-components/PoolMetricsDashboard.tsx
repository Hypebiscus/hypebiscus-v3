"use client";

import React, { useEffect, useState } from 'react';
import { mcpClient, PoolMetrics } from '@/lib/services/mcpClient';
import { useWallet } from '@solana/wallet-adapter-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendUp, TrendDown, ChartLine, Lightning, CurrencyDollar, ArrowsClockwise } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface PriceChangeProps {
  value: number;
}

const PriceChange: React.FC<PriceChangeProps> = ({ value }) => {
  const isPositive = value >= 0;
  const Icon = isPositive ? TrendUp : TrendDown;
  const colorClass = isPositive ? 'text-green-400' : 'text-red-400';

  return (
    <div className={`flex items-center gap-1 ${colorClass}`}>
      <Icon size={16} weight="bold" />
      <span className="text-sm font-medium">
        {isPositive ? '+' : ''}{value.toFixed(2)}%
      </span>
    </div>
  );
};

interface MetricCardProps {
  title: string;
  value: string;
  change?: number;
  icon: React.ReactNode;
  description?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, change, icon, description }) => (
  <Card className="bg-gray-900/50 border-border">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-gray-400">{title}</CardTitle>
      <div className="text-primary">{icon}</div>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold text-white">{value}</div>
      {change !== undefined && (
        <div className="mt-1">
          <PriceChange value={change} />
        </div>
      )}
      {description && (
        <p className="text-xs text-gray-500 mt-2">{description}</p>
      )}
    </CardContent>
  </Card>
);

const PoolMetricsDashboard: React.FC = () => {
  const { connected, publicKey } = useWallet();
  const [poolData, setPoolData] = useState<PoolMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const fetchPoolMetrics = async () => {
    try {
      setError(null);
      const data = await mcpClient.getPoolMetrics();
      setPoolData(data);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Failed to fetch pool metrics:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch pool data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPoolMetrics();

    // Refresh every 30 seconds
    const interval = setInterval(fetchPoolMetrics, 30000);

    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    const is502Error = error.includes('502');
    const errorMessage = is502Error
      ? '🔄 MCP server is waking up from sleep (Render free tier). This may take 30-60 seconds...'
      : `⚠️ ${error}`;

    return (
      <Alert variant={is502Error ? "default" : "destructive"}>
        <AlertDescription className="flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            onClick={fetchPoolMetrics}
            className="text-sm underline hover:no-underline"
            disabled={loading}
          >
            {loading ? 'Retrying...' : 'Retry'}
          </button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!poolData) {
    return (
      <Alert>
        <AlertDescription>No pool data available</AlertDescription>
      </Alert>
    );
  }

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(2)}K`;
    }
    return `$${value.toFixed(2)}`;
  };

  const solPrice = poolData.prices.SOL?.usd || 0;
  const solChange = poolData.prices.SOL?.change24h || 0;
  const zbtcPrice = poolData.prices.zBTC?.usd || 0;
  const zbtcChange = poolData.prices.zBTC?.change24h || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Lightning size={28} className="text-primary" weight="fill" />
            {poolData.poolName} Pool
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Live metrics from Render MCP • Updated {lastUpdate.toLocaleTimeString()}
          </p>
        </div>
        <button
          onClick={fetchPoolMetrics}
          className="text-sm text-primary hover:text-primary/80 flex items-center gap-1"
        >
          <ArrowsClockwise size={16} weight="bold" />
          Refresh
        </button>
      </div>

      {/* Main Metrics Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Annual APY"
          value={`${poolData.metrics.apy.toFixed(2)}%`}
          icon={<ChartLine size={20} weight="bold" />}
          description={poolData.metrics.apy > 20 ? "High yield potential" : "Moderate returns"}
        />

        <MetricCard
          title="24h Fees"
          value={formatCurrency(poolData.metrics.fees24h)}
          icon={<CurrencyDollar size={20} weight="bold" />}
          description="Total fees collected"
        />

        <MetricCard
          title="24h Volume"
          value={formatCurrency(poolData.metrics.volume24h)}
          icon={<TrendUp size={20} weight="bold" />}
          description="Trading activity"
        />

        <MetricCard
          title="Total Liquidity"
          value={formatCurrency(poolData.liquidity.totalUSD)}
          icon={<Lightning size={20} weight="bold" />}
          description={`Active Bin: ${poolData.metrics.activeBin}`}
        />
      </div>

      {/* Token Prices */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-gradient-to-br from-blue-500/10 to-transparent border-blue-500/30">
          <CardHeader>
            <CardTitle className="text-white flex items-center justify-between">
              <span>SOL Price</span>
              {solChange !== 0 && <PriceChange value={solChange} />}
            </CardTitle>
            <CardDescription className="text-gray-400">
              Powered by Jupiter API
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {solPrice > 0 ? formatCurrency(solPrice) : 'Loading...'}
            </div>
            <div className="text-sm text-gray-400 mt-2">
              {poolData.liquidity.tokenB.amount.toFixed(2)} SOL in pool
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500/10 to-transparent border-orange-500/30">
          <CardHeader>
            <CardTitle className="text-white flex items-center justify-between">
              <span>zBTC Price</span>
              {zbtcChange !== 0 && <PriceChange value={zbtcChange} />}
            </CardTitle>
            <CardDescription className="text-gray-400">
              Powered by Jupiter API
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {zbtcPrice > 0 ? formatCurrency(zbtcPrice) : 'Loading...'}
            </div>
            <div className="text-sm text-gray-400 mt-2">
              {poolData.liquidity.tokenA.amount.toFixed(4)} zBTC in pool
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Recommendation */}
      {poolData.recommendation && (
        <Card className="bg-primary/5 border-primary/30">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Lightning size={20} className="text-primary" weight="fill" />
              AI Recommendation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-300 text-sm leading-relaxed">
              {poolData.recommendation}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Connected Wallet Notice */}
      {connected && publicKey && (
        <Alert className="bg-green-500/10 border-green-500/30">
          <AlertDescription className="text-green-400">
            ✅ Wallet connected: {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
            <br />
            <span className="text-sm text-gray-400">
              You can now track your positions and enable auto-repositioning
            </span>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

export default PoolMetricsDashboard;
