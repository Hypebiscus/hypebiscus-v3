import { useCallback } from 'react';

/**
 * Message intent analysis result
 */
export interface MessageIntent {
  isPremiumAnalysis: boolean;
  isPoolMetricsQuery: boolean;
  isMCPDataQuery: boolean;
  isAutomationQuery: boolean;
  isSwapRequest: boolean;
  isEducational: boolean;
  isAlternativeRequest: boolean;
  isPoolRequest: boolean;
}

/**
 * Message handlers for different intent types
 */
export interface MessageHandlers {
  handlePremiumAnalysis: (message: string) => Promise<void>;
  handlePoolMetricsQuery: () => Promise<void>;
  handleMCPDataQuery: () => Promise<void>;
  handleAutomationQuery: () => Promise<void>;
  handleSwapRequest: () => Promise<void>;
  handleEducationalQuery: (message: string) => Promise<void>;
  handleAlternativePoolRequest: () => Promise<void>;
  handlePoolRequest: () => Promise<void>;
  handleGeneralChat: (message: string) => Promise<void>;
}

/**
 * Custom hook for routing messages based on intent
 * Provides a clean handler registry pattern instead of cascading if-else chains
 *
 * @param handlers - Object containing all message handler functions
 * @returns Object with routeMessage function
 */
export function useMessageRouter(handlers: MessageHandlers) {
  const routeMessage = useCallback(
    async (intent: MessageIntent, message: string): Promise<void> => {
      // Handler registry with priority ordering (paid features first)
      if (intent.isPremiumAnalysis) {
        await handlers.handlePremiumAnalysis(message);
      } else if (intent.isPoolMetricsQuery) {
        await handlers.handlePoolMetricsQuery();
      } else if (intent.isMCPDataQuery) {
        await handlers.handleMCPDataQuery();
      } else if (intent.isAutomationQuery) {
        await handlers.handleAutomationQuery();
      } else if (intent.isSwapRequest) {
        await handlers.handleSwapRequest();
      } else if (intent.isEducational) {
        await handlers.handleEducationalQuery(message);
      } else if (intent.isAlternativeRequest) {
        await handlers.handleAlternativePoolRequest();
      } else if (intent.isPoolRequest) {
        await handlers.handlePoolRequest();
      } else {
        // Fallback to general chat
        await handlers.handleGeneralChat(message);
      }
    },
    [handlers]
  );

  return { routeMessage };
}
