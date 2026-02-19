import * as vscode from 'vscode';
import type { CloudRegion } from '../../auth/constants';

export async function showCloudRegionPicker(): Promise<
  CloudRegion | undefined
> {
  const items: (vscode.QuickPickItem & { region: CloudRegion })[] = [
    {
      label: '$(cloud) US Cloud',
      description: 'us.posthog.com',
      region: 'us',
    },
    {
      label: '$(cloud) EU Cloud',
      description: 'eu.posthog.com',
      region: 'eu',
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select your PostHog Cloud region',
    ignoreFocusOut: true,
  });

  return picked?.region;
}
