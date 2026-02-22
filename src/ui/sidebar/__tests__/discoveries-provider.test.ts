import * as vscode from 'vscode';
import { DiscoveriesProvider } from '../discoveries-provider';
import type { DiscoveryTreeNode } from '../discoveries-provider';
import { DiscoveryStore } from '../../../features/discoveries/store';
import type { Discovery } from '../../../features/discoveries/types';

function makeError(overrides: Partial<Discovery> = {}): Discovery {
  return {
    id: 'error:issue-1',
    kind: 'error',
    title: 'TypeError: Cannot read properties of undefined',
    description: '42× · 2h ago',
    severity: 'warning',
    firstSeen: '2025-01-15T10:00:00Z',
    lastSeen: '2025-02-10T14:00:00Z',
    source: {},
    ...overrides,
  };
}

function makeSetupIssue(overrides: Partial<Discovery> = {}): Discovery {
  return {
    id: 'setup_issue:posthog_not_integrated',
    kind: 'setup_issue',
    title: 'PostHog not integrated',
    description: 'No PostHog SDK found in this project.',
    severity: 'warning',
    firstSeen: '2025-02-10T14:00:00Z',
    lastSeen: '2025-02-10T14:00:00Z',
    source: {
      checkId: 'posthog_not_integrated',
      evidence: [],
    },
    ...overrides,
  };
}

function isGroup(
  node: DiscoveryTreeNode,
): node is DiscoveryTreeNode & { __type: 'group' } {
  return '__type' in node && node.__type === 'group';
}

describe('DiscoveriesProvider', () => {
  describe('grouping', () => {
    it('should return empty children when store is empty', () => {
      const store = new DiscoveryStore();
      const provider = new DiscoveriesProvider(store);

      expect(provider.getChildren()).toEqual([]);
    });

    it('should return only non-empty groups at root level', () => {
      const store = new DiscoveryStore();
      store.merge([makeError()]);

      const provider = new DiscoveriesProvider(store);
      const roots = provider.getChildren();

      expect(roots).toHaveLength(1);
      expect(isGroup(roots[0]!)).toBe(true);
    });

    it('should show error group before setup_issue group', () => {
      const store = new DiscoveryStore();
      store.merge([makeError(), makeSetupIssue()]);

      const provider = new DiscoveriesProvider(store);
      const roots = provider.getChildren();

      expect(roots).toHaveLength(2);
      expect(isGroup(roots[0]!) && roots[0]!).toMatchObject({
        kind: 'error',
      });
      expect(isGroup(roots[1]!) && roots[1]!).toMatchObject({
        kind: 'setup_issue',
      });
    });

    it('should hide groups with no items', () => {
      const store = new DiscoveryStore();
      store.merge([makeSetupIssue()]);

      const provider = new DiscoveriesProvider(store);
      const roots = provider.getChildren();

      expect(roots).toHaveLength(1);
      expect(isGroup(roots[0]!) && roots[0]!).toMatchObject({
        kind: 'setup_issue',
      });
    });

    it('should return discoveries as children of their group', () => {
      const store = new DiscoveryStore();
      store.merge([makeError({ id: 'error:1' }), makeError({ id: 'error:2' })]);

      const provider = new DiscoveriesProvider(store);
      const roots = provider.getChildren();
      const children = provider.getChildren(roots[0]!);

      expect(children).toHaveLength(2);
      expect(children.every((c) => !isGroup(c))).toBe(true);
    });

    it('should return empty array for leaf children', () => {
      const store = new DiscoveryStore();
      store.merge([makeError()]);

      const provider = new DiscoveriesProvider(store);
      const roots = provider.getChildren();
      const children = provider.getChildren(roots[0]!);

      expect(provider.getChildren(children[0]!)).toEqual([]);
    });
  });

  describe('group tree items', () => {
    it('should render group with expanded state', () => {
      const store = new DiscoveryStore();
      store.merge([makeError()]);

      const provider = new DiscoveriesProvider(store);
      const group = provider.getChildren()[0]!;
      const item = provider.getTreeItem(group);

      expect(item.collapsibleState).toBe(
        vscode.TreeItemCollapsibleState.Expanded,
      );
    });

    it('should show count as description on group', () => {
      const store = new DiscoveryStore();
      store.merge([
        makeError({ id: 'error:1' }),
        makeError({ id: 'error:2' }),
        makeError({ id: 'error:3' }),
      ]);

      const provider = new DiscoveriesProvider(store);
      const group = provider.getChildren()[0]!;
      const item = provider.getTreeItem(group);

      expect(item.description).toBe('3');
    });
  });

  describe('leaf tree items', () => {
    it('should render discovery title as label', () => {
      const store = new DiscoveryStore();
      store.merge([makeError()]);

      const provider = new DiscoveriesProvider(store);
      const group = provider.getChildren()[0]!;
      const leaf = provider.getChildren(group)[0]!;
      const item = provider.getTreeItem(leaf);

      expect(item.label).toBe('TypeError: Cannot read properties of undefined');
    });

    it('should render description from discovery', () => {
      const store = new DiscoveryStore();
      store.merge([makeError()]);

      const provider = new DiscoveriesProvider(store);
      const group = provider.getChildren()[0]!;
      const leaf = provider.getChildren(group)[0]!;
      const item = provider.getTreeItem(leaf);

      expect(item.description).toBe('42× · 2h ago');
    });
  });

  describe('reactivity', () => {
    it('should refresh when the store changes', () => {
      const store = new DiscoveryStore();
      const provider = new DiscoveriesProvider(store);
      const listener = jest.fn();
      provider.onDidChangeTreeData(listener);

      store.merge([makeError()]);

      expect(listener).toHaveBeenCalled();
    });

    it('should refresh when the store is cleared', () => {
      const store = new DiscoveryStore();
      store.merge([makeError()]);

      const provider = new DiscoveriesProvider(store);
      const listener = jest.fn();
      provider.onDidChangeTreeData(listener);

      store.clear();

      expect(listener).toHaveBeenCalled();
    });
  });
});
