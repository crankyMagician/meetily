"use client";

import { useRef, useEffect, memo } from 'react';
import { ChatMessageResponse } from '@/types';
import { ChatMessageBubble } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { MessageSquare, LoaderIcon } from 'lucide-react';

interface ChatPanelProps {
  messages: ChatMessageResponse[];
  isLoading: boolean;
  isSending: boolean;
  onSendMessage: (content: string) => void;
  meetingId?: string | null;
}

export const ChatPanel = memo(function ChatPanel({
  messages,
  isLoading,
  isSending,
  onSendMessage,
  meetingId,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoaderIcon className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageSquare className="w-10 h-10 text-gray-300 mb-3" />
            <h3 className="text-sm font-medium text-gray-600 mb-1">
              {meetingId ? 'Ask about this meeting' : 'Ask across meetings'}
            </h3>
            <p className="text-xs text-gray-400 max-w-[250px]">
              {meetingId
                ? 'Ask questions about the transcript, summary, decisions, or action items.'
                : 'Search and ask questions across all your meeting transcripts.'}
            </p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatMessageBubble key={msg.id} message={msg} />
            ))}
            {isSending && (
              <div className="flex gap-2.5">
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-gray-100">
                  <LoaderIcon className="w-3.5 h-3.5 animate-spin text-gray-500" />
                </div>
                <div className="px-3 py-2 rounded-lg bg-gray-100 text-sm text-gray-500 rounded-bl-sm">
                  Thinking...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <ChatInput
        onSend={onSendMessage}
        disabled={isSending}
        placeholder={meetingId ? "Ask about this meeting..." : "Ask across all meetings..."}
      />
    </div>
  );
});
