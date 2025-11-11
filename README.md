# Hypebiscus V3

AI-powered DeFi platform for Solana DLMM liquidity pools on Meteora.

## Core Features

1. Bridge BTC to Solana via Zeus Bridge (zBTC 1:1 pegged)
2. AI chatbot for personalized LP recommendations
3. Real-time pool metrics and position tracking
4. Automated position management via Telegram bot

## Tech Stack

- Next.js 15, React 19, TypeScript
- Solana Web3.js, Wallet Adapter, Meteora DLMM SDK
- Anthropic Claude API
- x402 payment protocol
- MCP (Model Context Protocol) server on Render

## Architecture

```
User Input → ChatBox → Payment Check → MCP Client → API Route → MCP Server → Response
```

## MCP Integration

### Server Details

- Hosted on Render (free tier)
- Cold start: 30-60 seconds
- Timeout: 90 seconds
- Rate limit: 30 requests/minute per IP

### Available Tools

**Free:**
- `get_pool_metrics` - Pool stats (liquidity, APY, fees, volume)
- `generate_wallet_link_token` - Telegram bot linking

**Paid (1 credit = $0.01):**
- `get_user_positions_with_sync` - User positions

**Coming Soon:**
- `get_wallet_performance` - Portfolio analytics
- `calculate_rebalance` - Position health check
- `get_bin_distribution` - Liquidity distribution

### Implementation

**Client Service:**
```typescript
// src/lib/services/mcpClient.ts
import { mcpClient } from '@/lib/services/mcpClient';

const poolData = await mcpClient.callTool('get_pool_metrics', {});
```

**API Proxy:**
```typescript
// src/app/api/mcp/route.ts
// Handles JSON-RPC 2.0 protocol transformation
// Forwards to MCP server with 90s timeout
```

**ChatBox Integration:**
```typescript
// src/components/dashboard-components/ChatBox.tsx
// Intent detection → Payment verification → MCP query → Display
```

## x402 Payment System

### Pricing

**Credits:**
- $0.01 per credit
- Packages: 10, 50, 100, 500

**Subscription:**
- $4.99/month unlimited queries

### Payment Flow

1. User triggers paid feature
2. Check subscription or credit balance
3. Show payment modal if insufficient
4. Execute query after payment
5. Deduct credits via `use_credits` tool

**Key Files:**
- `src/hooks/usePaymentVerification.ts` - Verification hook
- `src/components/mcp-components/CreditsPurchaseModal.tsx` - Purchase UI
- `src/components/mcp-components/SubscriptionStatusCard.tsx` - Balance display

## ChatBox Integration

### Intent Detection

Analyzes user messages to route queries:

```typescript
const MESSAGE_PATTERNS = {
  poolMetricsQuery: [/pool.*stats/i, /show.*pool/i],
  mcpDataQuery: [/my positions/i, /portfolio/i],
  automationQuery: [/auto.*reposition/i, /telegram/i],
};
```

### Handler Flow

**Free Query:**
```typescript
const handlePoolMetricsQuery = async () => {
  setIsLoading(true);
  const data = await mcpClient.callTool('get_pool_metrics', {});
  addMessage("assistant", formatData(data));
  setIsLoading(false);
};
```

**Paid Query:**
```typescript
const handleMCPDataQuery = async () => {
  if (!connected || !publicKey) return;

  const accessResult = await verifyAccess({
    requireCredits: 1,
    action: 'view positions',
  });

  if (!accessResult.hasAccess) {
    setShowPaymentModal(true);
    return;
  }

  const data = await mcpClient.callTool('get_user_positions_with_sync', {
    walletAddress: publicKey.toBase58()
  });

  addMessage("assistant", formatData(data));
};
```

### Message Rendering

Uses `react-markdown` for link formatting:

```typescript
// User: plain text
<p>{content}</p>

// Assistant: markdown
<ReactMarkdown>{content}</ReactMarkdown>
```

Formatting:
- Bold: `**text**`
- Links: `[text](url)`
- Line breaks: `\n`

## Telegram Automation

Bot: `@hypebiscus_garden_bot`

### Linking Methods

1. Deep link (auto-opens Telegram)
2. QR code scan
3. Manual code entry: `/link XXXXXXXX`

### Flow

1. User requests automation in ChatBox
2. Generate link token
3. Display linking options
4. User links in Telegram
5. Receive position notifications

## Development

### Setup

```bash
pnpm install
```

### Environment

```env
ANTHROPIC_API_KEY=sk-ant-xxx
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
MCP_SERVER_URL=https://your-mcp-server.onrender.com
```

### Commands

```bash
pnpm dev      # Development server
pnpm build    # Production build
pnpm start    # Production server
pnpm lint     # ESLint check
```

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── chat/          # AI streaming
│   │   ├── mcp/           # MCP proxy
│   │   └── payments/      # x402 payments
│   ├── bridge/            # BTC bridging
│   ├── pricing/           # Subscription
│   └── wallet/            # Wallet management
├── components/
│   ├── dashboard-components/
│   │   └── ChatBox.tsx    # Main chat UI
│   ├── mcp-components/    # Payment & linking UI
│   └── ui/                # Reusable components
├── hooks/
│   └── usePaymentVerification.ts
├── lib/
│   ├── services/
│   │   └── mcpClient.ts   # MCP client
│   └── utils/             # Validation, rate limiting
└── types/                 # TypeScript types
```

## Security

- Rate limiting: 30 req/min per IP
- Input validation on all endpoints
- CORS with origin validation
- Content Security Policy headers
- XSS prevention via react-markdown
- Request size limits (1MB max)
- Server-side credit storage
- Wallet signature verification

## Deployment

**Frontend:** Vercel
**MCP Server:** Render (free tier)

## Links

- Demo: https://hypebiscus-v3.netlify.app
- Docs: https://hypebiscuss-organization.gitbook.io/hypebiscus

## License

Private - All rights reserved
