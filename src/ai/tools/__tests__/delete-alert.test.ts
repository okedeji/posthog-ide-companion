import { DeleteAlertTool } from '../delete-alert';
import type { PostHogApiClient } from '../../../api/client';
import type { ToolCall } from '../../types';

function makeCall(args: Record<string, unknown>): ToolCall {
  return { id: 'call-1', name: 'deleteAlert', arguments: args };
}

const MOCK_ALERT = {
  id: 1,
  name: 'High error rate',
  enabled: true,
};

function makeClient(overrides?: Partial<PostHogApiClient>): PostHogApiClient {
  return {
    get: jest.fn().mockResolvedValue({ ok: true, data: MOCK_ALERT }),
    delete: jest.fn().mockResolvedValue({ ok: true, data: undefined }),
    post: jest.fn(),
    patch: jest.fn(),
    getProjectUrl: jest.fn(),
    ...overrides,
  } as unknown as PostHogApiClient;
}

describe('DeleteAlertTool', () => {
  it('has requiresConsent set', () => {
    const tool = new DeleteAlertTool(makeClient());
    expect(tool.definition.requiresConsent).toBe(true);
  });

  it('deletes alert and returns confirmation with name', async () => {
    const client = makeClient();
    const tool = new DeleteAlertTool(client);

    const result = await tool.execute(makeCall({ id: 1 }));

    expect(result).toContain('Alert deleted');
    expect(result).toContain('ID: 1');
    expect(result).toContain('Name: High error rate');
    expect(client.get).toHaveBeenCalledWith('/alerts/1/', expect.anything());
    expect(client.delete).toHaveBeenCalledWith('/alerts/1/');
  });

  it('returns error for invalid id', async () => {
    const tool = new DeleteAlertTool(makeClient());
    const result = await tool.execute(makeCall({ id: 0 }));
    expect(result).toMatch(/id must be a positive integer/i);
  });

  it('returns error for non-integer id', async () => {
    const tool = new DeleteAlertTool(makeClient());
    const result = await tool.execute(makeCall({ id: 1.5 }));
    expect(result).toMatch(/id must be a positive integer/i);
  });

  it('returns error when fetch fails', async () => {
    const client = makeClient({
      get: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'not_found', message: 'Alert not found' },
      }),
    });
    const tool = new DeleteAlertTool(client);
    const result = await tool.execute(makeCall({ id: 999 }));
    expect(result).toMatch(/error fetching alert/i);
  });

  it('returns error when delete API fails', async () => {
    const client = makeClient({
      delete: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'unauthorized', message: 'Not authorized' },
      }),
    });
    const tool = new DeleteAlertTool(client);
    const result = await tool.execute(makeCall({ id: 1 }));
    expect(result).toMatch(/error deleting alert/i);
  });

  it('fetches alert before deleting to get the name', async () => {
    const client = makeClient();
    const tool = new DeleteAlertTool(client);

    await tool.execute(makeCall({ id: 5 }));

    // Get should be called before delete
    const getCalls = (client.get as jest.Mock).mock.invocationCallOrder[0]!;
    const deleteCalls = (client.delete as jest.Mock).mock
      .invocationCallOrder[0]!;
    expect(getCalls).toBeLessThan(deleteCalls);
  });

  it('calls onAlertDeleted on successful delete', async () => {
    const client = makeClient();
    const onAlertDeleted = jest.fn();
    const tool = new DeleteAlertTool(client, onAlertDeleted);

    await tool.execute(makeCall({ id: 1 }));

    expect(onAlertDeleted).toHaveBeenCalledWith(1);
  });

  it('does not call onAlertDeleted when delete fails', async () => {
    const client = makeClient({
      delete: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'unauthorized', message: 'No' },
      }),
    });
    const onAlertDeleted = jest.fn();
    const tool = new DeleteAlertTool(client, onAlertDeleted);

    await tool.execute(makeCall({ id: 1 }));

    expect(onAlertDeleted).not.toHaveBeenCalled();
  });
});
