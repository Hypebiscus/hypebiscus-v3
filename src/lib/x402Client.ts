/**
 * x402 Payment Client for Subscriptions and Credits
 *
 * Properly implements the x402 protocol using the official x402-solana SDK.
 * Handles automatic HTTP 402 payment flows with PayAI Network facilitator.
 *
 * Architecture:
 * 1. Client makes request to x402-protected API endpoint
 * 2. Server returns HTTP 402 with PaymentRequirements
 * 3. SDK automatically constructs payment, signs with wallet
 * 4. SDK retries request with X-PAYMENT header
 * 5. Server verifies payment via facilitator, returns content
 */

import { createX402Client } from '@payai/x402-solana/client';
import type { WalletAdapter } from '@payai/x402-solana/client';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

// Network configuration
const NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta' ? 'solana' : 'solana-devnet';
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// Pricing constants (exported for UI display)
export const SUBSCRIPTION_PRICE = 4.99;
export const SUBSCRIPTION_PRICE_MICRO_USDC = 4_990_000; // $4.99 USDC

export const CREDIT_PACKAGES = {
  trial: { amount: 1, price: 0.01, priceInMicro: 10_000 },
  starter: { amount: 1000, price: 10.00, priceInMicro: 10_000_000 },
  power: { amount: 2500, price: 25.00, priceInMicro: 25_000_000 },
  pro: { amount: 5000, price: 50.00, priceInMicro: 50_000_000 },
} as const;

export type CreditPackage = keyof typeof CREDIT_PACKAGES;

// Payment result interface
export interface PaymentResult {
  success: boolean;
  signature?: string;
  error?: string;
  data?: unknown;
}

/**
 * Create x402 client with Solana wallet adapter
 */
export function createHypebiscusX402Client(
  wallet: {
    publicKey: PublicKey | null;
    signTransaction: ((tx: Transaction) => Promise<Transaction>) |
                      ((tx: VersionedTransaction) => Promise<VersionedTransaction>);
  }
): ReturnType<typeof createX402Client> {
  if (!wallet.publicKey) {
    throw new Error('Wallet not connected');
  }

  // Adapt Solana wallet to x402 WalletAdapter interface
  // Official x402-solana supports both publicKey object OR address string
  // Using address string for simplicity (matches official examples)
  const walletAdapter: WalletAdapter = {
    address: wallet.publicKey.toBase58(),
    signTransaction: async (tx: VersionedTransaction) => {
      // Solana wallet adapters can sign both Transaction and VersionedTransaction
      const signed = await wallet.signTransaction(tx as unknown as Transaction & VersionedTransaction);
      return signed as VersionedTransaction;
    }
  };

  return createX402Client({
    wallet: walletAdapter,
    network: NETWORK as 'solana' | 'solana-devnet',
    rpcUrl: RPC_URL,
    maxPaymentAmount: BigInt(100_000_000), // $100 max payment
  });
}

/**
 * Purchase subscription using x402 protocol
 *
 * @param wallet - Solana wallet adapter
 * @returns Payment result with transaction signature
 */
export async function purchaseSubscription(
  wallet: {
    publicKey: PublicKey | null;
    signTransaction: ((tx: Transaction) => Promise<Transaction>) |
                      ((tx: VersionedTransaction) => Promise<VersionedTransaction>);
  }
): Promise<PaymentResult> {
  try {
    if (!wallet.publicKey) {
      throw new Error('Wallet not connected');
    }

    console.log('[x402] Purchasing subscription for:', wallet.publicKey.toBase58());

    // Create x402 client
    const x402Client = createHypebiscusX402Client(wallet);

    // Make request to x402-protected subscription endpoint
    // The client will automatically handle the 402 flow:
    // 1. GET /api/subscriptions/purchase → receives 402 response
    // 2. Constructs payment transaction based on PaymentRequirements
    // 3. Signs transaction with wallet
    // 4. Retries GET with X-PAYMENT header
    // 5. Server verifies payment and creates subscription
    const response = await x402Client.fetch('/api/subscriptions/purchase', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        walletAddress: wallet.publicKey.toBase58(),
        tier: 'premium'
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Payment failed' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    const result = await response.json();

    console.log('[x402] Subscription purchase successful:', result);

    return {
      success: true,
      signature: result.transactionSignature,
      data: result
    };
  } catch (error) {
    console.error('[x402] Subscription purchase failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Payment failed',
    };
  }
}

/**
 * Purchase credits using x402 protocol
 *
 * @param wallet - Solana wallet adapter
 * @param packageName - Credit package to purchase
 * @returns Payment result with transaction signature
 */
export async function purchaseCredits(
  wallet: {
    publicKey: PublicKey | null;
    signTransaction: ((tx: Transaction) => Promise<Transaction>) |
                      ((tx: VersionedTransaction) => Promise<VersionedTransaction>);
  },
  packageName: CreditPackage
): Promise<PaymentResult> {
  try {
    if (!wallet.publicKey) {
      throw new Error('Wallet not connected');
    }

    const pkg = CREDIT_PACKAGES[packageName];
    console.log(`[x402] Purchasing ${pkg.amount} credits for $${pkg.price}`);

    // Create x402 client
    const x402Client = createHypebiscusX402Client(wallet);

    // Make request to x402-protected credits endpoint
    const response = await x402Client.fetch('/api/credits/purchase', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        walletAddress: wallet.publicKey.toBase58(),
        package: packageName,
        creditsAmount: pkg.amount,
        expectedPrice: pkg.price
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Payment failed' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    const result = await response.json();

    console.log('[x402] Credits purchase successful:', result);

    return {
      success: true,
      signature: result.transactionSignature,
      data: result
    };
  } catch (error) {
    console.error('[x402] Credits purchase failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Payment failed',
    };
  }
}

/**
 * Legacy x402PaymentClient for backward compatibility
 * Wraps the new x402 SDK-based functions
 */
export const x402PaymentClient = {
  purchaseSubscription,
  purchaseCredits,
};
