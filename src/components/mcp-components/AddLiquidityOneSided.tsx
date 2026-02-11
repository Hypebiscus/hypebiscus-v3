"use client";

import React, { useState, useCallback } from 'react';
import { useWallet, useConnection } from '@/hooks/useAppKitWallet';
import { PublicKey, Keypair } from '@solana/web3.js';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/utils/showToast';
import DLMM, { StrategyType } from '@meteora-ag/dlmm';
import BN from 'bn.js';

interface AddLiquidityOneSidedProps {
  poolAddress: string;
  tokenSymbol: 'zBTC' | 'SOL';
  onSuccess?: () => void;
}

export function AddLiquidityOneSided({
  poolAddress,
  tokenSymbol,
  onSuccess
}: AddLiquidityOneSidedProps) {
  const { connection } = useConnection();
  const { publicKey, signAllTransactions } = useWallet();

  const [amount, setAmount] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [slippage, setSlippage] = useState('1'); // 1% default

  const handleAddLiquidity = useCallback(async () => {
    if (!publicKey || !signAllTransactions) {
      showToast.error('Wallet Required', 'Please connect your wallet first');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      showToast.error('Invalid Amount', 'Please enter a valid amount');
      return;
    }

    setIsAdding(true);

    try {
      showToast.info('Creating Position', 'Initializing one-sided liquidity position...');

      // Create DLMM pool instance
      const poolPubkey = new PublicKey(poolAddress);
      const dlmmPool = await DLMM.create(connection, poolPubkey);

      // Convert amount to lamports/smallest unit
      const decimals = tokenSymbol === 'zBTC' ? 8 : 9;
      const amountInSmallestUnit = new BN(
        Math.floor(parseFloat(amount) * Math.pow(10, decimals))
      );

      // Get active bin for price reference
      const activeBin = await dlmmPool.getActiveBin();
      const activeBinId = activeBin.binId;

      // Calculate distribution parameters for one-sided liquidity
      const isTokenX = tokenSymbol === 'zBTC';

      // FIXED: Create a NEW position keypair instead of using PublicKey.default
      // This keypair will be owned by the DLMM program, not the NativeLoader
      const newPositionKeypair = new Keypair();
      console.log('Created new position keypair:', newPositionKeypair.publicKey.toString());

      // CRITICAL FIX: Correct one-sided liquidity bin placement
      // For DLMM pools:
      // - TokenX (zBTC) liquidity should be placed ABOVE current price (users sell X for Y as price rises)
      // - TokenY (SOL) liquidity should be placed BELOW current price (users sell Y for X as price falls)
      //
      // This is opposite of traditional thinking because:
      // - When price moves UP, X holders sell X → liquidity should be ABOVE
      // - When price moves DOWN, Y holders sell Y → liquidity should be BELOW
      const binRange = 10; // Spread across 10 bins

      let minBinId: number;
      let maxBinId: number;

      if (isTokenX) {
        // zBTC (tokenX): Place ABOVE current price
        minBinId = activeBinId + 1; // Start just above active bin
        maxBinId = activeBinId + binRange;
      } else {
        // SOL (tokenY): Place BELOW current price
        minBinId = activeBinId - binRange;
        maxBinId = activeBinId - 1; // End just below active bin
      }

      // Ensure minBinId is not negative
      if (minBinId < 0) {
        minBinId = 0;
        maxBinId = binRange;
      }

      console.log('One-sided position parameters:', {
        isTokenX,
        tokenSymbol,
        side: isTokenX ? 'ABOVE (ask)' : 'BELOW (bid)',
        activeBinId,
        minBinId,
        maxBinId,
        binRange: maxBinId - minBinId,
        amountInSmallestUnit: amountInSmallestUnit.toString()
      });

      // Convert slippage to basis points (1% = 100 bps)
      const slippageBps = Math.floor(parseFloat(slippage) * 100);

      // FIXED: Use initializePositionAndAddLiquidityByStrategy for NEW positions
      // This is the correct method for creating a position that doesn't exist yet
      const createPositionTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: newPositionKeypair.publicKey, // Use the NEW keypair's public key
        user: publicKey,
        totalXAmount: isTokenX ? amountInSmallestUnit : new BN(0),
        totalYAmount: !isTokenX ? amountInSmallestUnit : new BN(0),
        strategy: {
          maxBinId,
          minBinId,
          strategyType: StrategyType.BidAsk // BidAsk strategy for one-sided liquidity
        },
        slippage: slippageBps, // Pass slippage in basis points
      });

      console.log('Position creation transaction prepared');

      // Handle both single transaction and transaction array responses
      const transactions = Array.isArray(createPositionTx) ? createPositionTx : [createPositionTx];

      // Get recent blockhash for all transactions
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');

      // Set blockhash and fee payer for all transactions
      transactions.forEach(tx => {
        tx.recentBlockhash = blockhash;
        tx.lastValidBlockHeight = lastValidBlockHeight;
        tx.feePayer = publicKey;
      });

      // FIXED: Sign transactions in correct order
      // 1. First, partially sign with position keypair (must sign BEFORE wallet)
      transactions.forEach(tx => {
        tx.partialSign(newPositionKeypair);
      });

      // 2. Then sign with wallet (this adds the user's signature)
      const signedTxs = await signAllTransactions(transactions);

      console.log('Transactions signed, sending to network...');

      // Send and confirm all transactions
      const txIds: string[] = [];
      for (const signedTx of signedTxs) {
        const txId = await connection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
          preflightCommitment: 'confirmed'
        });
        txIds.push(txId);

        console.log('Transaction sent:', txId);
        console.log('Explorer link:', `https://solscan.io/tx/${txId}`);

        // Wait for confirmation
        const confirmation = await connection.confirmTransaction({
          signature: txId,
          blockhash,
          lastValidBlockHeight
        }, 'confirmed');

        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        console.log('Transaction confirmed:', txId);
      }

      showToast.success(
        'Liquidity Added Successfully!',
        `Added ${amount} ${tokenSymbol} as one-sided liquidity. Position: ${newPositionKeypair.publicKey.toString().slice(0, 8)}...`
      );

      console.log('Full position address:', newPositionKeypair.publicKey.toString());
      console.log('View on Solscan:', `https://solscan.io/account/${newPositionKeypair.publicKey.toString()}`);

      // Reset form
      setAmount('');

      // Call success callback
      if (onSuccess) {
        onSuccess();
      }

    } catch (error) {
      console.error('Add liquidity error:', error);

      let errorMessage = 'Failed to add liquidity';
      if (error instanceof Error) {
        if (error.message.includes('User rejected') || error.message.includes('rejected the request')) {
          errorMessage = 'Transaction rejected by user';
        } else if (error.message.includes('insufficient') || error.message.includes('Insufficient')) {
          errorMessage = 'Insufficient balance. Check your token and SOL balance.';
        } else if (error.message.includes('AccountOwnedByWrongProgram')) {
          errorMessage = 'Account ownership error. Please try again or contact support.';
        } else if (error.message.includes('blockhash not found')) {
          errorMessage = 'Transaction expired. Please try again.';
        } else if (error.message.includes('0x1')) {
          errorMessage = 'Insufficient funds for transaction fee.';
        } else if (error.message.includes('0x1771')) {
          errorMessage = 'Invalid account data. Pool may not be initialized correctly.';
        } else {
          errorMessage = error.message;
        }
      }

      showToast.error('Transaction Failed', errorMessage);
    } finally {
      setIsAdding(false);
    }
  }, [
    publicKey,
    signAllTransactions,
    connection,
    poolAddress,
    amount,
    tokenSymbol,
    slippage,
    onSuccess
  ]);

  return (
    <div className="space-y-4 p-6 bg-gray-800 rounded-lg border border-gray-700">
      <div>
        <h3 className="text-lg font-semibold text-white mb-2">
          Add One-Sided Liquidity ({tokenSymbol})
        </h3>
        <p className="text-sm text-gray-400 mb-4">
          Add liquidity using only {tokenSymbol}. The position will be placed on one side of the current price.
        </p>
      </div>

      <div className="space-y-4">
        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Amount ({tokenSymbol})
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
            placeholder={`0.00 ${tokenSymbol}`}
            className="w-full bg-gray-900 border border-gray-700 text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            disabled={isAdding}
            step={tokenSymbol === 'zBTC' ? '0.00000001' : '0.001'}
            min="0"
          />
          <p className="text-xs text-gray-500 mt-1">
            {tokenSymbol === 'zBTC'
              ? 'Minimum: 0.00000001 zBTC'
              : 'Minimum: 0.001 SOL'}
          </p>
        </div>

        {/* Slippage Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Slippage Tolerance (%)
          </label>
          <div className="flex gap-2">
            {['0.5', '1', '2', '5'].map((value) => (
              <Button
                key={value}
                variant={slippage === value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSlippage(value)}
                disabled={isAdding}
                className="flex-1"
              >
                {value}%
              </Button>
            ))}
            <input
              type="number"
              value={slippage}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSlippage(e.target.value)}
              placeholder="Custom"
              className="w-24 bg-gray-900 border border-gray-700 text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={isAdding}
              step="0.1"
              min="0.1"
              max="100"
            />
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-blue-400 mb-2">
            One-Sided Liquidity Info
          </h4>
          <ul className="text-xs text-gray-400 space-y-1">
            <li>• New position will be created on one side of the current price</li>
            <li>• {tokenSymbol === 'zBTC'
              ? 'zBTC will be placed ABOVE current price (ask side) - sells as price rises'
              : 'SOL will be placed BELOW current price (bid side) - sells as price falls'
            }</li>
            <li>• You will earn fees when price moves through your liquidity range</li>
            <li>• Lower risk of impermanent loss compared to balanced liquidity</li>
            <li>• Position account rent (~0.057 SOL) will be refunded when you close the position</li>
          </ul>
        </div>

        {/* Add Liquidity Button */}
        <Button
          onClick={handleAddLiquidity}
          disabled={isAdding || !publicKey || !amount || parseFloat(amount) <= 0}
          className="w-full"
          size="lg"
        >
          {isAdding ? (
            <>
              <span className="animate-spin mr-2">⏳</span>
              Creating Position...
            </>
          ) : (
            `Add ${tokenSymbol} Liquidity`
          )}
        </Button>

        {!publicKey && (
          <p className="text-sm text-yellow-500 text-center">
            Please connect your wallet to add liquidity
          </p>
        )}
      </div>
    </div>
  );
}
