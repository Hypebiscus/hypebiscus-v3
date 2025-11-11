// Price API service with Birdeye and Jupiter fallback
import axios, { AxiosInstance } from 'axios';
import { API_ENDPOINTS, config, logger } from '../config.js';
import { ErrorType, HypebiscusMCPError, TOKEN_MINTS } from '../tools/types.js';
import { cache } from '../utils/cache.js';
import { withRetry } from '../utils/errors.js';

interface PriceData {
  price: number;
  change24h: number;
}

export class PriceApiService {
  private birdeyeClient: AxiosInstance | null;
  private jupiterClient: AxiosInstance;
  private cacheTtl: number;

  constructor() {
    // Initialize Birdeye client only if API key is provided
    this.birdeyeClient = config.birdeyeApiKey
      ? axios.create({
          baseURL: API_ENDPOINTS.birdeyeBase,
          timeout: config.requestTimeout,
          headers: {
            'X-API-KEY': config.birdeyeApiKey,
            'Content-Type': 'application/json',
          },
        })
      : null;

    // Jupiter client (free, no API key needed)
    this.jupiterClient = axios.create({
      baseURL: API_ENDPOINTS.jupiterPriceBase,
      timeout: config.requestTimeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.cacheTtl = config.cacheTtl * 1000; // Convert to milliseconds

    logger.info(
      `Initialized Price API service (Birdeye: ${this.birdeyeClient ? 'enabled' : 'disabled'}, Jupiter: enabled)`
    );
  }

  /**
   * Gets price data from Birdeye API
   * @param tokenAddress - Token mint address
   * @returns Price data
   */
  private async getPriceFromBirdeye(tokenAddress: string): Promise<PriceData | null> {
    if (!this.birdeyeClient) {
      return null;
    }

    try {
      const response = await withRetry(
        async () => {
          logger.debug(`Fetching price from Birdeye: ${tokenAddress}`);
          return await this.birdeyeClient!.get(`/defi/price`, {
            params: {
              address: tokenAddress,
              check_liquidity: 'false',
            },
          });
        },
        2,
        1000
      );

      if (response.data?.success && response.data?.data) {
        const data = response.data.data;
        return {
          price: data.value || 0,
          change24h: data.priceChange24h || 0,
        };
      }

      return null;
    } catch (error) {
      logger.warn(`Birdeye API error for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Gets price data from Jupiter API
   * @param tokenSymbol - Token symbol (e.g., 'SOL', 'zBTC')
   * @param tokenAddress - Token mint address (REQUIRED for Jupiter)
   * @returns Price data
   */
  private async getPriceFromJupiter(
    tokenSymbol: string,
    tokenAddress?: string
  ): Promise<PriceData | null> {
    // Jupiter requires mint address
    if (!tokenAddress) {
      logger.warn(`Jupiter API requires token address for ${tokenSymbol}`);
      return null;
    }

    try {
      const response = await withRetry(
        async () => {
          logger.debug(`Fetching price from Jupiter lite-api v3: ${tokenSymbol} (${tokenAddress})`);
          return await this.jupiterClient.get('', {
            params: {
              ids: tokenAddress, // Use mint address
            },
          });
        },
        2,
        1000
      );

      // Jupiter lite-api v3 returns data directly keyed by mint address (no "data" wrapper)
      // Response format: { "So11...112": { "usdPrice": 159.40, "priceChange24h": -4.38, ... } }
      if (response.data?.[tokenAddress]) {
        const data = response.data[tokenAddress];
        const price = typeof data.usdPrice === 'string' ? parseFloat(data.usdPrice) : data.usdPrice;
        const change24h = typeof data.priceChange24h === 'string' ? parseFloat(data.priceChange24h) : data.priceChange24h;
        return {
          price: price || 0,
          change24h: change24h || 0,
        };
      }

      return null;
    } catch (error) {
      logger.warn(`Jupiter API error for ${tokenSymbol}:`, error);
      return null;
    }
  }

  /**
   * Gets price data with fallback logic
   * @param tokenSymbol - Token symbol
   * @param tokenAddress - Token mint address (REQUIRED for accurate prices)
   * @returns Price data
   */
  async getTokenPrice(tokenSymbol: string, tokenAddress?: string): Promise<PriceData> {
    const cacheKey = `price:${tokenSymbol}`;

    // Check cache first
    const cached = cache.get<PriceData>(cacheKey);
    if (cached) {
      logger.info(`Using cached price for ${tokenSymbol}`);
      return cached;
    }

    let priceData: PriceData | null = null;

    // Try Birdeye first if available and address provided
    if (this.birdeyeClient && tokenAddress) {
      priceData = await this.getPriceFromBirdeye(tokenAddress);
      if (priceData) {
        logger.info(`Got price for ${tokenSymbol} from Birdeye: $${priceData.price}`);
      }
    }

    // Fallback to Jupiter (requires token address)
    if (!priceData && tokenAddress) {
      priceData = await this.getPriceFromJupiter(tokenSymbol, tokenAddress);
      if (priceData) {
        logger.info(`Got price for ${tokenSymbol} from Jupiter: $${priceData.price}`);
      }
    }

    // If still no price, throw error
    if (!priceData) {
      throw new HypebiscusMCPError(
        ErrorType.API_ERROR,
        `Failed to fetch price for ${tokenSymbol} from all sources${!tokenAddress ? ' (token address required)' : ''}`
      );
    }

    // Cache the result
    cache.set(cacheKey, priceData, this.cacheTtl);

    return priceData;
  }

  /**
   * Gets prices for multiple tokens
   * @param tokens - Array of token symbols and addresses
   * @returns Map of token symbols to price data
   */
  async getMultiplePrices(
    tokens: Array<{ symbol: string; address?: string }>
  ): Promise<Map<string, PriceData>> {
    const prices = new Map<string, PriceData>();

    // Fetch prices in parallel
    const promises = tokens.map(async (token) => {
      try {
        const price = await this.getTokenPrice(token.symbol, token.address);
        prices.set(token.symbol, price);
      } catch (error) {
        logger.warn(`Failed to fetch price for ${token.symbol}:`, error);
        // Set default price on error
        prices.set(token.symbol, { price: 0, change24h: 0 });
      }
    });

    await Promise.allSettled(promises);

    return prices;
  }

  /**
   * Gets SOL price (most commonly used)
   * @returns SOL price data
   */
  async getSolPrice(): Promise<PriceData> {
    return this.getTokenPrice('SOL', TOKEN_MINTS.SOL);
  }

  /**
   * Gets BTC variant prices (zBTC, wBTC, cbBTC)
   * @returns Map of BTC variant prices
   */
  async getBtcPrices(): Promise<Map<string, PriceData>> {
    return this.getMultiplePrices([
      { symbol: 'zBTC', address: TOKEN_MINTS.zBTC },
      { symbol: 'wBTC', address: TOKEN_MINTS.wBTC },
      { symbol: 'cbBTC', address: TOKEN_MINTS.cbBTC },
    ]);
  }
}

// Export singleton instance
export const priceApi = new PriceApiService();
