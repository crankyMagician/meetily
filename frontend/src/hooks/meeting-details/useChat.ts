import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChatSessionResponse, ChatMessageResponse } from '@/types';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { toast } from 'sonner';

interface UseChatProps {
  meetingId?: string | null;
  modelConfig: ModelConfig;
}

export function useChat({ meetingId, modelConfig }: UseChatProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // Load or create session when meeting changes
  useEffect(() => {
    const initSession = async () => {
      if (!meetingId) return;

      try {
        setIsLoading(true);
        // Try to find existing session
        const sessions = await invoke<ChatSessionResponse[]>('api_list_chat_sessions', {
          meetingId,
        });

        if (sessions.length > 0) {
          setSessionId(sessions[0].id);
          // Load messages
          const history = await invoke<ChatMessageResponse[]>('api_get_chat_history', {
            sessionId: sessions[0].id,
          });
          setMessages(history);
        } else {
          setSessionId(null);
          setMessages([]);
        }
      } catch (error) {
        console.error('Failed to init chat session:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initSession();
  }, [meetingId]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isSending) return;

    setIsSending(true);

    try {
      let currentSessionId = sessionId;

      // Create session if needed
      if (!currentSessionId) {
        const session = await invoke<ChatSessionResponse>('api_create_chat_session', {
          meetingId: meetingId || null,
          title: null,
        });
        currentSessionId = session.id;
        setSessionId(session.id);
      }

      // Add optimistic user message
      const tempUserMsg: ChatMessageResponse = {
        id: `temp-${Date.now()}`,
        session_id: currentSessionId,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, tempUserMsg]);

      // Send and get response
      const result = await invoke<{ message: ChatMessageResponse; response: string }>('api_send_chat_message', {
        sessionId: currentSessionId,
        message: content,
        model: modelConfig.provider,
        modelName: modelConfig.model,
      });

      // Replace optimistic message and add assistant response
      setMessages(prev => {
        const withoutTemp = prev.filter(m => m.id !== tempUserMsg.id);
        return [
          ...withoutTemp,
          result.message,
          {
            id: `resp-${Date.now()}`,
            session_id: currentSessionId!,
            role: 'assistant' as const,
            content: result.response,
            created_at: new Date().toISOString(),
          },
        ];
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => !m.id.startsWith('temp-')));
      toast.error('Failed to send message', { description: msg });
    } finally {
      setIsSending(false);
    }
  }, [sessionId, meetingId, modelConfig, isSending]);

  const clearChat = useCallback(() => {
    setSessionId(null);
    setMessages([]);
  }, []);

  return {
    messages,
    isLoading,
    isSending,
    sendMessage,
    clearChat,
  };
}
