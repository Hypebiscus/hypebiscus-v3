"use client";

import React, { useState, useEffect } from 'react';
import { useWallet } from '@/hooks/useAppKitWallet';
import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/utils/showToast';
import {
  Copy,
  Check,
  ArrowSquareOut,
  QrCode as QrCodeIcon,
  Link as LinkIcon,
  Keyboard,
  Clock
} from '@phosphor-icons/react';

interface LinkToken {
  token: string;
  shortToken: string;
  expiresAt: string;
  qrCodeData: string;
  deepLink: string;
  instructions: {
    method1_deepLink: string;
    method2_qrCode: string;
    method3_manual: string;
  };
}

interface LinkedAccount {
  isLinked: boolean;
  telegramUserId?: string;
  telegramUsername?: string;
  walletAddress?: string;
  linkedAt?: string;
}

interface WalletLinkingCardProps {
  onLinkSuccess?: () => void;
  onLinkError?: (error: Error) => void;
}

export function WalletLinkingCard({ onLinkSuccess, onLinkError }: WalletLinkingCardProps) {
  const { publicKey, connected } = useWallet();

  const [linkToken, setLinkToken] = useState<LinkToken | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedDeepLink, setCopiedDeepLink] = useState(false);
  const [linkedAccount, setLinkedAccount] = useState<LinkedAccount | null>(null);

  // Format time remaining
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Generate link token
  const generateToken = async () => {
    if (!publicKey) {
      showToast.error('Wallet Not Connected', 'Please connect your wallet first');
      return;
    }

    setIsGenerating(true);

    try {
      const response = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'generate_wallet_link_token',
            arguments: {
              walletAddress: publicKey.toBase58(),
              expiresInMinutes: 5,
            },
          },
          id: Date.now(),
        }),
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message || 'Failed to generate link token');
      }

      // Parse the result
      const resultText = data.result?.content?.[0]?.text;
      if (!resultText) {
        throw new Error('Invalid response format');
      }

      const parsedResult = JSON.parse(resultText);
      setLinkToken(parsedResult);
      setTimeRemaining(5 * 60); // 5 minutes
      setIsPolling(true);

      showToast.success('Link Token Generated', 'Use any of the 3 methods to link your Telegram account');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      showToast.error('Generation Failed', errorMsg);
      onLinkError?.(error instanceof Error ? error : new Error(errorMsg));
    } finally {
      setIsGenerating(false);
    }
  };

  // Copy short token to clipboard
  const copyShortToken = () => {
    if (linkToken?.shortToken) {
      navigator.clipboard.writeText(linkToken.shortToken);
      setCopiedToken(true);
      showToast.success('Copied!', 'Short token copied to clipboard');
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  // Copy deep link to clipboard
  const copyDeepLink = () => {
    if (linkToken?.deepLink) {
      navigator.clipboard.writeText(linkToken.deepLink);
      setCopiedDeepLink(true);
      showToast.success('Copied!', 'Deep link copied to clipboard');
      setTimeout(() => setCopiedDeepLink(false), 2000);
    }
  };

  // Countdown timer
  useEffect(() => {
    if (timeRemaining <= 0) return;

    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          setIsPolling(false);
          setLinkToken(null);
          showToast.warning('Token Expired', 'Please generate a new link token');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeRemaining]);

  // Poll for link status every 3 seconds
  useEffect(() => {
    if (!isPolling || !publicKey) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch('/api/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/call',
            params: {
              name: 'get_linked_account',
              arguments: { walletAddress: publicKey.toBase58() },
            },
            id: Date.now(),
          }),
        });

        const data = await response.json();
        const resultText = data.result?.content?.[0]?.text;

        if (resultText) {
          const parsedResult = JSON.parse(resultText);

          if (parsedResult.isLinked && parsedResult.linkedAccount) {
            setLinkedAccount({
              isLinked: true,
              ...parsedResult.linkedAccount,
            });
            setIsPolling(false);
            setLinkToken(null);
            showToast.success('Wallet Linked!', `Successfully linked to Telegram user @${parsedResult.linkedAccount.telegramUsername || 'Unknown'}`);
            onLinkSuccess?.();
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [isPolling, publicKey, onLinkSuccess]);

  // Check if already linked on mount
  useEffect(() => {
    if (!publicKey) return;

    const checkLinked = async () => {
      try {
        const response = await fetch('/api/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/call',
            params: {
              name: 'get_linked_account',
              arguments: { walletAddress: publicKey.toBase58() },
            },
            id: Date.now(),
          }),
        });

        const data = await response.json();
        const resultText = data.result?.content?.[0]?.text;

        if (resultText) {
          const parsedResult = JSON.parse(resultText);
          if (parsedResult.isLinked && parsedResult.linkedAccount) {
            setLinkedAccount({
              isLinked: true,
              ...parsedResult.linkedAccount,
            });
          }
        }
      } catch (error) {
        console.error('Check linked error:', error);
      }
    };

    checkLinked();
  }, [publicKey]);

  if (!connected) {
    return (
      <div className="border border-border rounded-lg p-8 bg-gray-900/50 text-center">
        <LinkIcon size={48} className="mx-auto text-gray-600 mb-4" />
        <h3 className="text-xl font-semibold text-white mb-2">Connect Wallet First</h3>
        <p className="text-gray-400">
          Please connect your Solana wallet to link it with your Telegram account
        </p>
      </div>
    );
  }

  if (linkedAccount?.isLinked) {
    return (
      <div className="border border-green-500/30 rounded-lg p-6 bg-green-900/10">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
            <Check size={24} className="text-green-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white mb-1">Wallet Linked Successfully!</h3>
            <p className="text-gray-400 text-sm mb-3">
              Your wallet is linked to Telegram user <span className="text-white font-medium">@{linkedAccount.telegramUsername || 'Unknown'}</span>
            </p>
            <div className="bg-gray-900/50 rounded p-3 text-xs">
              <div className="flex justify-between mb-1">
                <span className="text-gray-500">Telegram ID:</span>
                <span className="text-gray-300 font-mono">
                  {linkedAccount.telegramUserId || 'Unknown'}
                </span>
              </div>
              <div className="flex justify-between mb-1">
                <span className="text-gray-500">Wallet Address:</span>
                <span className="text-gray-300 font-mono">
                  {linkedAccount.walletAddress?.substring(0, 8)}...{linkedAccount.walletAddress?.substring(linkedAccount.walletAddress.length - 8)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Linked At:</span>
                <span className="text-gray-300">
                  {linkedAccount.linkedAt ? new Date(linkedAccount.linkedAt).toLocaleString() : 'Unknown'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-white mb-2">Link Your Telegram Account</h2>
        <p className="text-gray-400">
          Choose any of the 3 methods below to link your wallet with Telegram
        </p>
      </div>

      {!linkToken ? (
        /* Generate Token Button */
        <div className="border border-border rounded-lg p-8 bg-gray-900/50 text-center">
          <LinkIcon size={64} className="mx-auto text-primary mb-4" />
          <h3 className="text-xl font-semibold text-white mb-3">
            Generate Link Token
          </h3>
          <p className="text-gray-400 mb-6 max-w-md mx-auto">
            Click the button below to generate a secure link token. You&apos;ll have 5 minutes to complete the linking process using any of the 3 available methods.
          </p>
          <Button
            onClick={generateToken}
            disabled={isGenerating}
            size="lg"
            className="px-8"
          >
            {isGenerating ? 'Generating...' : 'Generate Link Token'}
          </Button>
        </div>
      ) : (
        <>
          {/* Timer */}
          <div className="flex items-center justify-center gap-2 text-sm">
            <Clock size={16} className="text-yellow-400" />
            <span className="text-gray-400">Token expires in:</span>
            <span className={`font-mono font-bold ${timeRemaining < 60 ? 'text-red-400' : 'text-white'}`}>
              {formatTime(timeRemaining)}
            </span>
          </div>

          {/* Method 1: Deep Link */}
          <div className="border border-border rounded-lg p-6 bg-gray-900/50">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <ArrowSquareOut size={20} className="text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-white mb-2">Method 1: Deep Link</h3>
                <p className="text-sm text-gray-400 mb-4">
                  Click the button below to automatically open Telegram and link your account
                </p>
                <div className="flex gap-3">
                  <Button
                    onClick={() => window.open(linkToken.deepLink, '_blank')}
                    className="flex-1"
                  >
                    <ArrowSquareOut size={16} className="mr-2" />
                    Open in Telegram
                  </Button>
                  <Button
                    variant="outline"
                    onClick={copyDeepLink}
                  >
                    {copiedDeepLink ? <Check size={16} /> : <Copy size={16} />}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Method 2: QR Code */}
          <div className="border border-border rounded-lg p-6 bg-gray-900/50">
            <div className="flex flex-col md:flex-row items-start gap-6">
              <div className="flex-shrink-0">
                <div className="bg-white p-4 rounded-lg">
                  {linkToken?.qrCodeData ? (
                    <QRCode
                      value={linkToken.qrCodeData}
                      size={200}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#000000"
                    />
                  ) : (
                    <div className="w-[200px] h-[200px] flex items-center justify-center text-gray-500">
                      Loading QR...
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-start gap-3 mb-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <QrCodeIcon size={20} className="text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-2">Method 2: QR Code</h3>
                    <p className="text-sm text-gray-400">
                      Scan this QR code with your phone camera or Telegram app to link instantly
                    </p>
                  </div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4 text-sm text-gray-300">
                  <p className="mb-2 font-medium">How to scan:</p>
                  <ol className="list-decimal list-inside space-y-1 text-xs">
                    <li>Open Telegram on your phone</li>
                    <li>Go to Settings → Devices → Scan QR Code</li>
                    <li>Point your camera at this QR code</li>
                    <li>Confirm to link your account</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>

          {/* Method 3: Manual Code */}
          <div className="border border-border rounded-lg p-6 bg-gray-900/50">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <Keyboard size={20} className="text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-white mb-2">Method 3: Manual Code</h3>
                <p className="text-sm text-gray-400 mb-4">
                  Open Telegram and send this 8-character code to the bot using the /link command
                </p>
                <div className="flex gap-3 items-center mb-4">
                  <div className="flex-1 bg-gray-800/50 rounded-lg p-4 border border-border">
                    <code className="text-2xl font-mono font-bold text-white tracking-widest">
                      {linkToken.shortToken}
                    </code>
                  </div>
                  <Button
                    variant="outline"
                    onClick={copyShortToken}
                    className="px-4"
                  >
                    {copiedToken ? <Check size={20} /> : <Copy size={20} />}
                  </Button>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4 text-sm">
                  <p className="text-gray-300 mb-2">
                    In Telegram, send: <code className="bg-gray-900 px-2 py-1 rounded text-primary">/link {linkToken.shortToken}</code>
                  </p>
                  <p className="text-xs text-gray-500">
                    to <a href="https://t.me/hypebiscus_garden_bot" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">@hypebiscus_garden_bot</a>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Polling Indicator */}
          {isPolling && (
            <div className="border border-blue-500/30 rounded-lg p-4 bg-blue-900/10">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400"></div>
                <p className="text-sm text-blue-300">
                  Waiting for you to complete linking in Telegram...
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
