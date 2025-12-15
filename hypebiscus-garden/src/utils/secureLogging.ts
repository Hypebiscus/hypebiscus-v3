/**
 * Secure Logging Utilities
 *
 * Provides functions to safely log sensitive data without exposing
 * full values (private keys, secrets, tokens, etc.)
 */

/**
 * Censor sensitive text by showing only first and last few characters
 *
 * @param text - The sensitive text to censor
 * @param showChars - Number of characters to show at start and end (default: 5)
 * @returns Censored text like "5KQwr...osgAsU"
 */
export function censorSensitiveText(text: string, showChars: number = 5): string {
  if (!text || text.length === 0) {
    return '[empty]';
  }

  // If text is very short, just show asterisks
  if (text.length <= showChars * 2) {
    return '*'.repeat(Math.min(text.length, 10));
  }

  const start = text.substring(0, showChars);
  const end = text.substring(text.length - showChars);
  const hiddenLength = text.length - (showChars * 2);

  return `${start}${'*'.repeat(Math.min(hiddenLength, 20))}${end}`;
}

/**
 * Detect if text appears to be a private key
 * Checks common formats: Base58, JSON array, hex, mnemonic
 */
export function looksLikePrivateKey(text: string): boolean {
  const trimmed = text.trim();

  // Base58 (40-90 characters, alphanumeric)
  if (/^[1-9A-HJ-NP-Za-km-z]{40,90}$/.test(trimmed)) {
    return true;
  }

  // JSON array format [1,2,3,...]
  if (/^\[[\d,\s]+\]$/.test(trimmed)) {
    return true;
  }

  // Hex format (with or without 0x, 64-128 chars)
  if (/^(0x)?[0-9a-fA-F]{64,128}$/.test(trimmed)) {
    return true;
  }

  // Mnemonic (12 or 24 words)
  const words = trimmed.split(/\s+/);
  if (words.length === 12 || words.length === 24) {
    // Check if words are mostly alphabetic (typical of BIP39 words)
    const alphaWords = words.filter(w => /^[a-z]+$/i.test(w));
    if (alphaWords.length >= words.length * 0.8) {
      return true;
    }
  }

  // Comma-separated numbers (64 numbers)
  if (/^[\d,\s]+$/.test(trimmed)) {
    const numbers = trimmed.split(',').map(s => s.trim()).filter(s => s.length > 0);
    if (numbers.length === 64) {
      return true;
    }
  }

  return false;
}

/**
 * Safely log user input, censoring if it looks like a private key
 */
export function safeLogUserInput(userId: number, text: string): void {
  const isPotentialKey = looksLikePrivateKey(text);

  if (isPotentialKey) {
    const censored = censorSensitiveText(text);
    console.log(`📝 Text received from user ${userId}: "${censored}" [CENSORED - potential private key]`);
  } else {
    // Safe to log (not a private key)
    // Still limit length to prevent log spam
    const safeText = text.length > 100 ? text.substring(0, 100) + '...' : text;
    console.log(`📝 Text received from user ${userId}: "${safeText}"`);
  }
}

/**
 * Censor wallet address (show first 8 and last 8 characters)
 */
export function censorWalletAddress(address: string): string {
  if (!address || address.length < 20) {
    return '[invalid-address]';
  }
  return `${address.substring(0, 8)}...${address.substring(address.length - 8)}`;
}

/**
 * Censor email address (show first 2 chars + domain)
 */
export function censorEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) {
    return '[invalid-email]';
  }
  return `${local.substring(0, 2)}***@${domain}`;
}
