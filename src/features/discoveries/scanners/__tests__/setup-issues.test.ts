import type { SetupIssue } from '../../../../workspace/types';
import { workspaceInfoToSetupDiscoveries } from '../setup-issues';

function makeIssue(overrides: Partial<SetupIssue> = {}): SetupIssue {
  return {
    checkId: 'posthog_not_integrated',
    title: 'PostHog not integrated',
    description: 'No PostHog SDK or HTTP integration found.',
    evidence: ['no posthog package in package.json'],
    ...overrides,
  };
}

describe('workspaceInfoToSetupDiscoveries', () => {
  it('should convert a single issue to a discovery', () => {
    const issues = [makeIssue()];
    const discoveries = workspaceInfoToSetupDiscoveries(issues);

    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]).toMatchObject({
      id: 'setup_issue:posthog_not_integrated',
      kind: 'setup_issue',
      title: 'PostHog not integrated',
      description: 'No PostHog SDK or HTTP integration found.',
      severity: 'warning',
      source: {
        checkId: 'posthog_not_integrated',
        evidence: ['no posthog package in package.json'],
      },
    });
  });

  it('should convert multiple issues with unique ids', () => {
    const issues = [
      makeIssue({ checkId: 'posthog_not_integrated' }),
      makeIssue({ checkId: 'error_capture_not_configured' }),
      makeIssue({ checkId: 'source_maps_not_configured' }),
    ];

    const discoveries = workspaceInfoToSetupDiscoveries(issues);

    expect(discoveries).toHaveLength(3);
    expect(discoveries.map((d) => d.id)).toEqual([
      'setup_issue:posthog_not_integrated',
      'setup_issue:error_capture_not_configured',
      'setup_issue:source_maps_not_configured',
    ]);
  });

  it('should assign info severity to suggestion checks', () => {
    const infoCheckIds = ['no_custom_events', 'no_feature_flags'];

    for (const checkId of infoCheckIds) {
      const discoveries = workspaceInfoToSetupDiscoveries([
        makeIssue({ checkId }),
      ]);
      expect(discoveries[0]?.severity).toBe('info');
    }
  });

  it('should assign warning severity to problem checks', () => {
    const warningCheckIds = [
      'no_user_identification',
      'debug_mode_enabled',
      'spa_pageview_not_configured',
    ];

    for (const checkId of warningCheckIds) {
      const discoveries = workspaceInfoToSetupDiscoveries([
        makeIssue({ checkId }),
      ]);
      expect(discoveries[0]?.severity).toBe('warning');
    }
  });

  it('should produce unique discovery ids for all eight check types', () => {
    const allCheckIds = [
      'posthog_not_integrated',
      'error_capture_not_configured',
      'source_maps_not_configured',
      'no_user_identification',
      'no_custom_events',
      'debug_mode_enabled',
      'spa_pageview_not_configured',
      'no_feature_flags',
    ];

    const issues = allCheckIds.map((checkId) => makeIssue({ checkId }));
    const discoveries = workspaceInfoToSetupDiscoveries(issues);

    expect(discoveries).toHaveLength(8);
    const ids = discoveries.map((d) => d.id);
    expect(new Set(ids).size).toBe(8);
    expect(ids).toEqual(allCheckIds.map((id) => `setup_issue:${id}`));
  });
});
