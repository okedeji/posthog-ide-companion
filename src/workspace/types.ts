export type DetectionStatus = 'idle' | 'running' | 'complete' | 'failed';

export type SetupIssue = {
  checkId: string;
  title: string;
  description: string;
  evidence: string[];
  remediation: string;
};

export type WorkspaceInfo = {
  language: string;
  frameworks: string[];
  frameworkVersions: Record<string, string>;
  // e.g. { "next.js": { "router": "app" } }
  frameworkDetails: Record<string, Record<string, string>>;
  packageManager: string | null;
  testFrameworks: string[];
  buildTools: string[];
  projectStructure: 'monorepo' | 'single-package' | 'multi-package' | 'unknown';
  notablePatterns: string[];
  // High-level understanding of what this codebase does, who it serves,
  // and key business logic — gives the chat LLM immediate context.
  codebaseSummary: string;
  setupIssues: SetupIssue[];
  detectedAt: string; // ISO 8601
};
