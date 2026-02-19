import * as vscode from 'vscode';
import { showCloudRegionPicker } from '../cloud-region';

const mockShowQuickPick = vscode.window.showQuickPick as jest.Mock;

describe('showCloudRegionPicker', () => {
  beforeEach(() => {
    mockShowQuickPick.mockReset();
  });

  it('should return the selected region', async () => {
    mockShowQuickPick.mockResolvedValue({
      label: '$(cloud) EU Cloud',
      description: 'eu.posthog.com',
      region: 'eu',
    });

    const result = await showCloudRegionPicker();

    expect(result).toBe('eu');
  });

  it('returns undefined when user cancels', async () => {
    mockShowQuickPick.mockResolvedValue(undefined);

    const result = await showCloudRegionPicker();

    expect(result).toBeUndefined();
  });

  it('should present US and EU options', async () => {
    mockShowQuickPick.mockResolvedValue(undefined);

    await showCloudRegionPicker();

    const items = mockShowQuickPick.mock.calls[0][0] as {
      label: string;
      description: string;
      region: string;
    }[];
    expect(items).toHaveLength(2);
    expect(items[0]?.region).toBe('us');
    expect(items[1]?.region).toBe('eu');
  });
});
