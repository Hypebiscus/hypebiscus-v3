# MCP Server Integration Guide

## Overview

The Hypebiscus MCP (Model Context Protocol) server is now live on Render and integrated with your Next.js application. This guide covers how the integration works and how to use it.

## Live Deployment 🎉

**MCP Server URL**: `https://hypebiscus-mcp.onrender.com`

**Status**: ✅ Live and operational

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Next.js App   │         │  Next.js API     │         │  MCP Server     │
│   (Frontend)    │ ──────> │  /api/mcp        │ ──────> │  (Render)       │
│                 │         │  (Proxy/Auth)    │         │                 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
     Client-Side                 Server-Side                  HTTP Bridge
                                                         ┌─────────────────┐
                                                         │  MCP stdio      │
                                                         │  (Internal)     │
                                                         └─────────────────┘
                                                                 │
                                                         ┌───────┴────────┐
                                                         │   Solana RPC   │
                                                         │   Prisma DB    │
                                                         │   Jupiter API  │
                                                         └────────────────┘
```

## How It Works

### 1. Frontend Integration

The frontend uses the MCP client service (`src/lib/services/mcpClient.ts`):

```typescript
import { mcpClient } from '@/lib/services/mcpClient';

// Get pool metrics
const poolData = await mcpClient.getPoolMetrics();

// Get user positions
const positions = await mcpClient.getUserPositionsWithSync(walletAddress);

// Check wallet performance
const performance = await mcpClient.getWalletPerformance(walletAddress);
```

### 2. API Route Proxy

The Next.js API route (`src/app/api/mcp/route.ts`) acts as a secure proxy:

- ✅ Rate limiting (30 req/min per IP)
- ✅ Request validation
- ✅ Error handling
- ✅ Timeout protection (30s)

### 3. MCP Server on Render

The MCP server runs as an HTTP bridge:

- ✅ Exposes MCP tools via HTTP
- ✅ Connects to Solana blockchain
- ✅ Queries Supabase database
- ✅ Fetches prices from Jupiter API v3
- ✅ Background sync every 5 minutes

## Environment Variables

### Development (.env.local)

```bash
MCP_SERVER_URL=http://localhost:3001
```

### Production (.env or deployment platform)

```bash
MCP_SERVER_URL=https://hypebiscus-mcp.onrender.com
```

**Important**: Make sure to set this in your production deployment platform:
- **Netlify**: Site Settings → Environment variables
- **Vercel**: Project Settings → Environment Variables
- **Render**: Environment → Add Environment Variable

## Available MCP Tools

The MCP server provides the following tools:

### Pool & Market Data
- `get_pool_metrics` - Get DLMM pool metrics and analysis
- `get_bin_distribution` - Get liquidity distribution across bins

### User Positions
- `get_user_positions_with_sync` - Hybrid sync (database + blockchain)
- `get_position_details` - Detailed position information
- `get_dlmm_position` - Blockchain position data
- `get_wallet_performance` - Performance metrics

### Reposition Tools
- `analyze_reposition` - Analyze position for reposition recommendation
- `prepare_reposition` - Prepare unsigned reposition transaction
- `get_position_chain` - Get reposition chain history
- `get_wallet_reposition_stats` - Reposition statistics

### Wallet Linking (Telegram Bot)
- `generate_wallet_link_token` - Generate linking token
- `link_wallet_by_short_token` - Link using short token
- `link_wallet` - Link wallet to Telegram
- `get_linked_account` - Get linked account details
- `unlink_wallet` - Unlink wallet

### Subscription & Payments
- `check_subscription` - Check subscription status
- `get_credit_balance` - Get credit balance
- `purchase_credits` - Purchase credits with payment

## Testing the Integration

Run the integration test:

```bash
node test-mcp-integration.mjs
```

Expected output:
```
✅ Health check passed!
✅ Pool metrics retrieved successfully!
✅ Price API working!

✨ All tests passed! MCP integration is working correctly.
```

## Usage Examples

### Example 1: Get Pool Metrics in a React Component

```typescript
'use client';

import { mcpClient } from '@/lib/services/mcpClient';
import { useEffect, useState } from 'react';

export function PoolMetrics() {
  const [poolData, setPoolData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPoolData() {
      try {
        const data = await mcpClient.getPoolMetrics();
        setPoolData(data);
      } catch (error) {
        console.error('Failed to fetch pool data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchPoolData();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (!poolData) return <div>Failed to load pool data</div>;

  return (
    <div>
      <h2>{poolData.poolName}</h2>
      <p>APY: {poolData.metrics.apy.toFixed(2)}%</p>
      <p>24h Fees: ${poolData.metrics.fees24h.toFixed(2)}</p>
    </div>
  );
}
```

### Example 2: Get User Positions with Wallet

```typescript
import { mcpClient } from '@/lib/services/mcpClient';
import { useWallet } from '@solana/wallet-adapter-react';

export function UserPositions() {
  const { publicKey } = useWallet();
  const [positions, setPositions] = useState<any[]>([]);

  useEffect(() => {
    if (!publicKey) return;

    async function fetchPositions() {
      try {
        const data = await mcpClient.getUserPositionsWithSync(
          publicKey.toBase58(),
          true, // includeHistorical
          true  // includeLive
        );
        setPositions(data as any[]);
      } catch (error) {
        console.error('Failed to fetch positions:', error);
      }
    }

    fetchPositions();
  }, [publicKey]);

  return (
    <div>
      <h2>Your Positions</h2>
      {positions.map(pos => (
        <div key={pos.positionId}>
          <p>Pool: {pos.poolAddress}</p>
          <p>Status: {pos.status}</p>
          <p>PnL: ${pos.pnl.toFixed(2)}</p>
        </div>
      ))}
    </div>
  );
}
```

## Health Check

The MCP server exposes a health check endpoint:

```bash
curl https://hypebiscus-mcp.onrender.com/health
```

Response:
```json
{
  "status": "ok",
  "ready": true
}
```

## Monitoring

### Render Dashboard
Monitor your MCP server at: https://dashboard.render.com/

### Logs
View real-time logs in Render Dashboard → Services → hypebiscus-mcp → Logs

### Metrics to Watch
- ✅ HTTP response times
- ✅ Error rates
- ✅ Memory usage
- ✅ Database connection pool
- ✅ Jupiter API call success rate

## Troubleshooting

### Issue: "MCP server unavailable"

**Solution**: Check if the Render service is running:
```bash
curl https://hypebiscus-mcp.onrender.com/health
```

### Issue: "Rate limit exceeded"

**Solution**: The API route has a 30 req/min limit. Wait or implement request queuing.

### Issue: "Request timeout"

**Solution**: Some MCP tools (like blockchain queries) can be slow. The timeout is set to 30s.

### Issue: Prices showing as $0

**Solution**: The server may be warming up. Jupiter API is fetched on-demand and cached for 30s.

## Production Deployment Checklist

- [x] MCP server deployed to Render
- [x] Environment variable `MCP_SERVER_URL` set in Next.js
- [x] Health check endpoint working
- [x] Jupiter Price API v3 integrated
- [x] Database connection configured
- [x] Rate limiting enabled
- [x] Error handling implemented
- [ ] Set `MCP_SERVER_URL` in production deployment platform
- [ ] Monitor Render logs for errors
- [ ] Test all MCP tools in production

## Next Steps

1. **Set Production Environment Variable**: Update `MCP_SERVER_URL` in your Next.js deployment platform (Netlify/Vercel)

2. **Test in Production**: After deploying Next.js, test MCP integration in production

3. **Monitor Performance**: Watch Render logs and metrics for any issues

4. **Optional Enhancements**:
   - Add caching layer for frequently accessed data
   - Implement request queuing for rate limits
   - Add error tracking (Sentry)
   - Set up uptime monitoring (UptimeRobot)

## Support

For issues or questions:
- Check Render logs: https://dashboard.render.com/
- Review MCP server code: `/hypebiscus-mcp/src/`
- Test integration: `node test-mcp-integration.mjs`

---

**Last Updated**: 2025-11-12
**MCP Server Version**: 1.0.0
**Status**: ✅ Live and Operational
