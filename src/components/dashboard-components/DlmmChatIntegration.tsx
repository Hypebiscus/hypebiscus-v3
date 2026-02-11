"use client";

import React, { useEffect, useRef, useCallback } from 'react';
import { useMeteoraDlmmService } from '@/lib/meteora/meteoraDlmmService';
import { useMeteoraPositionService } from '@/lib/meteora/meteoraPositionService';
import { parseDlmmCommand, CommandType, CommandResult } from '@/lib/meteora/meteoraChatCommands';
import { useWallet } from '@/hooks/useAppKitWallet';
// import { BN } from 'bn.js';

// Define types for the data objects
interface PoolData {
  name: string;
  address: string;
  price: string | number;
  binStep: string | number;
  [key: string]: unknown; // Using unknown instead of any for better type safety
}


interface PositionData {
  id: string;
  bins: number;
  totalValue?: number;
  [key: string]: unknown; // Using unknown instead of any for better type safety
}

// Command data interfaces
interface AddLiquidityData {
  amount: number;
  token?: string;
  poolAddress: string;
}

interface RemoveLiquidityData {
  percentage: number;
  positionId: string;
}

interface PositionActionData {
  positionId: string;
}

interface SwapData {
  amount: number;
  fromToken: string;
  toToken: string;
  poolAddress?: string;
}

// Interface for message handlers
interface MessageHandlers {
  onMessageSend: (message: string) => void;
}

// DlmmChatIntegration component
const DlmmChatIntegration: React.FC<MessageHandlers> = ({ onMessageSend }) => {
  // Store the original message handler in a ref to avoid issues with closures
  const originalMessageSendRef = useRef(onMessageSend);
  
  // const { publicKey, signTransaction, sendTransaction } = useWallet();
  const { publicKey } = useWallet();
  const { service: dlmmService } = useMeteoraDlmmService();
  const { service: positionService } = useMeteoraPositionService();
  
  // Handle DLMM command
  const handleDlmmCommand = useCallback(async (message: string): Promise<string> => {
    // Format pools response
    const formatPoolsResponse = (result: CommandResult): string => {
      if (!result.success || !result.data?.pools) {
        return result.message;
      }
  
      const pools = result.data.pools;
      if (pools.length === 0) {
        return "No DLMM pools found.";
      }
  
      let response = `Here are the available DLMM pools:\n\n`;
      pools.slice(0, 5).forEach((pool, index: number) => {
        // Use type assertion to treat pool as PoolData
        const poolData = pool as unknown as PoolData;
        response += `${index + 1}. ${poolData.name}\n`;
        response += `   Address: ${poolData.address.substring(0, 8)}...\n`;
        response += `   Price: ${poolData.price}\n`;
        response += `   Bin Step: ${poolData.binStep}\n\n`;
      });
  
      if (pools.length > 5) {
        response += `... and ${pools.length - 5} more pools.`;
      }
  
      return response;
    };
  
    // Format positions response
    const formatPositionsResponse = (result: CommandResult): string => {
      if (!result.success || !result.data?.positions) {
        return result.message;
      }
  
      const positions = result.data.positions;
      if (positions.length === 0) {
        return "You don't have any positions in this pool.";
      }
  
      let response = `Here are your DLMM positions:\n\n`;
      positions.forEach((position, index: number) => {
        // Use type assertion to treat position as PositionData
        const positionData = position as unknown as PositionData;
        response += `${index + 1}. Position ID: ${positionData.id.substring(0, 8)}...\n`;
        response += `   Number of Bins: ${positionData.bins}\n`;
        if (positionData.totalValue) {
          response += `   Total Value: $${positionData.totalValue.toFixed(2)}\n`;
        }
        response += `\n`;
      });
  
      return response;
    };
  
    // Handle add liquidity
    const handleAddLiquidity = async (result: CommandResult): Promise<string> => {
      if (!publicKey) {
        return "Please connect your wallet to add liquidity.";
      }
  
      try {
        const { amount, token, poolAddress } = result.data as AddLiquidityData;
        
        // This would be a placeholder - in a real implementation, you'd create a transaction
        // and send it to the blockchain
        
        // Example:
        // 1. Get active bin for the pool
        // const activeBin = await dlmmService.getActiveBin(poolAddress);
        
        // 2. Set bin range (10 bins above and below active bin)
        // const minBinId = activeBin.binId - 10;
        // const maxBinId = activeBin.binId + 10;
        
        // 3. Convert amount to lamports/smallest unit (example: assumes 9 decimals)
        // const decimals = 9; // This should be fetched from the token metadata
        // const bnAmount = new BN(amount * Math.pow(10, decimals));
        
        // 4. Prepare transaction
        // Note: This would be much more complex in a real implementation
        // This is just a placeholder for the demonstration
        return `Successfully prepared add liquidity transaction for ${amount} ${token || ''} to pool ${poolAddress.substring(0, 8)}... This would create a balanced position around the current price using Spot strategy. Would you like to proceed with this transaction?`;
      } catch (error) {
        console.error('Error preparing add liquidity transaction:', error);
        return "Failed to prepare add liquidity transaction. Please try again later.";
      }
    };
  
    // Handle remove liquidity
    const handleRemoveLiquidity = async (result: CommandResult): Promise<string> => {
      if (!publicKey) {
        return "Please connect your wallet to remove liquidity.";
      }
  
      try {
        const { percentage, positionId } = result.data as RemoveLiquidityData;
        
        // This would be a placeholder - in a real implementation, you'd create a transaction
        // and send it to the blockchain
        
        return `Successfully prepared remove liquidity transaction for ${percentage}% from position ${positionId.substring(0, 8)}... Would you like to proceed with this transaction?`;
      } catch (error) {
        console.error('Error preparing remove liquidity transaction:', error);
        return "Failed to prepare remove liquidity transaction. Please try again later.";
      }
    };
  
    // Handle claim fees
    const handleClaimFees = async (result: CommandResult): Promise<string> => {
      if (!publicKey) {
        return "Please connect your wallet to claim fees.";
      }
  
      try {
        const { positionId } = result.data as PositionActionData;
        
        // This would be a placeholder - in a real implementation, you'd create a transaction
        // and send it to the blockchain
        
        return `Successfully prepared claim fees transaction for position ${positionId.substring(0, 8)}... Would you like to proceed with this transaction?`;
      } catch (error) {
        console.error('Error preparing claim fees transaction:', error);
        return "Failed to prepare claim fees transaction. Please try again later.";
      }
    };
  
    // Handle close position
    const handleClosePosition = async (result: CommandResult): Promise<string> => {
      if (!publicKey) {
        return "Please connect your wallet to close a position.";
      }
  
      try {
        const { positionId } = result.data as PositionActionData;
        
        // This would be a placeholder - in a real implementation, you'd create a transaction
        // and send it to the blockchain
        
        return `Successfully prepared close position transaction for position ${positionId.substring(0, 8)}... Would you like to proceed with this transaction?`;
      } catch (error) {
        console.error('Error preparing close position transaction:', error);
        return "Failed to prepare close position transaction. Please try again later.";
      }
    };
  
    // Handle swap
    const handleSwap = async (result: CommandResult): Promise<string> => {
      if (!publicKey) {
        return "Please connect your wallet to perform a swap.";
      }
  
      try {
        const { amount, fromToken, toToken, poolAddress } = result.data as SwapData;
        
        // This would be a placeholder - in a real implementation, you'd create a transaction
        // and send it to the blockchain
        
        // Example swap quote calculation:
        let poolAddressToUse = poolAddress;
        
        // If no pool address was provided, find a pool that supports this token pair
        if (!poolAddressToUse) {
          // This is just a placeholder - you'd need to implement pool discovery logic
          poolAddressToUse = "ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq"; // Default to a known pool
        }
        
        return `Successfully prepared swap transaction for ${amount} ${fromToken} to ${toToken} using pool ${poolAddressToUse.substring(0, 8)}... You'll receive approximately X ${toToken} (estimate). Would you like to proceed with this transaction?`;
      } catch (error) {
        console.error('Error preparing swap transaction:', error);
        return "Failed to prepare swap transaction. Please try again later.";
      }
    };

    // Parse the command
    const commandResult = await parseDlmmCommand({
      command: message,
      userPublicKey: publicKey || undefined,
      service: {
        dlmm: dlmmService,
        position: positionService
      }
    });

    // Handle the result based on command type
    switch (commandResult.type) {
      case CommandType.GET_POOLS:
        return formatPoolsResponse(commandResult);
      
      case CommandType.GET_POSITION:
        return formatPositionsResponse(commandResult);
      
      case CommandType.ADD_LIQUIDITY:
        if (commandResult.success) {
          return await handleAddLiquidity(commandResult);
        }
        return commandResult.message;
      
      case CommandType.REMOVE_LIQUIDITY:
        if (commandResult.success) {
          return await handleRemoveLiquidity(commandResult);
        }
        return commandResult.message;
      
      case CommandType.CLAIM_FEES:
        if (commandResult.success) {
          return await handleClaimFees(commandResult);
        }
        return commandResult.message;
      
      case CommandType.CLOSE_POSITION:
        if (commandResult.success) {
          return await handleClosePosition(commandResult);
        }
        return commandResult.message;
      
      case CommandType.SWAP:
        if (commandResult.success) {
          return await handleSwap(commandResult);
        }
        return commandResult.message;
      
      case CommandType.UNKNOWN:
      default:
        // If it doesn't look like a DLMM command, return null to let normal chat processing happen
        if (commandResult.error === "Unknown command") {
          return "";
        }
        return commandResult.message;
    }
  }, [publicKey, dlmmService, positionService]);

  // Initialize command processing
  useEffect(() => {
    // Update ref to latest onMessageSend
    originalMessageSendRef.current = onMessageSend;
    
    // Create a new handler function that processes DLMM commands
    // const handleMessage = async (message: string) => {
    //   const response = await handleDlmmCommand(message);
      
    //   // If the message was processed as a DLMM command
    //   if (response) {
    //     // Add user message to chat
    //     originalMessageSendRef.current(message);
        
    //     // Add assistant response
    //     setTimeout(() => {
    //       // Simulate assistant response (in a real implementation, you'd integrate with your chat system)
    //       console.log("DLMM Assistant:", response);
          
    //       // Here you would update the chat UI with the response
    //       // This is just a placeholder - your implementation would depend on your chat system
    //     }, 500);
        
    //     return;
    //   }
      
    //   // If it wasn't processed as a DLMM command, pass it to the original handler
    //   originalMessageSendRef.current(message);
    // };
    
    // This is a workaround since we can't directly modify the parent's onMessageSend function
    // In a real implementation, you'd probably use a context or a different architecture
    // onMessageSend = handleMessage;
    
    // No cleanup needed as we're not actually modifying onMessageSend
  }, [publicKey, dlmmService, positionService, onMessageSend, handleDlmmCommand]);
  
  // No UI elements - this is just a wrapper component
  return null;
};

export default DlmmChatIntegration;