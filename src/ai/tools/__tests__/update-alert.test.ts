import { UpdateAlertTool } from '../update-alert';
import type { PostHogApiClient } from '../../../api/client';
import type { ToolCall } from '../../types';

function makeCall(args: Record<string, unknown>): ToolCall {
  return { id: 'call-1', name: 'updateAlert', arguments: args };
}

const MOCK_ALERT = {
  id: 1,
  name: 'High error rate',
  enabled: true,
  calculation_interval: 'daily',
  threshold: {
    configuration: {
      type: 'absolute',
      bounds: { upper: 100 },
    },
  },
};

function makeClient(overrides?: Partial<PostHogApiClient>): PostHogApiClient {
  return {
    get: jest.fn().mockResolvedValue({ ok: true, data: MOCK_ALERT }),
    patch: jest.fn().mockResolvedValue({ ok: true, data: MOCK_ALERT }),
    post: jest.fn(),
    delete: jest.fn(),
    getProjectUrl: jest.fn(),
    ...overrides,
  } as unknown as PostHogApiClient;
}

describe('UpdateAlertTool', () => {
  it('has requiresConsent set', () => {
    const tool = new UpdateAlertTool(makeClient());
    expect(tool.definition.requiresConsent).toBe(true);
  });

  it('updates name and enabled fields', async () => {
    const client = makeClient();
    const tool = new UpdateAlertTool(client);

    const result = await tool.execute(
      makeCall({ id: 1, name: 'New name', enabled: false }),
    );

    expect(result).toContain('Alert updated');
    expect(client.patch).toHaveBeenCalledWith(
      '/alerts/1/',
      expect.objectContaining({
        name: 'New name',
        enabled: false,
      }),
      expect.anything(),
    );
  });

  it('updates calculation_interval', async () => {
    const client = makeClient();
    const tool = new UpdateAlertTool(client);

    await tool.execute(makeCall({ id: 1, calculation_interval: 'hourly' }));

    expect(client.patch).toHaveBeenCalledWith(
      '/alerts/1/',
      expect.objectContaining({ calculation_interval: 'hourly' }),
      expect.anything(),
    );
  });

  it('fetches current alert when updating threshold', async () => {
    const client = makeClient();
    const tool = new UpdateAlertTool(client);

    await tool.execute(makeCall({ id: 1, upper_bound: 200 }));

    // Should fetch current alert first
    expect(client.get).toHaveBeenCalledWith('/alerts/1/', expect.anything());
    // Then patch with merged threshold
    expect(client.patch).toHaveBeenCalledWith(
      '/alerts/1/',
      expect.objectContaining({
        threshold: {
          configuration: {
            type: 'absolute',
            bounds: { upper: 200 },
          },
        },
      }),
      expect.anything(),
    );
  });

  it('preserves existing bounds when updating only one', async () => {
    const client = makeClient({
      get: jest.fn().mockResolvedValue({
        ok: true,
        data: {
          ...MOCK_ALERT,
          threshold: {
            configuration: {
              type: 'absolute',
              bounds: { upper: 100, lower: 10 },
            },
          },
        },
      }),
    });
    const tool = new UpdateAlertTool(client);

    await tool.execute(makeCall({ id: 1, upper_bound: 200 }));

    expect(client.patch).toHaveBeenCalledWith(
      '/alerts/1/',
      expect.objectContaining({
        threshold: {
          configuration: {
            type: 'absolute',
            bounds: { upper: 200, lower: 10 },
          },
        },
      }),
      expect.anything(),
    );
  });

  it('handles snooze', async () => {
    const client = makeClient();
    const tool = new UpdateAlertTool(client);

    await tool.execute(makeCall({ id: 1, snoozed_until: '2h' }));

    expect(client.patch).toHaveBeenCalledWith(
      '/alerts/1/',
      expect.objectContaining({ snoozed_until: '2h' }),
      expect.anything(),
    );
  });

  it('handles unsnooze with "null" string', async () => {
    const client = makeClient();
    const tool = new UpdateAlertTool(client);

    await tool.execute(makeCall({ id: 1, snoozed_until: 'null' }));

    expect(client.patch).toHaveBeenCalledWith(
      '/alerts/1/',
      expect.objectContaining({ snoozed_until: null }),
      expect.anything(),
    );
  });

  it('returns error for invalid id', async () => {
    const tool = new UpdateAlertTool(makeClient());
    const result = await tool.execute(makeCall({ id: -1 }));
    expect(result).toMatch(/id must be a positive integer/i);
  });

  it('returns error when no update fields provided', async () => {
    const tool = new UpdateAlertTool(makeClient());
    const result = await tool.execute(makeCall({ id: 1 }));
    expect(result).toMatch(/provide at least one field/i);
  });

  it('returns error for invalid condition_type', async () => {
    const tool = new UpdateAlertTool(makeClient());
    const result = await tool.execute(
      makeCall({ id: 1, condition_type: 'invalid' }),
    );
    expect(result).toMatch(/condition_type must be one of/i);
  });

  it('returns error for invalid calculation_interval', async () => {
    const tool = new UpdateAlertTool(makeClient());
    const result = await tool.execute(
      makeCall({ id: 1, calculation_interval: 'biweekly' }),
    );
    expect(result).toMatch(/calculation_interval must be one of/i);
  });

  it('returns error when API fails', async () => {
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'not_found', message: 'Alert not found' },
      }),
    });
    const tool = new UpdateAlertTool(client);
    const result = await tool.execute(makeCall({ id: 999, enabled: false }));
    expect(result).toMatch(/error updating alert/i);
  });

  it('returns error when fetch for threshold merge fails', async () => {
    const client = makeClient({
      get: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'not_found', message: 'Alert not found' },
      }),
    });
    const tool = new UpdateAlertTool(client);
    const result = await tool.execute(makeCall({ id: 1, upper_bound: 200 }));
    expect(result).toMatch(/error fetching alert/i);
  });
});
