// src/components/dashboard-components/ChatBox.tsx
"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  ChartLineIcon,
  ClockIcon,
  PlusIcon,
  WalletIcon,
  ArrowClockwiseIcon,
  ShuffleIcon,
  XIcon,
} from "@phosphor-icons/react";
import BtcPoolsList from "./BtcPoolsList";
import BtcFilterDropdown from "./BtcFilterDropdown";
import BtcFilterModal from "./BtcFilterModal";
import AddLiquidityModal from "./AddLiquidityModal";
import QuickActionButtons from "./QuickActionButtons";
import PortfolioStyleModal from "./PortfolioStyleModal";
import UserPositionsList from "./UserPositionsList";
import ChatMessage from "@/components/chat-message";
import ChatInput from "@/components/chat-input";
import JupiterPlugin from "@/components/JupiterPlugin"; // Changed from JupiterTerminal
import { fetchMessage } from "@/lib/api/chat";
import { fetchPremiumMessage } from "@/lib/api/premiumChat";
import { FormattedPool, formatPool, getPreferredBinSteps } from '@/lib/utils/poolUtils';
import { useErrorHandler } from '@/lib/utils/errorHandling';
import { usePoolSearchService } from '@/lib/services/poolSearchService';
import { usePaymentVerification } from '@/hooks/usePaymentVerification';
import { mcpClient } from '@/lib/services/mcpClient';
import { CreditsPurchaseModal } from '@/components/mcp-components/CreditsPurchaseModal';
import { CreditBalanceIndicator } from './CreditBalanceIndicator';
import { useWallet } from '@solana/wallet-adapter-react';
import { useRouter } from 'next/navigation';
import { showToast } from '@/lib/utils/showToast';

// Type definitions
type MessageRole = "user" | "assistant";

interface Message {
  role: MessageRole;
  content: string;
  timestamp: Date;
}

interface MessageWithPool {
  message: Message;
  pools?: FormattedPool[];
}

const ChatBox: React.FC = () => {
  // Hooks
  const { publicKey, connected } = useWallet();
  const router = useRouter();
  const { verifyAccess, checkPaymentStatus } = usePaymentVerification();

  // State management
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isPoolLoading, setIsPoolLoading] = useState(false);
  const [selectedPool, setSelectedPool] = useState<FormattedPool | null>(null);
  const [isAddLiquidityModalOpen, setIsAddLiquidityModalOpen] = useState(false);
  const [isPortfolioStyleModalOpen, setIsPortfolioStyleModalOpen] = useState(false);
  const [isBtcFilterModalOpen, setIsBtcFilterModalOpen] = useState(false);
  const [selectedPortfolioStyle, setSelectedPortfolioStyle] = useState<string | null>(null);
  const [showWelcomeScreen, setShowWelcomeScreen] = useState(true);
  const [activeTokenFilter, setActiveTokenFilter] = useState<string>('');

  // Jupiter Plugin state (changed from showJupiterTerminal)
  const [showJupiterPlugin, setShowJupiterPlugin] = useState(false);

  // Payment & MCP states
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showTelegramPrompt, setShowTelegramPrompt] = useState(false);
  const [pendingMCPQuery, setPendingMCPQuery] = useState<string | null>(null);
  
  // Pool tracking states
  const [shownPoolAddresses, setShownPoolAddresses] = useState<string[]>([]);
  const [shownBinStepsPerStyle, setShownBinStepsPerStyle] = useState<{
    [style: string]: number[];
  }>({ conservative: [], moderate: [], aggressive: [] });
  const [, setDifferentPoolRequests] = useState(0);
  const [messageWithPools, setMessageWithPools] = useState<MessageWithPool[]>([]);

  // Streaming states
  const [streamingMessage, setStreamingMessage] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  // User positions display state
  const [showUserPositions, setShowUserPositions] = useState(false);
  const [positionsAiResponse, setPositionsAiResponse] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Services
  const { handleError} = useErrorHandler();
  const { service: poolSearchService } = usePoolSearchService();

  // Intent detection patterns - moved to useMemo to avoid dependency warnings
  const MESSAGE_PATTERNS = useMemo(() => ({
    educational: [
      /what is.*(?:pool|lp|liquidity)/i,
      /how does.*work/i,
      /why solana/i,
      /what are the risks/i,
    ],
    poolRequest: [
      /(?:find|show|get).*(?:pool|liquidity)/i,
      /recommend/i,
      /best.*pool/i,
      /highest.*yield/i,
      /best.*yield/i,
      /best.*liquidity/i,
      /high.*tvl/i,
      /invest.*where/i,
      /which.*pool/i,
      /btc.*pool/i,
      /bitcoin.*pool/i,
      /lp.*opportunities/i,
      /liquidity.*provision.*options/i,
    ],
    alternativeRequest: [
      /another/i,
      /different/i,
      /show.*more/i,
      /other options/i,
      /alternatives/i,
    ],
    swapRequest: [
      /swap/i,
      /exchange/i,
      /trade.*token/i,
      /convert.*to/i,
      /buy.*with/i,
      /sell.*for/i,
      /jupiter/i,
    ],
    // NEW: Pool Metrics Queries (requires payment)
    poolMetricsQuery: [
      /pool.*(?:metrics|stats|statistics)/i,
      /show.*pool.*(?:info|data)/i,
      /(?:zbtc|btc|sol).*pool.*(?:stats|info)/i,
      /pool.*(?:apy|fees|volume|liquidity)/i,
      /what.*is.*pool.*doing/i,
      /pool.*performance/i,
    ],
    // NEW: MCP Data Queries (requires payment)
    mcpDataQuery: [
      /my positions?/i,
      /my liquidity/i,
      /show.*position/i,
      /what.*positions?.*(?:do i have|have i)/i,
      /check.*position/i,
      /position.*status/i,
      /my.*performance/i,
      /how.*(?:am i|is my).*doing/i,
      /portfolio.*stats/i,
      /wallet.*performance/i,
    ],
    // NEW: Automation Queries (requires payment)
    automationQuery: [
      /auto.*reposition/i,
      /enable.*automation/i,
      /activate.*auto/i,
      /monitor.*position/i,
      /auto.*manage/i,
      /rebalance.*automatic/i,
      /set.*up.*automation/i,
    ],
    // NEW: Premium Deep Analysis (requires credits/subscription)
    premiumAnalysis: [
      /deep.*analys/i,
      /detailed.*analys/i,
      /thorough.*analys/i,
      /expert.*analys/i,
      /premium.*analys/i,
      /advanced.*analys/i,
      /in[- ]?depth.*analys/i,
      /comprehensive.*analys/i,
    ],
  }), []);

  // Core message management
  const addMessage = useCallback(
    (role: MessageRole, content: string, pools?: FormattedPool[]) => {
      const newMessage = { role, content, timestamp: new Date() };
      setMessages((prev) => [...prev, newMessage]);
      setMessageWithPools((prev) => [...prev, { message: newMessage, pools }]);

      if (showWelcomeScreen) {
        setShowWelcomeScreen(false);
      }
    },
    [showWelcomeScreen]
  );

  const addErrorMessage = useCallback(
    (error: unknown) => {
      const appError = handleError(error, 'Chat operation');
      addMessage("assistant", appError.userMessage);
    },
    [addMessage, handleError]
  );

  /**
   * Cleans up loading messages from the message history
   */
  const cleanupLoadingMessages = useCallback((style: string | null) => {
    const loadingPatterns = [
      `Finding the best ${style} Solana liquidity pools for you...`,
      `Finding the best Solana liquidity pools based on your request...`,
      "You've selected the",
      "portfolio style. I'll recommend pools"
    ];

    setMessages((prevMessages) => {
      return prevMessages.filter(
        (msg) => !(
          msg.role === "assistant" &&
          loadingPatterns.some(pattern => msg.content.includes(pattern))
        )
      );
    });

    setMessageWithPools((prevMsgWithPools) => {
      return prevMsgWithPools.filter(
        (item) => !(
          item.message.role === "assistant" &&
          loadingPatterns.some(pattern => item.message.content.includes(pattern))
        )
      );
    });
  }, []);

  // Intent analysis function
  const analyzeMessageIntent = useCallback((message: string) => {
    const lowerMessage = message.toLowerCase();

    // Check for educational queries
    const isEducational = MESSAGE_PATTERNS.educational.some(pattern =>
      pattern.test(lowerMessage)
    );

    // Check for pool requests
    const isPoolRequest = MESSAGE_PATTERNS.poolRequest.some(pattern =>
      pattern.test(lowerMessage)
    );

    // Check for alternative pool requests
    const isAlternativeRequest = MESSAGE_PATTERNS.alternativeRequest.some(pattern =>
      pattern.test(lowerMessage)
    );

    // Check for swap requests
    const isSwapRequest = MESSAGE_PATTERNS.swapRequest.some(pattern =>
      pattern.test(lowerMessage)
    );

    // Check for pool metrics queries (requires payment)
    const isPoolMetricsQuery = MESSAGE_PATTERNS.poolMetricsQuery.some(pattern =>
      pattern.test(lowerMessage)
    );

    // Check for MCP data queries (requires payment)
    const isMCPDataQuery = MESSAGE_PATTERNS.mcpDataQuery.some(pattern =>
      pattern.test(lowerMessage)
    );

    // Check for automation queries (requires payment)
    const isAutomationQuery = MESSAGE_PATTERNS.automationQuery.some(pattern =>
      pattern.test(lowerMessage)
    );

    // Check for premium analysis requests (requires credits/subscription)
    const isPremiumAnalysis = MESSAGE_PATTERNS.premiumAnalysis.some(pattern =>
      pattern.test(lowerMessage)
    );

    return {
      isEducational,
      isPoolRequest,
      isAlternativeRequest,
      isSwapRequest,
      isPoolMetricsQuery,
      isMCPDataQuery,
      isAutomationQuery,
      isPremiumAnalysis,
      isGeneralChat: !isEducational && !isPoolRequest && !isAlternativeRequest && !isSwapRequest && !isPoolMetricsQuery && !isMCPDataQuery && !isAutomationQuery && !isPremiumAnalysis
    };
  }, [MESSAGE_PATTERNS]);

  // Handle swap requests (updated message text)
  const handleSwapRequest = useCallback(async () => {
    addMessage("assistant", "I'll open Jupiter Plugin for you to swap tokens. Jupiter Plugin provides the best rates across all Solana DEXes.");
    setShowJupiterPlugin(true); // Changed from setShowJupiterTerminal
  }, [addMessage]);

  // Handle pool metrics queries (FREE - no payment required)
  const handlePoolMetricsQuery = useCallback(async () => {
    try {
      addMessage("assistant", "📊 Fetching pool metrics from Meteora...");
      setIsLoading(true);

      const poolData = await mcpClient.getPoolMetrics();

      if (poolData) {
        const priceKeys = Object.keys(poolData.prices);
        const token0Price = priceKeys[0] ? poolData.prices[priceKeys[0]] : undefined;
        const token1Price = priceKeys[1] ? poolData.prices[priceKeys[1]] : undefined;

        const summary = `✅ **${poolData.poolName}** Pool Metrics:\n\n` +
          `💰 **Total Liquidity**: $${poolData.liquidity.totalUSD.toLocaleString()}\n` +
          `📈 **APY**: ${poolData.metrics.apy.toFixed(2)}%\n` +
          `💵 **24h Fees**: $${poolData.metrics.fees24h.toLocaleString()}\n` +
          `📊 **24h Volume**: $${poolData.metrics.volume24h.toLocaleString()}\n` +
          `🔢 **Bin Step**: ${poolData.metrics.binStep}\n\n` +
          `**Token Prices**:\n` +
          `• ${poolData.liquidity.tokenA.symbol}: $${token0Price?.usd.toLocaleString() || 'N/A'}` +
          `${token0Price?.change24h ? ` (${token0Price.change24h > 0 ? '+' : ''}${token0Price.change24h.toFixed(2)}% 24h)` : ''}\n` +
          `• ${poolData.liquidity.tokenB.symbol}: $${token1Price?.usd.toLocaleString() || 'N/A'}` +
          `${token1Price?.change24h ? ` (${token1Price.change24h > 0 ? '+' : ''}${token1Price.change24h.toFixed(2)}% 24h)` : ''}\n\n` +
          (poolData.recommendation ? `💡 **Recommendation**: ${poolData.recommendation}` : '');

        addMessage("assistant", summary);
      } else {
        addMessage("assistant", "❌ Unable to fetch pool metrics. Please try again.");
      }
    } catch (error) {
      console.error('Pool metrics query error:', error);
      addMessage("assistant", "❌ Failed to fetch pool metrics. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [addMessage]);

  // Handle MCP data queries (positions - FREE feature)
  const handleMCPDataQuery = useCallback(async () => {
    if (!connected || !publicKey) {
      addMessage("assistant", "🔐 Please connect your wallet to access your position data.");
      return;
    }

    // Show positions UI - FREE, no payment required
    try {
      setIsLoading(true);
      setShowWelcomeScreen(false);

      // Set AI response for the positions view
      const aiResponse = `📊 Here are your active positions. If any position is **out of range**, you can click **Reposition** to close it and re-add liquidity to the current active price range.`;

      setPositionsAiResponse(aiResponse);
      setShowUserPositions(true);

      addMessage("assistant", "📊 Loading your positions with reposition options...");
    } catch (error) {
      console.error('MCP query error:', error);
      addMessage("assistant", "❌ Failed to fetch position data. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [connected, publicKey, addMessage]);

  // Handle premium deep analysis (requires credits or subscription)
  const handlePremiumAnalysis = useCallback(async (userMessage: string) => {
    if (!connected || !publicKey) {
      addMessage("assistant", "🔐 Please connect your wallet to access premium AI analysis.");
      return;
    }

    // Check payment status
    const accessResult = await verifyAccess({
      requireCredits: 1,
      action: 'use premium AI analysis',
    });

    if (!accessResult.hasAccess) {
      // No payment - show payment modal
      setPendingMCPQuery(userMessage);
      setShowPaymentModal(true);
      addMessage(
        "assistant",
        `💎 **Premium Deep Analysis** uses our most advanced AI model (Claude Opus 4) for comprehensive insights.\n\n**Cost**: 1 credit ($0.01) per analysis\n**Or**: Premium subscription ($4.99/month) for unlimited analyses\n\nYou'll get:\n✓ Deeper technical analysis\n✓ More detailed risk assessment\n✓ Actionable recommendations\n✓ Advanced market insights\n\nClick below to purchase credits!`
      );
      return;
    }

    // Has access - execute premium analysis
    try {
      addMessage("assistant", "✨ Analyzing with premium AI (Claude Opus 4)...");
      setIsLoading(true);

      const walletAddress = publicKey.toBase58();
      const messageHistory = [
        ...messages,
        {
          role: "user" as const,
          content: userMessage,
          timestamp: new Date(),
        },
      ];

      // Start streaming premium response
      addMessage("assistant", "", undefined);
      setStreamingMessage("");
      setIsStreaming(true);

      const premiumResponse = await fetchPremiumMessage(
        messageHistory,
        walletAddress,
        undefined,
        selectedPortfolioStyle || undefined,
        (chunk) => {
          setStreamingMessage((prev) => (prev || "") + chunk);
        }
      );

      // Update the placeholder message with the full response
      setMessages((prev) => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1].content = premiumResponse;
        return newMessages;
      });

      setMessageWithPools((prev) => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1].message.content = premiumResponse;
        return newMessages;
      });

      // Success message
      const creditsInfo = accessResult.creditsRemaining !== undefined
        ? ` (${accessResult.creditsRemaining} credits remaining)`
        : '';

      showToast.success(
        'Premium Analysis Complete',
        `1 credit used${creditsInfo}`
      );

    } catch (error) {
      console.error('Premium analysis error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('Payment required')) {
        setPendingMCPQuery(userMessage);
        setShowPaymentModal(true);
        addMessage("assistant", "💳 Premium analysis requires credits or subscription. Please purchase to continue.");
      } else {
        addMessage("assistant", `❌ Premium analysis failed: ${errorMessage}`);
      }
    } finally {
      setStreamingMessage(null);
      setIsStreaming(false);
      setIsLoading(false);
    }
  }, [connected, publicKey, verifyAccess, addMessage, messages, selectedPortfolioStyle, showToast]);

  // Handle automation queries (auto-reposition - linking is FREE, but repositions cost money)
  const handleAutomationQuery = useCallback(async () => {
    if (!connected || !publicKey) {
      addMessage("assistant", "🔐 Please connect your wallet to enable automation.");
      return;
    }

    // Explain automation - linking is free, but repositions cost credits/subscription
    addMessage(
      "assistant",
      `🤖 **Auto-Repositioning** is available!\n\n**How it works:**\n1. Our AI monitors your positions 24/7\n2. When a position goes out of range, we notify you via Telegram\n3. You can auto-reposition with one click\n\n⚡ **Next Step:** Link your Telegram account to enable automation.\n\nGenerating your Telegram link token...`
    );

    try {
      const walletAddress = publicKey.toBase58();
      const response = await mcpClient.callTool('generate_wallet_link_token', {
        walletAddress,
        expiresInMinutes: 5,
      }) as { deepLink?: string; shortToken?: string; qrCodeData?: string; error?: string; message?: string };

      // Check if response has error
      if (response?.error) {
        if (response.error === 'VALIDATION_ERROR' && response.message?.includes('already linked')) {
          addMessage(
            "assistant",
            `✅ **Your wallet is already linked to Telegram!**\n\n🤖 Automation is ready to use. You'll receive notifications via Telegram when your positions need rebalancing.\n\n📱 **Open Telegram Bot:** [Click here to open bot](https://t.me/hypebiscus_garden_bot)\n\nOr visit the [Link page](/link) to manage your connection.`
          );
        } else {
          addMessage(
            "assistant",
            `⚠️ ${response.message || 'Failed to generate link token'}\n\nPlease visit the [Link page](/link) to manage your Telegram connection.`
          );
        }
        return;
      }

      if (response?.deepLink) {
        addMessage(
          "assistant",
          `✅ **Telegram Link Ready!**\n\n**Option 1:** Click the link to open Telegram:\n👉 [Open Telegram Bot](${response.deepLink})\n\n**Option 2:** Or visit the [Link page](/link) to see QR code and manual code options.\n\n⏱️ Link expires in 5 minutes.`
        );
      } else {
        throw new Error('Failed to generate link token');
      }
    } catch (error) {
      console.error('Telegram link generation error:', error);
      addMessage(
        "assistant",
        `❌ Failed to generate Telegram link. Please visit the [Link page](/link) to link manually.`
      );
    }
  }, [connected, publicKey, addMessage]);

  // Streaming response handler
  const handleStreamingResponse = useCallback(async (
    messageHistory: Message[],
    poolData?: FormattedPool,
    portfolioStyle?: string
  ) => {
    addMessage("assistant", "", undefined);
    setStreamingMessage("");
    setIsStreaming(true);

    try {
      const response = await fetchMessage(
        messageHistory,
        poolData,
        portfolioStyle,
        (chunk) => {
          setStreamingMessage(prev => (prev || "") + chunk);
        }
      );
      
      // Update the placeholder message with the full response
      setMessages(prev => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1].content = response;
        return newMessages;
      });
      
      setMessageWithPools(prev => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1].message.content = response;
        return newMessages;
      });
      
      return response;
    } catch (error) {
      console.error('Streaming response error:', error);
      addErrorMessage(error);
      throw error;
    } finally {
      setStreamingMessage(null);
      setIsStreaming(false);
    }
  }, [addMessage, addErrorMessage]);

  // Handle educational queries
  const handleEducationalQuery = useCallback(async (userMessage: string) => {
    const messageHistory = [
      ...messages,
      {
        role: "user" as const,
        content: userMessage,
        timestamp: new Date(),
      },
    ];

    await handleStreamingResponse(messageHistory);
  }, [messages, handleStreamingResponse]);

  // Declare showBestYieldPool before it's used
  const showBestYieldPool = useCallback(
    async (style: string | null) => {
      setIsPoolLoading(true);

      try {
        // Search for pools using the service
        const allPools = await poolSearchService.searchPools({
          style,
          shownPoolAddresses,
          tokenFilter: activeTokenFilter || undefined, // Include active token filter
          onLoadingMessage: (msg) => addMessage("assistant", msg)
        });

        if (allPools.length > 0) {
          // Get the best pool for the given style
          const selectedPool = poolSearchService.getBestPool(allPools, style, shownPoolAddresses);
          
          if (selectedPool) {
            // Add the pool address to shown list
            setShownPoolAddresses(prev => [...prev, selectedPool.address]);
            
            if (style) {
              const currentBinStep = selectedPool.bin_step || 0;
              setShownBinStepsPerStyle(prev => ({
                ...prev,
                [style]: [...(prev[style] || []), currentBinStep]
              }));
            }

            // First create a formatted pool to display immediately
            const formattedPool: FormattedPool = formatPool(selectedPool, style || 'conservative');
            
            // Add message with the pool data so it shows immediately
            addMessage("assistant", "", [formattedPool]);
            
            // Start streaming the AI analysis
            setStreamingMessage("");
            setIsStreaming(true);
            
            // Now process the selected pool with AI analysis
            await poolSearchService.processSelectedPool({
              selectedPool,
              style,
              onStreamingUpdate: (chunk) => {
                setStreamingMessage(prev => (prev || "") + chunk);
              },
              onComplete: (analysis) => {
                // Update the placeholder message with the full response
                setMessages(prev => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1].content = analysis;
                  return newMessages;
                });
                
                // Update the message content but keep our existing pool data
                setMessageWithPools(prev => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = {
                    message: { ...newMessages[newMessages.length - 1].message, content: analysis },
                    pools: newMessages[newMessages.length - 1].pools // Keep existing pools
                  };
                  return newMessages;
                });
                
                // Reset streaming state
                setStreamingMessage(null);
                setIsStreaming(false);
              },
              onError: () => {
                // Reset streaming state
                setStreamingMessage(null);
                setIsStreaming(false);
                
                // Fallback message if AI analysis fails
                const formattedPool = { 
                  name: selectedPool.name, 
                  binStep: selectedPool.bin_step?.toString() || 'N/A',
                  apy: selectedPool.apy.toFixed(2) + '%'
                };
                
                addMessage(
                  "assistant",
                  `Here's a ${style || "recommended"} liquidity pool that matches your criteria. This ${formattedPool.name} pool has a bin step of ${formattedPool.binStep} and currently offers an APY of ${formattedPool.apy}.`,
                  []
                );
              }
            });

            // Clean up loading messages
            cleanupLoadingMessages(style);

          } else {
            addMessage(
              "assistant",
              `I couldn't find any ${style || 'recommended'} pools that match your criteria at the moment. Please try again later or adjust your preferences.`
            );
          }

        } else {
          addMessage(
            "assistant",
            `I couldn't find any ${style || 'recommended'} pools that match your criteria at the moment. Please try again later or adjust your preferences.`
          );
        }

      } catch (error) {
        console.error("Error in showBestYieldPool:", error);
        addErrorMessage(error);
      } finally {
        setIsPoolLoading(false);
      }
    },
    [
      poolSearchService,
      addMessage,
      addErrorMessage,
      shownPoolAddresses,
      activeTokenFilter,
      cleanupLoadingMessages
    ]
  );

  // Handle alternative pool requests
  const handleAlternativePoolRequest = useCallback(async () => {
    console.log("User is asking for another pool");
    
    setDifferentPoolRequests((prev) => prev + 1);

    const shownBinStepsForStyle =
      shownBinStepsPerStyle[selectedPortfolioStyle || "conservative"] || [];
    const preferredBinSteps = getPreferredBinSteps(selectedPortfolioStyle || "conservative");

    const allPreferredBinStepsShown = preferredBinSteps.every((step) =>
      shownBinStepsForStyle.includes(step)
    );

    if (allPreferredBinStepsShown) {
      console.log("All preferred bin steps have been shown, resetting tracking to show them again");
      setShownBinStepsPerStyle((prev) => ({
        ...prev,
        [selectedPortfolioStyle || "conservative"]: [],
      }));
    }

    await showBestYieldPool(selectedPortfolioStyle || "conservative");
  }, [
    selectedPortfolioStyle,
    shownBinStepsPerStyle,
    setDifferentPoolRequests,
    setShownBinStepsPerStyle,
    showBestYieldPool
  ]);

  // Handle general pool requests
  const handlePoolRequest = useCallback(async () => {
    await showBestYieldPool(selectedPortfolioStyle || null);
  }, [selectedPortfolioStyle, showBestYieldPool]);

  // Handle general chat
  const handleGeneralChat = useCallback(async (userMessage: string) => {
    const messageHistory = [
      ...messages,
      {
        role: "user" as const,
        content: userMessage,
        timestamp: new Date(),
      },
    ];

    await handleStreamingResponse(messageHistory);
  }, [messages, handleStreamingResponse]);

  // Handle token filter search
  const handleTokenFilterSearch = useCallback(async (tokenFilter: string) => {
    setActiveTokenFilter(tokenFilter);
    
    // Clear previous messages about filters
    setMessages(prev => prev.filter(msg => 
      !(msg.role === "assistant" && msg.content.includes("Try adjusting your portfolio style"))
    ));
    
    setIsLoading(true);
    setIsPoolLoading(true);

    try {
      if (!selectedPortfolioStyle) {
        addMessage("assistant", "Please select a portfolio style first to get recommendations for specific token types.");
        return;
      }

      // Show immediate loading message with the specific filter
      const tokenNames: Record<string, string> = {
        'wbtc-sol': 'wBTC-SOL',
        'zbtc-sol': 'zBTC-SOL', 
        'cbbtc-sol': 'cbBTC-SOL'
      };
      
      const tokenName = tokenNames[tokenFilter] || tokenFilter;
      addMessage("assistant", `Finding the best ${selectedPortfolioStyle} ${tokenName} Solana liquidity pools for you...`);

      // Search with the specific token filter
      const filteredPools = await poolSearchService.searchPools({
        style: selectedPortfolioStyle,
        shownPoolAddresses: [], // Reset for new filter
        tokenFilter,
        onLoadingMessage: () => {} // Don't add duplicate loading messages
      });

      // Check if we have any pools
      if (filteredPools.length === 0) {
        addMessage("assistant", `No ${tokenName} pools found for your ${selectedPortfolioStyle} style. Try adjusting your portfolio style or check back later.`);
        return;
      }

      // Get the best pool for the selected style and token filter
      const selectedPool = poolSearchService.getBestPool(
        filteredPools, 
        selectedPortfolioStyle, 
        []
      );

      if (selectedPool) {
        // Reset shown pool addresses for new filter
        setShownPoolAddresses([selectedPool.address]);

        // First create a formatted pool to display immediately
        const formattedPool: FormattedPool = formatPool(selectedPool, selectedPortfolioStyle || 'conservative');
        
        // Add message with the pool data so it shows immediately
        addMessage("assistant", "", [formattedPool]);
        
        // Start streaming the AI analysis
        setStreamingMessage("");
        setIsStreaming(true);

        await poolSearchService.processSelectedPool({
          selectedPool,
          style: selectedPortfolioStyle,
          onStreamingUpdate: (chunk) => {
            setStreamingMessage(prev => (prev || "") + chunk);
          },
          onComplete: (analysis) => {
            setMessages(prev => {
              const newMessages = [...prev];
              newMessages[newMessages.length - 1].content = analysis;
              return newMessages;
            });
            
            // Update the message content but keep our existing pool data
            setMessageWithPools(prev => {
              const newMessages = [...prev];
              newMessages[newMessages.length - 1] = {
                message: { ...newMessages[newMessages.length - 1].message, content: analysis },
                pools: newMessages[newMessages.length - 1].pools // Keep existing pools
              };
              return newMessages;
            });
            
            setStreamingMessage(null);
            setIsStreaming(false);
          },
          onError: () => {
            setStreamingMessage(null);
            setIsStreaming(false);
            addErrorMessage(new Error('Failed to analyze pool'));
          }
        });

        // Clean up loading messages
        cleanupLoadingMessages(selectedPortfolioStyle);
      }
    } catch (error) {
      console.error("Error in token filter search:", error);
      addErrorMessage(error);
    } finally {
      setIsLoading(false);
      setIsPoolLoading(false);
    }
  }, [
    selectedPortfolioStyle,
    poolSearchService,
    addMessage,
    addErrorMessage,
    cleanupLoadingMessages
  ]);

  // Main refactored handleSendMessage function
  const handleSendMessage = useCallback(
    async (message?: string) => {
      const messageToSend = message || inputMessage;
      if (!messageToSend.trim()) return;

      // Add user message and clear input
      addMessage("user", messageToSend);
      const userMessage = messageToSend;
      setInputMessage("");
      setIsLoading(true);

      // Small delay for UI responsiveness
      await new Promise(resolve => setTimeout(resolve, 100));

      try {
        // Analyze message intent
        const intent = analyzeMessageIntent(userMessage);

        // Route to appropriate handler based on intent (prioritize paid features)
        if (intent.isPremiumAnalysis) {
          await handlePremiumAnalysis(userMessage);
        } else if (intent.isPoolMetricsQuery) {
          await handlePoolMetricsQuery();
        } else if (intent.isMCPDataQuery) {
          await handleMCPDataQuery();
        } else if (intent.isAutomationQuery) {
          await handleAutomationQuery();
        } else if (intent.isSwapRequest) {
          await handleSwapRequest();
        } else if (intent.isEducational) {
          await handleEducationalQuery(userMessage);
        } else if (intent.isAlternativeRequest) {
          await handleAlternativePoolRequest();
        } else if (intent.isPoolRequest) {
          await handlePoolRequest();
        } else {
          await handleGeneralChat(userMessage);
        }
      } catch (error) {
        console.error("Error sending message:", error);
        addErrorMessage(error);
        // Ensure streaming state is cleaned up on error
        setStreamingMessage(null);
        setIsStreaming(false);
      } finally {
        setIsLoading(false);
      }
    },
    [
      inputMessage,
      addMessage,
      analyzeMessageIntent,
      handlePremiumAnalysis,
      handlePoolMetricsQuery,
      handleMCPDataQuery,
      handleAutomationQuery,
      handleSwapRequest,
      handleEducationalQuery,
      handleAlternativePoolRequest,
      handlePoolRequest,
      handleGeneralChat,
      addErrorMessage
    ]
  );

  const handleAddLiquidity = (pool: FormattedPool) => {
    setSelectedPool(pool);
    setIsAddLiquidityModalOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleQuickAction = (question: string) => {
    handleSendMessage(question);
  };

  const handleSelectPortfolioStyle = async (style: string) => {
    setSelectedPortfolioStyle(style);
    
    // Close portfolio style modal and open BTC filter modal
    setIsPortfolioStyleModalOpen(false);
    setIsBtcFilterModalOpen(true);
  };

  const handleSelectBtcFilter = async (filter: string) => {
    setActiveTokenFilter(filter);
    setIsBtcFilterModalOpen(false);

    // Define filter labels inside the function
    const filterLabels: Record<string, string> = {
      'wbtc-sol': 'wBTC-SOL',
      'zbtc-sol': 'zBTC-SOL',
      'cbbtc-sol': 'cbBTC-SOL',
      'btc': 'All BTC'
    };

    try {
      if (!showWelcomeScreen) {
        addMessage("assistant", "", undefined);
      } else {
        setShowWelcomeScreen(false);
        addMessage("assistant", "", undefined);
      }

      setStreamingMessage("");
      setIsStreaming(true);
      
      // Generate concise portfolio + filter specific welcome message
      const portfolioStyle = selectedPortfolioStyle || 'conservative'; // Fix: provide fallback
      const welcomeMessage = await fetchMessage(
        [{ 
          role: "user", 
          content: `I've selected the ${portfolioStyle} portfolio style and want to focus on ${filterLabels[filter] || filter} pools. Please provide a VERY BRIEF welcome message (2-3 sentences maximum) that welcomes me to Hypebiscus and explains what this combination means for my liquidity pool recommendations. Be concise but engaging.` 
        }],
        undefined,
        portfolioStyle, // Use the fallback variable
        (chunk) => {
          setStreamingMessage(prev => (prev || "") + chunk);
        }
      );

      setMessages(prev => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1].content = welcomeMessage;
        return newMessages;
      });
      
      setMessageWithPools(prev => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1].message.content = welcomeMessage;
        return newMessages;
      });
      
      setStreamingMessage(null);
      setIsStreaming(false);

      // Start searching for pools with the selected filter
      await handleTokenFilterSearch(filter);
      
    } catch (error) {
      console.error("Error generating welcome message:", error);
      
      setStreamingMessage(null);
      setIsStreaming(false);
      
      // Fix: Use safe string manipulation with fallbacks
      const portfolioStyleFormatted = selectedPortfolioStyle 
        ? selectedPortfolioStyle.charAt(0).toUpperCase() + selectedPortfolioStyle.slice(1)
        : 'Conservative';
      
      if (!showWelcomeScreen) {
        addMessage(
          "assistant",
          `You've selected the ${portfolioStyleFormatted} portfolio style focusing on ${filterLabels[filter] || filter} pools. I'll recommend pools that match your preferences.`
        );
      } else {
        setShowWelcomeScreen(false);
        addMessage(
          "assistant",
          `Welcome! You've selected the ${portfolioStyleFormatted} portfolio style with ${filterLabels[filter] || filter} focus. I'll recommend pools that match your preferences.`
        );
      }
      
      await handleTokenFilterSearch(filter);
    }
  };

  const handleRefreshPools = useCallback(async () => {
    if (!selectedPortfolioStyle) {
      addMessage(
        "assistant",
        "Please select a portfolio style first to get pool recommendations."
      );
      return;
    }

    setIsPoolLoading(true);
    try {
      await showBestYieldPool(selectedPortfolioStyle);
    } catch (error) {
      console.error("Error refreshing pools:", error);
      addErrorMessage(error);
    } finally {
      setIsPoolLoading(false);
    }
  }, [selectedPortfolioStyle, showBestYieldPool, addMessage, addErrorMessage]);

  // Effects
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    const isUserMessage = lastMessage?.role === "user";
    
    if (isUserMessage || showWelcomeScreen) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [messages, showWelcomeScreen]);

  // Split AI response function
  const splitAIResponse = (response: string): { part1: string, part2: string } => {
    if (!response) return { part1: "", part2: "" };

    const splitKeywords = [
      "Risk considerations:", // lowercase version
      "Risk Considerations:",
      "Risk Analysis:",
      "Potential Risks:",
      "Risk Assessment:",
      "Risk Factors:",
      "Risk Profile:",
      "Before investing, consider:",
      "Important considerations:",
      "Key risks to be aware of:",
      "Risks to consider:"
    ];

    for (const keyword of splitKeywords) {
      const index = response.indexOf(keyword);
      if (index !== -1) {
        return {
          part1: response.substring(0, index).trim(),
          part2: response.substring(index).trim()
        };
      }
    }

    const questionRegex = /\n\n(Have you considered|Would you like|Are you interested|What are your thoughts|How do you feel|Do you prefer|Are you looking|What's your|What is your|Do you have)[^?]+\?(\s*\n\n[^?]+\?)*(\s*\n\n.*)?$/;
    const questionMatch = response.match(questionRegex);

    if (questionMatch) {
      const questionIndex = questionMatch.index!;
      return {
        part1: response.substring(0, questionIndex).trim(),
        part2: response.substring(questionIndex).trim()
      };
    }

    return { part1: response, part2: "" };
  };

  // Show welcome screen
  if (showWelcomeScreen) {
    return (
      <div className="flex flex-col h-[calc(100vh-100px)] w-full max-w-4xl mx-auto">
        <div className="flex-1 flex flex-col items-center justify-start lg:p-4 p-0 mt-8 overflow-y-auto">
          <h1 className="text-2xl md:text-3xl font-bold text-primary mb-2 text-center">
            Welcome to Hypebiscus
          </h1>
          <p className="text-white text-center font-medium max-w-md mb-6 text-sm md:text-base break-words">
            Your smart assistant for exploring BTC liquidity in the Solana DeFi ecosystem.
          </p>
          
          {/* Feature list - commented out
          <div className="flex justify-center w-full mb-8">
            <div className="grid grid-cols-1 gap-3 w-full max-w-xl">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <ClockIcon className="text-primary" size={18} />
                </div>
                <p className="text-white text-xs md:text-sm break-words">
                  Find the best places to earn with your Bitcoin - updated live.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <PlusIcon className="text-primary" size={18} />
                </div>
                <p className="text-white text-xs md:text-sm break-words">
                  Start earning with one click - no complicated steps.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <ChartLineIcon className="text-primary" size={18} />
                </div>
                <p className="text-white text-xs md:text-sm break-words">
                  See exactly how much you can earn and how safe each option is.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <WalletIcon className="text-primary" size={18} />
                </div>
                <p className="text-white text-xs md:text-sm break-words">
                  You keep full control of your Bitcoin - we never hold your funds.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <ShuffleIcon className="text-primary" size={18} />
                </div>
                <p className="text-white text-xs md:text-sm break-words">
                  Swap any Solana token instantly - built right in.
                </p>
              </div>
            </div>
          </div>
          */}

                    
          {/* Portfolio Style Selection - Only this button */}
          <Button
            variant="outline"
            size="secondary"
            className="bg-secondary/30 border-primary text-white flex items-center gap-2 w-full max-w-xs"
            onClick={() => setIsPortfolioStyleModalOpen(true)}
          >
            <ChartLineIcon size={18} />
            <span>Find Your Perfect Pool</span>
          </Button>
        </div>

        <div className="flex-shrink-0 lg:px-4 pb-4">
          <QuickActionButtons
            onQuickAction={handleQuickAction}
            disabled={isLoading}
          />
          <ChatInput
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading || isPoolLoading}
            onSend={() => handleSendMessage()}
            isLoading={isLoading}
          />
        </div>

        {/* Portfolio Style Modal */}
        <PortfolioStyleModal
          isOpen={isPortfolioStyleModalOpen}
          onClose={() => setIsPortfolioStyleModalOpen(false)}
          onSelectStyle={handleSelectPortfolioStyle}
        />
        
        {/* BTC Filter Modal */}
        <BtcFilterModal
          isOpen={isBtcFilterModalOpen}
          onClose={() => setIsBtcFilterModalOpen(false)}
          onSelectFilter={handleSelectBtcFilter}
        />
      </div>
    );
  }

  // Helper: Check if message is a pool message
  function isPoolMessage(message: Message): boolean {
    return (
      message.role === "assistant" &&
      (message.content.includes("Finding the best") ||
        message.content.includes("Found the optimal") ||
        /Finding the best \w+ Solana liquidity pools for you/.test(message.content))
    );
  }

  // Helper: Calculate message display flags
  function calculateMessageFlags(
    item: MessageWithPool,
    index: number,
    totalMessages: number,
    nextMessage?: MessageWithPool,
    isStreaming?: boolean
  ) {
    const poolMsg = isPoolMessage(item.message);
    const isLast = index === totalMessages - 1;
    const isAssistant = item.message.role === "assistant";

    return {
      isPoolMessage: poolMsg,
      isLoadingState: poolMsg && isLast && (!item.pools || item.pools.length === 0),
      shouldHideLoadingMessage:
        poolMsg &&
        index < totalMessages - 1 &&
        nextMessage?.pools &&
        nextMessage.pools.length > 0,
      isLastMessage: isLast,
      shouldShowStreaming: isLast && isAssistant && (isStreaming ?? false),
      showStreamingInPool:
        isLast && isAssistant && (isStreaming ?? false) && item.pools && item.pools.length > 0,
      showStreamingInMessage:
        isLast && isAssistant && (isStreaming ?? false) && (!item.pools || item.pools.length === 0),
    };
  }

  // Message item component
  interface MessageItemProps {
    item: MessageWithPool;
    index: number;
    totalMessages: number;
    nextMessage?: MessageWithPool;
    isStreaming: boolean;
    streamingMessage: string | null;
    isPoolLoading: boolean;
    onAddLiquidity: (pool: FormattedPool) => void;
  }

  function MessageItem({
    item,
    index,
    totalMessages,
    nextMessage,
    isStreaming: streaming,
    streamingMessage: streamMsg,
    isPoolLoading: poolLoading,
    onAddLiquidity,
  }: MessageItemProps) {
    const flags = calculateMessageFlags(item, index, totalMessages, nextMessage, streaming);

    const shouldShowMessage =
      !flags.shouldHideLoadingMessage && (flags.isLoadingState || !flags.isPoolMessage);

    const shouldRenderChatMessage =
      shouldShowMessage && !(item.message.role === "assistant" && item.pools && item.pools.length > 0);

    const shouldShowDivider =
      item.message.role === "assistant" &&
      !item.pools &&
      !flags.isLoadingState &&
      !flags.showStreamingInMessage;

    return (
      <React.Fragment>
        {shouldShowMessage && (
          <>
            {shouldRenderChatMessage && (
              <div className="w-full break-words">
                <ChatMessage
                  message={item.message}
                  streamingMessage={flags.showStreamingInMessage ? streamMsg : undefined}
                  isStreaming={flags.showStreamingInMessage}
                />
              </div>
            )}
            {shouldShowDivider && <hr className="mt-6 mb-10 border-border" />}
          </>
        )}
        {item.pools && item.pools.length > 0 && (
          <div className="w-full">
            {flags.showStreamingInPool ? (
              <BtcPoolsList
                pools={item.pools}
                onAddLiquidity={onAddLiquidity}
                isLoading={poolLoading}
                aiResponse={item.message.content}
                aiResponsePart1=""
                aiResponsePart2=""
                isStreaming={true}
                streamingContent={streamMsg}
              />
            ) : (
              <BtcPoolsList
                pools={item.pools}
                onAddLiquidity={onAddLiquidity}
                isLoading={poolLoading}
                aiResponse={item.message.content}
                aiResponsePart1={splitAIResponse(item.message.content).part1}
                aiResponsePart2={splitAIResponse(item.message.content).part2}
                isStreaming={false}
                streamingContent={null}
              />
            )}
            <hr className="mt-12 mb-8 border-border" />
          </div>
        )}
      </React.Fragment>
    );
  }

return (
  <div className="flex flex-col h-[calc(100vh-100px)] max-w-4xl mx-auto">
    <div className="flex justify-between items-center mb-6 flex-wrap">
      {/* Left side - BTC Filter Dropdown */}
      <div className="flex-shrink-0 min-w-0">
        <BtcFilterDropdown
          onFilterSelect={handleTokenFilterSearch}
          isLoading={isLoading || isPoolLoading}
          activeFilter={activeTokenFilter}
        />
      </div>
      
      {/* Right side - Portfolio, Jupiter, Credits, and Refresh buttons */}
      <div className="flex items-center lg:gap-2 gap-1 flex-shrink-0">
        {/* Credit Balance Indicator */}
        <CreditBalanceIndicator onPurchaseClick={() => setShowPaymentModal(true)} />

        {/* Jupiter Plugin Button */}
        <Button
          variant="secondary"
          size="secondary"
          className="bg-secondary/30 border-primary text-white flex items-center gap-2 hover:bg-primary/20 text-xs"
          onClick={() => setShowJupiterPlugin(true)}
          title="Open Jupiter Plugin for token swaps"
        >
          <ShuffleIcon size={14} />
          <span className="hidden sm:inline">Swap</span>
        </Button>

        {selectedPortfolioStyle && (
          <Button
            variant="secondary"
            size="secondary"
            className="bg-secondary/30 border-primary text-white flex items-center gap-2 hover:bg-primary/20 text-xs"
            onClick={handleRefreshPools}
            disabled={isPoolLoading}
            title="Find different BTC pools with your current portfolio style"
          >
            <ArrowClockwiseIcon
              size={14}
              className={isPoolLoading ? "animate-spin" : ""}
            />
            <span className="hidden sm:inline">
              {isPoolLoading ? "Finding..." : "Refresh Pools"}
            </span>
          </Button>
        )}

        <Button
          variant="secondary"
          size="secondary"
          className="bg-secondary/30 border-primary text-white flex items-center gap-2 text-xs"
          onClick={() => setIsPortfolioStyleModalOpen(true)}
        >
          <span className="truncate max-w-[120px] sm:max-w-none">
            {selectedPortfolioStyle ? (
              <>
                <span className="hidden sm:inline">Portfolio: </span>
                {selectedPortfolioStyle.charAt(0).toUpperCase() + selectedPortfolioStyle.slice(1)}
              </>
            ) : (
              <>
                <span className="hidden sm:inline">Select </span>Portfolio<span className="hidden sm:inline"> Style</span>
              </>
            )}
          </span>
        </Button>
      </div>
    </div>

    {/* Jupiter Plugin Modal */}
    {showJupiterPlugin && (
      <div
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={() => setShowJupiterPlugin(false)}
      >
        <div
          className="w-full max-w-md lg:h-[600px] h-[85vh] max-h-[800px] rounded-lg overflow-hidden relative"
          onClick={(e) => e.stopPropagation()} // Prevent clicks on plugin from closing modal
        >
          {/* Close button - only visible on mobile and iPad */}
          <button
            onClick={() => setShowJupiterPlugin(false)}
            className="absolute top-2 right-2 z-[60] lg:hidden bg-red-800/90 hover:bg-gray-700 text-white rounded-full p-[5px] shadow-lg transition-colors"
            aria-label="Close Jupiter Plugin"
          >
            <XIcon size={18} />
          </button>

          <JupiterPlugin
            className="w-full"
            onClose={() => setShowJupiterPlugin(false)}
          />
        </div>
      </div>
    )}

    {/* Scrollable chat messages area */}
    <div className="flex-1 overflow-y-auto pb-4 scrollbar-hide">
      <div className="flex flex-col space-y-6">
        {messageWithPools.map((item, index, array) => (
          <MessageItem
            key={index}
            item={item}
            index={index}
            totalMessages={array.length}
            nextMessage={array[index + 1]}
            isStreaming={isStreaming}
            streamingMessage={streamingMessage}
            isPoolLoading={isPoolLoading}
            onAddLiquidity={handleAddLiquidity}
          />
        ))}

        {/* User Positions List with Reposition functionality */}
        {showUserPositions && (
          <div className="w-full">
            <UserPositionsList
              onRefresh={() => {
                // Refresh positions after reposition
              }}
              isLoading={isLoading}
              aiResponse={positionsAiResponse}
            />
            <div className="flex justify-center mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowUserPositions(false);
                  setPositionsAiResponse('');
                }}
                className="text-gray-400 hover:text-white"
              >
                Back to Chat
              </Button>
            </div>
            <hr className="mt-6 mb-8 border-border" />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>

    {/* Fixed chat input area */}
    <div className="flex-shrink-0 lg:pb-4 pb-0">
      <QuickActionButtons
        onQuickAction={handleQuickAction}
        disabled={isLoading}
      />

      <ChatInput
        value={inputMessage}
        onChange={(e) => setInputMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isLoading || isPoolLoading}
        onSend={() => handleSendMessage()}
        isLoading={isLoading}
      />
    </div>

    {/* Add Liquidity Modal */}
    <AddLiquidityModal
      isOpen={isAddLiquidityModalOpen}
      onClose={() => setIsAddLiquidityModalOpen(false)}
      userPortfolioStyle={selectedPortfolioStyle}
      pool={selectedPool}
    />

    {/* Portfolio Style Modal */}
    <PortfolioStyleModal
      isOpen={isPortfolioStyleModalOpen}
      onClose={() => setIsPortfolioStyleModalOpen(false)}
      onSelectStyle={handleSelectPortfolioStyle}
    />
    
    {/* BTC Filter Modal */}
    <BtcFilterModal
      isOpen={isBtcFilterModalOpen}
      onClose={() => setIsBtcFilterModalOpen(false)}
      onSelectFilter={handleSelectBtcFilter}
    />

    {/* Payment Modal for MCP Access */}
    <CreditsPurchaseModal
      isOpen={showPaymentModal}
      onClose={() => {
        setShowPaymentModal(false);
        setPendingMCPQuery(null);
      }}
      onSuccess={() => {
        setShowPaymentModal(false);
        showToast.success('Credits Purchased!', 'Refreshing your balance...');

        // Re-check payment status and retry pending query
        // Add delay to allow database to update
        setTimeout(async () => {
          await checkPaymentStatus();

          if (pendingMCPQuery) {
            // Wait a bit more then retry the query
            setTimeout(() => {
              handleSendMessage(pendingMCPQuery);
              setPendingMCPQuery(null);
            }, 500);
          } else {
            showToast.success('Ready!', 'You can now query your positions');
          }
        }, 1500);
      }}
    />

    {/* Telegram Linking Prompt */}
    {showTelegramPrompt && (
      <div className="fixed bottom-24 right-4 max-w-sm bg-gray-800 border border-primary rounded-lg shadow-2xl p-4 z-40 animate-slide-up">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-lg">📱</span>
            </div>
            <h4 className="font-semibold text-white">Link Telegram</h4>
          </div>
          <button
            onClick={() => setShowTelegramPrompt(false)}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>
        <p className="text-sm text-gray-300 mb-4">
          Get real-time notifications and monitor your positions on Telegram!
        </p>
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            className="flex-1"
            onClick={() => {
              router.push('/link');
              setShowTelegramPrompt(false);
            }}
          >
            Link Now
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowTelegramPrompt(false)}
          >
            Later
          </Button>
        </div>
      </div>
    )}
  </div>
);
};

export default ChatBox;