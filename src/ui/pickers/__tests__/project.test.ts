import * as vscode from 'vscode';
import { showProjectPicker } from '../project';
import type { PostHogProject } from '../../../api/schemas';

const mockShowQuickPick = vscode.window.showQuickPick as jest.Mock;

const sampleProject: PostHogProject = {
  id: 1,
  name: 'Test Project',
  api_token: 'phc_test',
  organization: 'Test Org',
  uuid: 'uuid-1',
};

const sampleProject2: PostHogProject = {
  id: 2,
  name: 'Other Project',
  api_token: 'phc_other',
  organization: 'Test Org',
  uuid: 'uuid-2',
};

describe('showProjectPicker', () => {
  beforeEach(() => {
    mockShowQuickPick.mockReset();
  });

  it('should return the selected project', async () => {
    mockShowQuickPick.mockResolvedValue({
      label: 'Test Project',
      description: 'ID: 1',
      project: sampleProject,
    });

    const result = await showProjectPicker([sampleProject, sampleProject2]);

    expect(result).toEqual(sampleProject);
  });

  it('returns undefined when user cancels', async () => {
    mockShowQuickPick.mockResolvedValue(undefined);

    const result = await showProjectPicker([sampleProject]);

    expect(result).toBeUndefined();
  });

  it('should pass projects as quick pick items', async () => {
    mockShowQuickPick.mockResolvedValue(undefined);

    await showProjectPicker([sampleProject, sampleProject2]);

    const items = mockShowQuickPick.mock.calls[0][0] as {
      label: string;
      description: string;
    }[];
    expect(items).toHaveLength(2);
    expect(items[0]?.label).toBe('Test Project');
    expect(items[0]?.description).toBe('ID: 1');
    expect(items[1]?.label).toBe('Other Project');
    expect(items[1]?.description).toBe('ID: 2');
  });
});
