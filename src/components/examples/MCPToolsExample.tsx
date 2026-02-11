'use client';

/**
 * MCP Tools Integration Example
 *
 * Demonstrates how to use MCP tools from React components
 * Shows pool metrics, position data, and rebalancing analysis
 */

import { useState } from 'react';
import { useWallet } from '@/hooks/useAppKitWallet';
import { mcpClient } from '@/lib/mcp-client';

export function MCPToolsExample() {
  const { publicKey } = useWallet();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGetPoolMetrics() {
    setLoading(true);
    setError(null);

    try {
      const metrics = await mcpClient.getPoolMetrics({
        poolAddress: '2onAYHGyxUV4JuYeUQbFwbKmKUXyTA9v5aKiDgZMyCeL',
        walletAddress: publicKey?.toBase58()
      });

      setResult(metrics);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function handleGetUserPositions() {
    if (!publicKey) {
      setError('Wallet not connected');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const positions = await mcpClient.getUserPositions({
        walletAddress: publicKey.toBase58(),
        includeInactive: false
      });

      setResult(positions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function handleGetBinDistribution() {
    setLoading(true);
    setError(null);

    try {
      const distribution = await mcpClient.getBinDistribution({
        poolAddress: '2onAYHGyxUV4JuYeUQbFwbKmKUXyTA9v5aKiDgZMyCeL',
        rangeSize: 50,
        includeEmptyBins: false
      });

      setResult(distribution);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function handleGetWalletPerformance() {
    if (!publicKey) {
      setError('Wallet not connected');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const performance = await mcpClient.getWalletPerformance({
        walletAddress: publicKey.toBase58()
      });

      setResult(performance);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function handleHealthCheck() {
    setLoading(true);
    setError(null);

    try {
      const health = await mcpClient.healthCheck();
      setResult(health);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-4">MCP Tools Example</h2>
        <p className="text-gray-600 dark:text-gray-400">
          Demonstrates integration with MCP server via HTTP bridge
        </p>
      </div>

      {/* Tool Buttons */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <button
          onClick={handleHealthCheck}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          Health Check
        </button>

        <button
          onClick={handleGetPoolMetrics}
          disabled={loading}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
        >
          Get Pool Metrics
        </button>

        <button
          onClick={handleGetBinDistribution}
          disabled={loading}
          className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50"
        >
          Get Bin Distribution
        </button>

        <button
          onClick={handleGetUserPositions}
          disabled={loading || !publicKey}
          className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
        >
          Get User Positions
        </button>

        <button
          onClick={handleGetWalletPerformance}
          disabled={loading || !publicKey}
          className="px-4 py-2 bg-pink-500 text-white rounded hover:bg-pink-600 disabled:opacity-50"
        >
          Get Wallet Performance
        </button>
      </div>

      {/* Wallet Status */}
      <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded">
        <p className="text-sm">
          <strong>Wallet Status:</strong>{' '}
          {publicKey ? (
            <span className="text-green-600 dark:text-green-400">
              Connected ({publicKey.toBase58().slice(0, 8)}...)
            </span>
          ) : (
            <span className="text-red-600 dark:text-red-400">
              Not Connected
            </span>
          )}
        </p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
          <p className="text-blue-600 dark:text-blue-400">Loading...</p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
          <p className="text-red-600 dark:text-red-400">
            <strong>Error:</strong> {error}
          </p>
        </div>
      )}

      {/* Result Display */}
      {result && !loading && (
        <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded">
          <h3 className="font-semibold mb-2 text-green-600 dark:text-green-400">
            Result:
          </h3>
          <pre className="text-xs overflow-auto max-h-96 p-4 bg-white dark:bg-gray-900 rounded">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

      {/* Usage Instructions */}
      <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-800 rounded">
        <h3 className="font-semibold mb-2">Usage Notes:</h3>
        <ul className="text-sm space-y-1 list-disc list-inside text-gray-600 dark:text-gray-400">
          <li>Health Check: Tests MCP bridge connectivity</li>
          <li>Pool Metrics: Real-time DLMM pool data and APY</li>
          <li>Bin Distribution: Liquidity concentration analysis</li>
          <li>User Positions: Requires wallet connection</li>
          <li>Wallet Performance: Requires wallet connection</li>
        </ul>
      </div>

      {/* Important Note */}
      <div className="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded">
        <h3 className="font-semibold mb-2 text-yellow-600 dark:text-yellow-400">
          Important:
        </h3>
        <p className="text-sm text-yellow-600 dark:text-yellow-400">
          MCP tools are READ-ONLY. To add liquidity or perform transactions,
          use the wallet adapter and Meteora SDK directly. MCP provides
          analytics and decision support only.
        </p>
      </div>
    </div>
  );
}
