// src/hooks/useEnhancedWallet.ts

import { useWallet } from '@/hooks/useAppKitWallet';
import { useCallback, useMemo } from 'react';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';

interface EnhancedWalletState {
  // Wallet connection state
  isConnected: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  
  // Wallet info
  publicKey: PublicKey | null;
  walletName: string | null;
  
  // Connection utilities
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  
  // Transaction utilities
  signAndSendTransaction: (transaction: Transaction, connection: Connection) => Promise<string>;
  
  // State checks
  canTransact: boolean;
  connectionStatus: 'connected' | 'connecting' | 'disconnecting' | 'disconnected';
}

/**
 * Enhanced wallet hook with better state management and utilities
 */
export function useEnhancedWallet(): EnhancedWalletState {
  const {
    publicKey,
    connected,
    connecting,
    disconnecting,
    wallet,
    connect: walletConnect,
    disconnect: walletDisconnect,
    sendTransaction
  } = useWallet();

  // Enhanced connection function with error handling
  const connect = useCallback(async () => {
    try {
      if (!wallet) {
        throw new Error('No wallet selected');
      }
      await walletConnect();
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      throw error;
    }
  }, [wallet, walletConnect]);

  // Enhanced disconnection function
  const disconnect = useCallback(async () => {
    try {
      await walletDisconnect();
    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
      throw error;
    }
  }, [walletDisconnect]);

  // Enhanced transaction sending with better error handling
  const signAndSendTransaction = useCallback(async (
    transaction: Transaction,
    connection: Connection
  ): Promise<string> => {
    if (!publicKey || !connected) {
      throw new Error('Wallet not connected');
    }

    try {
      const signature = await sendTransaction(transaction, connection);
      console.log('Transaction sent:', signature);
      return signature;
    } catch (error) {
      console.error('Transaction failed:', error);
      throw error;
    }
  }, [publicKey, connected, sendTransaction]);

  // Computed connection status
  const connectionStatus = useMemo((): 'connected' | 'connecting' | 'disconnecting' | 'disconnected' => {
    if (connecting) return 'connecting';
    if (disconnecting) return 'disconnecting';
    if (connected) return 'connected';
    return 'disconnected';
  }, [connected, connecting, disconnecting]);

  // Check if wallet can perform transactions
  const canTransact = useMemo(() => {
    return connected && publicKey !== null && !connecting && !disconnecting;
  }, [connected, publicKey, connecting, disconnecting]);

  return {
    // Connection state
    isConnected: connected,
    isConnecting: connecting,
    isDisconnecting: disconnecting,
    
    // Wallet info
    publicKey,
    walletName: wallet?.adapter.name || null,
    
    // Actions
    connect,
    disconnect,
    signAndSendTransaction,
    
    // Computed state
    canTransact,
    connectionStatus
  };
}

/**
 * Hook for wallet connection status messages
 */
export function useWalletStatusMessage(): string {
  const { connectionStatus, walletName } = useEnhancedWallet();
  
  return useMemo(() => {
    switch (connectionStatus) {
      case 'connecting':
        return walletName ? `Connecting to ${walletName}...` : 'Connecting to wallet...';
      case 'disconnecting':
        return 'Disconnecting...';
      case 'connected':
        return walletName ? `Connected to ${walletName}` : 'Wallet connected';
      case 'disconnected':
      default:
        return 'Wallet not connected';
    }
  }, [connectionStatus, walletName]);
}

/**
 * Hook for wallet action buttons
 */
export function useWalletActions() {
  const { connect, disconnect, isConnected, canTransact } = useEnhancedWallet();
  
  const connectWithFeedback = useCallback(async () => {
    try {
      await connect();
      // You could show a success toast here
    } catch (error) {
      // You could show an error toast here
      console.error('Connection failed:', error);
    }
  }, [connect]);

  const disconnectWithFeedback = useCallback(async () => {
    try {
      await disconnect();
      // You could show a success toast here
    } catch (error) {
      // You could show an error toast here
      console.error('Disconnection failed:', error);
    }
  }, [disconnect]);

  return {
    connect: connectWithFeedback,
    disconnect: disconnectWithFeedback,
    isConnected,
    canTransact,
    getActionLabel: () => isConnected ? 'Disconnect' : 'Connect Wallet'
  };
}