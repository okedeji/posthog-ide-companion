(function() {
  const vscode = acquireVsCodeApi();


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
      consentBody = '<div class="consent-args">' + escapeHtml(values.join('\n')) + '</div>';
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


  function renderMarkdown(text) {
    let html = escapeHtml(text);

    // Code blocks: ```lang\n...\n```
    html = html.replace(
      /```(\w*)\n([\s\S]*?)```/g,
      function(_, lang, code) {
        return '<pre><code>' + code + '</code></pre>';
      }
    );

    // Inline code: `...`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold: **...**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic: *...*
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Headings: ### ... (only at line start)
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');

    // Ordered lists: consecutive numbered lines (1. 2. 3.)
    html = html.replace(/(^\d+\. .+$\n?)+/gm, function(block) {
      return '<ol>' + block.replace(/^\d+\. (.+)$/gm, '<li>$1</li>') + '</ol>';
    });

    // Unordered lists: consecutive dash lines (- item)
    html = html.replace(/(^- .+$\n?)+/gm, function(block) {
      return '<ul>' + block.replace(/^- (.+)$/gm, '<li>$1</li>') + '</ul>';
    });

    // Separate list blocks from surrounding text for paragraph wrapping
    html = html.replace(/([^\n])\n(<(?:ul|ol)>)/g, '$1\n\n$2');
    html = html.replace(/(<\/(?:ul|ol)>)\n([^\n])/g, '$1\n\n$2');

    // Links: [text](url)
    html = html.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank">$1</a>'
    );

    // Paragraphs: double newline
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs around block elements
    html = html.replace(/<p>\s*(<(?:pre|h[34]|ul|ol))/g, '$1');
    html = html.replace(/(<\/(?:pre|h[34]|ul|ol)>)\s*<\/p>/g, '$1');
    html = html.replace(/<p><\/p>/g, '');

    return html;
  }


  function closeOpenCodeBlock(text) {
    var count = (text.match(/```/g) || []).length;
    return count % 2 !== 0 ? text + '\n```' : text;
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
    return '<div class="tool-args">' + escapeHtml(values.join('\n')) + '</div>';
  }

  function truncateResult(text) {
    if (!text) return '';
    return text.length > 2000 ? text.slice(0, 2000) + '\n...(truncated)' : text;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function showEl(el) { el.classList.remove('hidden'); }
  function hideEl(el) { el.classList.add('hidden'); }


  vscode.postMessage({ type: 'ready' });
})();
