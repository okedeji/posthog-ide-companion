import * as vscode from 'vscode';

export function getChatHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const nonce = getNonce();

  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'chat.css'),
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'chat.js'),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
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
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
