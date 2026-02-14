import * as crypto from 'crypto';
import type { PostHogProject } from './schemas';
import type { CloudRegion } from './constants';
import { CLOUD_URLS } from './constants';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const STYLES = /* css */ `
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  padding: 16px 14px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: transparent;
  line-height: 1.4;
}

/* ---- Header ---- */

.header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.avatar {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: transparent;
  border: 1.5px solid var(--vscode-widget-border, var(--vscode-panel-border));
  color: var(--vscode-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  flex-shrink: 0;
  letter-spacing: -0.5px;
}

.header-text {
  min-width: 0;
  flex: 1;
}

.project-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground);
  line-height: 1.3;
  word-break: break-word;
}

.project-org {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  margin-top: 1px;
  word-break: break-word;
}

/* ---- Section labels ---- */

.section-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 8px;
  padding-left: 2px;
}

/* ---- Info card ---- */

.card {
  border-radius: 8px;
  border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  overflow: hidden;
  margin-bottom: 20px;
}

.card-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 9px 12px;
  gap: 12px;
  transition: background 0.12s ease;
}

.card-row:hover {
  background: var(--vscode-list-hoverBackground);
}

.card-row + .card-row {
  border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
}

.card-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--vscode-descriptionForeground);
  opacity: 0.7;
}

.card-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.card-label {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  flex-shrink: 0;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
  50% { opacity: 0.85; box-shadow: 0 0 0 4px rgba(34, 197, 94, 0); }
}

.card-value {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vscode-foreground);
  text-align: right;
  word-break: break-word;
  min-width: 0;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.4px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}

/* ---- Actions ---- */

.actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  padding: 8px 14px;
  border: none;
  border-radius: 6px;
  font-family: var(--vscode-font-family);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

button:active {
  transform: scale(0.98);
}

button svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.btn-primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.btn-primary:hover {
  background: var(--vscode-button-hoverBackground);
}

.btn-link {
  background: transparent;
  color: var(--vscode-textLink-foreground);
  padding: 6px 14px;
}

.btn-link:hover {
  color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
  text-decoration: underline;
}

.btn-secondary {
  background: transparent;
  color: var(--vscode-descriptionForeground);
  padding: 6px 14px;
}

.btn-secondary:hover {
  color: var(--vscode-foreground);
  background: var(--vscode-list-hoverBackground);
}

/* ---- Footer ---- */

.footer {
  margin-top: 24px;
  padding-top: 12px;
  border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  text-align: center;
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.6;
}`;

// ---------------------------------------------------------------------------
// Inline SVG icons (14x14, currentColor)
// ---------------------------------------------------------------------------

const ICON_SWITCH = /* html */ `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3L3 6l3 3"/><path d="M3 6h10"/><path d="M10 13l3-3-3-3"/><path d="M13 10H3"/></svg>`;

const ICON_SIGN_OUT = /* html */ `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14H3a1 1 0 01-1-1V3a1 1 0 011-1h3"/><path d="M10 11l3-3-3-3"/><path d="M13 8H6"/></svg>`;

const ICON_EXTERNAL = /* html */ `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1h4"/><path d="M8 8L14 2"/><path d="M10 2h4v4"/></svg>`;

const ICON_GLOBE = /* html */ `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M2 8h12"/><path d="M8 2a10 10 0 013 6 10 10 0 01-3 6"/><path d="M8 2a10 10 0 00-3 6 10 10 0 003 6"/></svg>`;

const ICON_ID = /* html */ `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12"/><path d="M2 8h12"/><path d="M2 12h8"/></svg>`;

const ICON_STATUS = /* html */ `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12l3-4 3 2 4-6"/><circle cx="14" cy="4" r="1.5"/></svg>`;

// ---------------------------------------------------------------------------
// HTML builders
// ---------------------------------------------------------------------------

/**
 * Builds the project details HTML with a Content Security Policy.
 * Uses a nonce to allow only our inline script.
 *
 * @param project - The active PostHog project.
 * @param region - The cloud region (e.g. "us", "eu").
 * @returns Complete HTML document string.
 */
export function buildProjectHtml(
  project: PostHogProject,
  region: string | undefined,
): string {
  const nonce = getNonce();
  const regionLabel = region?.toUpperCase() ?? 'Unknown';
  const initial = project.name.charAt(0).toUpperCase();
  const dashboardUrl =
    region && region in CLOUD_URLS
      ? `${CLOUD_URLS[region as CloudRegion]}/project/${String(project.id)}`
      : undefined;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>${STYLES}</style>
</head>
<body>
  <div class="header">
    <div class="avatar">${escapeHtml(initial)}</div>
    <div class="header-text">
      <div class="project-name">${escapeHtml(project.name)}</div>
      <div class="project-org">${escapeHtml(project.organization)}</div>
    </div>
  </div>

  <div class="section-label">Details</div>
  <div class="card">
    <div class="card-row">
      <span class="card-left">
        <span class="card-icon">${ICON_STATUS}</span>
        <span class="card-label">Status</span>
      </span>
      <span class="card-value"><span class="status-dot"></span> Connected</span>
    </div>
    <div class="card-row">
      <span class="card-left">
        <span class="card-icon">${ICON_GLOBE}</span>
        <span class="card-label">Region</span>
      </span>
      <span class="card-value"><span class="badge">${escapeHtml(regionLabel)}</span></span>
    </div>
    <div class="card-row">
      <span class="card-left">
        <span class="card-icon">${ICON_ID}</span>
        <span class="card-label">Project ID</span>
      </span>
      <span class="card-value">${String(project.id)}</span>
    </div>
  </div>

  <div class="section-label">Actions</div>
  <div class="actions">
    <button class="btn-primary" id="switchProject">${ICON_SWITCH} Switch Project</button>${
      dashboardUrl
        ? `
    <button class="btn-link" id="openDashboard">${ICON_EXTERNAL} Open in PostHog</button>`
        : ''
    }
    <button class="btn-secondary" id="signOut">${ICON_SIGN_OUT} Sign Out</button>
  </div>

  <div class="footer">PostHog IDE Companion</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('switchProject')
      .addEventListener('click', () => vscode.postMessage({ command: 'switchProject' }));
    document.getElementById('signOut')
      .addEventListener('click', () => vscode.postMessage({ command: 'signOut' }));
    const openBtn = document.getElementById('openDashboard');
    if (openBtn) {
      openBtn.addEventListener('click', () => vscode.postMessage({ command: 'openDashboard' }));
    }
  </script>
</body>
</html>`;
}

/**
 * Builds the empty-state HTML shown when no project is selected.
 *
 * @returns Complete HTML document string.
 */
export function buildEmptyHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      padding: 40px 20px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-descriptionForeground);
      background: transparent;
      text-align: center;
    }
    .empty-icon {
      width: 56px;
      height: 56px;
      margin: 0 auto 16px;
      opacity: 0.35;
    }
    .empty-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 6px;
    }
    .empty-desc {
      font-size: 12px;
      line-height: 1.6;
      max-width: 200px;
      margin: 0 auto;
    }
  </style>
</head>
<body>
  <svg class="empty-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="6" y="10" width="36" height="28" rx="3"/>
    <path d="M6 18h36"/>
    <circle cx="12" cy="14" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="18" cy="14" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="24" cy="14" r="1.5" fill="currentColor" stroke="none"/>
    <path d="M18 28h12"/>
    <path d="M22 32h4"/>
  </svg>
  <div class="empty-title">No project selected</div>
  <div class="empty-desc">Sign in and select a project to get started.</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Escapes HTML special characters to prevent XSS in template interpolation. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Generates a cryptographic nonce for Content Security Policy. */
function getNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}
