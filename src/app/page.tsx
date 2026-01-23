"use client";

import ChatBox from "@/components/dashboard-components/ChatBox";
import ConversationSidebar from "@/components/dashboard-components/ConversationSidebar";
import Header from "@/components/header";
import { useConversations } from "@/hooks/useConversations";

export default function Home() {
  const {
    conversations,
    activeConversationId,
    createConversation,
    updateConversationTitle,
    deleteConversation,
    selectConversation,
    touchConversation,
  } = useConversations();

  const handleNewConversation = () => {
    createConversation();
  };

  return (
    <div className="flex min-h-screen flex-col relative">
      <Header />
      <main className="w-full flex-1 flex">
        {/* Conversation Sidebar - Desktop only */}
        <div className="hidden lg:block h-[calc(100vh-72px)] sticky top-0 border-r border-border">
          <ConversationSidebar
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelectConversation={selectConversation}
            onCreateConversation={handleNewConversation}
            onUpdateTitle={updateConversationTitle}
            onDeleteConversation={deleteConversation}
          />
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 min-w-0 lg:px-[70px] px-4">
          <ChatBox
            conversationId={activeConversationId}
            onConversationStart={createConversation}
            onConversationUpdate={touchConversation}
          />
        </div>
      </main>
    </div>
  );
}
