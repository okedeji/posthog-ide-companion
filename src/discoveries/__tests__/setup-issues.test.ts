import type { SetupIssue } from '../../ai/types';
import { workspaceInfoToSetupDiscoveries } from '../scanners/setup-issues';

const NOW_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function makeIssue(overrides: Partial<SetupIssue> = {}): SetupIssue {
  return {
    checkId: 'posthog_not_integrated',
    title: 'PostHog not integrated',
    description: 'No PostHog SDK or HTTP integration found.',
    evidence: ['no posthog package in package.json'],
    remediation: 'Install posthog-js and initialize it in your app.',
    ...overrides,
  };
}

describe('workspaceInfoToSetupDiscoveries', () => {
  it('should return empty array for empty issues', () => {
    expect(workspaceInfoToSetupDiscoveries([])).toEqual([]);
  });

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
        remediation: 'Install posthog-js and initialize it in your app.',
      },
    });
  });

  it('should set firstSeen and lastSeen to current timestamp', () => {
    const discoveries = workspaceInfoToSetupDiscoveries([makeIssue()]);

    expect(discoveries[0]!.firstSeen).toMatch(NOW_RE);
    expect(discoveries[0]!.lastSeen).toMatch(NOW_RE);
    expect(discoveries[0]!.firstSeen).toBe(discoveries[0]!.lastSeen);
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

  it('should preserve evidence array from the issue', () => {
    const evidence = [
      'posthog-js found in package.json',
      'no captureExceptions config found',
    ];
    const discoveries = workspaceInfoToSetupDiscoveries([
      makeIssue({ evidence }),
    ]);

    expect(discoveries[0]!.source.evidence).toEqual(evidence);
  });
});
