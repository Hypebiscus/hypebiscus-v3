import { SolanaAdapter } from '@reown/appkit-adapter-solana/react'
import { solana, solanaTestnet, solanaDevnet } from '@reown/appkit/networks'
import type { AppKitNetwork } from '@reown/appkit/networks'

// Solana adapter for Reown AppKit
export const solanaAdapter = new SolanaAdapter()

// Project ID from https://cloud.reown.com
export const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || ''

// Metadata for WalletConnect
export const metadata = {
  name: 'Hypebiscus',
  description: 'AI-powered DeFi liquidity management on Solana',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://hypebiscus.com',
  icons: ['/hypebiscus_logo.png'],
}

// Network configuration based on environment
const networkEnv = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'mainnet-beta'

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = networkEnv === 'devnet'
  ? [solanaDevnet, solana, solanaTestnet]
  : networkEnv === 'testnet'
    ? [solanaTestnet, solana, solanaDevnet]
    : [solana, solanaDevnet, solanaTestnet]
