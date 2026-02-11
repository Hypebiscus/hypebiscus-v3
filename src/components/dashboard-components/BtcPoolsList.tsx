"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useAppKitWallet";
import { ArrowSquareIn} from "@phosphor-icons/react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { FormattedPool } from "@/lib/utils/poolUtils";

interface BtcPoolsListProps {
  pools: FormattedPool[];
  onAddLiquidity: (pool: FormattedPool) => void;
  isLoading: boolean;
  aiResponse?: string;
  aiResponsePart1?: string;
  aiResponsePart2?: string;
  isStreaming?: boolean;
  streamingContent?: string | null;
}

const BtcPoolsList: React.FC<BtcPoolsListProps> = ({
  pools,
  onAddLiquidity,
  isLoading,
  aiResponse,
  aiResponsePart1,
  aiResponsePart2,
  isStreaming,
  streamingContent,
}) => {
  const { connected } = useWallet();

  // Helper function to find a good split point for streaming content
  const findSplitPoint = (text: string): number => {
    if (!text || text.length <= 400) return text?.length || 0;
    
    // Try to find a natural split point based on content
    // Look for risk-related keywords first
    const riskKeywords = [
      "Risk Considerations:", 
      "Risk Analysis:", 
      "Potential Risks:", 
      "Risk Assessment:",
      "Risk Factors:",
      "Risk Profile:",
      "Before investing, consider:",
      "Important considerations:",
      "Key risks to be aware of:",
      "Risks to consider:",
      "Before you dive in"
    ];
    
    for (const keyword of riskKeywords) {
      const index = text.indexOf(keyword);
      if (index !== -1 && index > text.length * 0.3) { // Ensure it's not too early in the text
        return index;
      }
    }
    
    // Try to find a paragraph break near the middle
    const midPoint = Math.floor(text.length * 0.6); // Slightly past middle for better distribution
    const paragraphBreakAfter = text.indexOf("\n\n", midPoint);
    const paragraphBreakBefore = text.lastIndexOf("\n\n", midPoint);
    
    // If we found paragraph breaks, use the closest one
    if (paragraphBreakAfter !== -1 && paragraphBreakBefore !== -1) {
      return (midPoint - paragraphBreakBefore) < (paragraphBreakAfter - midPoint)
        ? paragraphBreakBefore + 2 // +2 to include the newline characters
        : paragraphBreakAfter;
    } else if (paragraphBreakAfter !== -1) {
      return paragraphBreakAfter;
    } else if (paragraphBreakBefore !== -1) {
      return paragraphBreakBefore + 2;
    }
    
    // If no paragraph breaks, try to find a sentence end
    const sentenceEndAfter = text.indexOf(". ", midPoint);
    const sentenceEndBefore = text.lastIndexOf(". ", midPoint);
    
    if (sentenceEndAfter !== -1 && sentenceEndBefore !== -1) {
      return (midPoint - sentenceEndBefore) < (sentenceEndAfter - midPoint)
        ? sentenceEndBefore + 2 // +2 to include the period and space
        : sentenceEndAfter + 2;
    } else if (sentenceEndAfter !== -1) {
      return sentenceEndAfter + 2;
    } else if (sentenceEndBefore !== -1) {
      return sentenceEndBefore + 2;
    }
    
    // If all else fails, just use the midpoint
    return midPoint;
  };

  // Calculate split point for streaming content
  const splitPoint = streamingContent ? findSplitPoint(streamingContent) : 0;
  const shouldShowPart2 = streamingContent && streamingContent.length > 400;

  if (pools.length === 0) {
    return <p className="text-white">No pools found</p>;
  }

  return (
    <div className="space-y-6">
      {pools.map((pool, index) => (
        <div key={index}>
          {/* Pool Header */}
          <div className="border border-primary rounded-2xl px-6 py-4">
            <div className="flex justify-between lg:items-center items-start">
              <h4 className="text-white font-bold text-lg">{pool.name}</h4>
              <div className="flex flex-col items-end">
                <span className="text-2xl font-bold">{pool.apr}</span>
                <span className="text-sm text-white">APR</span>
              </div>
            </div>

            <div className="lg:mt-4 mt-6">
              {/* Pool Stats */}
              <div className="flex flex-wrap lg:flex-row gap-6">
                <div>
                  <div className="text-xs text-white/60">
                    Total Value Locked
                  </div>
                  <div className="text-white font-semibold">
                    ${pool.liquidity}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-white/60">Trading Volume</div>
                  <div className="text-white font-semibold">
                    ${pool.volume24h}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-white/60">24h Fee</div>
                  <div className="text-white font-semibold">
                    ${pool.fees24h}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-white/60">Bin Step</div>
                  <div className="text-white font-semibold">
                    {pool.binStep}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row justify-between lg:items-center mt-6">
              <div className="flex flex-col lg:flex-row gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[#1BE3C2] bg-[#1be3c233] rounded-full px-4 py-1 font-semibold text-sm flex items-center justify-center gap-2 cursor-help">
                      Audited <ArrowSquareIn size={16} />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs bg-[#191919] border border-[#333] p-3 text-white">
                    <p className="font-medium mb-2">Audited by:</p>
                    <ul className="text-xs space-y-1">
                      <li>• Offside Labs</li>
                      <li>• Sec3 (formerly Soteria)</li>
                      <li>• OtterSec</li>
                      <li>• Quantstamp</li>
                      <li>• Halborn</li>
                      <li>• Oak</li>
                    </ul>
                  </TooltipContent>
                </Tooltip>
                <span className=" bg-[#efb54b33] rounded-full px-4 py-1 font-semibold text-sm flex flex-col lg:flex-row justify-center items-center">
                  Impermanent Loss Risk: <span className="text-[#EFB54B]">Moderate</span>
                </span>
              </div>
              <div>
                <Button
                  variant="default"
                  size="secondary"
                  onClick={() => onAddLiquidity(pool)}
                  disabled={!connected || isLoading}
                  className="w-full lg:w-fit mt-6 lg:mt-0"
                >
                  {connected
                    ? "Invest in this Pool"
                    : "Connect Wallet to Invest"}
                </Button>
              </div>
            </div>
          </div>

          {/* Estimated Earnings Section */}
          {pool.estimatedDailyEarnings && (
            <div className="mt-4 bg-secondary rounded-2xl p-4 w-fit">
              <h5 className="text-primary text-base font-medium mb-2">
                Your Estimated Earnings:
              </h5>
              <div className="flex flex-col">
                <p className="text-base text-white flex items-center gap-2">
                  Invest:{" "}
                  <span className="text-white font-semibold text-base">
                    ${pool.investmentAmount || "10,000"}
                  </span>
                </p>
                <p className="text-base text-white flex items-center gap-2">
                  Your Estimated Daily Earnings:{" "}
                  <span className="text-white font-semibold text-base">
                    ${pool.estimatedDailyEarnings}
                  </span>
                </p>
              </div>
            </div>
          )}

          {/* AI Analysis Part 1 - After Why this pool */}
          {(aiResponsePart1 || isStreaming) && (
            <div className="mt-4 bg-[#1be3c233] rounded-2xl p-4">
              <h5 className="text-base font-bold mb-4">Why this pool?</h5>
              <div className="prose prose-invert max-w-none">
                {isStreaming ? (
                  <div className="whitespace-pre-wrap text-white">
                    {/* Show content up to the split point */}
                    <p className="whitespace-pre-wrap text-white">{streamingContent && streamingContent.substring(0, splitPoint)}</p>
                    {!shouldShowPart2 && <span className="animate-pulse">▊</span>}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-white">{aiResponsePart1 || aiResponse}</p>
                )}
              </div>
            </div>
          )}

          {/* AI Analysis Part 2 - Before Risk Notice */}
          {(aiResponsePart2 || shouldShowPart2) && (
            <div className="mt-4">
              <h5 className="text-base font-bold mb-4">Before You Dive In</h5>
              <div className="prose prose-invert max-w-none">
                {isStreaming && shouldShowPart2 ? (
                  <div className="whitespace-pre-wrap text-white">
                    {/* Show content after the split point */}
                    <p className="whitespace-pre-wrap text-white">{streamingContent && streamingContent.substring(splitPoint)}</p>
                    <span className="animate-pulse">▊</span>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-white">{aiResponsePart2}</p>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-4">
            <div className="flex space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  window.open(
                    `https://app.meteora.ag/dlmm/${pool.address}`,
                    "_blank"
                  )
                }
                className="bg-transparent border-primary text-white"
              >
                View on Meteora
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default BtcPoolsList;