// src/services/walletService.ts
import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { EncryptionService } from '../utils/encryption';
import { PrivateKeyParser } from '../utils/privateKeyParser';
import * as db from './db';

export class WalletService {
  private connection: Connection;
  private zbtcMint: PublicKey;
  private encryption: EncryptionService;

  constructor(rpcUrl: string, zbtcMintAddress: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.zbtcMint = new PublicKey(zbtcMintAddress);
    this.encryption = new EncryptionService(); // Initialize after dotenv loads
  }

  /**
   * Create new wallet and save to database
   */
  async createWallet(userId: string): Promise<{
    publicKey: string;
    privateKey: string;
    privateKeyBase58: string;
  }> {
    // Generate new Solana keypair
    const keypair = Keypair.generate();
    const privateKeyArray = Array.from(keypair.secretKey);
    const privateKeyJson = JSON.stringify(privateKeyArray);

    // Encrypt private key (store as JSON array internally)
    const { encrypted, iv } = this.encryption.encrypt(privateKeyJson);

    // Save to database
    await db.createWallet(
      userId,
      keypair.publicKey.toString(),
      encrypted,
      iv
    );

    console.log(`✅ Wallet created and saved to DB for user ${userId}`);

    // Return both formats
    return {
      publicKey: keypair.publicKey.toString(),
      privateKey: privateKeyJson, // Keep for compatibility
      privateKeyBase58: this.arrayToBase58(keypair.secretKey), // Base58 format like Phantom
    };
  }

  /**
   * Convert Uint8Array to Base58 string (Phantom/Solflare format)
   */
  private arrayToBase58(secretKey: Uint8Array): string {
    const bs58 = require('bs58');
    return bs58.encode(secretKey);
  }

  /**
   * Convert Base58 string to Uint8Array
   */
  private base58ToArray(base58: string): Uint8Array {
    const bs58 = require('bs58');
    return bs58.decode(base58);
  }

  /**
   * Import existing wallet and save to database
   * Supports multiple formats: Base58, JSON array, hex, mnemonic, comma-separated
   */
  async importWallet(userId: string, privateKeyInput: string): Promise<{
    publicKey: string;
    format: string;
  } | null> {
    try {
      // Parse private key from any supported format
      const { secretKey, format } = PrivateKeyParser.parse(privateKeyInput);

      // Validate secret key
      if (!PrivateKeyParser.validateSecretKey(secretKey)) {
        throw new Error('Invalid private key: failed validation');
      }

      const keypair = Keypair.fromSecretKey(secretKey);

      // Convert to JSON array format for consistent storage
      const privateKeyArray = Array.from(secretKey);
      const privateKeyJson = JSON.stringify(privateKeyArray);

      // Encrypt private key
      const { encrypted, iv } = this.encryption.encrypt(privateKeyJson);

      // Save to database
      await db.createWallet(
        userId,
        keypair.publicKey.toString(),
        encrypted,
        iv
      );

      console.log(`✅ Wallet imported (${format} format) and saved to DB for user ${userId}`);

      return {
        publicKey: keypair.publicKey.toString(),
        format
      };
    } catch (error) {
      console.error('Failed to import wallet:', error);
      return null;
    }
  }

  /**
   * Get wallet public key (no decryption needed)
   */
  async getPublicKey(userId: string): Promise<string | null> {
    const wallet = await db.getWallet(userId);
    return wallet?.publicKey || null;
  }

  /**
   * Get keypair for signing transactions (decrypts on-demand)
   */
  async getKeypair(userId: string): Promise<Keypair | null> {
    const wallet = await db.getWallet(userId);
    if (!wallet) return null;

    try {
      // Decrypt private key
      const privateKeyJson = this.encryption.decrypt(wallet.encrypted, wallet.iv);
      const secretKey = new Uint8Array(JSON.parse(privateKeyJson));
      
      return Keypair.fromSecretKey(secretKey);
    } catch (error) {
      console.error('Failed to decrypt wallet:', error);
      return null;
    }
  }

  /**
   * Export private key (for user backup)
   */
  async exportPrivateKey(userId: string): Promise<string | null> {
    const wallet = await db.getWallet(userId);
    if (!wallet) return null;

    try {
      // Decrypt and return private key
      const privateKeyJson = this.encryption.decrypt(wallet.encrypted, wallet.iv);
      return privateKeyJson;
    } catch (error) {
      console.error('Failed to export private key:', error);
      return null;
    }
  }

  /**
   * Get SOL and ZBTC balance
   */
  async getBalance(userId: string): Promise<{ sol: number; zbtc: number } | null> {
    const wallet = await db.getWallet(userId);
    if (!wallet) return null;

    try {
      const publicKey = new PublicKey(wallet.publicKey);

      // Get SOL balance
      const solBalance = await this.connection.getBalance(publicKey);

      // Get ZBTC token balance
      let zbtcBalance = 0;
      try {
        const tokenAccount = await getAssociatedTokenAddress(
          this.zbtcMint,
          publicKey
        );

        const accountInfo = await getAccount(
          this.connection,
          tokenAccount,
          'confirmed',
          TOKEN_PROGRAM_ID
        );

        // ZBTC has 8 decimals
        zbtcBalance = Number(accountInfo.amount) / Math.pow(10, 8);
      } catch (error) {
        // Token account doesn't exist = 0 balance
        zbtcBalance = 0;
      }

      return {
        sol: solBalance / LAMPORTS_PER_SOL,
        zbtc: zbtcBalance,
      };
    } catch (error) {
      console.error('Failed to get balance:', error);
      return null;
    }
  }

  /**
   * Check if user has wallet
   */
  async hasWallet(userId: string): Promise<boolean> {
    const wallet = await db.getWallet(userId);
    return wallet !== null;
  }
}