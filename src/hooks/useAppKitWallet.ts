/**
 * Compatibility hooks that map Reown AppKit to the same interface
 * as @solana/wallet-adapter-react's useWallet() and useConnection().
 *
 * This allows all existing components to work without changes.
 */
import { useMemo, useCallback } from 'react'
import { useAppKit, useAppKitAccount, useAppKitProvider, useDisconnect } from '@reown/appkit/react'
import { useAppKitConnection } from '@reown/appkit-adapter-solana/react'
import type { Provider } from '@reown/appkit-adapter-solana/react'
import {
  PublicKey,
  type Connection,
  type Transaction,
  type VersionedTransaction,
  type Signer,
  type SendOptions,
} from '@solana/web3.js'

interface SendTransactionOptions extends SendOptions {
  signers?: Signer[]
}

/** Drop-in replacement for @solana/wallet-adapter-react useWallet() */
export function useWallet() {
  const { address, isConnected, status } = useAppKitAccount()
  const { walletProvider } = useAppKitProvider<Provider>('solana')
  const { open } = useAppKit()
  const { disconnect: appKitDisconnect } = useDisconnect()

  const publicKey = useMemo(() => {
    if (!address) return null
    try {
      return new PublicKey(address)
    } catch {
      return null
    }
  }, [address])

  const sendTransaction = useCallback(
    async (
      transaction: Transaction | VersionedTransaction,
      connection: Connection,
      options?: SendTransactionOptions
    ) => {
      if (!walletProvider) throw new Error('Wallet not connected')

      // If additional signers are provided, partially sign the transaction first
      if (options?.signers?.length) {
        const tx = transaction as Transaction
        tx.partialSign(...options.signers)
      }

      const signature = await walletProvider.sendTransaction(transaction, connection)
      return signature
    },
    [walletProvider]
  )

  const signTransaction = useCallback(
    async <T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> => {
      if (!walletProvider?.signTransaction) throw new Error('Wallet does not support signTransaction')
      return walletProvider.signTransaction(transaction) as Promise<T>
    },
    [walletProvider]
  )

  const signAllTransactions = useCallback(
    async <T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> => {
      if (!walletProvider?.signAllTransactions) throw new Error('Wallet does not support signAllTransactions')
      return walletProvider.signAllTransactions(transactions) as Promise<T[]>
    },
    [walletProvider]
  )

  const signMessage = useCallback(
    async (message: Uint8Array): Promise<Uint8Array> => {
      if (!walletProvider?.signMessage) throw new Error('Wallet does not support signMessage')
      return walletProvider.signMessage(message)
    },
    [walletProvider]
  )

  const connect = useCallback(async () => {
    await open()
  }, [open])

  const disconnect = useCallback(async () => {
    await appKitDisconnect()
  }, [appKitDisconnect])

  return {
    publicKey,
    connected: isConnected,
    connecting: status === 'connecting',
    disconnecting: status === 'disconnected' && isConnected,
    wallet: walletProvider ? { adapter: { name: 'Reown' } } : null,
    connect,
    disconnect,
    sendTransaction,
    signTransaction,
    signAllTransactions,
    signMessage,
  }
}

/** Drop-in replacement for @solana/wallet-adapter-react useConnection() */
export function useConnection() {
  const { connection } = useAppKitConnection()
  return { connection: connection as Connection }
}
