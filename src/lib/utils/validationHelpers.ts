// Reusable validation helper functions
// Used across multiple validators to eliminate duplication

import { ValidationError } from './validation';

// Shared XSS pattern for detecting potentially malicious content
// Covers: script tags, event handlers, javascript: URLs, iframes, data URLs, and other vectors
export const XSS_PATTERN = /<(?:script|iframe|object|embed|applet|meta|link|style|base)|javascript:|data:text\/html|on\w+\s*=/i;

/**
 * Validate role field (user or assistant)
 * @param role - The role value to validate
 * @param fieldName - Name of the field for error messages
 * @throws ValidationError if role is invalid
 */
export function validateRole(role: unknown, fieldName: string = 'role'): void {
  // Type check FIRST to prevent bypass with empty string or non-strings
  if (typeof role !== 'string') {
    throw new ValidationError(`${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} must be a string`, fieldName);
  }

  // Validate value is one of allowed roles
  if (!['user', 'assistant'].includes(role)) {
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

  // Prototype pollution protection - reject dangerous properties
  if (
    Object.prototype.hasOwnProperty.call(obj, '__proto__') ||
    Object.prototype.hasOwnProperty.call(obj, 'constructor') ||
    Object.prototype.hasOwnProperty.call(obj, 'prototype')
  ) {
    throw new ValidationError(
      `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} contains forbidden properties`,
      fieldName
    );
  }

  // Size check with error handling for circular references
  let serialized: string;
  try {
    serialized = JSON.stringify(obj);
  } catch (error) {
    // Catch circular reference errors and other JSON.stringify failures
    throw new ValidationError(
      `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} cannot be serialized (possible circular reference)`,
      fieldName
    );
  }

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

  // Type check FIRST to prevent bypass
  if (typeof walletAddress !== 'string') {
    if (required) {
      throw new ValidationError('Wallet address is required', fieldName);
    }
    return;
  }

  // Check for empty string (if required)
  if (required && walletAddress.length === 0) {
    throw new ValidationError('Wallet address is required', fieldName);
  }

  // Allow empty if not required
  if (!required && walletAddress.length === 0) {
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
