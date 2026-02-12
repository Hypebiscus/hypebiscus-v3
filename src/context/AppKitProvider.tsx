'use client'

import { type ReactNode } from 'react'
import { createAppKit } from '@reown/appkit/react'
import { solanaAdapter, projectId, metadata, networks } from '@/config/appkit'

// Custom RPC URL override if provided
const customRpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL

// Initialize AppKit - this runs once at module level
createAppKit({
  adapters: [solanaAdapter],
  networks,
  projectId,
  metadata,
  features: {
    analytics: false,
    socials: false,
  },
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#FF4040',
    '--w3m-color-mix': '#0F0F0F',
    '--w3m-color-mix-strength': 40,
    '--w3m-font-family': 'Geist Mono, monospace',
    '--w3m-border-radius-master': '0px',
    '--w3m-font-size-master': '9px',
  },
  ...(customRpcUrl
    ? {
        solanaConfig: {
          defaultChainId: networks[0].id,
          chains: networks,
        },
      }
    : {}),
})

export function AppKitProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}
