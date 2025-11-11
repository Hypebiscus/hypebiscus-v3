// Configuration and constants for Hypebiscus MCP Server
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface Config {
  solanaRpcUrl: string;
  birdeyeApiKey: string | null;
  defaultPoolAddress: string;
  cacheTtl: number;
  requestTimeout: number;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  backgroundSyncEnabled: boolean;
  backgroundSyncInterval: number;
  walletLinkSecret: string;
  solanaNetwork: 'mainnet-beta' | 'devnet';
  x402TreasuryAddress: string | null;
  x402FacilitatorUrl: string;
}

// Parse environment variables with defaults
export const config: Config = {
  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  birdeyeApiKey: process.env.BIRDEYE_API_KEY || null,
  defaultPoolAddress: process.env.DEFAULT_POOL_ADDRESS || '2onAYHGyxUV4JuYeUQbFwbKmKUXyTA9v5aKiDgZMyCeL',
  cacheTtl: parseInt(process.env.CACHE_TTL || '30', 10),
  requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || '10000', 10),
  logLevel: (process.env.LOG_LEVEL as Config['logLevel']) || 'info',
  backgroundSyncEnabled: process.env.BACKGROUND_SYNC_ENABLED === 'true',
  backgroundSyncInterval: parseInt(process.env.BACKGROUND_SYNC_INTERVAL || '300000', 10), // Default: 5 minutes
  walletLinkSecret: process.env.WALLET_LINK_SECRET || (() => {
    console.error('[ERROR] WALLET_LINK_SECRET not set! Using insecure default. Generate a secure secret for production!');
    return 'INSECURE_DEFAULT_CHANGE_THIS_IN_PRODUCTION';
  })(),
  solanaNetwork: (process.env.SOLANA_NETWORK as Config['solanaNetwork']) || 'mainnet-beta',
  x402TreasuryAddress: process.env.X402_TREASURY_ADDRESS || null,
  x402FacilitatorUrl: process.env.X402_FACILITATOR_URL || 'https://facilitator.payai.network',
};

// API Endpoints
export const API_ENDPOINTS = {
  meteoraBase: 'https://dlmm-api.meteora.ag',
  birdeyeBase: 'https://public-api.birdeye.so',
  // Use Jupiter lite-api v3 (free, no auth required)
  jupiterPriceBase: 'https://lite-api.jup.ag/price/v3',
} as const;

// Validation constants
export const VALIDATION = {
  minPoolAddressLength: 32,
  maxPoolAddressLength: 44,
  base58Regex: /^[1-9A-HJ-NP-Za-km-z]+$/,
} as const;

// Default values
export const DEFAULTS = {
  poolAddress: '2onAYHGyxUV4JuYeUQbFwbKmKUXyTA9v5aKiDgZMyCeL',
  poolName: 'zBTC-SOL',
  cacheTtl: 30000, // 30 seconds in milliseconds
} as const;

// Logging helper
export class Logger {
  private level: Config['logLevel'];

  constructor(level: Config['logLevel'] = 'info') {
    this.level = level;
  }

  private shouldLog(level: Config['logLevel']): boolean {
    const levels = ['error', 'warn', 'info', 'debug'];
    return levels.indexOf(level) <= levels.indexOf(this.level);
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.error(`[INFO] ${message}`, ...args); // Use stderr for all logs
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.error(`[DEBUG] ${message}`, ...args);
    }
  }
}

export const logger = new Logger(config.logLevel);
