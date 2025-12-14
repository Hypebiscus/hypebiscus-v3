"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Lock, TrendingUp, History, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { usePaymentVerification } from "@/hooks/usePaymentVerification";

interface CreditGateAlertProps {
  show: boolean;
  positionCount: number;
}

export function CreditGateAlert({ show, positionCount }: CreditGateAlertProps) {
  const { status, checkPaymentStatus } = usePaymentVerification();
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (show && positionCount > 0) {
      checkPaymentStatus();
      setIsVisible(!status.hasAccess);
    } else {
      setIsVisible(false);
    }
  }, [show, positionCount, status.hasAccess, checkPaymentStatus]);

  if (!isVisible) return null;

  return (
    <Alert className="mb-6 border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
      <Lock className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />
      <AlertTitle className="text-lg font-semibold text-yellow-800 dark:text-yellow-400">
        Position Tracking Locked
      </AlertTitle>
      <AlertDescription>
        <p className="text-yellow-700 dark:text-yellow-300 mb-4">
          You&apos;re viewing live positions from the blockchain.
          Purchase credits to unlock advanced features:
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div className="flex items-start gap-2">
            <History className="h-5 w-5 text-yellow-600 dark:text-yellow-500 mt-0.5" />
            <div>
              <p className="font-semibold text-yellow-800 dark:text-yellow-400">
                Historical PnL Tracking
              </p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                Track deposit prices and calculate accurate PnL over time
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <XCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 mt-0.5" />
            <div>
              <p className="font-semibold text-yellow-800 dark:text-yellow-400">
                Position Close via Platform
              </p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                Close positions directly from the dashboard
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <TrendingUp className="h-5 w-5 text-yellow-600 dark:text-yellow-500 mt-0.5" />
            <div>
              <p className="font-semibold text-yellow-800 dark:text-yellow-400">
                Advanced Analytics
              </p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                Transaction history, fee tracking, and detailed reports
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Lock className="h-5 w-5 text-yellow-600 dark:text-yellow-500 mt-0.5" />
            <div>
              <p className="font-semibold text-yellow-800 dark:text-yellow-400">
                Auto-Reposition Features
              </p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                Automated position management and notifications
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={() => router.push("/pricing")}
            className="bg-yellow-600 hover:bg-yellow-700 text-white"
          >
            Purchase Credits
          </Button>
          <Button
            onClick={() => setIsVisible(false)}
            variant="outline"
            className="border-yellow-600 text-yellow-700 hover:bg-yellow-100 dark:border-yellow-500 dark:text-yellow-400 dark:hover:bg-yellow-950/40"
          >
            Dismiss
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
