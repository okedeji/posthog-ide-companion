import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProposeEditTool } from '../propose-edit';
import type { EditApprovalCallback } from '../propose-edit';
import type { ToolCall } from '../../types';

const mockExecuteCommand = vscode.commands.executeCommand as jest.Mock;

function makeCall(args: Record<string, unknown>): ToolCall {
  return { id: 'call-1', name: 'proposeEdit', arguments: args };
}

describe('ProposeEditTool', () => {
  let tmpDir: string;
  let approveAll: EditApprovalCallback;
  let rejectAll: EditApprovalCallback;

  beforeEach(async () => {
    jest.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pe-test-'));
    approveAll = jest.fn(async () => ({ action: 'approve' as const }));
    rejectAll = jest.fn(async () => ({ action: 'reject' as const }));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('execute', () => {
    it('should return error for empty path', async () => {
      const tool = new ProposeEditTool(tmpDir, approveAll);
      const result = await tool.execute(
        makeCall({ path: '', newContent: 'x' }),
      );
      expect(result).toBe('Error: path is required');
    });

    it('should return error for empty newContent', async () => {
      const tool = new ProposeEditTool(tmpDir, approveAll);
      const result = await tool.execute(
        makeCall({ path: 'file.ts', newContent: '' }),
      );
      expect(result).toBe('Error: newContent is required');
    });

    it('should reject paths outside the workspace', async () => {
      const tool = new ProposeEditTool(tmpDir, approveAll);
      const result = await tool.execute(
        makeCall({ path: '../../../etc/passwd', newContent: 'x' }),
      );
      expect(result).toBe('Error: path is outside the workspace');
    });

    it('should reject sensitive files', async () => {
      const tool = new ProposeEditTool(tmpDir, approveAll);
      const result = await tool.execute(
        makeCall({ path: '.env', newContent: 'x' }),
      );
      expect(result).toContain('sensitive files');
    });
  });

  describe('editing existing files', () => {
    it('should apply search-and-replace when approved', async () => {
      const filePath = path.join(tmpDir, 'app.ts');
      await fs.writeFile(filePath, 'const x = 1;\nconst y = 2;\n');

      const tool = new ProposeEditTool(tmpDir, approveAll);
      const result = await tool.execute(
        makeCall({
          path: 'app.ts',
          oldContent: 'const x = 1;',
          newContent: 'const x = 42;',
          description: 'Update x value',
        }),
      );

      expect(result).toContain('Edit applied to app.ts');
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'vscode.diff',
        expect.anything(),
        expect.anything(),
        '[PostHog Companion] app.ts',
      );

      const updated = await fs.readFile(filePath, 'utf-8');
      expect(updated).toBe('const x = 42;\nconst y = 2;\n');
    });

    it('should not write file when rejected', async () => {
      const filePath = path.join(tmpDir, 'app.ts');
      await fs.writeFile(filePath, 'const x = 1;\n');

      const tool = new ProposeEditTool(tmpDir, rejectAll);
      const result = await tool.execute(
        makeCall({
          path: 'app.ts',
          oldContent: 'const x = 1;',
          newContent: 'const x = 99;',
        }),
      );

      expect(result).toContain('Edit rejected');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('const x = 1;\n');
    });

    it('should return error when oldContent is not found', async () => {
      await fs.writeFile(path.join(tmpDir, 'app.ts'), 'hello');

      const tool = new ProposeEditTool(tmpDir, approveAll);
      const result = await tool.execute(
        makeCall({
          path: 'app.ts',
          oldContent: 'not in file',
          newContent: 'replacement',
        }),
      );

      expect(result).toContain('oldContent not found');
    });

    it('should return error when oldContent matches multiple locations', async () => {
      await fs.writeFile(path.join(tmpDir, 'app.ts'), 'foo\nfoo\n');

      const tool = new ProposeEditTool(tmpDir, approveAll);
      const result = await tool.execute(
        makeCall({
          path: 'app.ts',
          oldContent: 'foo',
          newContent: 'bar',
        }),
      );

      expect(result).toContain('multiple locations');
    });
  });

  describe('creating new files', () => {
    it('should create a new file when oldContent is omitted and approved', async () => {
      const tool = new ProposeEditTool(tmpDir, approveAll);
      const result = await tool.execute(
        makeCall({
          path: 'new-file.ts',
          newContent: 'export const hello = "world";',
        }),
      );

      expect(result).toContain('Edit applied to new-file.ts');
      const content = await fs.readFile(
        path.join(tmpDir, 'new-file.ts'),
        'utf-8',
      );
      expect(content).toBe('export const hello = "world";');
    });

    it('should return error when file already exists and oldContent is omitted', async () => {
      await fs.writeFile(path.join(tmpDir, 'exists.ts'), 'content');

      const tool = new ProposeEditTool(tmpDir, approveAll);
      const result = await tool.execute(
        makeCall({
          path: 'exists.ts',
          newContent: 'new content',
        }),
      );

      expect(result).toContain('file already exists');
    });
  });

  describe('dispose', () => {
    it('should clean up temp files', async () => {
      await fs.writeFile(path.join(tmpDir, 'app.ts'), 'const x = 1;');

      const tool = new ProposeEditTool(tmpDir, approveAll);
      await tool.execute(
        makeCall({
          path: 'app.ts',
          oldContent: 'const x = 1;',
          newContent: 'const x = 2;',
        }),
      );

      await tool.dispose();
      // No assertion - just verifying dispose doesn't throw
    });
  });
});
