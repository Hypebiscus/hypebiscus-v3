import DLMM from '@meteora-ag/dlmm';
import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import { StrategyType } from '@meteora-ag/dlmm';
import { PoolStatus } from '../types';

const BUFFER_BINS = 2;
const REPOSITION_COOLDOWN_MS = 300000;
const MAX_CREATE_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

export class DlmmService {
  private connection: Connection;
  private pool: DLMM | null = null;
  private lastRepositionTime = new Map<string, number>();

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  async initializePool(): Promise<void> {
    if (this.pool) return;

    try {
      const poolAddress = process.env.ZBTC_SOL_POOL_ADDRESS;
      
      if (!poolAddress || poolAddress.trim() === '') {
        throw new Error('ZBTC_SOL_POOL_ADDRESS not configured in .env file');
      }
      
      console.log(`🔍 Connecting to pool: ${poolAddress}`);
      const poolPubkey = new PublicKey(poolAddress);
      
      this.pool = await DLMM.create(this.connection, poolPubkey);
      console.log('✅ DLMM Pool connected successfully');
      
      const activeBin = await this.pool.getActiveBin();
      console.log(`📊 Active Bin ID: ${activeBin.binId}`);
      console.log(`💰 Active Bin Price: ${activeBin.price}`);
    } catch (error) {
      console.error('❌ Failed to connect to pool:', error);
      throw error;
    }
  }

  async getPoolStatus(): Promise<PoolStatus> {
    await this.initializePool();
    if (!this.pool) throw new Error('Pool not initialized');

    const activeBin = await this.pool.getActiveBin();
    
    return {
      currentPrice: parseFloat(activeBin.price),
      activeBinId: activeBin.binId,
      priceChange24h: 0,
      totalLiquidity: activeBin.xAmount.toString()
    };
  }

  async isPositionOutOfRange(
    positionId: string,
    bufferBins: number = BUFFER_BINS
  ): Promise<boolean> {
    await this.initializePool();
    if (!this.pool) throw new Error('Pool not initialized');

    try {
      const positionPubkey = new PublicKey(positionId);
      const position = await this.pool.getPosition(positionPubkey);
      const activeBin = await this.pool.getActiveBin();
      
      if (!position || !position.positionData) {
        console.log(`⚠️ Position not found: ${positionId}`);
        return true;
      }

      const positionBins = position.positionData.positionBinData || [];
      if (positionBins.length === 0) {
        console.log(`⚠️ Position has no bins: ${positionId}`);
        return true;
      }

      const minBinId = Math.min(...positionBins.map((bin: any) => bin.binId));
      const maxBinId = Math.max(...positionBins.map((bin: any) => bin.binId));
      
      const effectiveMinBin = minBinId - bufferBins;
      const effectiveMaxBin = maxBinId + bufferBins;
      
      const isOutOfRange = 
        activeBin.binId < effectiveMinBin ||
        activeBin.binId > effectiveMaxBin;
      
      let distanceFromPosition = 0;
      if (activeBin.binId < minBinId) {
        distanceFromPosition = minBinId - activeBin.binId;
      } else if (activeBin.binId > maxBinId) {
        distanceFromPosition = activeBin.binId - maxBinId;
      }
      
      if (isOutOfRange) {
        console.log(`⚠️ Position SIGNIFICANTLY out of range:`);
        console.log(`   Position ID: ${positionId.substring(0, 8)}...`);
        console.log(`   Active Bin: ${activeBin.binId}`);
        console.log(`   Position Range: ${minBinId} - ${maxBinId}`);
        console.log(`   Buffer Zone: ${effectiveMinBin} - ${effectiveMaxBin}`);
        console.log(`   Distance: ${distanceFromPosition} bins from edge`);
      } else if (distanceFromPosition > 0) {
        console.log(`📊 Position near edge but within buffer:`);
        console.log(`   Active Bin: ${activeBin.binId}`);
        console.log(`   Position Range: ${minBinId} - ${maxBinId}`);
        console.log(`   Distance: ${distanceFromPosition} bins from edge`);
        console.log(`   Buffer remaining: ${bufferBins - distanceFromPosition} bins`);
      }
      
      return isOutOfRange;
    } catch (error) {
      console.error('❌ Failed to check position range:', error);
      return false;
    }
  }

  canReposition(positionId: string): boolean {
    const lastTime = this.lastRepositionTime.get(positionId);
    if (!lastTime) return true;
    
    const timeSince = Date.now() - lastTime;
    const canReposition = timeSince >= REPOSITION_COOLDOWN_MS;
    
    if (!canReposition) {
      const remainingSeconds = Math.round((REPOSITION_COOLDOWN_MS - timeSince) / 1000);
      console.log(`⏳ Reposition cooldown: ${remainingSeconds}s remaining`);
    }
    
    return canReposition;
  }

  private recordReposition(positionId: string): void {
    this.lastRepositionTime.set(positionId, Date.now());
  }

  async createPositionWithTracking(
    userKeypair: Keypair,
    zbtcAmount: number
  ): Promise<{
    positionId: string;
    entryPrice: number;
    entryBin: number;
  }> {
    await this.initializePool();
    if (!this.pool) throw new Error('Pool not initialized');

    const activeBin = await this.pool.getActiveBin();
    const entryBin = activeBin.binId;
    const entryPrice = parseFloat(activeBin.price);

    console.log(`📊 Entry: Bin ${entryBin}, Price $${entryPrice.toFixed(2)}`);

    const positionId = await this.createPosition(
      userKeypair,
      zbtcAmount
    );

    // ✅ POST-CREATION VERIFICATION: Ensure position actually has liquidity
    console.log(`🔍 Verifying position has liquidity...`);
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for blockchain confirmation

    try {
      const positionPubkey = new PublicKey(positionId);
      const position = await this.pool.getPosition(positionPubkey);

      if (!position || !position.positionData) {
        throw new Error(
          `CRITICAL: Position ${positionId} was created but cannot be fetched! ` +
          `Transaction may have failed partially.`
        );
      }

      // Check if position has any liquidity in bins
      const positionBinData = position.positionData.positionBinData || [];
      const totalLiquidity = positionBinData.reduce((sum: number, bin: any) => {
        return sum + (bin.positionXAmount || 0) + (bin.positionYAmount || 0);
      }, 0);

      if (totalLiquidity === 0 || positionBinData.length === 0) {
        throw new Error(
          `CRITICAL: Position ${positionId} was created but has ZERO liquidity! ` +
          `This indicates the position account was created but liquidity add failed. ` +
          `ZBTC (${zbtcAmount.toFixed(8)}) should still be in your wallet.`
        );
      }

      console.log(`✅ Position verified: ${positionBinData.length} bins with liquidity`);
      console.log(`💰 Total liquidity in position: ${totalLiquidity}`);

    } catch (error: any) {
      // If verification fails, we have a critical issue
      console.error(`❌ Position verification failed:`, error.message);
      throw new Error(
        `Position creation verification failed: ${error.message}. ` +
        `Position may exist but be empty. Check wallet and blockchain explorer.`
      );
    }

    return {
      positionId,
      entryPrice,
      entryBin
    };
  }

  /**
   * Validate user has sufficient ZBTC balance before creating position
   */
  private async validateZbtcBalance(
    userKeypair: Keypair,
    zbtcAmount: number
  ): Promise<void> {
    const zbtcMintAddress = process.env.ZBTC_MINT_ADDRESS;
    if (!zbtcMintAddress) {
      throw new Error('ZBTC_MINT_ADDRESS not configured in environment');
    }

    const zbtcMint = new PublicKey(zbtcMintAddress);
    const zbtcTokenAccount = await getAssociatedTokenAddress(
      zbtcMint,
      userKeypair.publicKey
    );

    console.log(`🔍 Pre-flight: Validating ZBTC balance...`);
    try {
      const zbtcBalance = await this.connection.getTokenAccountBalance(zbtcTokenAccount);
      const uiAmountString = zbtcBalance.value.uiAmount?.toString() || '0';
      const actualBalance = parseFloat(uiAmountString);

      console.log(`💰 Wallet has: ${actualBalance.toFixed(8)} ZBTC`);
      console.log(`💰 Attempting to deposit: ${zbtcAmount.toFixed(8)} ZBTC`);

      if (actualBalance < zbtcAmount) {
        throw new Error(
          `Insufficient ZBTC balance. Required: ${zbtcAmount.toFixed(8)}, Available: ${actualBalance.toFixed(8)}`
        );
      }

      console.log(`✅ Balance check passed`);
    } catch (error: any) {
      if (error.message.includes('could not find account')) {
        throw new Error(
          `ZBTC token account not found for wallet ${userKeypair.publicKey.toString()}. ` +
          `User may not have any ZBTC.`
        );
      }
      throw error;
    }
  }

  /**
   * Check if bin is moving rapidly and wait for stabilization
   */
  private async waitForBinStabilization(
    activeBinId: number,
    lastActiveBinId: number | null
  ): Promise<boolean> {
    if (lastActiveBinId !== null && Math.abs(activeBinId - lastActiveBinId) > 2) {
      console.log(`⚠️ Bin moving rapidly: ${lastActiveBinId} → ${activeBinId}`);
      console.log(`💤 Waiting 3s for market stabilization...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      return true; // Need to skip this attempt
    }
    return false; // Proceed with position creation
  }

  /**
   * Determine if error is retryable and handle retry logic
   */
  private async handleRetryableError(
    error: any,
    attempt: number,
    maxRetries: number
  ): Promise<boolean> {
    const errorMessage = error?.message || String(error);
    const errorLogs = error?.transactionLogs?.join('\n') || '';

    const isSlippageError =
      errorMessage.toLowerCase().includes('slippage') ||
      errorMessage.toLowerCase().includes('price moved') ||
      errorLogs.includes('ExceededBinSlippageTolerance') ||
      errorLogs.includes('6004');

    const isBlockHeightError =
      errorMessage.includes('block height exceeded') ||
      errorMessage.includes('BlockheightExceeded');

    if (isSlippageError || isBlockHeightError) {
      console.log(`⚠️ Attempt ${attempt} failed: ${
        isSlippageError ? 'Slippage' : 'Block height'
      } error`);

      if (attempt < maxRetries) {
        const delay = attempt <= 3 ? attempt * 1000 : attempt * 1500;
        console.log(`💤 Waiting ${delay/1000}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return true; // Should retry
      }
    }

    return false; // Not retryable or out of retries
  }

  /**
   * Execute single position creation attempt
   */
  private async executePositionCreation(
    userKeypair: Keypair,
    zbtcAmount: number,
    attempt: number
  ): Promise<string> {
    if (!this.pool) throw new Error('Pool not initialized');

    const activeBin = await this.pool.getActiveBin();
    console.log(`📊 Active Bin: ${activeBin.binId} at price ${activeBin.price}`);

    const positionKeypair = Keypair.generate();

    const minBinId = activeBin.binId;
    const maxBinId = activeBin.binId + 68;

    const totalXAmount = new BN(zbtcAmount * Math.pow(10, 8));
    const totalYAmount = new BN(0);

    console.log(`🎯 Full range position:`);
    console.log(`   Min bin: ${minBinId} (current price)`);
    console.log(`   Max bin: ${maxBinId}`);
    console.log(`   Total bins: ${maxBinId - minBinId + 1}`);

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');
    console.log(`🔗 Fresh blockhash: ${blockhash.substring(0, 8)}...`);

    const createPositionTx = await this.pool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: positionKeypair.publicKey,
      user: userKeypair.publicKey,
      totalXAmount,
      totalYAmount,
      strategy: {
        maxBinId,
        minBinId,
        strategyType: StrategyType.BidAsk
      },
      slippage: 1000
    });

    console.log('ℹ️ Using Meteora SDK default priority fees');

    createPositionTx.recentBlockhash = blockhash;
    createPositionTx.feePayer = userKeypair.publicKey;
    createPositionTx.sign(userKeypair, positionKeypair);

    const rawTransaction = createPositionTx.serialize();

    console.log(`📤 Sending transaction...`);

    const signature = await this.sendAndConfirmWithRetry(
      rawTransaction,
      blockhash,
      lastValidBlockHeight,
      attempt
    );

    const positionId = positionKeypair.publicKey.toString();
    console.log(`✅ Position created: ${positionId}`);
    console.log(`📊 Range: ${maxBinId - minBinId + 1} bins (${minBinId}-${maxBinId})`);
    console.log(`🛡️ Buffer zone: ±${BUFFER_BINS} bins`);
    console.log(`📝 Tx: ${signature}`);

    return positionId;
  }

  async createPosition(
    userKeypair: Keypair,
    zbtcAmount: number,
    maxRetries: number = 5
  ): Promise<string> {
    await this.initializePool();
    if (!this.pool) throw new Error('Pool not initialized');

    // Pre-flight balance validation
    await this.validateZbtcBalance(userKeypair, zbtcAmount);

    let lastError: any;
    let lastActiveBinId: number | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🎯 Creating position (attempt ${attempt}/${maxRetries})...`);

        const activeBin = await this.pool.getActiveBin();

        // Check for bin stabilization
        const shouldSkip = await this.waitForBinStabilization(
          activeBin.binId,
          lastActiveBinId
        );

        if (shouldSkip) {
          lastActiveBinId = activeBin.binId;
          continue;
        }

        lastActiveBinId = activeBin.binId;

        // Execute position creation
        return await this.executePositionCreation(userKeypair, zbtcAmount, attempt);

      } catch (error: any) {
        lastError = error;

        // Handle retryable errors
        const shouldRetry = await this.handleRetryableError(error, attempt, maxRetries);

        if (shouldRetry) {
          continue;
        }

        console.error('❌ Failed to create position:', error);
        throw error;
      }
    }

    throw new Error(
      `Failed after ${maxRetries} attempts. Market too volatile.`
    );
  }

  private async sendAndConfirmWithRetry(
    rawTransaction: Buffer,
    blockhash: string,
    lastValidBlockHeight: number,
    attemptNumber: number
  ): Promise<string> {
    const TX_RETRY_INTERVAL = 2000;
    let txSendAttempts = 0;
    
    const signature = await this.connection.sendRawTransaction(rawTransaction, {
      skipPreflight: false,
      maxRetries: 0,
      preflightCommitment: 'confirmed'
    });
    
    console.log(`📝 Transaction sent: ${signature}`);
    
    const confirmPromise = this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );
    
    let confirmed = false;
    
    while (!confirmed) {
      try {
        const result = await Promise.race([
          confirmPromise,
          new Promise<null>(resolve => setTimeout(() => resolve(null), TX_RETRY_INTERVAL))
        ]);
        
        if (result) {
          confirmed = true;
          console.log(`✅ Confirmed after ${txSendAttempts} resends`);
          break;
        }
        
        const currentBlockHeight = await this.connection.getBlockHeight('confirmed');
        if (currentBlockHeight > lastValidBlockHeight) {
          throw new Error('Transaction expired: block height exceeded');
        }
        
        txSendAttempts++;
        console.log(`🔄 Not confirmed, resending (${txSendAttempts})...`);
        
        await this.connection.sendRawTransaction(rawTransaction, {
          skipPreflight: true,
          maxRetries: 0
        });
        
      } catch (error: any) {
        if (error.message?.includes('block height exceeded')) {
          throw error;
        }
        console.error('Error during confirmation:', error);
        throw error;
      }
    }
    
    return signature;
  }

  async createMaxRangePosition(
    userKeypair: Keypair,
    zbtcAmount: number,
    maxRetries: number = 5
  ): Promise<string> {
    return this.createPosition(userKeypair, zbtcAmount, maxRetries);
  }

  async repositionLiquidityWithTracking(
    userKeypair: Keypair,
    oldPositionId: string,
    useMaxRange: boolean = true
  ): Promise<{
    positionId: string;
    entryPrice: number;
    entryBin: number;
    exitPrice: number;
    exitBin: number;
    actualZbtcDeposited: number;
  }> {
    try {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🔄 REPOSITIONING: ${oldPositionId.substring(0, 8)}...`);
      console.log(`${'='.repeat(60)}\n`);

      if (!this.canReposition(oldPositionId)) {
        const lastTime = this.lastRepositionTime.get(oldPositionId)!;
        const timeSince = Date.now() - lastTime;
        const remainingSeconds = Math.round((REPOSITION_COOLDOWN_MS - timeSince) / 1000);
        throw new Error(
          `Reposition on cooldown. Wait ${remainingSeconds}s.`
        );
      }

      await this.initializePool();
      if (!this.pool) throw new Error('Pool not initialized');

      const oldPositionPubkey = new PublicKey(oldPositionId);
      const oldPosition = await this.pool.getPosition(oldPositionPubkey);

      if (!oldPosition) {
        throw new Error('Old position not found or already closed');
      }

      console.log(`✅ Old position verified`);

      const exitBinData = await this.pool.getActiveBin();
      const exitPrice = parseFloat(exitBinData.price);
      const exitBin = exitBinData.binId;

      console.log(`📊 Exit: Bin ${exitBin}, Price $${exitPrice.toFixed(2)}`);

      console.log(`\n🔴 CLOSING OLD POSITION...`);
      await this.closePosition(userKeypair, oldPositionId);
      console.log(`✅ Old position closed`);

      // ✅ FIX: Wait longer for blockchain confirmation and liquidity to settle
      console.log(`⏳ Waiting 5s for liquidity to return and settle...`);
      await new Promise(resolve => setTimeout(resolve, 5000));

      // ✅ FIX: Get ACTUAL ZBTC balance from wallet
      const zbtcMintAddress = process.env.ZBTC_MINT_ADDRESS;
      if (!zbtcMintAddress) {
        throw new Error('ZBTC_MINT_ADDRESS not configured in environment');
      }

      const zbtcMint = new PublicKey(zbtcMintAddress);
      const zbtcTokenAccount = await getAssociatedTokenAddress(
        zbtcMint,
        userKeypair.publicKey
      );

      console.log(`🔍 Checking actual wallet balance...`);
      const zbtcBalance = await this.connection.getTokenAccountBalance(zbtcTokenAccount);
      const uiAmountString = zbtcBalance.value.uiAmount?.toString() || '0';
      const actualZbtcAmount = parseFloat(uiAmountString);

      console.log(`💰 Actual ZBTC in wallet: ${actualZbtcAmount.toFixed(8)} ZBTC`);

      if (actualZbtcAmount === 0) {
        throw new Error(
          'CRITICAL: No ZBTC found in wallet after closing position! ' +
          'Liquidity may not have been returned. Check blockchain explorer.'
        );
      }

      if (actualZbtcAmount < 0.00000001) {
        throw new Error(
          `ZBTC amount too small: ${actualZbtcAmount}. ` +
          `Minimum required is 0.00000001 ZBTC (1 satoshi).`
        );
      }

      console.log(`\n🟢 CREATING NEW POSITION WITH ACTUAL BALANCE...`);
      const newPositionResult = await this.createPositionWithTracking(
        userKeypair,
        actualZbtcAmount  // ✅ FIX: Use actual balance, not database value!
      );

      this.recordReposition(newPositionResult.positionId);

      console.log(`\n${'='.repeat(60)}`);
      console.log(`✅ REPOSITION COMPLETE`);
      console.log(`${'='.repeat(60)}`);
      console.log(`🔴 Old: ${oldPositionId.substring(0, 8)}...`);
      console.log(`🟢 New: ${newPositionResult.positionId.substring(0, 8)}...`);
      console.log(`💰 Amount: ${actualZbtcAmount.toFixed(8)} ZBTC`);
      console.log(`📊 Exit: Bin ${exitBin}, Price $${exitPrice.toFixed(2)}`);
      console.log(`📊 Entry: Bin ${newPositionResult.entryBin}, Price $${newPositionResult.entryPrice.toFixed(2)}`);
      console.log(`${'='.repeat(60)}\n`);

      return {
        positionId: newPositionResult.positionId,
        entryPrice: newPositionResult.entryPrice,
        entryBin: newPositionResult.entryBin,
        exitPrice,
        exitBin,
        actualZbtcDeposited: actualZbtcAmount  // ✅ Return actual amount deposited
      };

    } catch (error: any) {
      console.error(`\n❌ REPOSITION FAILED:`, error.message);
      throw error;
    }
  }

  /**
   * Close a position on-chain by removing all liquidity
   *
   * Flow (per Meteora DLMM SDK docs):
   * 1. Fetch position data from blockchain to get bin IDs
   * 2. Call removeLiquidity with shouldClaimAndClose=true which:
   *    - Removes 100% of liquidity from all bins
   *    - Claims any accumulated swap fees
   *    - Closes the position account on-chain
   * 3. Returns withdrawn tokens to user's wallet
   *
   * Note: This ONLY handles blockchain operations. PnL calculation
   * and database updates are handled separately by the MCP server.
   *
   * @param userKeypair - User's wallet keypair for signing transactions
   * @param positionId - On-chain position public key
   * @throws Error if position not found or transaction fails
   */
  /**
   * Confirms a transaction using block height strategy with retry logic
   * This is more reliable than the default confirmTransaction method
   */
  private async confirmTransactionWithRetry(
    signature: string,
    blockhash: { blockhash: string; lastValidBlockHeight: number },
    maxRetries = 5 // Increased from 3 to 5
  ): Promise<void> {
    let retries = 0;

    while (retries < maxRetries) {
      try {
        // Use block height strategy for confirmation
        const confirmation = await this.connection.confirmTransaction(
          {
            signature,
            blockhash: blockhash.blockhash,
            lastValidBlockHeight: blockhash.lastValidBlockHeight
          },
          'confirmed'
        );

        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        console.log(`✅ Transaction confirmed: ${signature}`);
        return;
      } catch (error: any) {
        retries++;
        console.log(`⚠️ Confirmation attempt ${retries}/${maxRetries} failed`);

        // Check transaction status even if confirmation timed out
        const status = await this.connection.getSignatureStatus(signature);

        if (status?.value?.confirmationStatus === 'confirmed' ||
            status?.value?.confirmationStatus === 'finalized') {
          console.log(`✅ Transaction confirmed via status check: ${signature}`);
          return;
        }

        if (status?.value?.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
        }

        if (retries >= maxRetries) {
          // Check one more time before failing
          await new Promise(resolve => setTimeout(resolve, 3000));
          const finalStatus = await this.connection.getSignatureStatus(signature);

          if (finalStatus?.value?.confirmationStatus === 'confirmed' ||
              finalStatus?.value?.confirmationStatus === 'finalized') {
            console.log(`✅ Transaction confirmed on final check: ${signature}`);
            return;
          }

          throw new Error(
            `Transaction not confirmed after ${maxRetries} attempts. ` +
            `Signature: ${signature}. ` +
            `Check status at https://solscan.io/tx/${signature} ` +
            `(Status: ${finalStatus?.value?.confirmationStatus || 'null'})`
          );
        }

        // Exponential backoff: 3s, 6s, 9s, 12s
        const waitTime = 3000 * retries;
        console.log(`⏳ Waiting ${waitTime/1000}s before retry ${retries + 1}...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  async closePosition(userKeypair: Keypair, positionId: string): Promise<void> {
    await this.initializePool();
    if (!this.pool) throw new Error('Pool not initialized');

    try {
      const positionPubkey = new PublicKey(positionId);

      // Step 1: Fetch position data from blockchain
      const position = await this.pool.getPosition(positionPubkey);

      if (!position || !position.positionData) {
        console.log('⚠️ Position not found or already closed');
        return;
      }

      // Step 2: Get all bin IDs where liquidity is deposited
      const binIdsToRemove = position.positionData.positionBinData.map(
        (bin: any) => bin.binId
      );

      if (binIdsToRemove.length === 0) {
        console.log('⚠️ Position has no bins');
        return;
      }

      const fromBinId = Math.min(...binIdsToRemove);
      const toBinId = Math.max(...binIdsToRemove);

      console.log(`📊 Removing liquidity from bins ${fromBinId} to ${toBinId}`);

      // Step 3: Remove 100% liquidity and close position on-chain
      // Per Meteora docs: shouldClaimAndClose=true does THREE things:
      // 1. Removes all liquidity (bps = 10000 = 100%)
      // 2. Claims accumulated swap fees
      // 3. Closes position account (returns rent to user)
      const removeLiquidityTx = await this.pool.removeLiquidity({
        position: positionPubkey,
        user: userKeypair.publicKey,
        fromBinId,
        toBinId,
        bps: new BN(100 * 100), // 100% = 10000 basis points
        shouldClaimAndClose: true // Claim fees + close position in one tx
      });

      const txArray = Array.isArray(removeLiquidityTx)
        ? removeLiquidityTx
        : [removeLiquidityTx];

      // Get blockhash with lastValidBlockHeight for block-height based confirmation
      const blockhashInfo = await this.connection.getLatestBlockhash('confirmed');

      for (const tx of txArray) {
        // Meteora SDK already adds optimal ComputeBudget instructions
        // We don't need to add our own - let the SDK handle it
        console.log('ℹ️ Using Meteora SDK default priority fees');

        tx.recentBlockhash = blockhashInfo.blockhash;
        tx.feePayer = userKeypair.publicKey;
        tx.sign(userKeypair);

        const rawTx = tx.serialize();
        const signature = await this.connection.sendRawTransaction(rawTx, {
          skipPreflight: false,
          maxRetries: 2
        });

        console.log(`📝 Remove liquidity tx sent: ${signature}`);
        console.log(`🔗 Track transaction: https://solscan.io/tx/${signature}`);

        // Use improved confirmation strategy with retry logic
        await this.confirmTransactionWithRetry(signature, blockhashInfo);
        console.log(`✅ Liquidity removed and position closed`);
      }
      
    } catch (error) {
      console.error('❌ Failed to close position:', error);
      throw error;
    }
  }

  async getPositionDetails(positionId: string): Promise<any> {
    await this.initializePool();
    if (!this.pool) throw new Error('Pool not initialized');

    try {
      const positionPubkey = new PublicKey(positionId);
      const position = await this.pool.getPosition(positionPubkey);
      
      if (!position || !position.positionData) {
        return null;
      }

      const positionBins = position.positionData.positionBinData || [];
      const binCount = positionBins.length;
      const minBinId = Math.min(...positionBins.map((bin: any) => bin.binId));
      const maxBinId = Math.max(...positionBins.map((bin: any) => bin.binId));
      
      return {
        positionId,
        binCount,
        minBinId,
        maxBinId,
        range: maxBinId - minBinId,
        bins: positionBins
      };
    } catch (error: any) {
      // Expected error: Position not found (already closed)
      if (error.message?.includes('not found')) {
        // This is expected for closed positions, just log as info
        console.log(`📊 Position ${positionId.substring(0, 8)}... not found on-chain (likely closed)`);
        return null;
      }

      // Unexpected error: log as error
      console.error('❌ Failed to get position details:', error);
      return null;
    }
  }
}