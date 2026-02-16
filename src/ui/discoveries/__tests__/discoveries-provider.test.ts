import * as vscode from 'vscode';
import { DiscoveriesProvider } from '../discoveries-provider';
import { DiscoveryStore } from '../../../discoveries/store';
import type { Discovery } from '../../../discoveries/types';

function makeDiscovery(overrides: Partial<Discovery> = {}): Discovery {
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

describe('DiscoveriesProvider', () => {
  it('should have the correct static view type', () => {
    expect(DiscoveriesProvider.viewType).toBe('posthog.discoveries');
  });

  it('should return empty children when store is empty', () => {
    const store = new DiscoveryStore();
    const provider = new DiscoveriesProvider(store);

    expect(provider.getChildren()).toEqual([]);
  });

  it('should return discoveries from the store', () => {
    const store = new DiscoveryStore();
    store.merge([makeDiscovery(), makeDiscovery({ id: 'error:issue-2' })]);

    const provider = new DiscoveriesProvider(store);
    expect(provider.getChildren()).toHaveLength(2);
  });

  it('should render discovery title as label', () => {
    const store = new DiscoveryStore();
    store.merge([makeDiscovery()]);

    const provider = new DiscoveriesProvider(store);
    const item = provider.getTreeItem(provider.getChildren()[0]!);

    expect(item.label).toBe('TypeError: Cannot read properties of undefined');
  });

  it('should render occurrence count and time as description', () => {
    const store = new DiscoveryStore();
    store.merge([makeDiscovery()]);

    const provider = new DiscoveriesProvider(store);
    const item = provider.getTreeItem(provider.getChildren()[0]!);

    expect(item.description).toBe('42× · 2h ago');
  });

  it('should use warning icon for warning severity', () => {
    const store = new DiscoveryStore();
    store.merge([makeDiscovery({ severity: 'warning' })]);

    const provider = new DiscoveriesProvider(store);
    const item = provider.getTreeItem(provider.getChildren()[0]!);

    expect(item.iconPath).toBeInstanceOf(vscode.ThemeIcon);
    expect((item.iconPath as vscode.ThemeIcon).id).toBe('warning');
  });

  it('should use error icon for critical severity', () => {
    const store = new DiscoveryStore();
    store.merge([makeDiscovery({ severity: 'critical' })]);

    const provider = new DiscoveriesProvider(store);
    const item = provider.getTreeItem(provider.getChildren()[0]!);

    expect((item.iconPath as vscode.ThemeIcon).id).toBe('error');
  });

  it('should use info icon for info severity', () => {
    const store = new DiscoveryStore();
    store.merge([makeDiscovery({ severity: 'info' })]);

    const provider = new DiscoveriesProvider(store);
    const item = provider.getTreeItem(provider.getChildren()[0]!);

    expect((item.iconPath as vscode.ThemeIcon).id).toBe('info');
  });

  it('should set all items to non-collapsible', () => {
    const store = new DiscoveryStore();
    store.merge([makeDiscovery()]);

    const provider = new DiscoveriesProvider(store);
    const item = provider.getTreeItem(provider.getChildren()[0]!);

    expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
  });

  it('should set contextValue to discovery kind', () => {
    const store = new DiscoveryStore();
    store.merge([makeDiscovery()]);

    const provider = new DiscoveriesProvider(store);
    const item = provider.getTreeItem(provider.getChildren()[0]!);

    expect(item.contextValue).toBe('error');
  });

  it('should refresh when the store changes', () => {
    const store = new DiscoveryStore();
    const provider = new DiscoveriesProvider(store);
    const listener = jest.fn();
    provider.onDidChangeTreeData(listener);

    store.merge([makeDiscovery()]);

    expect(listener).toHaveBeenCalled();
  });

  it('should refresh when the store is cleared', () => {
    const store = new DiscoveryStore();
    store.merge([makeDiscovery()]);

    const provider = new DiscoveriesProvider(store);
    const listener = jest.fn();
    provider.onDidChangeTreeData(listener);

    store.clear();

    expect(listener).toHaveBeenCalled();
  });
});
