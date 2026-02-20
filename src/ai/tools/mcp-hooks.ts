export type McpToolHook = {
  onSuccess: (args: Record<string, unknown>, result: string) => void;
};

export type McpToolHooks = Map<string, McpToolHook>;

export function buildMcpToolHooks(
  onDiscoveryResolved: (discoveryId: string) => void,
): McpToolHooks {
  const hooks: McpToolHooks = new Map();

  // MCP uses flagKey (string) for feature flags
  hooks.set('update-feature-flag', {
    onSuccess: (args) => {
      const key = args['flagKey'] as string | undefined;
      const data = args['data'] as Record<string, unknown> | undefined;
      if (!key || data?.['active'] !== false) {
        return;
      }
      onDiscoveryResolved(`stale_flag:${key}`);
      onDiscoveryResolved(`flag_rollback:${key}`);
    },
  });

  hooks.set('delete-feature-flag', {
    onSuccess: (args) => {
      const key = args['flagKey'] as string | undefined;
      if (!key) {
        return;
      }
      onDiscoveryResolved(`stale_flag:${key}`);
      onDiscoveryResolved(`flag_rollback:${key}`);
    },
  });

  // MCP uses experimentId (number) for experiments
  hooks.set('experiment-update', {
    onSuccess: (args) => {
      const id = args['experimentId'] as number | undefined;
      if (id == null) {
        return;
      }
      const data = args['data'] as Record<string, unknown> | undefined;
      if (data?.['end_date'] != null || data?.['conclusion'] != null) {
        onDiscoveryResolved(`experiment_result:${id}`);
      }
    },
  });

  hooks.set('experiment-delete', {
    onSuccess: (args) => {
      const id = args['experimentId'] as number | undefined;
      if (id == null) {
        return;
      }
      onDiscoveryResolved(`experiment_result:${id}`);
    },
  });

  return hooks;
}
