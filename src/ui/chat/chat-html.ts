import type * as vscode from 'vscode';

/**
 * Generates the full HTML document for the chat webview.
 * Uses VSCode CSS custom properties for automatic theme support.
 * @param webview - The webview to generate HTML for (used for CSP source)
 * @param _extensionUri - The extension's base URI (reserved for future asset loading)
 * @returns Complete HTML string
 */
export function getChatHtml(
  webview: vscode.Webview,
  _extensionUri: vscode.Uri,
): string {
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">${STYLES}</style>
</head>
<body>
  <div id="root">
    <div id="header">
      <button id="new-chat-btn" title="New chat">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M14 7H9V2H7v5H2v2h5v5h2V9h5V7z"/>
        </svg>
        New Chat
      </button>
      <button id="history-btn" title="Chat history">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11zM8.5 4H7v4.5l3.5 2.1.8-1.2L8.5 7.5V4z"/>
        </svg>
        History
      </button>
    </div>
    <div id="session-list" class="hidden"></div>
    <div id="messages">
      <div id="streaming" class="hidden"></div>
    </div>
    <div id="consent-dialog" class="hidden"></div>
    <div id="error-toast" class="hidden"></div>
    <div id="input-area">
      <div id="context-banner" class="hidden"></div>
      <textarea
        id="input"
        placeholder="Ask about your PostHog data, codebase, or errors..."
        rows="1"
      ></textarea>
      <div id="input-footer">
        <span id="input-hint"><kbd>Enter</kbd> to send, <kbd>Shift+Enter</kbd> for new line</span>
        <button id="send-btn" title="Send message (Enter)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 1.5L15 8L1 14.5V9.5L10 8L1 6.5V1.5Z"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}

function getNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const STYLES = `
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    height: 100vh;
    overflow: hidden;
  }

  #root {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  /* --- Header --- */
  #header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
  }

  #header button {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-font-family);
    font-size: 11px;
    cursor: pointer;
  }

  #header button:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15));
    color: var(--vscode-foreground);
  }

  /* --- Session list (history) --- */
  #session-list {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }

  .session-list-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .session-item {
    padding: 8px 10px;
    border-radius: 4px;
    cursor: pointer;
    margin-bottom: 2px;
  }

  .session-item:hover {
    background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.1));
  }

  .session-item .session-title {
    font-size: 13px;
    color: var(--vscode-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-item .session-meta {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-top: 2px;
  }

  .session-list-empty {
    text-align: center;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    padding: 24px;
  }

  /* --- Context quote (above input) --- */
  #context-banner {
    margin: 8px 12px 0;
    padding: 6px 10px;
    border-left: 3px solid var(--vscode-notificationsInfoIcon-foreground, #3794ff);
    background: var(--context-bg, rgba(128,128,128,0.1));
    border-radius: 0 4px 4px 0;
    font-size: 12px;
    display: flex;
    align-items: flex-start;
    gap: 6px;
    color: var(--vscode-foreground);
  }

  #context-banner .context-body {
    flex: 1;
    min-width: 0;
  }

  #context-banner .context-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  #context-banner .kind {
    text-transform: uppercase;
    font-weight: 600;
    font-size: 10px;
    flex-shrink: 0;
  }

  #context-banner .context-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    font-weight: 500;
  }

  #context-banner .context-detail {
    margin-top: 2px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
  }

  #context-banner .context-detail.collapsed {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  #context-banner .dismiss {
    cursor: pointer;
    opacity: 0.5;
    background: none;
    border: none;
    color: var(--vscode-foreground);
    font-size: 14px;
    flex-shrink: 0;
    padding: 0 2px;
    margin-top: 1px;
  }

  #context-banner .dismiss:hover { opacity: 1; }

  /* --- Messages --- */
  #messages {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .message {
    max-width: 100%;
    line-height: 1.5;
  }

  .message.user {
    align-self: flex-start;
    background: var(--vscode-input-background, rgba(128,128,128,0.1));
    color: var(--vscode-foreground);
    padding: 8px 12px;
    border-radius: 2px 12px 12px 12px;
    max-width: 85%;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .message.user .msg-context {
    border-left: 2px solid var(--vscode-notificationsInfoIcon-foreground, #3794ff);
    padding: 4px 8px;
    margin-bottom: 6px;
    font-size: 11px;
    border-radius: 0 3px 3px 0;
    background: rgba(55, 148, 255, 0.08);
    white-space: normal;
  }

  .message.user .msg-context.severity-critical {
    border-left-color: var(--vscode-testing-iconFailed, #f44);
    background: rgba(255, 68, 68, 0.08);
  }

  .message.user .msg-context.severity-warning {
    border-left-color: var(--vscode-list-warningForeground, #cca700);
    background: rgba(204, 167, 0, 0.08);
  }

  .message.user .msg-context.severity-info {
    border-left-color: var(--vscode-notificationsInfoIcon-foreground, #3794ff);
    background: rgba(55, 148, 255, 0.08);
  }

  .message.user .msg-context .msg-ctx-kind {
    text-transform: uppercase;
    font-weight: 600;
    font-size: 10px;
    margin-right: 4px;
    color: var(--vscode-notificationsInfoIcon-foreground, #3794ff);
  }

  .message.user .msg-context.severity-critical .msg-ctx-kind {
    color: var(--vscode-testing-iconFailed, #f44);
  }

  .message.user .msg-context.severity-warning .msg-ctx-kind {
    color: var(--vscode-list-warningForeground, #cca700);
  }

  .message.user .msg-context .msg-ctx-title {
    font-weight: 500;
  }

  .message.user .msg-context .msg-ctx-detail {
    margin-top: 2px;
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
  }

  .message.assistant {
    align-self: flex-start;
    padding: 4px 0;
  }

  .message.assistant .content,
  .streaming-text {
    word-break: break-word;
  }

  .message.assistant .content h3,
  .message.assistant .content h4,
  .streaming-text h3,
  .streaming-text h4 {
    margin: 8px 0 4px;
    font-size: 1em;
  }

  .message.assistant .content h3,
  .streaming-text h3 { font-size: 1.1em; }

  .message.assistant .content p,
  .streaming-text p {
    margin: 4px 0;
  }

  .message.assistant .content ul,
  .message.assistant .content ol,
  .streaming-text ul,
  .streaming-text ol {
    margin: 4px 0 4px 20px;
  }

  .message.assistant .content pre,
  .streaming-text pre {
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15));
    padding: 8px 10px;
    border-radius: 4px;
    overflow-x: auto;
    margin: 6px 0;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    white-space: pre;
  }

  .message.assistant .content code,
  .streaming-text code {
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15));
    padding: 1px 4px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.92em;
  }

  .message.assistant .content pre code,
  .streaming-text pre code {
    background: none;
    padding: 0;
  }

  .message.assistant .content em,
  .streaming-text em {
    font-style: italic;
    opacity: 0.5;
  }

  .message.assistant .content a,
  .streaming-text a {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
  }

  .message.assistant .content a:hover,
  .streaming-text a:hover {
    text-decoration: underline;
  }

  /* --- Tool activity --- */
  .tool-activity {
    margin: 6px 0;
  }

  .tool-activity details {
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
    border-radius: 4px;
    margin: 2px 0;
  }

  .tool-activity summary {
    padding: 4px 8px;
    cursor: pointer;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    user-select: none;
    list-style: none;
  }

  .tool-activity summary::before {
    content: '\\25B6';
    display: inline-block;
    margin-right: 6px;
    font-size: 9px;
    transition: transform 0.15s;
  }

  .tool-activity details[open] summary::before {
    transform: rotate(90deg);
  }

  .tool-activity .tool-args {
    padding: 4px 8px;
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace);
    white-space: pre-wrap;
    word-break: break-word;
    border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
    color: var(--vscode-descriptionForeground);
    opacity: 0.8;
  }

  .tool-activity .tool-result {
    padding: 6px 8px;
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow-y: auto;
    border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
    color: var(--vscode-descriptionForeground);
  }

  /* --- Streaming / working indicator --- */
  #streaming {
    padding: 0;
  }

  .working-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    padding: 4px 0;
  }

  .pulse-dots {
    display: flex;
    gap: 3px;
    align-items: center;
  }

  .pulse-dots span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--vscode-descriptionForeground);
    animation: pulse 1.4s ease-in-out infinite;
  }

  .pulse-dots span:nth-child(2) { animation-delay: 0.2s; }
  .pulse-dots span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes pulse {
    0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
    40% { opacity: 1; transform: scale(1.1); }
  }

  .streaming-text {
    line-height: 1.5;
    padding: 4px 0;
  }

  /* --- Consent dialog --- */
  #consent-dialog {
    margin: 8px 12px;
    border: 1px solid var(--vscode-inputValidation-warningBorder, #cca700);
    border-radius: 6px;
    padding: 12px;
    background: var(--vscode-inputValidation-warningBackground, rgba(204,167,0,0.1));
  }

  #consent-dialog .consent-title {
    font-weight: 600;
    margin-bottom: 6px;
    font-size: 13px;
  }

  #consent-dialog .consent-args {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15));
    padding: 6px 8px;
    border-radius: 4px;
    margin: 6px 0 10px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 150px;
    overflow-y: auto;
  }

  .consent-buttons {
    display: flex;
    gap: 8px;
  }

  .consent-buttons button {
    padding: 4px 14px;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
  }

  .consent-buttons .approve {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  .consent-buttons .approve:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .consent-buttons .reject {
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.3));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }

  .consent-buttons .reject:hover {
    opacity: 0.9;
  }

  .consent-buttons .modify {
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.3));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }

  .consent-buttons .modify:hover {
    opacity: 0.9;
  }

  .consent-modify-input {
    width: 100%;
    resize: none;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, rgba(128,128,128,0.35)));
    border-radius: 4px;
    padding: 6px 8px;
    font-family: var(--vscode-font-family);
    font-size: 12px;
    line-height: 1.4;
  }

  .consent-modify-input:focus {
    outline: none;
    border-color: var(--vscode-focusBorder);
  }

  .consent-buttons .modify-submit {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  .consent-buttons .modify-submit:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .consent-buttons .modify-cancel {
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.3));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }

  .tool-feedback {
    font-size: 11px;
    font-style: italic;
    opacity: 0.5;
    margin: 2px 0 4px 8px;
  }

  /* --- Error toast --- */
  #error-toast {
    margin: 8px 12px;
    padding: 8px 12px;
    background: var(--vscode-inputValidation-errorBackground, rgba(255,0,0,0.1));
    border: 1px solid var(--vscode-inputValidation-errorBorder, #f44);
    border-radius: 4px;
    font-size: 12px;
    color: var(--vscode-errorForeground, #f44);
  }

  /* --- Input area --- */
  #input-area {
    flex-shrink: 0;
    margin: 8px 16px 18px;
    max-width: 600px;
    align-self: center;
    width: calc(100% - 32px);
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, rgba(128,128,128,0.35)));
    border-radius: 8px;
    background: var(--vscode-input-background);
    display: flex;
    flex-direction: column;
    transition: border-color 0.15s;
  }

  #input-area:focus-within {
    border-color: var(--vscode-focusBorder);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder);
  }

  #input {
    resize: none;
    background: transparent;
    color: var(--vscode-input-foreground);
    border: none;
    padding: 8px 12px 4px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    line-height: 1.4;
    min-height: calc(1.9 * 1.4em);
    overflow: hidden;
  }

  #input:focus {
    outline: none;
  }

  #input::placeholder {
    color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
  }

  #input-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px 6px;
  }

  #input-hint {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.7;
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  #input-hint kbd {
    font-family: var(--vscode-font-family);
    font-size: 10px;
    padding: 1px 4px;
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
    border-radius: 3px;
    background: var(--vscode-badge-background, rgba(128,128,128,0.15));
    color: var(--vscode-descriptionForeground);
  }

  #send-btn {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  #send-btn:hover {
    background: var(--vscode-button-hoverBackground);
  }

  #send-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* --- Empty state --- */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 8px;
    color: var(--vscode-descriptionForeground);
    text-align: center;
    padding: 24px;
  }

  .empty-state .title {
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }

  .empty-state .subtitle {
    font-size: 12px;
    max-width: 260px;
  }

  .hidden { display: none !important; }
`;

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

const SCRIPT = `
(function() {
  const vscode = acquireVsCodeApi();

  // --- State ---
  const state = {
    messages: [],
    isProcessing: false,
    streamBlocks: [],   // chronological: { type:'text', content } | { type:'tool', name, pending, result?, durationMs? }
    activeTextIdx: -1,  // index of the text block currently being streamed (-1 = none)
    consentRequest: null,
    contextBanner: null,
  };

  var thinkingPhrases = [
    'Thinking',
    'Analyzing',
    'Researching',
    'Processing',
    'Looking into it',
    'Working on it',
    'Gathering context',
    'Reasoning',
  ];
  var thinkingIndex = 0;
  var thinkingInterval = null;

  // --- DOM refs ---
  const messagesEl = document.getElementById('messages');
  const streamingEl = document.getElementById('streaming');
  const consentEl = document.getElementById('consent-dialog');
  const errorEl = document.getElementById('error-toast');
  const bannerEl = document.getElementById('context-banner');
  const sessionListEl = document.getElementById('session-list');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('send-btn');
  const newChatBtn = document.getElementById('new-chat-btn');
  const historyBtn = document.getElementById('history-btn');

  // --- Message handling ---
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'history':
        var prev = state.messages;
        state.messages = msg.messages;
        // Preserve context from optimistic user messages (not in SessionMessage)
        for (var ci = 0; ci < state.messages.length && ci < prev.length; ci++) {
          if (prev[ci].context && state.messages[ci].role === 'user') {
            state.messages[ci].context = prev[ci].context;
          }
        }
        state.streamBlocks = [];
        state.activeTextIdx = -1;
        stopThinkingRotation();
        hideSessionList();
        renderMessages();
        hideEl(streamingEl);
        break;

      case 'agent_event':
        handleAgentEvent(msg.event);
        break;

      case 'consent_request':
        state.consentRequest = {
          callId: msg.callId,
          toolName: msg.toolName,
          args: msg.args,
        };
        renderConsentDialog();
        break;

      case 'state':
        state.isProcessing = msg.isProcessing;
        updateInputState();
        if (!msg.isProcessing) {
          state.streamBlocks = [];
          state.activeTextIdx = -1;
          stopThinkingRotation();
          hideEl(streamingEl);
        }
        break;

      case 'error':
        showError(msg.message);
        break;

      case 'context_loaded':
        state.contextBanner = { title: msg.title, detail: msg.detail, kind: msg.kind, severity: msg.severity };
        renderContextBanner();
        break;

      case 'session_list':
        renderSessionList(msg.sessions);
        break;
    }
  });

  function handleAgentEvent(event) {
    switch (event.type) {
      case 'iteration_start':
        state.isProcessing = true;
        state.activeTextIdx = -1;
        updateInputState();
        renderStreaming();
        break;

      case 'tool_call_start':
        state.activeTextIdx = -1;
        state.streamBlocks.push({
          type: 'tool',
          name: event.call.name,
          args: event.call.arguments,
          pending: true,
        });
        renderStreaming();
        break;

      case 'tool_call_result':
        for (var i = state.streamBlocks.length - 1; i >= 0; i--) {
          var b = state.streamBlocks[i];
          if (b.type === 'tool' && b.name === event.call.name && b.pending) {
            b.pending = false;
            b.result = event.result;
            b.durationMs = event.durationMs;
            break;
          }
        }
        renderStreaming();
        break;

      case 'text_response':
        if (state.activeTextIdx >= 0) {
          state.streamBlocks[state.activeTextIdx].content = event.content;
        } else {
          state.activeTextIdx = state.streamBlocks.length;
          state.streamBlocks.push({ type: 'text', content: event.content });
        }
        renderStreaming();
        break;

      case 'complete':
        break;

      case 'error':
        showError(event.error);
        break;
    }
  }

  // --- Rendering ---
  function renderMessages() {
    // Detach streaming element before replacing innerHTML
    if (streamingEl.parentNode === messagesEl) {
      messagesEl.removeChild(streamingEl);
    }

    if (state.messages.length === 0) {
      messagesEl.innerHTML = '<div class="empty-state">'
        + '<div class="title">PostHog Companion</div>'
        + '<div class="subtitle">Ask about analytics, errors, feature flags, or your codebase.</div>'
        + '</div>';
    } else {
      messagesEl.innerHTML = state.messages.map(renderMessage).join('');
    }

    // Re-append streaming element so it always sits below messages
    messagesEl.appendChild(streamingEl);
    scrollToBottom();
  }

  function renderMessage(msg) {
    if (msg.role === 'user') {
      var ctxHtml = '';
      if (msg.context) {
        var sev = msg.context.severity || 'info';
        var detailPart = msg.context.detail
          ? '<div class="msg-ctx-detail">' + escapeHtml(msg.context.detail) + '</div>'
          : '';
        ctxHtml = '<div class="msg-context severity-' + escapeHtml(sev) + '">'
          + '<span class="msg-ctx-kind">' + escapeHtml(msg.context.kind) + '</span>'
          + '<span class="msg-ctx-title">' + escapeHtml(msg.context.title) + '</span>'
          + detailPart
          + '</div>';
      }
      return '<div class="message user">' + ctxHtml + escapeHtml(msg.content) + '</div>';
    }

    let html = '<div class="message assistant">';

    if (msg.blocks && msg.blocks.length > 0) {
      for (const block of msg.blocks) {
        if (block.type === 'text') {
          html += '<div class="content">' + renderMarkdown(block.content) + '</div>';
        } else if (block.type === 'tool') {
          var duration = block.durationMs
            ? ' (' + (block.durationMs / 1000).toFixed(1) + 's)'
            : '';
          var truncated = truncateResult(block.result);
          html += '<div class="tool-activity"><details>'
            + '<summary>' + escapeHtml(block.name) + duration + '</summary>'
            + formatArgs(block.arguments)
            + '<div class="tool-result">' + escapeHtml(truncated) + '</div>'
            + '</details></div>';
          if (block.feedback) {
            html += '<div class="tool-feedback">' + escapeHtml(block.feedback) + '</div>';
          }
        }
      }
    } else if (msg.toolActivity && msg.toolActivity.length > 0) {
      // Fallback for old messages without blocks
      html += '<div class="tool-activity">';
      for (const activity of msg.toolActivity) {
        var duration = activity.durationMs
          ? ' (' + (activity.durationMs / 1000).toFixed(1) + 's)'
          : '';
        var truncated = truncateResult(activity.result);
        html += '<details>'
          + '<summary>' + escapeHtml(activity.name) + duration + '</summary>'
          + formatArgs(activity.arguments)
          + '<div class="tool-result">' + escapeHtml(truncated) + '</div>'
          + '</details>';
      }
      html += '</div>';
      html += '<div class="content">' + renderMarkdown(msg.content) + '</div>';
    } else {
      html += '<div class="content">' + renderMarkdown(msg.content) + '</div>';
    }

    html += '</div>';
    return html;
  }

  var pulseDots = '<div class="pulse-dots"><span></span><span></span><span></span></div>';

  function startThinkingRotation() {
    if (thinkingInterval) return;
    thinkingIndex = 0;
    thinkingInterval = setInterval(function() {
      thinkingIndex = (thinkingIndex + 1) % thinkingPhrases.length;
      var el = document.getElementById('thinking-text');
      if (el) el.textContent = thinkingPhrases[thinkingIndex];
    }, 2500);
  }

  function stopThinkingRotation() {
    if (thinkingInterval) {
      clearInterval(thinkingInterval);
      thinkingInterval = null;
    }
  }

  function renderStreaming() {
    if (!state.isProcessing && state.streamBlocks.length === 0) {
      stopThinkingRotation();
      hideEl(streamingEl);
      return;
    }

    let html = '';

    // Render blocks in chronological order
    for (var i = 0; i < state.streamBlocks.length; i++) {
      var block = state.streamBlocks[i];
      if (block.type === 'text') {
        html += '<div class="streaming-text">'
          + renderMarkdown(closeOpenCodeBlock(block.content))
          + '</div>';
      } else if (block.type === 'tool') {
        if (block.pending) {
          html += '<div class="working-indicator">'
            + pulseDots
            + '<span>Using ' + escapeHtml(block.name) + '...</span>'
            + '</div>';
        } else {
          var duration = block.durationMs
            ? ' (' + (block.durationMs / 1000).toFixed(1) + 's)'
            : '';
          var truncated = truncateResult(block.result || '');
          html += '<div class="tool-activity"><details>'
            + '<summary>' + escapeHtml(block.name) + duration + '</summary>'
            + formatArgs(block.args)
            + '<div class="tool-result">' + escapeHtml(truncated) + '</div>'
            + '</details></div>';
          if (block.feedback) {
            html += '<div class="tool-feedback">' + escapeHtml(block.feedback) + '</div>';
          }
        }
      }
    }

    // Thinking indicator: show throughout processing, hide only when done or a tool is pending
    var hasPending = state.streamBlocks.some(function(b) { return b.type === 'tool' && b.pending; });
    if (state.isProcessing && !hasPending) {
      startThinkingRotation();
      html += '<div class="working-indicator">'
        + pulseDots
        + '<span id="thinking-text">' + thinkingPhrases[thinkingIndex] + '</span>'
        + '</div>';
    } else {
      stopThinkingRotation();
    }

    streamingEl.innerHTML = html;
    showEl(streamingEl);
    scrollToBottom();
  }

  function renderConsentDialog() {
    const req = state.consentRequest;
    if (!req) {
      hideEl(consentEl);
      return;
    }

    var consentBody = '';
    if (req.toolName === 'proposeEdit') {
      consentBody = '<div class="consent-args">'
        + '<div>' + escapeHtml(String(req.args.path || '')) + '</div>'
        + '<div style="margin-top:4px;color:var(--vscode-descriptionForeground)">' + escapeHtml(String(req.args.description || '')) + '</div>'
        + '</div>';
    } else {
      var values = Object.values(req.args).map(function(v) {
        return typeof v === 'string' ? v : JSON.stringify(v);
      });
      consentBody = '<div class="consent-args">' + escapeHtml(values.join('\\n')) + '</div>';
    }

    var modifySection = '<div class="consent-modify hidden">'
      + '<textarea class="consent-modify-input" placeholder="Describe what to change..." rows="2"></textarea>'
      + '<div class="consent-buttons" style="margin-top:6px">'
      + '<button class="modify-submit">Send</button>'
      + '<button class="modify-cancel">Cancel</button>'
      + '</div>'
      + '</div>';

    consentEl.innerHTML =
      '<div class="consent-title">Approve: ' + escapeHtml(req.toolName) + '</div>'
      + consentBody
      + '<div class="consent-buttons consent-main-buttons">'
      + '<button class="approve">Approve</button>'
      + '<button class="modify">Modify</button>'
      + '<button class="reject">Reject</button>'
      + '</div>'
      + modifySection;

    consentEl.querySelector('.approve').addEventListener('click', function() {
      handleConsent('approve');
    });
    consentEl.querySelector('.reject').addEventListener('click', function() {
      handleConsent('reject');
    });

    var modifyBtn = consentEl.querySelector('.modify');
    var modifyDiv = consentEl.querySelector('.consent-modify');
    var modifyInput = consentEl.querySelector('.consent-modify-input');

    modifyBtn.addEventListener('click', function() {
      modifyDiv.classList.remove('hidden');
      consentEl.querySelector('.consent-main-buttons').classList.add('hidden');
      modifyInput.focus();
    });

    consentEl.querySelector('.modify-submit').addEventListener('click', function() {
      var feedback = modifyInput.value.trim();
      if (feedback) {
        handleConsentRespond(feedback);
      }
    });

    consentEl.querySelector('.modify-cancel').addEventListener('click', function() {
      modifyDiv.classList.add('hidden');
      consentEl.querySelector('.consent-main-buttons').classList.remove('hidden');
      modifyInput.value = '';
    });

    modifyInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        var feedback = modifyInput.value.trim();
        if (feedback) {
          handleConsentRespond(feedback);
        }
      }
    });

    showEl(consentEl);
    scrollToBottom();
  }

  var severityColors = {
    critical: 'var(--vscode-testing-iconFailed, #f44)',
    warning: 'var(--vscode-list-warningForeground, #cca700)',
    info: 'var(--vscode-notificationsInfoIcon-foreground, #3794ff)',
  };

  var severityBg = {
    critical: 'rgba(255, 68, 68, 0.08)',
    warning: 'rgba(204, 167, 0, 0.08)',
    info: 'rgba(55, 148, 255, 0.08)',
  };

  function renderContextBanner() {
    const ctx = state.contextBanner;
    if (!ctx) {
      hideEl(bannerEl);
      return;
    }

    var accentColor = severityColors[ctx.severity] || severityColors.info;
    bannerEl.style.borderLeftColor = accentColor;
    bannerEl.style.background = severityBg[ctx.severity] || severityBg.info;

    var detailHtml = ctx.detail
      ? '<div class="context-detail collapsed">' + escapeHtml(ctx.detail) + '</div>'
      : '';
    bannerEl.innerHTML =
      '<div class="context-body">'
      + '<div class="context-header">'
      + '<span class="kind" style="color:' + accentColor + '">' + escapeHtml(ctx.kind) + '</span>'
      + '<span class="context-title">' + escapeHtml(ctx.title) + '</span>'
      + '</div>'
      + detailHtml
      + '</div>'
      + '<button class="dismiss">&times;</button>';

    bannerEl.querySelector('.dismiss').addEventListener('click', dismissBanner);
    var detailEl = bannerEl.querySelector('.context-detail');
    if (detailEl) {
      detailEl.addEventListener('click', function() {
        detailEl.classList.toggle('collapsed');
      });
    }

    showEl(bannerEl);
  }

  // --- Actions ---
  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || state.isProcessing) return;

    // Optimistically show user message and loading state
    var userMsg = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    if (state.contextBanner) {
      userMsg.context = {
        kind: state.contextBanner.kind,
        title: state.contextBanner.title,
        detail: state.contextBanner.detail,
        severity: state.contextBanner.severity,
      };
    }
    state.messages = state.messages.concat([userMsg]);
    state.isProcessing = true;
    renderMessages();
    renderStreaming();
    updateInputState();

    vscode.postMessage({ type: 'send', text: text });
    inputEl.value = '';
    autoResize();
    dismissBanner();
  }

  function handleConsent(action) {
    if (!state.consentRequest) return;
    vscode.postMessage({
      type: 'consent_decision',
      callId: state.consentRequest.callId,
      decision: { action: action },
    });
    state.consentRequest = null;
    hideEl(consentEl);
  }

  function handleConsentRespond(message) {
    if (!state.consentRequest) return;
    // Store feedback on the last pending tool block for display
    for (var fi = state.streamBlocks.length - 1; fi >= 0; fi--) {
      if (state.streamBlocks[fi].type === 'tool' && state.streamBlocks[fi].pending) {
        state.streamBlocks[fi].feedback = message;
        break;
      }
    }
    vscode.postMessage({
      type: 'consent_decision',
      callId: state.consentRequest.callId,
      decision: { action: 'respond', message: message },
    });
    state.consentRequest = null;
    hideEl(consentEl);
    renderStreaming();
  }

  function dismissBanner() {
    state.contextBanner = null;
    hideEl(bannerEl);
  }

  function showError(message) {
    errorEl.textContent = message;
    showEl(errorEl);
    setTimeout(function() { hideEl(errorEl); }, 8000);
  }

  // --- Session list (history) ---
  function renderSessionList(sessions) {
    if (sessions.length === 0) {
      sessionListEl.innerHTML = '<div class="session-list-empty">No previous chats</div>';
    } else {
      let html = '<div class="session-list-title">Previous Chats</div>';
      for (var i = 0; i < sessions.length; i++) {
        var s = sessions[i];
        var date = new Date(s.lastActiveAt).toLocaleDateString(undefined, {
          month: 'short', day: 'numeric',
        });
        html += '<div class="session-item" data-id="' + escapeHtml(s.id) + '">'
          + '<div class="session-title">' + escapeHtml(s.title) + '</div>'
          + '<div class="session-meta">' + s.messageCount + ' messages · ' + date + '</div>'
          + '</div>';
      }
      sessionListEl.innerHTML = html;

      var items = sessionListEl.querySelectorAll('.session-item');
      for (var j = 0; j < items.length; j++) {
        items[j].addEventListener('click', function() {
          var id = this.getAttribute('data-id');
          vscode.postMessage({ type: 'load_session', id: id });
          hideSessionList();
        });
      }
    }

    showSessionList();
  }

  function showSessionList() {
    showEl(sessionListEl);
    hideEl(messagesEl);
    hideEl(streamingEl);
    document.getElementById('input-area').style.display = 'none';
  }

  function hideSessionList() {
    hideEl(sessionListEl);
    showEl(messagesEl);
    document.getElementById('input-area').style.display = '';
  }

  // --- Header buttons ---
  newChatBtn.addEventListener('click', function() {
    vscode.postMessage({ type: 'new_chat' });
    hideSessionList();
  });

  historyBtn.addEventListener('click', function() {
    if (!sessionListEl.classList.contains('hidden')) {
      hideSessionList();
    } else {
      vscode.postMessage({ type: 'show_history' });
    }
  });

  // --- Input handling ---
  sendBtn.addEventListener('click', sendMessage);

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.isProcessing) {
      e.preventDefault();
      vscode.postMessage({ type: 'cancel' });
    }
  });

  inputEl.addEventListener('input', autoResize);

  function autoResize() {
    inputEl.style.overflow = 'hidden';
    inputEl.style.height = 'auto';
    var lineHeight = parseFloat(getComputedStyle(inputEl).lineHeight) || 18;
    var maxH = Math.ceil(lineHeight * 10) + 12;
    var newH = Math.min(inputEl.scrollHeight, maxH);
    inputEl.style.height = newH + 'px';
    inputEl.style.overflow = inputEl.scrollHeight > maxH ? 'auto' : 'hidden';
  }

  function updateInputState() {
    sendBtn.disabled = state.isProcessing;
    inputEl.placeholder = state.isProcessing
      ? 'Waiting for response...'
      : 'Ask about your PostHog data, codebase, or errors...';
  }

  // --- Markdown rendering ---
  function renderMarkdown(text) {
    let html = escapeHtml(text);

    // Code blocks: \`\`\`lang\\n...\\n\`\`\`
    html = html.replace(
      /\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g,
      function(_, lang, code) {
        return '<pre><code>' + code + '</code></pre>';
      }
    );

    // Inline code: \`...\`
    html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

    // Bold: **...**
    html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');

    // Italic: *...*
    html = html.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');

    // Headings: ### ... (only at line start)
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');

    // Ordered lists: consecutive numbered lines (1. 2. 3.)
    html = html.replace(/(^\\d+\\. .+$\\n?)+/gm, function(block) {
      return '<ol>' + block.replace(/^\\d+\\. (.+)$/gm, '<li>$1</li>') + '</ol>';
    });

    // Unordered lists: consecutive dash lines (- item)
    html = html.replace(/(^- .+$\\n?)+/gm, function(block) {
      return '<ul>' + block.replace(/^- (.+)$/gm, '<li>$1</li>') + '</ul>';
    });

    // Separate list blocks from surrounding text for paragraph wrapping
    html = html.replace(/([^\\n])\\n(<(?:ul|ol)>)/g, '$1\\n\\n$2');
    html = html.replace(/(<\\/(?:ul|ol)>)\\n([^\\n])/g, '$1\\n\\n$2');

    // Links: [text](url)
    html = html.replace(
      /\\[([^\\]]+)\\]\\(([^)]+)\\)/g,
      '<a href="$2" target="_blank">$1</a>'
    );

    // Paragraphs: double newline
    html = html.replace(/\\n\\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs around block elements
    html = html.replace(/<p>\\s*(<(?:pre|h[34]|ul|ol))/g, '$1');
    html = html.replace(/(<\\/(?:pre|h[34]|ul|ol)>)\\s*<\\/p>/g, '$1');
    html = html.replace(/<p><\\/p>/g, '');

    return html;
  }

  // --- Utilities ---
  function closeOpenCodeBlock(text) {
    var count = (text.match(/\`\`\`/g) || []).length;
    return count % 2 !== 0 ? text + '\\n\`\`\`' : text;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatArgs(args) {
    if (!args || Object.keys(args).length === 0) return '';
    var values = Object.values(args).map(function(v) {
      return typeof v === 'string' ? v : JSON.stringify(v);
    });
    return '<div class="tool-args">' + escapeHtml(values.join('\\n')) + '</div>';
  }

  function truncateResult(text) {
    if (!text) return '';
    return text.length > 2000 ? text.slice(0, 2000) + '\\n...(truncated)' : text;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function showEl(el) { el.classList.remove('hidden'); }
  function hideEl(el) { el.classList.add('hidden'); }

  // --- Init ---
  vscode.postMessage({ type: 'ready' });
})();
`;
