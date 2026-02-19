import type * as vscode from 'vscode';
import type { SessionMessage } from '../ai/types';

const STORAGE_KEY = 'posthog.chatHistory';
const MAX_SESSIONS = 50;

export type ChatSessionSummary = {
  id: string;
  title: string;
  messageCount: number;
  createdAt: number;
  lastActiveAt: number;
};

export type ChatSession = {
  id: string;
  title: string;
  messages: SessionMessage[];
  createdAt: number;
  lastActiveAt: number;
};

// Newest-first, capped at MAX_SESSIONS.
export class ChatHistory {
  constructor(private readonly _state: vscode.Memento) {}

  list(): ChatSessionSummary[] {
    const sessions = this._load();
    return sessions.map((s) => ({
      id: s.id,
      title: stripMarkdown(s.title),
      messageCount: s.messages.length,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
    }));
  }

  get(id: string): ChatSession | undefined {
    return this._load().find((s) => s.id === id);
  }

  // Upserts — replaces existing session with same ID, keeps newest-first.
  save(session: ChatSession): void {
    const sessions = this._load().filter((s) => s.id !== session.id);
    sessions.unshift(session);
    if (sessions.length > MAX_SESSIONS) {
      sessions.length = MAX_SESSIONS;
    }
    void this._state.update(STORAGE_KEY, sessions);
  }

  delete(id: string): void {
    const sessions = this._load().filter((s) => s.id !== id);
    void this._state.update(STORAGE_KEY, sessions);
  }

  private _load(): ChatSession[] {
    return this._state.get<ChatSession[]>(STORAGE_KEY) ?? [];
  }
}

export function deriveSessionTitle(
  messages: readonly SessionMessage[],
): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) {
    return 'Empty chat';
  }
  const text = stripMarkdown(firstUser.content.trim());
  return text.length > 60 ? text.slice(0, 57) + '...' : text;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,4}\s+/gm, '') // headings
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1') // italic
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/\n{2,}/g, ' ') // collapse double newlines
    .trim();
}
