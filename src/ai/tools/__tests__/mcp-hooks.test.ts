import { buildMcpToolHooks } from '../mcp-hooks';

describe('buildMcpToolHooks', () => {
  describe('update-feature-flag', () => {
    it('fires when flag is deactivated', () => {
      const onResolved = jest.fn();
      const hooks = buildMcpToolHooks(onResolved);
      const hook = hooks.get('update-feature-flag')!;

      hook.onSuccess({ flagKey: 'my-flag', data: { active: false } }, '');

      expect(onResolved).toHaveBeenCalledWith('stale_flag:my-flag');
      expect(onResolved).toHaveBeenCalledWith('flag_rollback:my-flag');
    });

    it('does not fire when flag stays active', () => {
      const onResolved = jest.fn();
      const hooks = buildMcpToolHooks(onResolved);
      const hook = hooks.get('update-feature-flag')!;

      hook.onSuccess({ flagKey: 'my-flag', data: { active: true } }, '');

      expect(onResolved).not.toHaveBeenCalled();
    });

    it('does not fire when data is missing', () => {
      const onResolved = jest.fn();
      const hooks = buildMcpToolHooks(onResolved);
      const hook = hooks.get('update-feature-flag')!;

      hook.onSuccess({ flagKey: 'my-flag' }, '');

      expect(onResolved).not.toHaveBeenCalled();
    });

    it('does not fire when flagKey is missing', () => {
      const onResolved = jest.fn();
      const hooks = buildMcpToolHooks(onResolved);
      const hook = hooks.get('update-feature-flag')!;

      hook.onSuccess({ data: { active: false } }, '');

      expect(onResolved).not.toHaveBeenCalled();
    });
  });

  describe('delete-feature-flag', () => {
    it('always fires both discovery prefixes', () => {
      const onResolved = jest.fn();
      const hooks = buildMcpToolHooks(onResolved);
      const hook = hooks.get('delete-feature-flag')!;

      hook.onSuccess({ flagKey: 'old-flag' }, '');

      expect(onResolved).toHaveBeenCalledWith('stale_flag:old-flag');
      expect(onResolved).toHaveBeenCalledWith('flag_rollback:old-flag');
    });

    it('does not fire when flagKey is missing', () => {
      const onResolved = jest.fn();
      const hooks = buildMcpToolHooks(onResolved);
      const hook = hooks.get('delete-feature-flag')!;

      hook.onSuccess({}, '');

      expect(onResolved).not.toHaveBeenCalled();
    });
  });

  describe('experiment-update', () => {
    it('fires when end_date is set', () => {
      const onResolved = jest.fn();
      const hooks = buildMcpToolHooks(onResolved);
      const hook = hooks.get('experiment-update')!;

      hook.onSuccess({ experimentId: 7, data: { end_date: '2026-01-01' } }, '');

      expect(onResolved).toHaveBeenCalledWith('experiment_result:7');
    });

    it('fires when conclusion is set', () => {
      const onResolved = jest.fn();
      const hooks = buildMcpToolHooks(onResolved);
      const hook = hooks.get('experiment-update')!;

      hook.onSuccess(
        { experimentId: 7, data: { conclusion: 'variant wins' } },
        '',
      );

      expect(onResolved).toHaveBeenCalledWith('experiment_result:7');
    });

    it('does not fire for other updates', () => {
      const onResolved = jest.fn();
      const hooks = buildMcpToolHooks(onResolved);
      const hook = hooks.get('experiment-update')!;

      hook.onSuccess({ experimentId: 7, data: { name: 'renamed' } }, '');

      expect(onResolved).not.toHaveBeenCalled();
    });

    it('does not fire when experimentId is missing', () => {
      const onResolved = jest.fn();
      const hooks = buildMcpToolHooks(onResolved);
      const hook = hooks.get('experiment-update')!;

      hook.onSuccess({ data: { end_date: '2026-01-01' } }, '');

      expect(onResolved).not.toHaveBeenCalled();
    });
  });

  describe('experiment-delete', () => {
    it('always fires on success', () => {
      const onResolved = jest.fn();
      const hooks = buildMcpToolHooks(onResolved);
      const hook = hooks.get('experiment-delete')!;

      hook.onSuccess({ experimentId: 42 }, '');

      expect(onResolved).toHaveBeenCalledWith('experiment_result:42');
    });

    it('does not fire when experimentId is missing', () => {
      const onResolved = jest.fn();
      const hooks = buildMcpToolHooks(onResolved);
      const hook = hooks.get('experiment-delete')!;

      hook.onSuccess({}, '');

      expect(onResolved).not.toHaveBeenCalled();
    });
  });
});
