// src/components/dashboard-components/ConversationSidebar.tsx
"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  SidebarSimpleIcon,
  PlusIcon,
  PencilSimpleIcon,
  CheckIcon,
  XIcon,
  TrashIcon,
  ChatCircleIcon,
} from "@phosphor-icons/react";
import { Conversation } from "@/hooks/useConversations";

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onCreateConversation: () => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
}

const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  onCreateConversation,
  onUpdateTitle,
  onDeleteConversation,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleStartEdit = (conversation: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
  };

  const handleSaveEdit = () => {
    if (editingId && editingTitle.trim()) {
      onUpdateTitle(editingId, editingTitle.trim());
    }
    setEditingId(null);
    setEditingTitle("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveEdit();
    } else if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteConversation(id);
  };

  return (
    <div className="flex h-full">
      {/* Icon Strip - Always visible */}
      <div className="flex flex-col items-center py-4 px-2 gap-3 bg-background">
        {/* Toggle Sidebar */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-10 h-10 flex items-center justify-center rounded-xl border border-border hover:bg-secondary/50 hover:border-primary/30 transition-colors"
          aria-label={isExpanded ? "Close sidebar" : "Open sidebar"}
        >
          <SidebarSimpleIcon size={20} className="text-white/70" />
        </button>

        {/* New Chat */}
        <button
          onClick={onCreateConversation}
          className="w-10 h-10 flex items-center justify-center rounded-xl border border-border hover:bg-secondary/50 hover:border-primary/30 transition-colors"
          aria-label="New chat"
        >
          <PlusIcon size={20} className="text-white/70" />
        </button>
      </div>

      {/* Expanded Panel - Conversations List */}
      {isExpanded && (
        <div className="w-64 border-l border-border flex flex-col bg-background">
          {/* Header */}
          <div className="p-4 border-b border-border">
            <h2 className="font-mono text-sm text-white/60">Recent Chats</h2>
          </div>

          {/* Conversations List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-hide">
            {conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <ChatCircleIcon size={32} className="text-white/20 mb-2" />
                <p className="text-xs text-white/30 font-mono">
                  No conversations yet
                </p>
              </div>
            ) : (
              conversations.map((conversation) => {
                const isActive = conversation.id === activeConversationId;
                const isEditing = conversation.id === editingId;

                return (
                  <div
                    key={conversation.id}
                    className={`group relative rounded-xl transition-colors ${
                      isActive
                        ? "bg-secondary/50 border border-primary/30"
                        : "hover:bg-secondary/30 border border-transparent"
                    }`}
                  >
                    {isEditing ? (
                      <div className="flex items-center gap-1 px-3 py-2.5">
                        <input
                          ref={inputRef}
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onKeyDown={handleKeyDown}
                          onBlur={handleSaveEdit}
                          className="flex-1 bg-transparent border-none outline-none text-sm font-mono text-white"
                          maxLength={50}
                        />
                        <button
                          onClick={handleSaveEdit}
                          className="p-1 hover:bg-primary/20 rounded-lg"
                          aria-label="Save"
                        >
                          <CheckIcon size={14} className="text-primary" />
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="p-1 hover:bg-white/10 rounded-lg"
                          aria-label="Cancel"
                        >
                          <XIcon size={14} className="text-white/50" />
                        </button>
                      </div>
                    ) : (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectConversation(conversation.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelectConversation(conversation.id);
                          }
                        }}
                        className="w-full flex items-center justify-between px-3 py-2.5 cursor-pointer"
                      >
                        <span
                          className={`text-sm font-mono truncate flex-1 text-left ${
                            isActive ? "text-white" : "text-white/60"
                          }`}
                        >
                          {conversation.title}
                        </span>

                        {/* Action buttons */}
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => handleStartEdit(conversation, e)}
                            className="p-1.5 hover:bg-white/10 rounded-lg"
                            aria-label="Edit title"
                          >
                            <PencilSimpleIcon size={14} className="text-white/50" />
                          </button>
                          <button
                            onClick={(e) => handleDelete(conversation.id, e)}
                            className="p-1.5 hover:bg-primary/20 rounded-lg"
                            aria-label="Delete conversation"
                          >
                            <TrashIcon size={14} className="text-primary/70" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ConversationSidebar;
