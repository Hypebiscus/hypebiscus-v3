// src/components/LPStatusBadge.tsx
"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useHybridPositions } from "@/hooks/useHybridPositions";
import Link from "next/link";

const LPStatusBadge = () => {
  const { publicKey, connected } = useWallet();

  // Use SWR-cached hook for positions (reduces RPC calls)
  const { activePositions } = useHybridPositions(publicKey?.toBase58(), {
    includeHistorical: false,
    includeLive: true,
    refreshInterval: 60000, // 60 seconds (increased from 30s to reduce load)
  });

  const count = activePositions.length;

  if (!connected || count === 0) return null;

  return (
    <Link href="/wallet">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 hover:bg-green-500/20 transition-all">
        <div className="relative">
          <div className="w-2 h-2 bg-green-500 rounded-full" />
          <div className="absolute inset-0 w-2 h-2 bg-green-500 rounded-full animate-ping" />
        </div>
        <span className="hidden sm:inline text-sm font-medium text-green-400">
          {count} Active {count === 1 ? "Position" : "Positions"}
        </span>
        <span className="sm:hidden text-sm font-medium text-green-400">{count}</span>
      </div>
    </Link>
  );
};

export default LPStatusBadge;
