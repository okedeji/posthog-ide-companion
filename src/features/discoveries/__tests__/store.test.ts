import { DiscoveryStore } from '../store';
import type { Discovery } from '../types';

function makeDiscovery(overrides: Partial<Discovery> = {}): Discovery {
  return {
    id: 'disc-1',
    kind: 'error',
    title: 'TypeError',
    description: '42 occurrences',
    severity: 'warning',
    firstSeen: '2025-01-01T00:00:00Z',
    lastSeen: '2025-02-01T00:00:00Z',
    source: {},
    ...overrides,
  };
}

describe('DiscoveryStore', () => {
  it('should add discoveries via merge', () => {
    const store = new DiscoveryStore();
    const added = store.merge([makeDiscovery()]);

    expect(added).toBe(1);
    expect(store.count).toBe(1);
  });

  it('should return new count of 0 when merging existing ids', () => {
    const store = new DiscoveryStore();
    store.merge([makeDiscovery({ id: 'a' })]);

    const added = store.merge([
      makeDiscovery({ id: 'a', description: 'updated' }),
    ]);

    expect(added).toBe(0);
    expect(store.count).toBe(1);
    // Should have updated the entry
    expect(store.getAll()[0]?.description).toBe('updated');
  });

  it('should count only genuinely new ids in a mixed merge', () => {
    const store = new DiscoveryStore();
    store.merge([makeDiscovery({ id: 'existing' })]);

    const added = store.merge([
      makeDiscovery({ id: 'existing' }),
      makeDiscovery({ id: 'brand-new' }),
    ]);

    expect(added).toBe(1);
    expect(store.count).toBe(2);
  });

  it('should sort by lastSeen descending', () => {
    const store = new DiscoveryStore();
    store.merge([
      makeDiscovery({ id: 'old', lastSeen: '2025-01-01T00:00:00Z' }),
      makeDiscovery({ id: 'new', lastSeen: '2025-02-15T00:00:00Z' }),
      makeDiscovery({ id: 'mid', lastSeen: '2025-01-20T00:00:00Z' }),
    ]);

    const ids = store.getAll().map((d) => d.id);
    expect(ids).toEqual(['new', 'mid', 'old']);
  });

  it('should filter by kind', () => {
    const store = new DiscoveryStore();
    store.merge([
      makeDiscovery({ id: 'err-1', kind: 'error' }),
      makeDiscovery({ id: 'err-2', kind: 'error' }),
    ]);

    expect(store.getByKind('error')).toHaveLength(2);
  });

  it('should clear all items', () => {
    const store = new DiscoveryStore();
    store.merge([makeDiscovery({ id: 'a' }), makeDiscovery({ id: 'b' })]);

    store.clear();

    expect(store.count).toBe(0);
    expect(store.getAll()).toEqual([]);
  });

  it('should fire onDidChange when items are merged', () => {
    const store = new DiscoveryStore();
    const listener = jest.fn();
    store.onDidChange(listener);

    store.merge([makeDiscovery()]);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should fire onDidChange when cleared', () => {
    const store = new DiscoveryStore();
    store.merge([makeDiscovery()]);

    const listener = jest.fn();
    store.onDidChange(listener);

    store.clear();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
