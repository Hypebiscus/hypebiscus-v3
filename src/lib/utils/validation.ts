// Input validation utilities for API endpoints

import {
  validateRole,
  validateContent,
  validateOptionalObject,
  validateWalletAddress as validateWalletAddressHelper,
  XSS_PATTERN,
} from './validationHelpers';

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequestBody {
  messages: ChatMessage[]
  poolData?: Record<string, unknown>
  portfolioStyle?: string
  walletAddress?: string
}

export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

// ============================================================================
// Chat Request Validation Helper Functions
// ============================================================================

/**
 * Validate messages array structure and count
 */
function validateMessagesArray(messages: unknown, poolData?: unknown): void {
  if (!messages || !Array.isArray(messages)) {
    throw new ValidationError('Messages must be an array', 'messages')
  }

  // Allow empty messages array if poolData is provided (for initial pool analysis)
  if (messages.length === 0 && !poolData) {
    throw new ValidationError('Messages array cannot be empty when no pool data provided', 'messages')
  }

  if (messages.length > 50) {
    throw new ValidationError('Too many messages. Maximum 50 messages allowed', 'messages')
  }
}

/**
 * Validate a single message structure and content
 */
function validateSingleMessage(message: unknown, index: number): void {
  if (!message || typeof message !== 'object') {
    throw new ValidationError(`Message at index ${index} is invalid`, 'messages')
  }

  const msg = message as Record<string, unknown>

  try {
    // Use shared validation helpers
    validateRole(msg.role, 'role')
    validateContent(msg.content, 'content', 10000, true)
  } catch (error) {
    // Re-throw with index information
    if (error instanceof ValidationError) {
      throw new ValidationError(`Message at index ${index}: ${error.message}`, 'messages')
    }
    throw error
  }
}

/**
 * Validate portfolio style parameter
 */
function validatePortfolioStyle(portfolioStyle: unknown): void {
  if (portfolioStyle === undefined) {
    return
  }

  if (typeof portfolioStyle !== 'string') {
    throw new ValidationError('Portfolio style must be a string', 'portfolioStyle')
  }

  if (portfolioStyle.length > 100) {
    throw new ValidationError('Portfolio style too long. Maximum 100 characters allowed', 'portfolioStyle')
  }
}

/**
 * Validate pool data parameter
 */
function validatePoolData(poolData: unknown): void {
  validateOptionalObject(poolData, 'poolData', 50000)
}

/**
 * Validate Solana wallet address
 */
function validateWalletAddress(walletAddress: unknown): void {
  validateWalletAddressHelper(walletAddress, 'walletAddress', false)
}

/**
 * Main chat request validation function
 * Validates all required and optional parameters for chat API
 */
export function validateChatRequest(body: unknown): ChatRequestBody {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Invalid request body')
  }

  const { messages, poolData, portfolioStyle, walletAddress } = body as Record<string, unknown>

  // Validate messages array
  validateMessagesArray(messages, poolData)

  // Validate each individual message
  if (Array.isArray(messages)) {
    for (let i = 0; i < messages.length; i++) {
      validateSingleMessage(messages[i], i)
    }
  }

  // Validate optional parameters
  validatePortfolioStyle(portfolioStyle)
  validatePoolData(poolData)
  validateWalletAddress(walletAddress)

  return {
    messages: messages as ChatMessage[],
    poolData: poolData as Record<string, unknown> | undefined,
    portfolioStyle: portfolioStyle as string | undefined,
    walletAddress: walletAddress as string | undefined
  }
}

export function sanitizeString(input: string): string {
  // Since React already provides XSS protection for text content,
  // we only need to sanitize actual HTML tags that could be dangerous
  // Don't encode normal characters like apostrophes and quotes
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function validateRequestSize(request: Request): void {
  const contentLength = request.headers.get('content-length')

  if (contentLength) {
    const size = parseInt(contentLength, 10)

    // Maximum 1MB request size
    if (size > 1024 * 1024) {
      throw new ValidationError('Request body too large. Maximum 1MB allowed')
    }
  }
}

// MCP-specific validation
export interface MCPRequestBody {
  jsonrpc: string
  method: string
  params?: {
    name?: string
    arguments?: Record<string, unknown>
  }
  id: number | string
}

// List of available MCP tools
// IMPORTANT: This list must match the tools registered in hypebiscus-mcp/src/index.ts
const AVAILABLE_MCP_TOOLS = [
  'get_pool_metrics',
  'get_user_by_wallet',
  'get_user_positions',
  'get_wallet_performance',
  'get_position_details',
  'get_dlmm_position',
  'get_bin_distribution',
  'calculate_rebalance',
  'get_user_positions_with_sync',
  'generate_wallet_link_token',
  'link_wallet_by_short_token',
  'link_wallet',
  'get_linked_account',
  'unlink_wallet',
  'delete_wallet_completely',
  'check_subscription',
  'get_credit_balance',
  'purchase_credits',
  'use_credits',
  'record_execution',
  'get_reposition_settings',
  'update_reposition_settings',
  'analyze_reposition',
  'prepare_reposition',
  'get_position_chain',
  'get_wallet_reposition_stats',
  'calculate_position_pnl',
  'close_position',
  'get_wallet_pnl',
  'sync_wallet_positions'
] as const;

const ALLOWED_MCP_METHODS = ['tools/list', 'tools/call'] as const;

/**
 * Validate JSON-RPC structure (version, method, id)
 */
function validateJSONRPCStructure(req: Record<string, unknown>): { isValid: boolean; error?: string } {
  // Validate JSON-RPC version
  if (req.jsonrpc !== '2.0') {
    return { isValid: false, error: 'Invalid JSON-RPC version. Must be "2.0"' };
  }

  // Validate method
  if (typeof req.method !== 'string' || req.method.length === 0) {
    return { isValid: false, error: 'Method must be a non-empty string' };
  }

  if (!ALLOWED_MCP_METHODS.includes(req.method as typeof ALLOWED_MCP_METHODS[number])) {
    return { isValid: false, error: `Method must be one of: ${ALLOWED_MCP_METHODS.join(', ')}` };
  }

  // Validate id
  if (typeof req.id !== 'number' && typeof req.id !== 'string') {
    return { isValid: false, error: 'ID must be a number or string' };
  }

  return { isValid: true };
}

/**
 * Validate tool name against available tools
 */
function validateToolName(name: string): { isValid: boolean; error?: string } {
  if (!AVAILABLE_MCP_TOOLS.includes(name as typeof AVAILABLE_MCP_TOOLS[number])) {
    return {
      isValid: false,
      error: `Unknown tool: ${name}. Available tools: ${AVAILABLE_MCP_TOOLS.join(', ')}`
    };
  }
  return { isValid: true };
}

/**
 * Validate tool arguments structure and size
 */
function validateToolArguments(args: unknown): { isValid: boolean; error?: string } {
  if (args === undefined) {
    return { isValid: true };
  }

  if (typeof args !== 'object' || args === null) {
    return { isValid: false, error: 'Arguments must be an object' };
  }

  // Check serialized size (max 10KB)
  const argsString = JSON.stringify(args);
  if (argsString.length > 10000) {
    return { isValid: false, error: 'Arguments too large. Maximum 10KB allowed' };
  }

  return { isValid: true };
}

/**
 * Validate params for tools/call method
 */
function validateToolsCallParams(params: unknown): { isValid: boolean; error?: string } {
  if (!params || typeof params !== 'object') {
    return { isValid: false, error: 'Params required for tools/call method' };
  }

  const p = params as Record<string, unknown>;

  if (typeof p.name !== 'string' || p.name.length === 0) {
    return { isValid: false, error: 'Tool name required and must be a non-empty string' };
  }

  // Validate tool name exists
  const toolNameResult = validateToolName(p.name);
  if (!toolNameResult.isValid) {
    return toolNameResult;
  }

  // Validate arguments if provided
  return validateToolArguments(p.arguments);
}

/**
 * Main MCP request validation function
 * Validates JSON-RPC structure and tool-specific parameters
 */
export function validateMCPRequest(body: unknown): { isValid: boolean; error?: string } {
  if (!body || typeof body !== 'object') {
    return { isValid: false, error: 'Invalid request body' };
  }

  const req = body as Record<string, unknown>;

  // Validate JSON-RPC structure
  const structureResult = validateJSONRPCStructure(req);
  if (!structureResult.isValid) {
    return structureResult;
  }

  // Validate params for tools/call method
  if (req.method === 'tools/call') {
    return validateToolsCallParams(req.params);
  }

  return { isValid: true };
}

// ============================================================================
// Conversation & Message Validation
// ============================================================================

export interface ConversationCreateBody {
  walletAddress: string;
  title?: string;
}

export interface ConversationUpdateBody {
  title: string;
}

export interface MessageCreateBody {
  role: 'user' | 'assistant';
  content: string;
  poolData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Validate conversation creation request
 */
export function validateConversationCreate(body: unknown): ConversationCreateBody {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Invalid request body');
  }

  const { walletAddress, title } = body as Record<string, unknown>;

  // Validate wallet address (required)
  validateWalletAddressHelper(walletAddress, 'walletAddress', true);

  // Validate title (optional)
  if (title !== undefined) {
    validateContent(title, 'title', 200, false);
  }

  return {
    walletAddress: walletAddress as string,
    title: title as string | undefined,
  };
}

/**
 * Validate conversation update request
 */
export function validateConversationUpdate(body: unknown): ConversationUpdateBody {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Invalid request body');
  }

  const { title } = body as Record<string, unknown>;

  // Validate title (required for update)
  if (!title) {
    throw new ValidationError('Title is required', 'title');
  }

  validateContent(title, 'title', 200, true);

  return { title: title as string };
}

/**
 * Validate message creation request
 */
export function validateMessageCreate(body: unknown): MessageCreateBody {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Invalid request body');
  }

  const { role, content, poolData, metadata } = body as Record<string, unknown>;

  // Validate all fields using shared helpers
  validateRole(role, 'role');
  validateContent(content, 'content', 10000, true);
  validateOptionalObject(poolData, 'poolData', 50000);
  validateOptionalObject(metadata, 'metadata', 10000);

  return {
    role: role as 'user' | 'assistant',
    content: content as string,
    poolData: poolData as Record<string, unknown> | undefined,
    metadata: metadata as Record<string, unknown> | undefined,
  };
}

/**
 * Validate wallet address query parameter
 */
export function validateWalletAddressParam(walletAddress: unknown): string {
  validateWalletAddressHelper(walletAddress, 'walletAddress', true);
  return walletAddress as string;
}