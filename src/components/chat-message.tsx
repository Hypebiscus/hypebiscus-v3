"use client";

import React from "react";
import ReactMarkdown from "react-markdown";

interface ChatMessageProps {
  message: {
    role: string;
    content: string;
    timestamp?: Date;
  };
  streamingMessage?: string | null;
  isStreaming?: boolean;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message, streamingMessage, isStreaming }) => {
  const isUser = message.role === "user";

  // Content to display (either streaming or regular message)
  const displayContent = (!isUser && isStreaming && streamingMessage) ? streamingMessage : message.content;

  // Check if this is a welcome message
  const isWelcomeMessage = !isUser &&
    (message.content.includes("Welcome to Hypebiscus") ||
     message.content.includes("portfolio style") ||
     message.content.toLowerCase().includes("welcome"));

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-full ${
          isUser
            ? "bg-white/10 border border-border text-white text-left rounded-full py-2 px-4"
            : isWelcomeMessage
              ? "pt-8"
              : "pt-0"
        }`}
      >
        {isUser ? (
          <p>{displayContent}</p>
        ) : (
          <div className="prose prose-invert max-w-none prose-a:text-primary prose-a:no-underline hover:prose-a:underline">
            <ReactMarkdown>{displayContent}</ReactMarkdown>
            {isStreaming && <span className="inline-block animate-pulse">▌</span>}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatMessage; 