// frontend/src/hooks/useChatSession.js

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch, API_BASE_URL } from '../config/api';
import { useAuth } from '../context/AuthContext';

function generateSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'session_' + Math.random().toString(36).substring(2, 11);
}

export default function useChatSession(options = {}) {
  const { user } = useAuth ? useAuth() : { user: null };
  const userRole = options.role || (user && user.role) || 'guest';

  const [sessionId] = useState(() => generateSessionId());
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);

  const abortControllerRef = useRef(null);

  const clearChat = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setMessages([]);
    setError(null);
    setIsStreaming(false);
  }, []);

  const sendMessage = useCallback(async (promptText) => {
    if (!promptText || typeof promptText !== 'string' || !promptText.trim()) return;
    const cleanPrompt = promptText.trim();

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setError(null);
    setIsStreaming(true);

    const userMessage = { role: 'user', content: cleanPrompt, ts: new Date().toISOString() };
    const assistantPlaceholder = { role: 'assistant', content: '', ts: new Date().toISOString() };

    setMessages(prev => [...prev, userMessage, assistantPlaceholder]);

    try {
      const url = `${API_BASE_URL}/api/chat/stream`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: cleanPrompt,
          sessionId,
          role: userRole,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        setError(`HTTP_${response.status}`);
        setIsStreaming(false);
        setMessages(prev => {
          const newArr = [...prev];
          const last = newArr[newArr.length - 1];
          if (last && last.role === 'assistant') {
            last.content = 'Sorry, the service encountered an HTTP error while processing your query.';
          }
          return newArr;
        });
        return;
      }

      const reader = response.body ? response.body.getReader() : null;
      if (!reader) {
        // Direct JSON fallback
        let json;
        try {
          json = await response.json();
        } catch (e) {
          json = null;
        }
        const text = json?.answer || 'Response completed.';
        setMessages(prev => {
          const newArr = [...prev];
          const last = newArr[newArr.length - 1];
          if (last && last.role === 'assistant') {
            last.content = text;
          }
          return newArr;
        });
        setIsStreaming(false);
        return;
      }

      const decoder = new TextDecoder('utf8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed === 'data: [DONE]') {
            setIsStreaming(false);
            break;
          }

          if (trimmed.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              if (parsed.content) {
                setMessages(prev => {
                  const newArr = [...prev];
                  const last = newArr[newArr.length - 1];
                  if (last && last.role === 'assistant') {
                    last.content += parsed.content;
                  }
                  return newArr;
                });
              } else if (parsed.error) {
                setError(parsed.error);
              }
            } catch (e) {
              // Ignore partial JSON parse errors
            }
          }
        }
      }

      setIsStreaming(false);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        setIsStreaming(false);
        return;
      }
      setError('NETWORK_ERROR');
      setIsStreaming(false);
      setMessages(prev => {
        const newArr = [...prev];
        const last = newArr[newArr.length - 1];
        if (last && last.role === 'assistant' && !last.content) {
          last.content = 'Failed to connect to AI assistant streaming service.';
        }
        return newArr;
      });
    }
  }, [sessionId, userRole]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    messages,
    sendMessage,
    isStreaming,
    error,
    clearChat,
    sessionId,
  };
}
