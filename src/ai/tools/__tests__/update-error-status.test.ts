import { UpdateErrorStatusTool } from '../update-error-status';
import type { PostHogApiClient } from '../../../api/client';
import type { ToolCall } from '../../types';

function makeCall(args: Record<string, unknown>): ToolCall {
  return { id: 'call-1', name: 'updateErrorStatus', arguments: args };
}

const ACTIVE_ISSUE = {
  id: 'abc-123-def',
  status: 'active',
  name: 'TypeError: Cannot read property of undefined',
  description: null,
};

function makeClient(overrides?: Partial<PostHogApiClient>): PostHogApiClient {
  return {
    patch: jest.fn().mockResolvedValue({ ok: true, data: ACTIVE_ISSUE }),
    getProjectUrl: jest
      .fn()
      .mockReturnValue(
        'https://us.posthog.com/project/1/error_tracking/abc-123-def',
      ),
    ...overrides,
  } as unknown as PostHogApiClient;
}

describe('UpdateErrorStatusTool', () => {
  it('sends PATCH to correct error_tracking/issues endpoint', async () => {
    const client = makeClient();
    const tool = new UpdateErrorStatusTool(client);

    await tool.execute(makeCall({ id: 'abc-123-def', status: 'resolved' }));

    expect(client.patch).toHaveBeenCalledWith(
      '/error_tracking/issues/abc-123-def/',
      { status: 'resolved' },
      expect.anything(),
    );
  });

  it('accepts resolved status', async () => {
    const resolvedIssue = { ...ACTIVE_ISSUE, status: 'resolved' };
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({ ok: true, data: resolvedIssue }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateErrorStatusTool(client);

    const result = await tool.execute(
      makeCall({ id: 'abc-123-def', status: 'resolved' }),
    );

    expect(result).toContain('resolved');
  });

  it('accepts suppressed status', async () => {
    const suppressedIssue = { ...ACTIVE_ISSUE, status: 'suppressed' };
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({ ok: true, data: suppressedIssue }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateErrorStatusTool(client);

    const result = await tool.execute(
      makeCall({ id: 'abc-123-def', status: 'suppressed' }),
    );

    expect(result).toContain('suppressed');
  });

  it('accepts active status to reopen', async () => {
    const client = makeClient();
    const tool = new UpdateErrorStatusTool(client);

    await tool.execute(makeCall({ id: 'abc-123-def', status: 'active' }));

    expect(client.patch).toHaveBeenCalledWith(
      '/error_tracking/issues/abc-123-def/',
      { status: 'active' },
      expect.anything(),
    );
  });

  it('returns success message with issue name and url', async () => {
    const client = makeClient();
    const tool = new UpdateErrorStatusTool(client);

    const result = await tool.execute(
      makeCall({ id: 'abc-123-def', status: 'resolved' }),
    );

    expect(result).toContain('Error status updated');
    expect(result).toContain('TypeError');
    expect(result).toContain(
      'https://us.posthog.com/project/1/error_tracking/abc-123-def',
    );
  });

  it('falls back to truncated ID when name and description are null', async () => {
    const noNameIssue = {
      ...ACTIVE_ISSUE,
      name: null,
      description: null,
      status: 'resolved',
    };
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({ ok: true, data: noNameIssue }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateErrorStatusTool(client);

    const result = await tool.execute(
      makeCall({ id: 'abc-123-def', status: 'resolved' }),
    );

    expect(result).toContain('abc-123-');
  });

  it('returns error for empty id', async () => {
    const tool = new UpdateErrorStatusTool(makeClient());
    const result = await tool.execute(makeCall({ id: '', status: 'resolved' }));
    expect(result).toMatch(/id is required/i);
  });

  it('returns error for invalid status', async () => {
    const tool = new UpdateErrorStatusTool(makeClient());
    const result = await tool.execute(
      makeCall({ id: 'abc-123-def', status: 'archived' }),
    );
    expect(result).toMatch(/status must be one of/i);
  });

  it('rejects pending_release as a writable status', async () => {
    const tool = new UpdateErrorStatusTool(makeClient());
    const result = await tool.execute(
      makeCall({ id: 'abc-123-def', status: 'pending_release' }),
    );
    expect(result).toMatch(/status must be one of/i);
  });

  it('returns error when PATCH fails', async () => {
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'not_found', message: 'Issue not found' },
      }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateErrorStatusTool(client);

    const result = await tool.execute(
      makeCall({ id: 'abc-123-def', status: 'resolved' }),
    );

    expect(result).toMatch(/error updating error status/i);
    expect(result).toContain('Issue not found');
  });

  it('has requiresConsent set', () => {
    const tool = new UpdateErrorStatusTool(makeClient());
    expect(tool.definition.requiresConsent).toBe(true);
  });

  it('calls onStatusChanged on successful PATCH', async () => {
    const resolvedIssue = { ...ACTIVE_ISSUE, status: 'resolved' };
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({ ok: true, data: resolvedIssue }),
    } as Partial<PostHogApiClient>);
    const onStatusChanged = jest.fn();
    const tool = new UpdateErrorStatusTool(client, onStatusChanged);

    await tool.execute(makeCall({ id: 'abc-123-def', status: 'resolved' }));

    expect(onStatusChanged).toHaveBeenCalledWith('abc-123-def', 'resolved');
  });

  it('does not call onStatusChanged when PATCH fails', async () => {
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'not_found', message: 'Issue not found' },
      }),
    } as Partial<PostHogApiClient>);
    const onStatusChanged = jest.fn();
    const tool = new UpdateErrorStatusTool(client, onStatusChanged);

    await tool.execute(makeCall({ id: 'abc-123-def', status: 'resolved' }));

    expect(onStatusChanged).not.toHaveBeenCalled();
  });

  it('does not call onStatusChanged on validation error', async () => {
    const onStatusChanged = jest.fn();
    const tool = new UpdateErrorStatusTool(makeClient(), onStatusChanged);

    await tool.execute(makeCall({ id: '', status: 'resolved' }));

    expect(onStatusChanged).not.toHaveBeenCalled();
  });
});
