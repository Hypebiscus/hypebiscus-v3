/**
 * Reposition Modal Component
 * Allows users to reposition out-of-range DLMM positions
 */

import React, { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';
import { Button } from '@/components/ui/button';
import { mcpClient } from '@/lib/services/mcpClient';
import { showToast } from '@/lib/utils/showToast';
import type {
  RepositionRecommendation,
  RepositionStrategy,
  UnsignedRepositionTransaction,
} from '@/types/reposition';
import { X, ArrowRight, Warning, CheckCircle } from '@phosphor-icons/react';

interface RepositionModalProps {
  positionId: string;
  poolAddress?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function RepositionModal({
  positionId,
  poolAddress,
  onClose,
  onSuccess,
}: RepositionModalProps) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const [step, setStep] = useState<'analysis' | 'config' | 'preview' | 'signing'>('analysis');
  const [loading, setLoading] = useState(false);
  const [recommendation, setRecommendation] = useState<RepositionRecommendation | null>(null);

  // Configuration state
  const [selectedStrategy, setSelectedStrategy] = useState<RepositionStrategy>('balanced');
  const [binRange, setBinRange] = useState(10);
  const [slippage, setSlippage] = useState(1.0); // 1% default

  // Transaction state
  const [unsignedTx, setUnsignedTx] = useState<UnsignedRepositionTransaction | null>(null);

  // Load analysis on mount
  useEffect(() => {
    loadAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionId]);

  const loadAnalysis = async () => {
    setLoading(true);
    try {
      const result = await mcpClient.analyzeReposition(positionId, poolAddress);
      const analysis = result as RepositionRecommendation;
      setRecommendation(analysis);
      setSelectedStrategy(analysis.recommendedStrategy);
      setStep('config');
    } catch (error) {
      showToast.error('Analysis Failed', error instanceof Error ? error.message : 'Unknown error');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handlePrepare = async () => {
    if (!publicKey || !recommendation) return;

    setLoading(true);
    setStep('preview');

    try {
      const result = await mcpClient.prepareReposition({
        positionAddress: positionId,
        walletAddress: publicKey.toBase58(),
        poolAddress,
        strategy: selectedStrategy,
        binRange,
        slippage: slippage * 100, // Convert to bps
      });

      setUnsignedTx(result as UnsignedRepositionTransaction);
    } catch (error) {
      showToast.error('Preparation Failed', error instanceof Error ? error.message : 'Unknown error');
      setStep('config');
    } finally {
      setLoading(false);
    }
  };

  const handleSign = async () => {
    if (!unsignedTx || !publicKey || !signTransaction) return;

    setLoading(true);
    setStep('signing');

    try {
      // Decode transaction
      const tx = Transaction.from(Buffer.from(unsignedTx.transaction, 'base64'));

      // Add recent blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      // Sign transaction
      const signedTx = await signTransaction(tx);

      // Send transaction
      const signature = await connection.sendRawTransaction(signedTx.serialize());

      // Confirm transaction
      showToast.info('Transaction Sent', 'Waiting for confirmation...');
      await connection.confirmTransaction(signature, 'confirmed');

      showToast.success(
        'Position Repositioned!',
        `Transaction: ${signature.slice(0, 8)}...${signature.slice(-8)}`
      );

      onSuccess();
      onClose();
    } catch (error) {
      showToast.error('Transaction Failed', error instanceof Error ? error.message : 'Unknown error');
      setStep('preview');
    } finally {
      setLoading(false);
    }
  };

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'high':
        return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'medium':
        return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'low':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      default:
        return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
    }
  };

  const getStrategyLabel = (strategy: RepositionStrategy) => {
    switch (strategy) {
      case 'one-sided-x':
        return 'One-Sided zBTC';
      case 'one-sided-y':
        return 'One-Sided SOL';
      case 'balanced':
        return 'Balanced (50/50)';
    }
  };

  if (loading && step === 'analysis') {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
        <div className="bg-gray-900 border border-border rounded-lg p-8 max-w-md w-full mx-4">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="text-white text-lg">Analyzing position...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!recommendation) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 overflow-y-auto p-4">
      <div className="bg-gray-900 border border-border rounded-lg max-w-2xl w-full my-8">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-2xl font-bold text-white">Reposition Liquidity</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            disabled={loading}
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Analysis Summary */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-white mb-3">Position Analysis</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-card rounded-lg p-4 border border-border">
                <div className="text-sm text-gray-400 mb-1">Current Status</div>
                <div className="flex items-center gap-2">
                  <Warning size={20} className="text-red-400" />
                  <span className="text-white font-medium">{recommendation.reason}</span>
                </div>
              </div>
              <div className="bg-card rounded-lg p-4 border border-border">
                <div className="text-sm text-gray-400 mb-1">Urgency</div>
                <div className={`inline-flex items-center px-3 py-1 rounded-full border ${getUrgencyColor(recommendation.urgency)}`}>
                  <span className="font-medium uppercase">{recommendation.urgency}</span>
                </div>
              </div>
              <div className="bg-card rounded-lg p-4 border border-border">
                <div className="text-sm text-gray-400 mb-1">Distance from Range</div>
                <div className="text-white font-medium">{recommendation.distanceFromRange} bins</div>
              </div>
              <div className="bg-card rounded-lg p-4 border border-border">
                <div className="text-sm text-gray-400 mb-1">Est. Gas Cost</div>
                <div className="text-white font-medium">{recommendation.estimatedGasCost.toFixed(4)} SOL</div>
              </div>
            </div>
          </div>

          {/* Bin Range Visualization */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-white mb-3">Bin Range Update</h3>
            <div className="bg-card rounded-lg p-4 border border-border">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="text-sm text-gray-400 mb-1">Current Range</div>
                  <div className="text-white font-mono">
                    {recommendation.positionRange.min} - {recommendation.positionRange.max}
                  </div>
                </div>
                <ArrowRight size={24} className="text-primary mx-4" />
                <div className="flex-1">
                  <div className="text-sm text-gray-400 mb-1">New Range</div>
                  <div className="text-white font-mono">
                    {recommendation.recommendedBinRange.min} - {recommendation.recommendedBinRange.max}
                  </div>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-border">
                <div className="text-sm text-gray-400">Active Bin: <span className="text-primary font-mono">{recommendation.currentActiveBin}</span></div>
              </div>
            </div>
          </div>

          {/* Configuration */}
          {(step === 'config' || step === 'preview') && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-white mb-3">Configuration</h3>
              <div className="space-y-4">
                {/* Strategy Selection */}
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Strategy</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['balanced', 'one-sided-x', 'one-sided-y'] as RepositionStrategy[]).map((strategy) => (
                      <button
                        key={strategy}
                        onClick={() => setSelectedStrategy(strategy)}
                        disabled={step !== 'config'}
                        className={`px-4 py-2 rounded-lg border transition-colors ${
                          selectedStrategy === strategy
                            ? 'bg-primary border-primary text-white'
                            : 'bg-card border-border text-gray-400 hover:border-primary/50'
                        } ${step !== 'config' ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <div className="text-sm font-medium">{getStrategyLabel(strategy)}</div>
                        {strategy === recommendation.recommendedStrategy && (
                          <div className="text-xs text-primary mt-1">Recommended</div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Bin Range */}
                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    Bin Range: {binRange} bins
                  </label>
                  <input
                    type="range"
                    min="5"
                    max="30"
                    step="1"
                    value={binRange}
                    onChange={(e) => setBinRange(Number(e.target.value))}
                    disabled={step !== 'config'}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Narrow (5)</span>
                    <span>Wide (30)</span>
                  </div>
                </div>

                {/* Slippage */}
                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    Slippage Tolerance: {slippage}%
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[0.5, 1.0, 2.0, 5.0].map((value) => (
                      <button
                        key={value}
                        onClick={() => setSlippage(value)}
                        disabled={step !== 'config'}
                        className={`px-3 py-2 rounded-lg border transition-colors ${
                          slippage === value
                            ? 'bg-primary border-primary text-white'
                            : 'bg-card border-border text-gray-400 hover:border-primary/50'
                        } ${step !== 'config' ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {value}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Transaction Preview */}
          {step === 'preview' && unsignedTx && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-white mb-3">Transaction Preview</h3>
              <div className="bg-card rounded-lg p-4 border border-border space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-400">Liquidity to Recover</span>
                  <span className="text-white">
                    ${unsignedTx.metadata.estimatedLiquidityRecovered.totalUSD.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">New Bin Range</span>
                  <span className="text-white font-mono">
                    {unsignedTx.metadata.newBinRange.min} - {unsignedTx.metadata.newBinRange.max}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Strategy</span>
                  <span className="text-white">{getStrategyLabel(unsignedTx.metadata.strategy)}</span>
                </div>
                <div className="pt-3 border-t border-border">
                  <div className="flex items-center gap-2 text-sm text-blue-400">
                    <CheckCircle size={16} />
                    <span>Transaction prepared. Ready to sign.</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-border">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>

          {step === 'config' && (
            <Button onClick={handlePrepare} disabled={loading}>
              {loading ? 'Preparing...' : 'Preview Transaction'}
            </Button>
          )}

          {step === 'preview' && (
            <Button onClick={handleSign} disabled={loading}>
              {loading ? 'Signing...' : 'Sign & Execute'}
            </Button>
          )}

          {step === 'signing' && (
            <Button disabled>
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Processing...
              </div>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
