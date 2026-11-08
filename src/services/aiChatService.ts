/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Tagoloan Water District - Baymax AI Chat Service
 * Supports Baymax 1.0 (Consumer Companion) & Baymax 2.0 (Admin Companion)
 * Powered by Google Gemini 3.8 Flash with multilingual intelligence (English, Tagalog, Bisaya).
 */

export type ChatPortalType = 'consumer' | 'admin';
export type ChatLanguage = 'auto' | 'en' | 'tl' | 'ceb';

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  language?: string;
  model?: string;
}

export interface ChatRequestPayload {
  portal: ChatPortalType;
  messages: Array<{ role: 'user' | 'model'; text: string }>;
  language: ChatLanguage;
  context?: Record<string, any>;
}

export interface ChatResponsePayload {
  success: boolean;
  reply: string;
  model: string;
  portal: ChatPortalType;
  botName: string;
  botSubtitle: string;
}

const STORAGE_KEY_PREFIX = 'twd_baymax_chat_';

export function getStoredChatHistory(portal: ChatPortalType): ChatMessage[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${portal}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn(`[Baymax Storage] Failed to load chat history for ${portal}:`, err);
  }
  return [];
}

export function saveChatHistory(portal: ChatPortalType, messages: ChatMessage[]): void {
  try {
    // Keep last 40 messages to avoid local storage bloat
    const trimmed = messages.slice(-40);
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${portal}`, JSON.stringify(trimmed));
  } catch (err) {
    console.warn(`[Baymax Storage] Failed to save chat history for ${portal}:`, err);
  }
}

export function clearStoredChatHistory(portal: ChatPortalType): void {
  try {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${portal}`);
  } catch (err) {
    console.warn(`[Baymax Storage] Failed to clear chat history for ${portal}:`, err);
  }
}

export async function sendBaymaxChatMessage(
  portal: ChatPortalType,
  allMessages: ChatMessage[],
  language: ChatLanguage = 'auto',
  context: Record<string, any> = {}
): Promise<ChatResponsePayload> {
  // Convert messages for API call (strip internal IDs and keep role + text)
  const formattedMessages = allMessages.map((m) => ({
    role: m.role,
    text: m.text,
  }));

  const payload: ChatRequestPayload = {
    portal,
    messages: formattedMessages,
    language,
    context,
  };

  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.message || `Server responded with HTTP ${response.status}`);
  }

  const data: ChatResponsePayload = await response.json();
  return data;
}
