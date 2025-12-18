"use client";

import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Bot, ArrowRight, Zap, Bell } from "lucide-react";
import { useRouter } from "next/navigation";

interface AutoRepositionAlertProps {
  show: boolean;
}

export function AutoRepositionAlert({ show }: AutoRepositionAlertProps) {
  const router = useRouter();

  if (!show) return null;

  return (
    <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800 mb-6">
      <Bot className="h-5 w-5 text-blue-600 dark:text-blue-400" />
      <AlertTitle className="text-blue-900 dark:text-blue-100 font-semibold">
        Want Full Auto-Reposition? Use Telegram!
      </AlertTitle>
      <AlertDescription className="text-blue-800 dark:text-blue-200 space-y-4">
        <p className="mt-2">
          On the website, you'll get <strong>smart notifications</strong> when positions go out of range.
          You can reposition with one click while keeping full control of your keys.
        </p>

        <div className="bg-white dark:bg-blue-900 rounded-lg p-4 space-y-3">
          <div className="flex items-start gap-3">
            <Bell className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-blue-900 dark:text-blue-100">Smart Notifications (Website)</p>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Get alerts → Click to reposition → You sign → Done
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-blue-900 dark:text-blue-100">Full Automation (Telegram)</p>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                100% hands-off → Auto-executes while you sleep → Just wake up to repositioned positions
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mt-4">
          <Button
            onClick={() => router.push("/link")}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Bot className="h-4 w-4" />
            Link Wallet to Telegram
            <ArrowRight className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            onClick={() => window.open("https://t.me/hypebiscus_garden_bot", "_blank")}
            className="text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700"
          >
            Open Telegram Bot
          </Button>
        </div>

        <p className="text-xs text-blue-600 dark:text-blue-400 mt-3">
          💡 <strong>Why Telegram?</strong> The Telegram bot securely manages auto-signing,
          enabling true "set it and forget it" automation for your positions.
        </p>
      </AlertDescription>
    </Alert>
  );
}
