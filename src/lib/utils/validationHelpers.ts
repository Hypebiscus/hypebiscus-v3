// Reusable validation helper functions
// Used across multiple validators to eliminate duplication

import { ValidationError } from './validation';

// Shared XSS pattern for detecting potentially malicious content
export const XSS_PATTERN = /<script|javascript:|on\w+\s*=/i;

/**
 * Validate role field (user or assistant)
 * @param role - The role value to validate
 * @param fieldName - Name of the field for error messages
 * @throws ValidationError if role is invalid
 */
export function validateRole(role: unknown, fieldName: string = 'role'): void {
  if (!role || !['user', 'assistant'].includes(role as string)) {
    throw new ValidationError(`${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} must be "user" or "assistant"`, fieldName);
  }
}

/**
 * Validate string content with length and XSS checks
 * @param content - The content to validate
 * @param fieldName - Name of the field for error messages
 * @param maxLength - Maximum allowed length
 * @param required - Whether the field is required (default: true)
 * @throws ValidationError if content is invalid
 */
export function validateContent(
  content: unknown,
  fieldName: string,
  maxLength: number,
  required: boolean = true
): void {
  // Type check
  if (typeof content !== 'string') {
    throw new ValidationError(`${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} must be a string`, fieldName);
  }

  // Empty check (only if required)
  if (required && content.length === 0) {
    throw new ValidationError(`${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} cannot be empty`, fieldName);
  }

  // Length check
  if (content.length > maxLength) {
    throw new ValidationError(
      `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} too long. Maximum ${maxLength.toLocaleString()} characters allowed`,
      fieldName
    );
  }

  // XSS prevention - reject obvious script tags
  if (XSS_PATTERN.test(content)) {
    throw new ValidationError(
      `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} contains potentially malicious content`,
      fieldName
    );
  }
}

/**
 * Validate optional object parameter with size limit
 * @param obj - The object to validate
 * @param fieldName - Name of the field for error messages
 * @param maxSize - Maximum serialized size in bytes
 * @throws ValidationError if object is invalid
 */
export function validateOptionalObject(
  obj: unknown,
  fieldName: string,
  maxSize: number
): void {
  // Allow undefined (optional parameter)
  if (obj === undefined) {
    return;
  }

  // Type check
  if (typeof obj !== 'object' || obj === null) {
    throw new ValidationError(
      `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} must be an object`,
      fieldName
    );
  }

  // Size check
  const serialized = JSON.stringify(obj);
  if (serialized.length > maxSize) {
    const sizeMB = maxSize >= 1000 ? `${(maxSize / 1000).toFixed(0)}KB` : `${maxSize} bytes`;
    throw new ValidationError(
      `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} too large. Maximum ${sizeMB} allowed`,
      fieldName
    );
  }
}

/**
 * Validate Solana wallet address format
 * @param walletAddress - The wallet address to validate
 * @param fieldName - Name of the field for error messages
 * @param required - Whether the field is required (default: true)
 * @throws ValidationError if wallet address is invalid
 */
export function validateWalletAddress(
  walletAddress: unknown,
  fieldName: string = 'walletAddress',
  required: boolean = true
): void {
  // Allow undefined if not required
  if (!required && walletAddress === undefined) {
    return;
  }

  // Type and presence check
  if (!walletAddress || typeof walletAddress !== 'string') {
    if (required) {
      throw new ValidationError('Wallet address is required', fieldName);
    }
    return;
  }

  // Length check (Solana base58: 32-44 characters)
  if (walletAddress.length < 32 || walletAddress.length > 44) {
    throw new ValidationError('Invalid wallet address length', fieldName);
  }

  // Format check (base58 alphabet)
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(walletAddress)) {
    throw new ValidationError('Invalid wallet address format', fieldName);
  }
}
