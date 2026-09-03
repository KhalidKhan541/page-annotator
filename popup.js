/* ===== Page Annotator - Popup Script ===== */

(function () {
  'use strict';

  let currentTab = null;
  let currentUrl = '';
  let allAnnotations = {};
  let currentTool = 'highlight';
  let currentColor = '#ffeb3b';
  let annotationMode = true;

  // DOM references
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // Initialize popup
  async function init() {
    await loadCurrentTab();
    loadTheme();
    bindEvents();
    await loadAnnotations();
    updateStats();
    renderAnnotationList();
    updateToggleState();
  }

  // Get current active tab
  async function loadCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTab = tab;
      currentUrl = tab.url || '';
      const displayUrl = currentUrl.length > 45 ? currentUrl.substring(0, 42) + '...' : currentUrl;
      $('#pageUrl').textContent = displayUrl;
      $('#pageUrl').title = currentUrl;
    }
  }

  // Load theme preference
  function loadTheme() {
    chrome.storage.local.get('pa_theme', (data) => {
      const theme = data.pa_theme || 'light';
      document.documentElement.setAttribute('data-theme', theme);
    });
  }

  // Bind all events
  function bindEvents() {
    // Tab switching
    $$('.tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Tool selection
    $$('.tool-btn[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => selectTool(btn.dataset.tool));
    });

    // Color selection
    $$('.color-swatch').forEach((swatch) => {
      swatch.addEventListener('click', () => selectColor(swatch.dataset.color));
    });

    // Annotation mode toggle
    $('#annotationModeToggle').addEventListener('click', toggleAnnotationMode);

    // Theme toggle
    $('#toggleTheme').addEventListener('click', toggleTheme);

    // Navigation
    $('#prevAnnotation').addEventListener('click', () => navigateAnnotation('prev'));
    $('#nextAnnotation').addEventListener('click', () => navigateAnnotation('next'));

    // Clear page annotations
    $('#clearPageAnnotations').addEventListener('click', clearPageAnnotations);

    // Search
    $('#searchInput').addEventListener('input', debounce(handleSearch, 250));

    // Export
    $('#exportBtn').addEventListener('click', toggleExportMenu);
    $$('.export-option').forEach((opt) => {
      opt.addEventListener('click', () => handleExport(opt.dataset.format));
    });

    // Import
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', handleImport);

    // Clear all
    $('#clearAllBtn').addEventListener('click', clearAllAnnotations);

    // Draw size
    $('#drawSize')?.addEventListener('input', (e) => {
      sendToContent({ action: 'setDrawSize', size: parseInt(e.target.value) });
    });

    // Close export menu on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#exportBtn') && !e.target.closest('#exportMenu')) {
        $('#exportMenu').classList.remove('visible');
      }
    });
  }

  // Tab switching
  function switchTab(tabName) {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    $$('.tab-content').forEach((c) => c.classList.remove('active'));
    $(`.tab[data-tab="${tabName}"]`).classList.add('active');
    $(`#tab-${tabName}`).classList.add('active');

    if (tabName === 'annotations') {
      renderAnnotationList();
    } else if (tabName === 'stats') {
      updateStats();
    }
  }

  // Tool selection
  function selectTool(tool) {
    currentTool = tool;
    $$('.tool-btn[data-tool]').forEach((b) => b.classList.remove('active'));
    $(`.tool-btn[data-tool="${tool}"]`).classList.add('active');

    // Show/hide draw options
    $('#drawOptions').style.display = tool === 'draw' ? 'flex' : 'none';

    sendToContent({ action: 'setTool', tool, color: currentColor });
  }

  // Color selection
  function selectColor(color) {
    currentColor = color;
    $$('.color-swatch').forEach((s) => s.classList.remove('active'));
    $(`.color-swatch[data-color="${color}"]`).classList.add('active');
    sendToContent({ action: 'setColor', color });
  }

  // Toggle annotation mode
  function toggleAnnotationMode() {
    annotationMode = !annotationMode;
    updateToggleState();
    sendToContent({ action: 'setAnnotationMode', enabled: annotationMode });
  }

  function updateToggleState() {
    const toggle = $('#annotationModeToggle');
    if (annotationMode) {
      toggle.classList.add('active');
    } else {
      toggle.classList.remove('active');
    }
  }

  // Theme toggle
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    chrome.storage.local.set({ pa_theme: next });
  }

  // Send message to content script
  function sendToContent(message) {
    if (currentTab) {
      chrome.tabs.sendMessage(currentTab.id, message).catch(() => {});
    }
  }

  // Load annotations for current page
  async function loadAnnotations() {
    if (!currentUrl) return;

    const urlKey = normalizeUrl(currentUrl);
    const data = await chrome.storage.local.get('pa_annotations');
    allAnnotations = data.pa_annotations || {};

    // Also get annotations from content script
    try {
      const response = await chrome.tabs.sendMessage(currentTab.id, { action: 'getAnnotations' });
      if (response && response.annotations) {
        allAnnotations[urlKey] = response.annotations;
      }
    } catch (e) {
      // Content script not ready, use stored data
    }
  }

  // Normalize URL for storage key
  function normalizeUrl(url) {
    try {
      const u = new URL(url);
      return u.origin + u.pathname + u.search;
    } catch {
      return url;
    }
  }

  // Update statistics
  async function updateStats() {
    const data = await chrome.storage.local.get('pa_annotations');
    const annotations = data.pa_annotations || {};

    let total = 0;
    let highlights = 0;
    const pages = Object.keys(annotations).length;

    for (const url in annotations) {
      const pageAnnotations = annotations[url];
      total += pageAnnotations.length;
      highlights += pageAnnotations.filter((a) => a.type === 'highlight' || a.type === 'underline' || a.type === 'strikethrough').length;
    }

    const urlKey = normalizeUrl(currentUrl);
    const pageCount = (annotations[urlKey] || []).length;

    $('#totalAnnotations').textContent = total;
    $('#pagesAnnotated').textContent = pages;
    $('#pageAnnotationCount').textContent = pageCount;
    $('#highlightsCount').textContent = highlights;
  }

  // Render annotation list
  function renderAnnotationList(searchQuery = '') {
    const container = $('#annotationList');
    const urlKey = normalizeUrl(currentUrl);
    let annotations = allAnnotations[urlKey] || [];

    if (searchQuery) {
      // Search across all pages
      annotations = [];
      for (const url in allAnnotations) {
        const matches = allAnnotations[url].filter(
          (a) =>
            (a.text && a.text.toLowerCase().includes(searchQuery)) ||
            (a.note && a.note.toLowerCase().includes(searchQuery))
        );
        annotations.push(...matches.map((a) => ({ ...a, _sourceUrl: url })));
      }
    }

    if (annotations.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
          <p>${searchQuery ? 'No matching annotations found' : 'No annotations yet.<br>Select text to start annotating!'}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = annotations
      .map(
        (a, i) => `
      <div class="annotation-item" data-id="${a.id}" data-index="${i}">
        <div class="annotation-color-bar" style="background:${a.color || '#ffeb3b'}"></div>
        <div class="annotation-content">
          <div class="annotation-text">${escapeHtml(a.text || '')}</div>
          ${a.note ? `<div class="annotation-note">${escapeHtml(a.note)}</div>` : ''}
          <div class="annotation-meta">
            <span class="annotation-type-badge">${a.type}</span>
            <span>${formatDate(a.timestamp)}</span>
            ${searchQuery && a._sourceUrl ? `<span title="${a._sourceUrl}">📄</span>` : ''}
          </div>
        </div>
        <div class="annotation-actions">
          <button class="edit-btn" data-id="${a.id}" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </button>
          <button class="delete-btn" data-id="${a.id}" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
    `
      )
      .join('');

    // Bind annotation item events
    container.querySelectorAll('.annotation-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.annotation-actions')) return;
        const id = item.dataset.id;
        sendToContent({ action: 'scrollToAnnotation', id });
      });
    });

    container.querySelectorAll('.delete-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteAnnotation(btn.dataset.id);
      });
    });

    container.querySelectorAll('.edit-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        editAnnotation(btn.dataset.id);
      });
    });
  }

  // Delete annotation
  async function deleteAnnotation(id) {
    const urlKey = normalizeUrl(currentUrl);
    sendToContent({ action: 'deleteAnnotation', id });

    if (allAnnotations[urlKey]) {
      allAnnotations[urlKey] = allAnnotations[urlKey].filter((a) => a.id !== id);
      await chrome.storage.local.set({ pa_annotations: allAnnotations });
    }

    renderAnnotationList($('#searchInput').value.toLowerCase().trim());
    updateStats();
  }

  // Edit annotation
  function editAnnotation(id) {
    sendToContent({ action: 'editAnnotation', id });
  }

  // Clear page annotations
  async function clearPageAnnotations() {
    if (!confirm('Clear all annotations on this page?')) return;

    const urlKey = normalizeUrl(currentUrl);
    sendToContent({ action: 'clearAllAnnotations' });

    delete allAnnotations[urlKey];
    await chrome.storage.local.set({ pa_annotations: allAnnotations });

    renderAnnotationList();
    updateStats();
  }

  // Clear all annotations
  async function clearAllAnnotations() {
    if (!confirm('Delete ALL annotations across ALL pages? This cannot be undone.')) return;

    sendToContent({ action: 'clearAllAnnotations' });

    allAnnotations = {};
    await chrome.storage.local.set({ pa_annotations: allAnnotations });

    renderAnnotationList();
    updateStats();
  }

  // Search annotations
  function handleSearch(e) {
    const query = e.target.value.toLowerCase().trim();
    renderAnnotationList(query);
  }

  // Navigate annotations
  function navigateAnnotation(direction) {
    sendToContent({ action: 'navigateAnnotation', direction });
  }

  // Toggle export menu
  function toggleExportMenu() {
    $('#exportMenu').classList.toggle('visible');
  }

  // Export annotations
  async function handleExport(format) {
    $('#exportMenu').classList.remove('visible');
    const data = await chrome.storage.local.get('pa_annotations');
    const annotations = data.pa_annotations || {};

    let content, filename, mimeType;

    switch (format) {
      case 'json':
        content = JSON.stringify(annotations, null, 2);
        filename = 'annotations.json';
        mimeType = 'application/json';
        break;

      case 'markdown':
        content = generateMarkdown(annotations);
        filename = 'annotations.md';
        mimeType = 'text/markdown';
        break;

      case 'html':
        content = generateHtml(annotations);
        filename = 'annotations.html';
        mimeType = 'text/html';
        break;

      case 'page-json':
        const urlKey = normalizeUrl(currentUrl);
        content = JSON.stringify({ url: currentUrl, annotations: annotations[urlKey] || [] }, null, 2);
        filename = 'page-annotations.json';
        mimeType = 'application/json';
        break;
    }

    downloadFile(content, filename, mimeType);
  }

  // Generate Markdown export
  function generateMarkdown(annotations) {
    let md = '# Page Annotations\n\n';
    md += `Exported: ${new Date().toLocaleString()}\n\n`;

    for (const url in annotations) {
      const pageAnnotations = annotations[url];
      if (pageAnnotations.length === 0) continue;

      md += `## ${url}\n\n`;

      for (const a of pageAnnotations) {
        md += `- **[${a.type.toUpperCase()}]** "${a.text || ''}"`;
        if (a.note) md += ` — _${a.note}_`;
        md += `\n`;
        md += `  - Color: ${a.color || '#ffeb3b'} | Date: ${formatDate(a.timestamp)}\n\n`;
      }
    }

    return md;
  }

  // Generate HTML export
  function generateHtml(annotations) {
    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Page Annotations</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 40px 20px; color: #333; }
    h1 { color: #1a1a1a; border-bottom: 2px solid #4a90d9; padding-bottom: 10px; }
    h2 { color: #4a90d9; margin-top: 30px; }
    .annotation { padding: 12px 16px; margin: 8px 0; border-left: 4px solid; background: #f9f9f9; border-radius: 4px; }
    .annotation .type { font-size: 11px; text-transform: uppercase; color: #666; font-weight: 600; }
    .annotation .text { font-size: 14px; margin: 4px 0; }
    .annotation .note { font-size: 13px; color: #555; font-style: italic; margin-top: 4px; }
    .annotation .meta { font-size: 11px; color: #999; margin-top: 6px; }
  </style>
</head>
<body>
  <h1>Page Annotations</h1>
  <p>Exported: ${new Date().toLocaleString()}</p>`;

    for (const url in annotations) {
      const pageAnnotations = annotations[url];
      if (pageAnnotations.length === 0) continue;

      html += `\n  <h2><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></h2>`;

      for (const a of pageAnnotations) {
        html += `
  <div class="annotation" style="border-color:${a.color || '#ffeb3b'}">
    <div class="type">${escapeHtml(a.type)}</div>
    <div class="text">"${escapeHtml(a.text || '')}"</div>
    ${a.note ? `<div class="note">${escapeHtml(a.note)}</div>` : ''}
    <div class="meta">Color: ${a.color || '#ffeb3b'} | ${formatDate(a.timestamp)}</div>
  </div>`;
      }
    }

    html += '\n</body>\n</html>';
    return html;
  }

  // Import annotations
  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const imported = JSON.parse(text);

      if (typeof imported !== 'object') {
        throw new Error('Invalid format');
      }

      // Merge with existing
      const data = await chrome.storage.local.get('pa_annotations');
      const existing = data.pa_annotations || {};

      for (const url in imported) {
        if (Array.isArray(imported[url])) {
          existing[url] = [...(existing[url] || []), ...imported[url]];
        }
      }

      await chrome.storage.local.set({ pa_annotations: existing });
      allAnnotations = existing;

      renderAnnotationList();
      updateStats();

      alert(`Imported annotations from ${Object.keys(imported).length} page(s).`);
    } catch (err) {
      alert('Failed to import: ' + err.message);
    }

    e.target.value = '';
  }

  // Download helper
  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Escape HTML
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Format date
  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';

    return d.toLocaleDateString();
  }

  // Debounce helper
  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // Listen for messages from content script
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'annotationsUpdated') {
      loadAnnotations().then(() => {
        updateStats();
        renderAnnotationList($('#searchInput').value.toLowerCase().trim());
      });
    }
  });

  // Initialize
  init();
})();
