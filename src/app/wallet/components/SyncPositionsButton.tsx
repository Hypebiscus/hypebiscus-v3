"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Lock } from "lucide-react";
import { showToast } from "@/lib/utils/showToast";
import { mcpClient } from "@/lib/services/mcpClient";
import { usePaymentVerification } from "@/hooks/usePaymentVerification";
import { useRouter } from "next/navigation";

interface SyncPositionsButtonProps {
  walletAddress: string | null;
  onSyncComplete?: () => void;
}

export function SyncPositionsButton({ walletAddress, onSyncComplete }: SyncPositionsButtonProps) {
  const [syncing, setSyncing] = useState(false);
  const { status, checkPaymentStatus } = usePaymentVerification();
  const router = useRouter();

  // Check payment status on mount and when wallet changes
  useEffect(() => {
    if (walletAddress) {
      checkPaymentStatus();
    }
  }, [walletAddress, checkPaymentStatus]);

  const handleSync = async () => {
    if (!walletAddress) {
      showToast.error("Please connect your wallet", "");
      return;
    }

    setSyncing(true);

    try {
      // Check payment status first
      const paymentStatus = await checkPaymentStatus();

      if (!paymentStatus.hasAccess) {
        showToast.error("Purchase credits to enable position sync", "");
        router.push("/pricing");
        setSyncing(false);
        return;
      }

      // Call MCP sync tool
      console.log("🔄 Syncing positions for:", walletAddress.slice(0, 8) + "...");

      const result = await mcpClient.callTool("sync_wallet_positions", {
        walletAddress,
      }) as {
        success: boolean;
        positionsSynced: number;
        hasAccess: boolean;
        reason?: string;
        message: string;
      };

      if (result.success) {
        showToast.success(
          `✅ Synced ${result.positionsSynced} position${result.positionsSynced !== 1 ? "s" : ""} to database`,
          ""
        );

        console.log("✅ Sync result:", result);

        // Callback to refresh positions
        if (onSyncComplete) {
          onSyncComplete();
        }
      } else {
        if (result.reason === "no_payment") {
          showToast.error("Purchase credits to enable position sync", "");
          router.push("/pricing");
        } else {
          showToast.error(result.message || "Failed to sync positions", "");
        }
      }
    } catch (error) {
      console.error("❌ Sync failed:", error);
      showToast.error(
        error instanceof Error ? error.message : "Failed to sync positions",
        ""
      );
    } finally {
      setSyncing(false);
    }
  };

  // Determine button state
  const hasAccess = status.hasAccess;
  const isLoading = syncing || status.loading;

  return (
    <Button
      onClick={handleSync}
      disabled={isLoading}
      variant={hasAccess ? "default" : "outline"}
      className="flex items-center gap-2"
    >
      {isLoading ? (
        <RefreshCw className="h-4 w-4 animate-spin" />
      ) : hasAccess ? (
        <RefreshCw className="h-4 w-4" />
      ) : (
        <Lock className="h-4 w-4" />
      )}
      {isLoading
        ? "Syncing..."
        : hasAccess
        ? "Sync Positions"
        : "Unlock Sync (Purchase Credits)"}
    </Button>
  );
}
