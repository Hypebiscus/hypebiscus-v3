'use client'

import { type ReactNode, useEffect } from 'react'
import { createAppKit, useAppKitTheme } from '@reown/appkit/react'
import { solanaAdapter, projectId, metadata, networks } from '@/config/appkit'

// Custom RPC URL override if provided
const customRpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL

const themeVars = {
  '--w3m-accent': '#FF4040',
  '--w3m-color-mix': '#0F0F0F',
  '--w3m-color-mix-strength': 40,
  '--w3m-font-family': 'Geist Mono, monospace',
  '--w3m-border-radius-master': '0px',
  '--w3m-font-size-master': '9px',
} as const

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
  themeVariables: themeVars,
  ...(customRpcUrl
    ? {
        solanaConfig: {
          defaultChainId: networks[0].id,
          chains: networks,
        },
      }
    : {}),
})

function ThemeSync() {
  const { setThemeMode, setThemeVariables } = useAppKitTheme()

  useEffect(() => {
    setThemeMode('dark')
    setThemeVariables(themeVars)
  }, [setThemeMode, setThemeVariables])

  return null
}

export function AppKitProvider({ children }: { children: ReactNode }) {
  return (
    <>
      <ThemeSync />
      {children}
    </>
  )
}
