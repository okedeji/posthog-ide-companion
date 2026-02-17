import type { SetupIssue } from '../../../../workspace/types';
import { workspaceInfoToSetupDiscoveries } from '../setup-issues';

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
});
