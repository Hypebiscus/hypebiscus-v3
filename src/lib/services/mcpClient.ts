// MCP Client Service - Frontend service for MCP interactions
// Handles communication with Next.js API route which forwards to Docker MCP server

export interface MCPHealthStatus {
  status: 'healthy' | 'unhealthy';
  serverUrl?: string;
  tools?: MCPTool[];
  error?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: number | string;
}

export interface PoolMetrics {
  poolAddress: string;
  poolName: string;
  liquidity: {
    totalUSD: number;
    tokenA: {
      symbol: string;
      amount: number;
      decimals: number;
      usdValue: number;
    };
    tokenB: {
      symbol: string;
      amount: number;
      decimals: number;
      usdValue: number;
    };
  };
  metrics: {
    apy: number;
    fees24h: number;
    volume24h: number;
    binStep: number;
    activeBin: number;
  };
  prices: Record<string, { usd: number; change24h?: number }>;
  timestamp: string;
  recommendation?: string;
}

export interface UserPosition {
  positionId: string;
  poolAddress: string;
  status: 'active' | 'closed';
  entryDate: string;
  exitDate?: string;
  entryLiquidity: number;
  currentLiquidity?: number;
  fees: number;
  pnl: number;
}

export interface WalletPerformance {
  totalPnL: number;
  totalFeesCollected: number;
  activePositions: number;
  closedPositions: number;
  winRate: number;
  avgHoldingTime: number;
}

class MCPClientService {
  private apiUrl = '/api/mcp';
  private requestId = 0;

  /**
   * Check MCP server health and get available tools
   */
  async checkHealth(): Promise<MCPHealthStatus> {
    try {
      const response = await fetch(this.apiUrl, {
        method: 'GET',
      });

      if (!response.ok) {
        const data = await response.json();
        return {
          status: 'unhealthy',
          error: data.error || 'Server returned error'
        };
      }

      const data = await response.json();
      return data;
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Failed to connect'
      };
    }
  }

  /**
   * List all available MCP tools
   */
  async listTools(): Promise<MCPTool[]> {
    try {
      const response = await this.sendRequest({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: this.nextId(),
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const result = response.result as { tools: MCPTool[] };
      return result?.tools || [];
    } catch (error) {
      console.error('Failed to list tools:', error);
      throw error;
    }
  }

  /**
   * Call a specific MCP tool
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<unknown> {
    try {
      const response = await this.sendRequest({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
        id: this.nextId(),
      });

      if (response.error) {
        const errorMessage = response.error.message || response.error.data || JSON.stringify(response.error);
        throw new Error(`MCP tool ${toolName} failed: ${errorMessage}`);
      }

      // Extract and parse MCP protocol response
      const result = response.result as { content?: Array<{ type: string; text?: string; value?: unknown }> };

      // Check for content array
      if (!result?.content || !Array.isArray(result.content) || result.content.length === 0) {
        throw new Error(`Invalid response format from MCP server. Tool: ${toolName}`);
      }

      const firstContent = result.content[0];

      // Try text field first (standard MCP format)
      const resultText = firstContent?.text || (typeof firstContent?.value === 'string' ? firstContent.value : null);

      if (!resultText) {
        throw new Error(`Empty response from MCP server. Tool: ${toolName}`);
      }

      // Try to parse as JSON
      try {
        return JSON.parse(resultText);
      } catch {
        // Return as-is if not JSON
        return resultText;
      }
    } catch (error) {
      console.error(`Failed to call tool ${toolName}:`, error);
      throw error;
    }
  }

  /**
   * Get pool metrics for a specific pool
   */
  async getPoolMetrics(
    poolAddress?: string,
    walletAddress?: string
  ): Promise<PoolMetrics> {
    const args: Record<string, unknown> = {};
    if (poolAddress) args.poolAddress = poolAddress;
    if (walletAddress) args.walletAddress = walletAddress;

    const result = await this.callTool('get_pool_metrics', args);
    return result as PoolMetrics;
  }

  /**
   * Get user positions with hybrid data sync (database + blockchain)
   * Merges historical database records with real-time blockchain data
   *
   * @param walletAddress - Solana wallet public key
   * @param includeHistorical - Include positions from database (default: true)
   * @param includeLive - Include real-time blockchain positions (default: true)
   * @param positionId - Optional: Filter to a specific position ID
   */
  async getUserPositionsWithSync(
    walletAddress: string,
    includeHistorical = true,
    includeLive = true,
    positionId?: string
  ): Promise<unknown> {
    const args: Record<string, unknown> = {
      walletAddress,
      includeHistorical,
      includeLive,
    };

    if (positionId) {
      args.positionId = positionId;
    }

    const result = await this.callTool('get_user_positions_with_sync', args);
    return result;
  }

  /**
   * Get wallet performance metrics
   */
  async getWalletPerformance(
    walletAddress: string
  ): Promise<WalletPerformance> {
    const result = await this.callTool('get_wallet_performance', {
      walletAddress,
    });

    return result as WalletPerformance;
  }


  /**
   * Get bin distribution for a pool
   */
  async getBinDistribution(
    poolAddress?: string,
    rangeSize = 20,
    includeEmptyBins = false
  ): Promise<unknown> {
    const args: Record<string, unknown> = {
      rangeSize,
      includeEmptyBins,
    };
    if (poolAddress) args.poolAddress = poolAddress;

    return await this.callTool('get_bin_distribution', args);
  }

  /**
   * Calculate rebalance recommendation
   */
  async calculateRebalance(
    positionId: string,
    poolAddress?: string,
    bufferBins = 3
  ): Promise<unknown> {
    const args: Record<string, unknown> = {
      positionId,
      bufferBins,
    };
    if (poolAddress) args.poolAddress = poolAddress;

    return await this.callTool('calculate_rebalance', args);
  }

  /**
   * Analyze a position for reposition recommendation
   */
  async analyzeReposition(
    positionAddress: string,
    poolAddress?: string
  ): Promise<unknown> {
    const args: Record<string, unknown> = {
      positionAddress,
    };
    if (poolAddress) args.poolAddress = poolAddress;

    return await this.callTool('analyze_reposition', args);
  }

  /**
   * Prepare an unsigned reposition transaction
   */
  async prepareReposition(params: {
    positionAddress: string;
    walletAddress: string;
    poolAddress?: string;
    strategy?: string;
    binRange?: number;
    slippage?: number;
  }): Promise<unknown> {
    return await this.callTool('prepare_reposition', params);
  }

  /**
   * Get the reposition chain for a position
   */
  async getPositionChain(positionAddress: string): Promise<unknown> {
    return await this.callTool('get_position_chain', { positionAddress });
  }

  /**
   * Get reposition statistics for a wallet
   */
  async getWalletRepositionStats(walletAddress: string): Promise<unknown> {
    return await this.callTool('get_wallet_reposition_stats', { walletAddress });
  }

  /**
   * Send a request to the MCP API
   */
  private async sendRequest(
    request: Record<string, unknown>
  ): Promise<MCPResponse> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Request failed');
    }

    return await response.json();
  }

  /**
   * Generate next request ID
   */
  private nextId(): number {
    return ++this.requestId;
  }
}

// Export singleton instance
export const mcpClient = new MCPClientService();
