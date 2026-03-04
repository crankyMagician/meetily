"use client";

import { ChatMessageResponse } from '@/types';
import { User, Bot } from 'lucide-react';

interface ChatMessageProps {
  message: ChatMessageResponse;
}

export function ChatMessageBubble({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
        isUser ? 'bg-blue-100' : 'bg-gray-100'
      }`}>
        {isUser ? (
          <User className="w-3.5 h-3.5 text-blue-600" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-gray-600" />
        )}
      </div>
      <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
        isUser
          ? 'bg-blue-600 text-white rounded-br-sm'
          : 'bg-gray-100 text-gray-800 rounded-bl-sm'
      }`}>
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    </div>
  );
}
