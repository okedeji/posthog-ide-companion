import type * as vscode from 'vscode';
import type { SessionMessage } from '../ai/types';

const STORAGE_KEY = 'posthog.chatHistory';
const MAX_SESSIONS = 50;

/**
 * Summary shown in history list (without full message content).
 */
export type ChatSessionSummary = {
  id: string;
  title: string;
  messageCount: number;
  createdAt: number;
  lastActiveAt: number;
};

/**
 * Full persisted session with messages.
 */
export type ChatSession = {
  id: string;
  title: string;
  messages: SessionMessage[];
  createdAt: number;
  lastActiveAt: number;
};

/**
 * Persists chat sessions to VSCode workspace state.
 * Sessions are stored newest-first, capped at MAX_SESSIONS.
 */
export class ChatHistory {
  constructor(private readonly _state: vscode.Memento) {}

  /**
   * Returns summaries of all saved sessions (newest first).
   */
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

  /**
   * Loads a full session by ID.
   * @param id - The session ID to load
   * @returns The session, or undefined if not found
   */
  get(id: string): ChatSession | undefined {
    return this._load().find((s) => s.id === id);
  }

  /**
   * Saves a session. If it already exists (same ID), replaces it.
   * Sessions are kept newest-first, capped at MAX_SESSIONS.
   * @param session - The session to save
   */
  save(session: ChatSession): void {
    const sessions = this._load().filter((s) => s.id !== session.id);
    sessions.unshift(session);
    if (sessions.length > MAX_SESSIONS) {
      sessions.length = MAX_SESSIONS;
    }
    void this._state.update(STORAGE_KEY, sessions);
  }

  /**
   * Deletes a session by ID.
   * @param id - The session ID to delete
   */
  delete(id: string): void {
    const sessions = this._load().filter((s) => s.id !== id);
    void this._state.update(STORAGE_KEY, sessions);
  }

  private _load(): ChatSession[] {
    return this._state.get<ChatSession[]>(STORAGE_KEY) ?? [];
  }
}

/**
 * Derives a title from the first user message in a session.
 * @param messages - The session messages
 * @returns A short title string
 */
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
