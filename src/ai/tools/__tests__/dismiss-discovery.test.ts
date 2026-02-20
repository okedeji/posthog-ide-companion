import { DismissDiscoveryTool } from '../dismiss-discovery';
import type { ToolCall } from '../../types';

function makeCall(args: Record<string, unknown>): ToolCall {
  return { id: 'call-1', name: 'dismissDiscovery', arguments: args };
}

describe('DismissDiscoveryTool', () => {
  it('calls onResolved with the discovery id', async () => {
    const onResolved = jest.fn();
    const tool = new DismissDiscoveryTool(onResolved);

    await tool.execute(
      makeCall({ id: 'setup_issue:source_maps_not_configured' }),
    );

    expect(onResolved).toHaveBeenCalledWith(
      'setup_issue:source_maps_not_configured',
    );
  });

  it('returns success message', async () => {
    const tool = new DismissDiscoveryTool(jest.fn());

    const result = await tool.execute(
      makeCall({ id: 'setup_issue:missing_sdk' }),
    );

    expect(result).toContain('Discovery dismissed');
    expect(result).toContain('setup_issue:missing_sdk');
  });

  it('returns error for empty id', async () => {
    const onResolved = jest.fn();
    const tool = new DismissDiscoveryTool(onResolved);

    const result = await tool.execute(makeCall({ id: '' }));

    expect(result).toMatch(/id is required/i);
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('dismisses integration suggestion discoveries', async () => {
    const onResolved = jest.fn();
    const tool = new DismissDiscoveryTool(onResolved);

    const result = await tool.execute(
      makeCall({ id: 'integration_suggestion:src/pages/checkout.tsx' }),
    );

    expect(result).toContain('Discovery dismissed');
    expect(onResolved).toHaveBeenCalledWith(
      'integration_suggestion:src/pages/checkout.tsx',
    );
  });

  it('rejects non-dismissable ids', async () => {
    const onResolved = jest.fn();
    const tool = new DismissDiscoveryTool(onResolved);

    const result = await tool.execute(makeCall({ id: 'error:abc-123' }));

    expect(result).toMatch(/only setup issues and integration suggestions/i);
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('has requiresConsent set', () => {
    const tool = new DismissDiscoveryTool(jest.fn());
    expect(tool.definition.requiresConsent).toBe(true);
  });
});
