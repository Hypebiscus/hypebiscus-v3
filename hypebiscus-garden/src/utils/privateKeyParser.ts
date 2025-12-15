/**
 * Private Key Parser Utility
 *
 * Supports multiple Solana private key formats:
 * 1. Base58 string (Phantom/Solflare export format)
 * 2. JSON array [1,2,3,...,64]
 * 3. Comma-separated numbers: 1,2,3,...,64
 * 4. Hex string (0x... or without prefix)
 * 5. Mnemonic seed phrase (12 or 24 words)
 */

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

export interface ParsedPrivateKey {
  secretKey: Uint8Array;
  format: 'base58' | 'json' | 'hex' | 'mnemonic' | 'comma-separated';
}

export class PrivateKeyParser {
  /**
   * Parse private key from various formats and return Uint8Array
   */
  static parse(input: string): ParsedPrivateKey {
    const trimmed = input.trim();

    // 1. Try Base58 format (most common - Phantom/Solflare)
    if (this.isBase58(trimmed)) {
      try {
        const secretKey = bs58.decode(trimmed);
        if (secretKey.length === 64) {
          return { secretKey, format: 'base58' };
        }
      } catch (e) {
        // Not valid base58, continue
      }
    }

    // 2. Try JSON array format: [1,2,3,...,64]
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const array = JSON.parse(trimmed);
        if (Array.isArray(array) && array.length === 64) {
          const secretKey = new Uint8Array(array);
          return { secretKey, format: 'json' };
        }
      } catch (e) {
        // Not valid JSON, continue
      }
    }

    // 3. Try comma-separated numbers: 1,2,3,...,64
    if (trimmed.includes(',') && !trimmed.includes('[')) {
      try {
        const numbers = trimmed.split(',').map(s => parseInt(s.trim(), 10));
        if (numbers.length === 64 && numbers.every(n => n >= 0 && n <= 255)) {
          const secretKey = new Uint8Array(numbers);
          return { secretKey, format: 'comma-separated' };
        }
      } catch (e) {
        // Not valid comma-separated, continue
      }
    }

    // 4. Try hex format (with or without 0x prefix)
    if (this.isHex(trimmed)) {
      try {
        const hex = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
        if (hex.length === 128) { // 64 bytes = 128 hex chars
          const secretKey = this.hexToUint8Array(hex);
          return { secretKey, format: 'hex' };
        }
      } catch (e) {
        // Not valid hex, continue
      }
    }

    // 5. Try mnemonic seed phrase (12 or 24 words)
    if (this.isMnemonic(trimmed)) {
      try {
        const secretKey = this.mnemonicToSecretKey(trimmed);
        return { secretKey, format: 'mnemonic' };
      } catch (e) {
        // Not valid mnemonic, continue
      }
    }

    throw new Error('Invalid private key format. Supported formats: Base58, JSON array, hex, mnemonic, or comma-separated numbers.');
  }

  /**
   * Check if string is valid Base58
   */
  private static isBase58(str: string): boolean {
    return /^[1-9A-HJ-NP-Za-km-z]+$/.test(str) && str.length >= 32;
  }

  /**
   * Check if string is valid hex
   */
  private static isHex(str: string): boolean {
    const hex = str.startsWith('0x') ? str.slice(2) : str;
    return /^[0-9a-fA-F]+$/.test(hex);
  }

  /**
   * Check if string is valid mnemonic (12 or 24 words)
   */
  private static isMnemonic(str: string): boolean {
    const words = str.trim().split(/\s+/);
    return (words.length === 12 || words.length === 24) && bip39.validateMnemonic(str);
  }

  /**
   * Convert hex string to Uint8Array
   */
  private static hexToUint8Array(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }

  /**
   * Convert mnemonic to secret key using Solana derivation path
   */
  private static mnemonicToSecretKey(mnemonic: string): Uint8Array {
    // Validate mnemonic
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase');
    }

    // Generate seed from mnemonic
    const seed = bip39.mnemonicToSeedSync(mnemonic, ''); // Passphrase is empty for most wallets

    // Derive Solana keypair using BIP44 path: m/44'/501'/0'/0'
    // 501 is Solana's coin type
    const path = "m/44'/501'/0'/0'";
    const derivedSeed = derivePath(path, seed.toString('hex')).key;

    return derivedSeed;
  }

  /**
   * Validate that the secret key can create a valid Keypair
   */
  static validateSecretKey(secretKey: Uint8Array): boolean {
    try {
      if (secretKey.length !== 64) {
        return false;
      }
      Keypair.fromSecretKey(secretKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get format examples for user guidance
   */
  static getFormatExamples(): string {
    return `**Supported Formats:**

1️⃣ **Base58** (Phantom/Solflare):
\`5Kd3N...\` (43-88 characters)

2️⃣ **JSON Array**:
\`[123,45,67,...,234]\` (64 numbers, 0-255)

3️⃣ **Hex String**:
\`0x1a2b3c...\` or \`1a2b3c...\` (128 hex characters)

4️⃣ **Comma-Separated**:
\`123,45,67,...,234\` (64 numbers)

5️⃣ **Seed Phrase** (12 or 24 words):
\`word1 word2 word3...\``;
  }
}
