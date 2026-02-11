// src/hooks/useConversations.ts
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useWallet } from "@/hooks/useAppKitWallet";

export interface Conversation {
  id: string;
  title: string;
  isTitleGenerated?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MAX_CONVERSATIONS = 50;

// Local storage key for offline/guest mode
const STORAGE_KEY = "hypebiscus_conversations";
const MESSAGES_STORAGE_PREFIX = "hypebiscus_messages_";

export function useConversations() {
  const { publicKey, connected } = useWallet();
  const walletAddress = publicKey?.toBase58();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Track previous wallet to detect changes
  const prevWalletRef = useRef<string | undefined>(undefined);

  // Helper: API fetch with error handling
  const apiFetch = useCallback(async <T>(
    url: string,
    options?: RequestInit
  ): Promise<{ data?: T; error?: string }> => {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      const result = await response.json();

      if (!response.ok) {
        return { error: result.message || result.error || "Request failed" };
      }

      return { data: result.data };
    } catch (err) {
      console.error("API fetch error:", err);
      return { error: "Network error. Please try again." };
    }
  }, []);

  // Load conversations from API when wallet connects
  useEffect(() => {
    // Skip if wallet hasn't changed
    if (prevWalletRef.current === walletAddress) {
      return;
    }
    prevWalletRef.current = walletAddress;

    const loadConversationsFromLocalStorage = () => {
      if (typeof window === "undefined") return;

      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Conversation[];
          const withDates = parsed.map((c) => ({
            ...c,
            createdAt: new Date(c.createdAt),
            updatedAt: new Date(c.updatedAt),
          }));
          setConversations(withDates);

          if (withDates.length > 0) {
            setActiveConversationId(withDates[0].id);
          }
        }
      } catch (err) {
        console.error("Failed to load conversations from localStorage:", err);
      }

      setIsLoaded(true);
    };

    const loadConversations = async () => {
      if (!connected || !walletAddress) {
        // Not connected - use localStorage fallback
        loadConversationsFromLocalStorage();
        return;
      }

      setIsLoading(true);
      setError(null);

      const { data, error: apiError } = await apiFetch<Conversation[]>(
        `/api/conversations?walletAddress=${walletAddress}`
      );

      if (apiError) {
        setError(apiError);
        // Fallback to localStorage on error
        loadConversationsFromLocalStorage();
      } else if (data) {
        const withDates = data.map((c) => ({
          ...c,
          createdAt: new Date(c.createdAt),
          updatedAt: new Date(c.updatedAt),
        }));
        setConversations(withDates);

        // Set most recent as active if none selected
        if (withDates.length > 0) {
          setActiveConversationId(withDates[0].id);
        }
      }

      setIsLoading(false);
      setIsLoaded(true);
    };

    loadConversations();
  }, [connected, walletAddress, apiFetch]);

  // Load from localStorage (fallback for guest mode or errors)
  const loadFromLocalStorage = useCallback(() => {
    if (typeof window === "undefined") return;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Conversation[];
        const withDates = parsed.map((c) => ({
          ...c,
          createdAt: new Date(c.createdAt),
          updatedAt: new Date(c.updatedAt),
        }));
        setConversations(withDates);

        if (withDates.length > 0) {
          setActiveConversationId((prev) => prev || withDates[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load conversations from localStorage:", err);
    }

    setIsLoaded(true);
  }, []);

  // Save to localStorage (for guest mode)
  const saveToLocalStorage = useCallback((convs: Conversation[]) => {
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(convs));
    } catch (err) {
      console.error("Failed to save conversations to localStorage:", err);
    }
  }, []);

  // Create a new conversation
  const createConversation = useCallback(
    async (title?: string): Promise<Conversation> => {
      const newConversation: Conversation = {
        id: crypto.randomUUID(),
        title: title || "New Chat",
        isTitleGenerated: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Optimistically update UI
      setConversations((prev) => {
        const updated = [newConversation, ...prev];
        if (updated.length > MAX_CONVERSATIONS) {
          return updated.slice(0, MAX_CONVERSATIONS);
        }
        return updated;
      });
      setActiveConversationId(newConversation.id);

      // If connected, persist to API
      if (connected && walletAddress) {
        const { data, error: apiError } = await apiFetch<Conversation>(
          "/api/conversations",
          {
            method: "POST",
            body: JSON.stringify({ walletAddress, title: title || "New Chat" }),
          }
        );

        if (apiError) {
          console.error("Failed to create conversation via API:", apiError);
          // Keep local version
          saveToLocalStorage([newConversation, ...conversations]);
        } else if (data) {
          // Update with server-generated ID
          const serverConversation: Conversation = {
            ...data,
            createdAt: new Date(data.createdAt),
            updatedAt: new Date(data.updatedAt),
          };

          setConversations((prev) =>
            prev.map((c) => (c.id === newConversation.id ? serverConversation : c))
          );
          setActiveConversationId(serverConversation.id);
          return serverConversation;
        }
      } else {
        // Guest mode - save to localStorage
        saveToLocalStorage([newConversation, ...conversations]);
      }

      return newConversation;
    },
    [connected, walletAddress, conversations, apiFetch, saveToLocalStorage]
  );

  // Update conversation title
  const updateConversationTitle = useCallback(
    async (id: string, title: string) => {
      // Optimistically update UI
      setConversations((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, title, isTitleGenerated: true, updatedAt: new Date() } : c
        )
      );

      // If connected, persist to API
      if (connected && walletAddress) {
        const { error: apiError } = await apiFetch<Conversation>(
          `/api/conversations/${id}?walletAddress=${walletAddress}`,
          {
            method: "PATCH",
            body: JSON.stringify({ title }),
          }
        );

        if (apiError) {
          console.error("Failed to update conversation title via API:", apiError);
        }
      } else {
        // Guest mode - save to localStorage
        const updated = conversations.map((c) =>
          c.id === id ? { ...c, title, isTitleGenerated: true, updatedAt: new Date() } : c
        );
        saveToLocalStorage(updated);
      }
    },
    [connected, walletAddress, conversations, apiFetch, saveToLocalStorage]
  );

  // Delete a conversation
  const deleteConversation = useCallback(
    async (id: string) => {
      // Optimistically update UI
      setConversations((prev) => {
        const filtered = prev.filter((c) => c.id !== id);

        // If deleted active, select first remaining
        if (activeConversationId === id && filtered.length > 0) {
          setActiveConversationId(filtered[0].id);
        } else if (filtered.length === 0) {
          setActiveConversationId(null);
        }

        return filtered;
      });

      // If connected, delete via API
      if (connected && walletAddress) {
        const { error: apiError } = await apiFetch<{ id: string }>(
          `/api/conversations/${id}?walletAddress=${walletAddress}`,
          { method: "DELETE" }
        );

        if (apiError) {
          console.error("Failed to delete conversation via API:", apiError);
        }
      } else {
        // Guest mode - save to localStorage
        const filtered = conversations.filter((c) => c.id !== id);
        saveToLocalStorage(filtered);

        // Also remove messages from localStorage
        if (typeof window !== "undefined") {
          localStorage.removeItem(MESSAGES_STORAGE_PREFIX + id);
        }
      }
    },
    [connected, walletAddress, conversations, activeConversationId, apiFetch, saveToLocalStorage]
  );

  // Select a conversation (local only)
  const selectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

  // Touch conversation to update timestamp
  const touchConversation = useCallback(
    (id: string) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, updatedAt: new Date() } : c))
      );

      // Don't need to persist touch to API - it happens on message save
      if (!connected || !walletAddress) {
        // Guest mode - save to localStorage
        const updated = conversations.map((c) =>
          c.id === id ? { ...c, updatedAt: new Date() } : c
        );
        saveToLocalStorage(updated);
      }
    },
    [connected, walletAddress, conversations, saveToLocalStorage]
  );

  // Refresh conversations from API
  const refreshConversations = useCallback(async () => {
    if (!connected || !walletAddress) {
      loadFromLocalStorage();
      return;
    }

    setIsLoading(true);
    setError(null);

    const { data, error: apiError } = await apiFetch<Conversation[]>(
      `/api/conversations?walletAddress=${walletAddress}`
    );

    if (apiError) {
      setError(apiError);
    } else if (data) {
      const withDates = data.map((c) => ({
        ...c,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
      }));
      setConversations(withDates);
    }

    setIsLoading(false);
  }, [connected, walletAddress, apiFetch, loadFromLocalStorage]);

  return {
    conversations,
    activeConversationId,
    isLoading,
    isLoaded,
    error,
    walletAddress,
    isConnected: connected,
    createConversation,
    updateConversationTitle,
    deleteConversation,
    selectConversation,
    touchConversation,
    refreshConversations,
  };
}
