import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Info, AlertTriangle, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useWallet } from '@/hooks/useAppKitWallet';
import { useMeteoraDlmmService } from "@/lib/meteora/meteoraDlmmService";
import { useMeteoraPositionService } from "@/lib/meteora/meteoraPositionService";
import type { ExistingBinRange } from "@/lib/meteora/meteoraPositionService";
import { BN } from 'bn.js';
import { StrategyType } from '@meteora-ag/dlmm';
import { FormattedPool } from '@/lib/utils/poolUtils';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { showToast } from "@/lib/utils/showToast";
import { useTokenData } from '@/hooks/useTokenData';

interface AddLiquidityModalProps {
  isOpen: boolean;
  onClose: () => void;
  pool: FormattedPool | null;
  userPortfolioStyle?: string | null;
}

interface BalanceInfo {
  solBalance: number;
  tokenBalance: number;
  hasEnoughSol: boolean;
  estimatedSolNeeded: number;
  shortfall: number;
}

interface StrategyOption {
  id: string;
  icon: string;
  label: string;
  subtitle: string;
  description: string;
  estimatedCost: number;
  riskLevel: 'low' | 'medium' | 'high';
  isDefault?: boolean;
}

// Simplified timing constants
const TIMING = {
  TRANSACTION_DELAY: 800,
  SUCCESS_DURATION: 5000,
  MODAL_CLOSE_DELAY: 5500,
  ERROR_DURATION: 4000
} as const;

// Cache for bin ranges
const binRangesCache = new Map<string, { 
  data: ExistingBinRange[]; 
  timestamp: number; 
  activeBinId: number;
}>();
const CACHE_DURATION = 60000;


const AddLiquidityModal: React.FC<AddLiquidityModalProps> = ({ 
  isOpen, 
  onClose,
  pool,
  userPortfolioStyle = 'conservative'
}) => {
  const actualPortfolioStyle = userPortfolioStyle || 'conservative';
  const { publicKey, sendTransaction } = useWallet();
  const { service: dlmmService } = useMeteoraDlmmService();
  const { service: positionService } = useMeteoraPositionService();
  const tokens = useTokenData();
  
  // State management
  const [amount, setAmount] = useState('');
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [balanceInfo, setBalanceInfo] = useState<BalanceInfo | null>(null);
  const [isCheckingBalance, setIsCheckingBalance] = useState(false);
  const [validationError, setValidationError] = useState<string>('');
  const [currentBinId, setCurrentBinId] = useState<number | null>(null);
  const [existingBinRanges, setExistingBinRanges] = useState<ExistingBinRange[]>([]);
  const [isLoadingBins, setIsLoadingBins] = useState(false);
  const [binRangesLoaded, setBinRangesLoaded] = useState(false);
  const [userTokenBalance, setUserTokenBalance] = useState<number>(0);
  
  // UI state
  const [showDetails, setShowDetails] = useState(false);
  const [activePercentage, setActivePercentage] = useState<number | null>(null);
  const [isUpdatingAmount, setIsUpdatingAmount] = useState(false);

  // Refs
  const findingBinsRef = useRef(false);
  const poolAddressRef = useRef<string | null>(null);

  // Get token names from pool
  const getTokenNames = useCallback(() => {
    if (!pool) return { tokenX: 'BTC', tokenY: 'SOL' };
    const [tokenX, tokenY] = pool.name.split('-');
    return { 
      tokenX: tokenX.replace('WBTC', 'wBTC'), 
      tokenY 
    };
  }, [pool]);

  const { tokenX } = getTokenNames();

  // Simplified strategy options
  const strategyOptions: StrategyOption[] = useMemo(() => {
    if (existingBinRanges.length === 0) return [];
    
    const strategies = {
      conservative: {
        icon: '🛡️',
        label: 'Conservative',
        subtitle: 'Lower risk, steady returns',
        description: 'Best for long-term holders'
      },
      moderate: {
        icon: '⚖️', 
        label: 'Moderate',
        subtitle: 'Balanced risk and returns',
        description: 'Good for most users'
      },
      aggressive: {
        icon: '🚀',
        label: 'Aggressive', 
        subtitle: 'Higher risk, higher returns',
        description: 'For experienced traders'
      }
    };
    
    const style = strategies[actualPortfolioStyle.toLowerCase() as keyof typeof strategies] || strategies.moderate;
    
    return [{
      id: 'selected-strategy',
      ...style,
      estimatedCost: 0.06,
      riskLevel: actualPortfolioStyle.toLowerCase() as 'low' | 'medium' | 'high',
      isDefault: true
    }];
  }, [actualPortfolioStyle, existingBinRanges]);

  // Set default strategy
  useEffect(() => {
    if (strategyOptions.length > 0 && !selectedStrategy) {
      setSelectedStrategy(strategyOptions[0].id);
    }
  }, [strategyOptions, selectedStrategy]);

  const selectedStrategyOption = strategyOptions.find(opt => opt.id === selectedStrategy);

  // Fixed balance fetching function
  const fetchUserTokenBalance = useCallback(async () => {
    if (!publicKey || !pool) return;

    try {
      const connection = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
      );

      // Extract the token symbol from pool name (e.g., "wBTC-SOL" -> "wBTC")
      const { tokenX } = getTokenNames();
      
      // Define known token mint addresses on Solana mainnet
      const TOKEN_MINTS: Record<string, string> = {
        'wBTC': '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
        'zBTC': 'zBTCug3er3tLyffELcvDNrKkCymbPWysGcWihESYfLg',
        'cbBTC': 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
        'SOL': 'So11111111111111111111111111111111111111112'
      };

      // Get the target token mint address
      let targetTokenMint: string | undefined = TOKEN_MINTS[tokenX];
      
      // Fallback: if not in our predefined list, try to find via token registry
      if (!targetTokenMint && tokens.length > 0) {
        const tokenInfo = tokens.find(t => 
          t.symbol === tokenX || 
          t.symbol === tokenX.toUpperCase() ||
          t.symbol === tokenX.toLowerCase()
        );
        targetTokenMint = tokenInfo?.address;
      }

      if (!targetTokenMint) {
        console.warn(`Could not determine mint address for token: ${tokenX} in pool: ${pool.name}`);
        setUserTokenBalance(0);
        return;
      }

      // Get all token accounts for the user
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        publicKey,
        { programId: TOKEN_PROGRAM_ID }
      );

      // Find the specific token account that matches our target mint
      const targetAccount = tokenAccounts.value.find(account => {
        const mintAddress = account.account.data.parsed.info.mint;
        return mintAddress === targetTokenMint;
      });

      if (targetAccount) {
        const balance = targetAccount.account.data.parsed.info.tokenAmount.uiAmount || 0;
        setUserTokenBalance(balance);
      } else {
        setUserTokenBalance(0);
      }

    } catch (error) {
      console.error('Error fetching token balance:', error);
      setUserTokenBalance(0);
    }
  }, [publicKey, pool, tokens, getTokenNames]);

  // Find existing bin ranges
  const findExistingBinRanges = useCallback(async (poolAddress: string) => {
    if (findingBinsRef.current || !poolAddress) return;

    const cached = binRangesCache.get(poolAddress);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      setExistingBinRanges(cached.data);
      setCurrentBinId(cached.activeBinId);
      setBinRangesLoaded(true);
      return;
    }

    findingBinsRef.current = true;
    setIsLoadingBins(true);
    setBinRangesLoaded(false);
    
    try {
      const dlmmPool = await dlmmService.initializePool(poolAddress);
      const activeBin = await dlmmPool.getActiveBin();
      setCurrentBinId(activeBin.binId);
      
      const existingRanges = await positionService.findExistingBinRanges(poolAddress, 69, actualPortfolioStyle);
      
      let finalRanges: ExistingBinRange[];
      
      if (existingRanges.length > 0) {
        finalRanges = existingRanges;
      } else {
        // Fallback: Use 69 bins ABOVE active bin for one-sided zBTC liquidity
        // This allows zBTC to fill ALL bins (zBTC can only be placed in bins >= active)
        const fallbackRange: ExistingBinRange = {
          minBinId: activeBin.binId,
          maxBinId: activeBin.binId + 68,
          existingBins: Array.from({length: 69}, (_, i) => activeBin.binId + i),
          liquidityDepth: 69,
          isPopular: false,
          description: 'Full range above current market price'
        };
        finalRanges = [fallbackRange];
      }
      
      setExistingBinRanges(finalRanges);
      setBinRangesLoaded(true);
      
      binRangesCache.set(poolAddress, {
        data: finalRanges,
        timestamp: now,
        activeBinId: activeBin.binId
      });
      
    } catch (error) {
      console.error('Error finding price ranges:', error);

      // Fallback: Use 69 bins ABOVE active bin for one-sided zBTC liquidity
      const fallbackRange: ExistingBinRange = {
        minBinId: currentBinId || 0,
        maxBinId: currentBinId ? currentBinId + 68 : 68,
        existingBins: currentBinId ? Array.from({length: 69}, (_, i) => currentBinId + i) : Array.from({length: 69}, (_, i) => i),
        liquidityDepth: 69,
        isPopular: false,
        description: 'Full range above current market price'
      };
      setExistingBinRanges([fallbackRange]);
      setBinRangesLoaded(true);
    } finally {
      setIsLoadingBins(false);
      findingBinsRef.current = false;
    }
  }, [actualPortfolioStyle, dlmmService, positionService, currentBinId]);

  // Load existing bins when modal opens
  useEffect(() => {
    if (isOpen && pool && pool.address !== poolAddressRef.current && !binRangesLoaded && !isLoadingBins) {
      poolAddressRef.current = pool.address;
      findExistingBinRanges(pool.address);
    }
  }, [isOpen, pool, binRangesLoaded, isLoadingBins, findExistingBinRanges]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setBinRangesLoaded(false);
      setExistingBinRanges([]);
      setCurrentBinId(null);
      setBalanceInfo(null);
      setValidationError('');
      setAmount('');
      setSelectedStrategy('');
      setUserTokenBalance(0);
      setActivePercentage(null);
      setIsUpdatingAmount(false);
      poolAddressRef.current = null;
      findingBinsRef.current = false;
    }
  }, [isOpen]);

  // Fetch user's token balance
  useEffect(() => {
    if (isOpen && publicKey && pool) {
      fetchUserTokenBalance();
    }
  }, [isOpen, publicKey, pool, fetchUserTokenBalance]);

  // Handle percentage buttons
  const handlePercentageClick = useCallback((percentage: number) => {
    if (isUpdatingAmount) return;
    
    if (userTokenBalance <= 0) {
      showToast.warning('No Balance', `You don't have any ${tokenX} tokens to add.`);
      return;
    }
    
    setIsUpdatingAmount(true);
    setActivePercentage(percentage);
    
    const newAmount = (userTokenBalance * percentage / 100).toFixed(6);
    setAmount(newAmount);
    
    showToast.success('Amount Updated', `Set to ${percentage}% of your balance`);
    
    setTimeout(() => {
      setIsUpdatingAmount(false);
    }, 300);
  }, [userTokenBalance, isUpdatingAmount, tokenX]);

  // Handle max button
  const handleMaxClick = useCallback(() => {
    if (isUpdatingAmount) return;
    
    if (userTokenBalance <= 0) {
      showToast.warning('No Balance', `You don't have any ${tokenX} tokens to add.`);
      return;
    }
    
    setIsUpdatingAmount(true);
    setActivePercentage(100);
    
    const newAmount = userTokenBalance.toFixed(6);
    setAmount(newAmount);
    
    showToast.success('Amount Updated', `Set to maximum: ${newAmount} ${tokenX}`);
    
    setTimeout(() => {
      setIsUpdatingAmount(false);
    }, 300);
  }, [userTokenBalance, tokenX, isUpdatingAmount]);

  // Balance checking
  const checkUserBalances = useCallback(async () => {
    if (!publicKey || !pool || !amount || parseFloat(amount) <= 0 || !selectedStrategyOption) return;

    setIsCheckingBalance(true);
    setValidationError('');

    // First check if entered amount exceeds token balance
    const enteredAmount = parseFloat(amount);
    if (enteredAmount > userTokenBalance) {
      setValidationError(
        `Insufficient ${tokenX} balance. You have ${userTokenBalance.toFixed(6)} ${tokenX}.`
      );
      setIsCheckingBalance(false);
      return;
    }

    try {
      const connection = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
      );

      const solBalanceLamports = await connection.getBalance(publicKey);
      const solBalance = solBalanceLamports / LAMPORTS_PER_SOL;

      const estimatedSolNeeded = selectedStrategyOption.estimatedCost;
      const hasEnoughSol = solBalance >= estimatedSolNeeded;
      const shortfall = Math.max(0, estimatedSolNeeded - solBalance);

      const balanceInfo: BalanceInfo = {
        solBalance,
        tokenBalance: 0,
        hasEnoughSol,
        estimatedSolNeeded,
        shortfall
      };

      setBalanceInfo(balanceInfo);

      if (!hasEnoughSol) {
        setValidationError(
          `You need ${shortfall.toFixed(3)} more SOL to complete this transaction.`
        );
      }

    } catch (error) {
      console.error('Error checking balances:', error);
      setValidationError('Unable to check account balances. Please try again.');
    } finally {
      setIsCheckingBalance(false);
    }
  }, [publicKey, pool, amount, selectedStrategyOption, userTokenBalance, tokenX]);

  useEffect(() => {
    if (amount && parseFloat(amount) > 0 && publicKey && pool && selectedStrategyOption) {
      checkUserBalances();
    } else {
      setBalanceInfo(null);
      setValidationError('');
    }
  }, [amount, publicKey, pool, selectedStrategyOption, checkUserBalances]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/^[0-9]*\.?[0-9]*$/.test(value) || value === '') {
      setAmount(value);
    }
  };

  // Main transaction handler
  const handleAddLiquidity = async () => {
    if (!pool || !publicKey || !amount || parseFloat(amount) <= 0 || !currentBinId || !selectedStrategyOption || existingBinRanges.length === 0) return;

    // Check if user has enough token balance
    const enteredAmount = parseFloat(amount);
    if (enteredAmount > userTokenBalance) {
      showToast.error('Insufficient Balance',
        `You only have ${userTokenBalance.toFixed(6)} ${tokenX}. Please enter a smaller amount.`
      );
      return;
    }

    if (balanceInfo && !balanceInfo.hasEnoughSol) {
      showToast.error('Not Enough SOL',
        validationError || 'You need more SOL to complete this transaction.'
      );
      return;
    }

    setIsLoading(true);
    
    try {
      const decimals = 8;
      const bnAmount = new BN(parseFloat(amount) * Math.pow(10, decimals));

      const selectedRange = existingBinRanges[0];

      // Full range with BidAsk strategy - range is above active bin so zBTC fills ALL bins
      const result = await positionService.createPositionWithExistingBins({
        poolAddress: pool.address,
        userPublicKey: publicKey,
        totalXAmount: bnAmount,
        totalYAmount: new BN(0),
        minBinId: selectedRange.minBinId,
        maxBinId: selectedRange.maxBinId,
        strategyType: StrategyType.BidAsk,
        useAutoFill: false // One-sided zBTC only (range is above active, so all bins get filled)
      }, selectedRange);
      
      const transactionSignatures: string[] = [];
      
      if (Array.isArray(result.transaction)) {
        for (let i = 0; i < result.transaction.length; i++) {
          const tx = result.transaction[i];
          const signature = await sendTransaction(tx, dlmmService.connection, {
            signers: [result.positionKeypair]
          });
          transactionSignatures.push(signature);
        }
      } else {
        const signature = await sendTransaction(result.transaction, dlmmService.connection, {
          signers: [result.positionKeypair]
        });
        transactionSignatures.push(signature);
      }
      
      setTimeout(() => {
        showToast.success('Success!', `Your ${amount} ${tokenX} has been added to the pool. You'll start earning fees from trading activity.`);
      }, TIMING.TRANSACTION_DELAY);
      
      setTimeout(() => {
        onClose();
        setAmount('');
        setActivePercentage(null);
      }, TIMING.MODAL_CLOSE_DELAY);
      
    } catch (error) {
      console.error('Error adding liquidity:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      if (errorMessage.includes('insufficient funds') || errorMessage.includes('insufficient lamports')) {
        showToast.error('Not Enough SOL', 
          `You need about ${selectedStrategyOption.estimatedCost.toFixed(2)} SOL to start earning.`
        );
      } else if (errorMessage.includes('User rejected') || errorMessage.includes('user rejected') || errorMessage.includes('User denied') || errorMessage.includes('cancelled')) {
        showToast.warning('Transaction Cancelled', 
          'You cancelled the transaction. Your funds are safe.'
        );
      } else {
        showToast.error('Transaction Failed', 
          'Something went wrong. Please try again.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'conservative': return 'text-green-400';
      case 'moderate': return 'text-blue-400';  
      case 'aggressive': return 'text-orange-400';
      default: return 'text-blue-400';
    }
  };
  
  return (
    <Dialog open={isOpen && !!pool} onOpenChange={onClose}>
      <DialogContent className="bg-[#161616] border-border text-white max-w-lg mx-auto max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-3">
          <DialogTitle className="text-white text-xl">Add Liquidity</DialogTitle>
          <DialogDescription className="text-sm text-sub-text">
            Start earning fees from {pool?.name} trading activity
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 mt-6">
          {/* Amount Input */}
          <div className="space-y-3">
            <label className="text-sm text-sub-text block font-medium">
              How much {tokenX} do you want to add?
            </label>
            
            {/* Token Balance Display */}
            {publicKey && (
              <div className="flex justify-between items-center text-xs text-sub-text">
                <span>Available:</span>
                <span className="font-medium">
                  {userTokenBalance.toFixed(6)} {tokenX}
                </span>
              </div>
            )}
            
            <div className="relative">
              <input
                type="text"
                value={amount}
                onChange={handleAmountChange}
                placeholder="0.0"
                className="w-full bg-[#0f0f0f] border border-border rounded-lg p-4 text-white pr-20 text-lg font-medium"
              />
              <div className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-secondary/30 px-3 py-1.5 rounded text-sm font-medium">
                {tokenX}
              </div>
              {isCheckingBalance && (
                <div className="absolute right-24 top-1/2 transform -translate-y-1/2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                </div>
              )}
            </div>
            
            {/* Percentage Buttons */}
            {publicKey && userTokenBalance > 0 && (
              <div className="flex gap-2 mt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handlePercentageClick(25)}
                  disabled={isUpdatingAmount}
                  className={`flex-1 text-xs transition-all duration-200 ${
                    activePercentage === 25
                      ? 'bg-primary/20 border-primary text-primary font-medium'
                      : 'bg-transparent border-border hover:border-green-500 hover:bg-green-500/20 hover:text-green-400 text-white'
                  }`}
                >
                  25%
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handlePercentageClick(50)}
                  disabled={isUpdatingAmount}
                  className={`flex-1 text-xs transition-all duration-200 ${
                    activePercentage === 50
                      ? 'bg-primary/20 border-primary text-primary font-medium'
                      : 'bg-transparent border-border hover:border-green-500 hover:bg-green-500/20 hover:text-green-400 text-white'
                  }`}
                >
                  50%
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handlePercentageClick(75)}
                  disabled={isUpdatingAmount}
                  className={`flex-1 text-xs transition-all duration-200 ${
                    activePercentage === 75
                      ? 'bg-primary/20 border-primary text-primary font-medium'
                      : 'bg-transparent border-border hover:border-green-500 hover:bg-green-500/20 hover:text-green-400 text-white'
                  }`}
                >
                  75%
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleMaxClick}
                  disabled={isUpdatingAmount}
                  className={`flex-1 text-xs transition-all duration-200 ${
                    activePercentage === 100
                      ? 'bg-primary/20 border-primary text-primary font-medium'
                      : 'bg-transparent border-border hover:border-green-500 hover:bg-green-500/20 hover:text-green-400 text-white'
                  }`}
                >
                  MAX
                </Button>
              </div>
            )}
            
            {/* No Balance Warning */}
            {publicKey && userTokenBalance === 0 && (
              <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-lg p-3 mt-3">
                <div className="flex items-center gap-2 text-yellow-200 text-sm">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span>No {tokenX} found in your wallet</span>
                </div>
              </div>
            )}
          </div>

          {/* Strategy Display */}
          {strategyOptions.length > 0 && (
            <div className="space-y-4">
              <label className="text-sm text-sub-text block font-medium">
                Your Strategy
              </label>
              
              <div className="p-4 border border-primary bg-primary/10 rounded-lg">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">{selectedStrategyOption?.icon}</span>
                      <div>
                        <div className="font-medium text-white text-sm">
                          {selectedStrategyOption?.label}
                        </div>
                        <div className={`text-xs ${getRiskColor(actualPortfolioStyle)}`}>
                          {selectedStrategyOption?.subtitle}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-sub-text">
                      {selectedStrategyOption?.description}
                    </div>
                  </div>
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 ml-2" />
                </div>
              </div>
            </div>
          )}

          {/* Cost Information */}
          <div className="bg-[#0f0f0f] border border-border rounded-lg p-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-sub-text">Cost to start:</span>
              <span className="text-white font-medium">
                ~{selectedStrategyOption ? selectedStrategyOption.estimatedCost.toFixed(2) : '0.06'} SOL
              </span>
            </div>
            <div className="text-xs text-green-400 mt-1">
              You get this back when you exit
            </div>
          </div>

          {/* Balance Check Results */}
          {balanceInfo && (
            <div className="bg-[#0f0f0f] border border-border rounded-lg p-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-sub-text">Your SOL Balance:</span>
                <span className={`font-medium ${balanceInfo.hasEnoughSol ? 'text-green-400' : 'text-red-400'}`}>
                  {balanceInfo.solBalance.toFixed(3)} SOL
                </span>
              </div>
              {balanceInfo.shortfall > 0 && (
                <div className="flex justify-between items-center text-sm mt-2">
                  <span className="text-sub-text">Need:</span>
                  <span className="text-red-400 font-medium">
                    {balanceInfo.shortfall.toFixed(3)} more SOL
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Validation Error */}
          {validationError && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-200">{validationError}</div>
            </div>
          )}

          {/* Loading States */}
          {isLoadingBins && (
            <div className="bg-[#0f0f0f] border border-border rounded-lg p-4 text-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto mb-2" />
              <p className="text-sm text-sub-text">Finding safe price ranges...</p>
            </div>
          )}

          {/* Success State */}
          {existingBinRanges.length > 0 && binRangesLoaded && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="h-5 w-5 text-green-400" />
                <span className="text-green-400 font-medium">Ready to earn</span>
              </div>
              <p className="text-sm text-white">
                Safe price range found. You&apos;ll start earning fees when people trade this pair.
              </p>
            </div>
          )}

          {/* Advanced Details (Collapsible) */}
          <div className="bg-[#0f0f0f] border border-border rounded-lg">
            <div 
              className="p-4 cursor-pointer flex items-center justify-between"
              onClick={() => setShowDetails(!showDetails)}
            >
              <div className="flex items-center gap-2">
                <Info className="h-5 w-5 flex-shrink-0 text-primary" />
                <span className="text-sm text-sub-text font-medium">How it works</span>
              </div>
              {showDetails ? (
                <ChevronUp className="h-4 w-4 text-primary flex-shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 text-primary flex-shrink-0" />
              )}
            </div>
            
            {showDetails && (
              <div className="px-4 pb-4 animate-in slide-in-from-top-2 duration-200">
                <div className="space-y-3 border-t border-border pt-4 text-sm text-sub-text">
                  <div>
                    <div className="font-medium text-white mb-1">What happens next:</div>
                    <div>• Your {tokenX} will be added to the {pool?.name} trading pool</div>
                    <div>• You&apos;ll automatically earn fees when people trade this pair</div>
                    <div>• You can withdraw your funds anytime</div>
                    <div>• The ~0.06 SOL cost gets refunded when you exit</div>
                  </div>
                  <div>
                    <div className="font-medium text-white mb-1">Risk level: {selectedStrategyOption?.subtitle}</div>
                    <div>• {actualPortfolioStyle === 'conservative' ? 'Lower risk with steady returns over time' : 
                             actualPortfolioStyle === 'moderate' ? 'Balanced approach with moderate returns' :
                             'Higher potential returns with increased risk'}</div>
                    <div>• Your tokens may lose some value if prices move significantly</div>
                    <div>• Trading fees help offset any potential losses</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        
        <DialogFooter className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button 
            onClick={handleAddLiquidity} 
            disabled={
              !amount || 
              parseFloat(amount) <= 0 || 
              isLoading || 
              isCheckingBalance ||
              isLoadingBins ||
              existingBinRanges.length === 0 ||
              (balanceInfo ? !balanceInfo.hasEnoughSol : false)
            }
            className="bg-primary hover:bg-primary/80 w-full sm:w-auto order-1 sm:order-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Adding Liquidity...
              </>
            ) : isLoadingBins ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              'Add Liquidity'
            )}
          </Button>
          <Button 
            variant="outline" 
            onClick={onClose} 
            disabled={isLoading || isLoadingBins}
            className="w-full sm:w-auto order-2 sm:order-1"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddLiquidityModal;