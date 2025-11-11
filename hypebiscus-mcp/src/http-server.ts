#!/usr/bin/env node

/**
 * HTTP Bridge for Hypebiscus MCP Server
 *
 * Wraps the stdio MCP server with an HTTP interface for Next.js integration
 * Maintains compatibility with Claude Desktop via stdio transport
 */

import http from 'http';
import { spawn, ChildProcess } from 'child_process';
import { logger } from './config.js';

interface MCPRequest {
  jsonrpc: string;
  id: string | number;
  method: string;
  params: {
    name: string;
    arguments?: Record<string, unknown>;
  };
}

interface MCPResponse {
  jsonrpc: string;
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

class MCPHttpBridge {
  private mcpProcess: ChildProcess | null = null;
  private server: http.Server | null = null;
  private requestQueue: Map<string | number, {
    resolve: (value: MCPResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private buffer = '';
  private isReady = false;
  private port: number;

  constructor(port = 3001) {
    this.port = port;
  }

  /**
   * Start the MCP process with stdio transport
   */
  private async startMCPProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info('Starting MCP server process...');

      this.mcpProcess = spawn('node', ['dist/index.js'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
        env: { ...process.env, LOG_LEVEL: 'info' }
      });

      // Handle stdout (MCP protocol messages)
      this.mcpProcess.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      // Handle stderr (logs)
      this.mcpProcess.stderr?.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        if (message) {
          logger.debug(`[MCP Process] ${message}`);
        }
      });

      // Handle process exit
      this.mcpProcess.on('exit', (code, signal) => {
        logger.warn(`MCP process exited with code ${code}, signal ${signal}`);
        this.isReady = false;
        this.mcpProcess = null;

        // Reject all pending requests
        for (const [id, { reject, timeout }] of this.requestQueue.entries()) {
          clearTimeout(timeout);
          reject(new Error('MCP process terminated'));
          this.requestQueue.delete(id);
        }
      });

      // Handle process errors
      this.mcpProcess.on('error', (error) => {
        logger.error('MCP process error:', error);
        reject(error);
      });

      // Wait for process to be ready
      setTimeout(() => {
        if (this.mcpProcess && this.mcpProcess.exitCode === null) {
          this.isReady = true;
          logger.info('MCP server process ready');
          resolve();
        } else {
          reject(new Error('MCP process failed to start'));
        }
      }, 2000);
    });
  }

  /**
   * Process buffered data and extract complete JSON-RPC messages
   */
  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line) as MCPResponse;
        this.handleMCPResponse(message);
      } catch (error) {
        logger.error('Failed to parse MCP response:', line, error);
      }
    }
  }

  /**
   * Handle MCP response and resolve corresponding request
   */
  private handleMCPResponse(response: MCPResponse): void {
    const pending = this.requestQueue.get(response.id);

    if (pending) {
      clearTimeout(pending.timeout);
      this.requestQueue.delete(response.id);
      pending.resolve(response);
    } else {
      logger.warn(`Received response for unknown request ID: ${response.id}`);
    }
  }

  /**
   * Send request to MCP server via stdin
   */
  private async sendToMCP(request: MCPRequest): Promise<MCPResponse> {
    if (!this.mcpProcess || !this.isReady) {
      throw new Error('MCP process not ready');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requestQueue.delete(request.id);
        reject(new Error('MCP request timeout'));
      }, 30000); // 30 second timeout

      this.requestQueue.set(request.id, { resolve, reject, timeout });

      const message = JSON.stringify(request) + '\n';
      const success = this.mcpProcess?.stdin?.write(message);

      if (!success) {
        clearTimeout(timeout);
        this.requestQueue.delete(request.id);
        reject(new Error('Failed to write to MCP process'));
      }
    });
  }

  /**
   * Initialize the MCP server
   */
  private async initializeMCP(): Promise<void> {
    logger.info('Initializing MCP server...');

    const initRequest: MCPRequest = {
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: {
        name: 'http-bridge',
        arguments: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'hypebiscus-http-bridge',
            version: '1.0.0'
          }
        }
      }
    };

    await this.sendToMCP(initRequest);
    logger.info('MCP server initialized');
  }

  /**
   * Start HTTP server
   */
  async start(): Promise<void> {
    try {
      // Start MCP process
      await this.startMCPProcess();

      // Initialize MCP
      await this.initializeMCP();

      // Create HTTP server
      this.server = http.createServer(async (req, res) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        // Handle preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        // Handle GET /health for Render health checks
        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', ready: this.isReady }));
          return;
        }

        // Only accept POST for MCP calls
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        // Parse request body
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });

        req.on('end', async () => {
          try {
            const request = JSON.parse(body);

            // Health check endpoint
            if (request.method === 'health') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'ok', ready: this.isReady }));
              return;
            }

            // Validate request
            if (!request.method || !request.params) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid request format' }));
              return;
            }

            // Forward to MCP server
            const mcpRequest: MCPRequest = {
              jsonrpc: '2.0',
              id: request.id || Date.now().toString(),
              method: 'tools/call',
              params: {
                name: request.method,
                arguments: request.params
              }
            };

            const response = await this.sendToMCP(mcpRequest);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
          } catch (error) {
            logger.error('Error processing request:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: error instanceof Error ? error.message : 'Internal server error'
            }));
          }
        });
      });

      this.server.listen(this.port, () => {
        logger.info(`HTTP bridge listening on port ${this.port}`);
        logger.info(`Health check: http://localhost:${this.port}/`);
        logger.info(`Ready to accept requests from Next.js`);
      });
    } catch (error) {
      logger.error('Failed to start HTTP bridge:', error);
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down HTTP bridge...');

    // Close HTTP server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => {
          logger.info('HTTP server closed');
          resolve();
        });
      });
    }

    // Stop MCP process
    if (this.mcpProcess) {
      this.mcpProcess.kill('SIGTERM');

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.mcpProcess?.kill('SIGKILL');
          resolve();
        }, 5000);

        this.mcpProcess?.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      logger.info('MCP process stopped');
    }
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Render sets PORT automatically; fall back to HTTP_PORT for local dev
  const port = parseInt(process.env.PORT || process.env.HTTP_PORT || '3001', 10);
  const bridge = new MCPHttpBridge(port);

  // Handle process signals
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT signal');
    await bridge.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM signal');
    await bridge.shutdown();
    process.exit(0);
  });

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });

  try {
    await bridge.start();
  } catch (error) {
    logger.error('Failed to start bridge:', error);
    process.exit(1);
  }
}

// Run if executed directly
// Note: In CommonJS, check if module is main
if (require.main === module) {
  main();
}

export { MCPHttpBridge };
