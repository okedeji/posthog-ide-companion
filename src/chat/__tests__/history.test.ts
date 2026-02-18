import { ChatHistory, deriveSessionTitle } from '../history';
import type { ChatSession } from '../history';
import type { SessionMessage } from '../../ai/types';

function createMockMemento(): { get: jest.Mock; update: jest.Mock } {
  const store = new Map<string, unknown>();
  return {
    get: jest.fn((key: string) => store.get(key)),
    update: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
}

function makeSession(id: string, title: string, msgCount = 2): ChatSession {
  const messages: SessionMessage[] = [];
  for (let i = 0; i < msgCount; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
      timestamp: Date.now() - (msgCount - i) * 1000,
    });
  }
  return {
    id,
    title,
    messages,
    createdAt: messages[0]?.timestamp ?? Date.now(),
    lastActiveAt: messages[messages.length - 1]?.timestamp ?? Date.now(),
  };
}

describe('ChatHistory', () => {
  let memento: ReturnType<typeof createMockMemento>;
  let history: ChatHistory;

  beforeEach(() => {
    memento = createMockMemento();
    history = new ChatHistory(memento as never);
  });

  it('should return empty list when no sessions saved', () => {
    expect(history.list()).toEqual([]);
  });

  it('should save and retrieve a session', () => {
    const session = makeSession('s1', 'First chat');
    history.save(session);

    const summaries = history.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe('s1');
    expect(summaries[0].title).toBe('First chat');
    expect(summaries[0].messageCount).toBe(2);

    const full = history.get('s1');
    expect(full).toBeDefined();
    expect(full?.messages).toHaveLength(2);
  });

  it('should return undefined for unknown session ID', () => {
    expect(history.get('nonexistent')).toBeUndefined();
  });

  it('should keep newest sessions first', () => {
    history.save(makeSession('s1', 'First'));
    history.save(makeSession('s2', 'Second'));

    const summaries = history.list();
    expect(summaries[0].id).toBe('s2');
    expect(summaries[1].id).toBe('s1');
  });

  it('should replace existing session with same ID', () => {
    history.save(makeSession('s1', 'Original', 2));
    history.save(makeSession('s1', 'Updated', 4));

    const summaries = history.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].title).toBe('Updated');
    expect(summaries[0].messageCount).toBe(4);
  });

  it('should delete a session by ID', () => {
    history.save(makeSession('s1', 'First'));
    history.save(makeSession('s2', 'Second'));

    history.delete('s1');

    const summaries = history.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe('s2');
  });

  it('should cap sessions at 50', () => {
    for (let i = 0; i < 55; i++) {
      history.save(makeSession(`s${i}`, `Chat ${i}`));
    }

    expect(history.list()).toHaveLength(50);
  });
});

describe('deriveSessionTitle', () => {
  it('should use first user message as title', () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: 'What errors happened today?', timestamp: 1 },
      { role: 'assistant', content: 'Here are the errors...', timestamp: 2 },
    ];
    expect(deriveSessionTitle(messages)).toBe('What errors happened today?');
  });

  it('should truncate long messages to 60 characters', () => {
    const long = 'A'.repeat(80);
    const messages: SessionMessage[] = [
      { role: 'user', content: long, timestamp: 1 },
    ];
    const title = deriveSessionTitle(messages);
    expect(title).toHaveLength(60);
    expect(title.endsWith('...')).toBe(true);
  });

  it('should return "Empty chat" when no user messages exist', () => {
    expect(deriveSessionTitle([])).toBe('Empty chat');
    expect(
      deriveSessionTitle([{ role: 'assistant', content: 'Hi', timestamp: 1 }]),
    ).toBe('Empty chat');
  });
});
