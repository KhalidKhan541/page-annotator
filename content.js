/* ===== Page Annotator - Content Script ===== */

(function () {
  'use strict';

  if (window.PageAnnotatorContent) return;
  window.PageAnnotatorContent = true;

  const STORAGE = window.PageAnnotatorStorage;
  const ENGINE = window.PageAnnotatorEngine;

  // State
  let state = {
    enabled: true,
    tool: 'highlight',
    color: '#ffeb3b',
    drawSize: 3,
    annotations: [],
    currentNavIndex: -1,
    miniToolbar: null,
    modeIndicator: null,
    drawCanvas: null,
    drawCtx: null,
    isDrawing: false,
    currentPath: null,
    pathData: [],
    drawingsContainer: null,
  };

  // ========== INITIALIZATION ==========

  async function init() {
    createModeIndicator();
    createDrawOverlay();
    await loadAnnotations();
    renderAllAnnotations();
    bindEvents();
    observeDynamicContent();
  }

  // ========== UI ELEMENTS ==========

  function createModeIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'pa-mode-indicator';
    indicator.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
      <span>Annotations ON</span>
    `;
    indicator.addEventListener('click', toggleAnnotationMode);
    document.body.appendChild(indicator);
    state.modeIndicator = indicator;
    updateModeIndicator();
  }

  function updateModeIndicator() {
    const indicator = state.modeIndicator;
    if (!indicator) return;

    const span = indicator.querySelector('span');
    if (state.enabled) {
      indicator.classList.remove('off');
      span.textContent = 'Annotations ON';
      document.body.classList.add('pa-annotation-mode');
    } else {
      indicator.classList.add('off');
      span.textContent = 'Annotations OFF';
      document.body.classList.remove('pa-annotation-mode');
    }
  }

  function createMiniToolbar() {
    if (state.miniToolbar) return state.miniToolbar;

    const toolbar = document.createElement('div');
    toolbar.className = 'pa-mini-toolbar';
    toolbar.innerHTML = `
      <button class="pa-mini-toolbar-btn" data-action="highlight" title="Highlight">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
      </button>
      <button class="pa-mini-toolbar-btn" data-action="underline" title="Underline">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M6 3v7a6 6 0 006 6 6 6 0 006-6V3"/>
          <line x1="4" y1="21" x2="20" y2="21"/>
        </svg>
      </button>
      <button class="pa-mini-toolbar-btn" data-action="strikethrough" title="Strikethrough">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M16 4H9a3 3 0 00-3 3v0a3 3 0 003 3h6a3 3 0 013 3v0a3 3 0 01-3 3H7"/>
          <line x1="4" y1="12" x2="20" y2="12"/>
        </svg>
      </button>
      <button class="pa-mini-toolbar-btn" data-action="note" title="Add Note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
        </svg>
      </button>
      <div class="pa-mini-toolbar-divider"></div>
      <div class="pa-mini-color" data-color="#ffeb3b" style="background:#ffeb3b" title="Yellow"></div>
      <div class="pa-mini-color" data-color="#4caf50" style="background:#4caf50" title="Green"></div>
      <div class="pa-mini-color" data-color="#2196f3" style="background:#2196f3" title="Blue"></div>
      <div class="pa-mini-color" data-color="#e91e63" style="background:#e91e63" title="Pink"></div>
      <div class="pa-mini-color" data-color="#ff9800" style="background:#ff9800" title="Orange"></div>
    `;

    document.body.appendChild(toolbar);
    state.miniToolbar = toolbar;

    // Tool actions
    toolbar.querySelectorAll('.pa-mini-toolbar-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const action = btn.dataset.action;
        applyToolFromSelection(action);
        hideMiniToolbar();
      });
    });

    // Color actions
    toolbar.querySelectorAll('.pa-mini-color').forEach((swatch) => {
      swatch.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.color = swatch.dataset.color;
        toolbar.querySelectorAll('.pa-mini-color').forEach((s) => s.classList.remove('active'));
        swatch.classList.add('active');
      });
    });

    return toolbar;
  }

  function showMiniToolbar(x, y) {
    const toolbar = createMiniToolbar();

    // Update active tool
    toolbar.querySelectorAll('.pa-mini-toolbar-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.action === state.tool);
    });

    // Update active color
    toolbar.querySelectorAll('.pa-mini-color').forEach((swatch) => {
      swatch.classList.toggle('active', swatch.dataset.color === state.color);
    });

    // Position toolbar
    const toolbarRect = toolbar.getBoundingClientRect();
    let left = x - toolbarRect.width / 2;
    let top = y - toolbarRect.height - 10;

    // Keep within viewport
    if (left < 8) left = 8;
    if (left + toolbarRect.width > window.innerWidth - 8) left = window.innerWidth - toolbarRect.width - 8;
    if (top < 8) top = y + 20;

    toolbar.style.left = left + 'px';
    toolbar.style.top = top + 'px';
    toolbar.classList.add('visible');
  }

  function hideMiniToolbar() {
    if (state.miniToolbar) {
      state.miniToolbar.classList.remove('visible');
    }
  }

  // ========== DRAW OVERLAY ==========

  function createDrawOverlay() {
    // Drawings container for persistent drawings
    const container = document.createElement('div');
    container.className = 'pa-drawings-container';
    document.documentElement.appendChild(container);
    state.drawingsContainer = container;

    // Canvas for active drawing
    const canvas = document.createElement('canvas');
    canvas.className = 'pa-draw-canvas';
    canvas.style.display = 'none';
    document.body.appendChild(canvas);
    state.drawCanvas = canvas;

    const ctx = canvas.getContext('2d');
    state.drawCtx = ctx;

    resizeDrawCanvas();

    canvas.addEventListener('mousedown', onDrawStart);
    canvas.addEventListener('mousemove', onDrawMove);
    canvas.addEventListener('mouseup', onDrawEnd);
    canvas.addEventListener('mouseleave', onDrawEnd);

    // Touch support
    canvas.addEventListener('touchstart', onDrawTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onDrawTouchMove, { passive: false });
    canvas.addEventListener('touchend', onDrawEnd);

    window.addEventListener('resize', resizeDrawCanvas);
  }

  function resizeDrawCanvas() {
    if (!state.drawCanvas) return;
    state.drawCanvas.width = window.innerWidth;
    state.drawCanvas.height = window.innerHeight;
  }

  function showDrawCanvas() {
    if (!state.drawCanvas) return;
    state.drawCanvas.style.display = 'block';
    state.drawCtx.clearRect(0, 0, state.drawCanvas.width, state.drawCanvas.height);
    state.pathData = [];
  }

  function hideDrawCanvas() {
    if (!state.drawCanvas) return;
    state.drawCanvas.style.display = 'none';
  }

  function onDrawStart(e) {
    if (!state.enabled || state.tool !== 'draw') return;

    state.isDrawing = true;
    const point = { x: e.clientX, y: e.clientY, color: state.color, size: state.drawSize };
    state.currentPath = [point];

    state.drawCtx.beginPath();
    state.drawCtx.strokeStyle = state.color;
    state.drawCtx.lineWidth = state.drawSize;
    state.drawCtx.lineCap = 'round';
    state.drawCtx.lineJoin = 'round';
    state.drawCtx.moveTo(point.x, point.y);
  }

  function onDrawMove(e) {
    if (!state.isDrawing) return;

    const point = { x: e.clientX, y: e.clientY };
    state.currentPath.push(point);

    state.drawCtx.lineTo(point.x, point.y);
    state.drawCtx.stroke();
  }

  function onDrawEnd() {
    if (!state.isDrawing) return;
    state.isDrawing = false;

    if (state.currentPath && state.currentPath.length > 1) {
      // Save the drawing
      const d = pathToSvgD(state.currentPath);
      state.pathData.push({
        d,
        color: state.color,
        size: state.drawSize,
      });
    }
    state.currentPath = null;
  }

  function onDrawTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    onDrawStart({ clientX: touch.clientX, clientY: touch.clientY });
  }

  function onDrawTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    onDrawMove({ clientX: touch.clientX, clientY: touch.clientY });
  }

  function pathToSvgD(points) {
    if (points.length < 2) return '';

    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    return d;
  }

  async function saveDrawing() {
    if (state.pathData.length === 0) return;

    // Convert screen coords to page coords
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    const adjustedPaths = state.pathData.map((p) => ({
      ...p,
      // Store relative to viewport, convert on render
    }));

    const annotation = {
      id: ENGINE.generateId(),
      type: 'draw',
      color: state.color,
      paths: adjustedPaths,
      timestamp: Date.now(),
    };

    await STORAGE.saveAnnotation(window.location.href, annotation);
    state.annotations.push(annotation);

    renderDrawing(annotation);
    hideDrawCanvas();
    state.pathData = [];

    notifyPopup();
  }

  // ========== ANNOTATION CREATION ==========

  function createTextAnnotation(type) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    const text = selection.toString().trim();

    if (!text) return null;

    const rangeData = ENGINE.serializeRange(range);

    const annotation = {
      id: ENGINE.generateId(),
      type,
      color: state.color,
      text,
      rangeData,
      timestamp: Date.now(),
    };

    return annotation;
  }

  function createNoteAnnotation(x, y) {
    const annotation = {
      id: ENGINE.generateId(),
      type: 'note',
      color: state.color,
      note: '',
      x: x + window.scrollX,
      y: y + window.scrollY,
      timestamp: Date.now(),
    };

    return annotation;
  }

  async function saveAnnotation(annotation) {
    await STORAGE.saveAnnotation(window.location.href, annotation);
    state.annotations.push(annotation);
    notifyPopup();
  }

  async function deleteAnnotation(id) {
    // Remove from DOM
    ENGINE.removeAnnotationMarks(id);

    // Remove note elements
    const noteEl = document.querySelector(`.pa-sticky-note[data-pa-id="${id}"]`);
    if (noteEl) noteEl.remove();

    // Remove drawing elements
    const drawEl = document.querySelector(`.pa-drawing-element[data-pa-id="${id}"]`);
    if (drawEl) drawEl.remove();

    // Remove from state
    state.annotations = state.annotations.filter((a) => a.id !== id);

    // Remove from storage
    await STORAGE.deleteAnnotation(window.location.href, id);
    notifyPopup();
  }

  async function updateAnnotation(id, updates) {
    const annotation = state.annotations.find((a) => a.id === id);
    if (!annotation) return;

    Object.assign(annotation, updates);
    await STORAGE.saveAnnotation(window.location.href, annotation);
    notifyPopup();
  }

  async function clearAllAnnotations() {
    // Remove all marks
    document.querySelectorAll('[data-pa-id]').forEach((el) => {
      if (el.classList.contains('pa-highlight') ||
          el.classList.contains('pa-underline') ||
          el.classList.contains('pa-strikethrough')) {
        const parent = el.parentNode;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        parent.normalize();
      } else {
        el.remove();
      }
    });

    state.annotations = [];
    await STORAGE.clearAnnotationsForUrl(window.location.href);
    notifyPopup();
  }

  // ========== ANNOTATION RENDERING ==========

  async function loadAnnotations() {
    const url = window.location.href;
    state.annotations = await STORAGE.getAnnotationsForUrl(url);
  }

  function renderAllAnnotations() {
    state.annotations.forEach((annotation) => {
      renderAnnotation(annotation);
    });
  }

  function renderAnnotation(annotation) {
    switch (annotation.type) {
      case 'highlight':
      case 'underline':
      case 'strikethrough':
        renderTextAnnotation(annotation);
        break;
      case 'note':
        renderNote(annotation);
        break;
      case 'draw':
        renderDrawing(annotation);
        break;
    }
  }

  function renderTextAnnotation(annotation) {
    if (!annotation.rangeData) return;

    const range = ENGINE.deserializeRange(annotation.rangeData);
    if (!range) {
      console.warn('Page Annotator: Could not restore range for annotation', annotation.id);
      return;
    }

    switch (annotation.type) {
      case 'highlight':
        ENGINE.highlightRange(range, annotation.color, annotation.id);
        break;
      case 'underline':
        ENGINE.underlineRange(range, annotation.color, annotation.id);
        break;
      case 'strikethrough':
        ENGINE.strikethroughRange(range, annotation.color, annotation.id);
        break;
    }
  }

  function renderNote(annotation) {
    const note = ENGINE.createStickyNote(annotation);
    document.body.appendChild(note);
  }

  function renderDrawing(annotation) {
    const svg = ENGINE.renderDrawingOnCanvas(annotation);
    state.drawingsContainer.appendChild(svg);
  }

  // ========== TOOL APPLICATION ==========

  function applyToolFromSelection(tool) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    if (tool === 'note') {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const annotation = createNoteAnnotation(rect.left + rect.width / 2, rect.top + window.scrollY);
      if (annotation) {
        saveAnnotation(annotation);
        renderNote(annotation);
      }
    } else {
      const annotation = createTextAnnotation(tool);
      if (annotation) {
        saveAnnotation(annotation);
        renderAnnotation(annotation);
      }
    }

    selection.removeAllRanges();
  }

  // ========== EVENT HANDLING ==========

  function bindEvents() {
    // Text selection -> show mini toolbar
    document.addEventListener('mouseup', handleTextSelection);
    document.addEventListener('mousedown', handleMouseDown);

    // Click on annotations
    document.addEventListener('click', handleAnnotationClick);

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboard);

    // Message from popup/background
    chrome.runtime.onMessage.addListener(handleMessage);
  }

  function handleMouseDown(e) {
    // Hide toolbar when clicking elsewhere
    if (!e.target.closest('.pa-mini-toolbar') && !e.target.closest('.pa-sticky-note')) {
      hideMiniToolbar();
    }

    // Handle draw tool click
    if (state.enabled && state.tool === 'draw') {
      if (!e.target.closest('.pa-draw-canvas') && state.pathData.length > 0) {
        saveDrawing();
      }
    }
  }

  function handleTextSelection(e) {
    // Don't interfere with toolbar clicks
    if (e.target.closest('.pa-mini-toolbar') || e.target.closest('.pa-sticky-note') || e.target.closest('.pa-mode-indicator')) {
      return;
    }

    // Don't show toolbar if in draw mode or not enabled
    if (!state.enabled || state.tool === 'draw') return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }

    // Get selection position
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top;

    showMiniToolbar(x, y + window.scrollY);
  }

  function handleAnnotationClick(e) {
    if (!state.enabled) return;

    // Click on highlight/underline/strikethrough
    const textMark = e.target.closest('.pa-highlight, .pa-underline, .pa-strikethrough');
    if (textMark) {
      const id = textMark.dataset.paId;
      highlightAnnotation(id);
      return;
    }

    // Click on note
    const note = e.target.closest('.pa-sticky-note');
    if (note && !e.target.closest('.pa-note-header-btn') && !e.target.closest('.pa-note-body-edit')) {
      const id = note.dataset.paId;
      highlightAnnotation(id);
    }
  }

  function highlightAnnotation(id) {
    // Remove previous highlight
    document.querySelectorAll('.pa-highlight-active').forEach((el) => {
      el.classList.remove('pa-highlight-active');
    });

    // Add highlight to current
    const el = document.querySelector(`[data-pa-id="${id}"]`);
    if (el) {
      el.classList.add('pa-highlight-active');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => el.classList.remove('pa-highlight-active'), 2000);
    }
  }

  function handleKeyboard(e) {
    // Ctrl/Cmd + Shift + H = Toggle annotation mode
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'H') {
      e.preventDefault();
      toggleAnnotationMode();
    }

    // Escape = Hide toolbar, cancel drawing
    if (e.key === 'Escape') {
      hideMiniToolbar();
      if (state.isDrawing) {
        state.isDrawing = false;
        state.currentPath = null;
        state.pathData = [];
        hideDrawCanvas();
      }
    }

    // Delete/Backspace on selected annotation
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const activeEl = document.querySelector('.pa-highlight-active');
      if (activeEl) {
        e.preventDefault();
        deleteAnnotation(activeEl.dataset.paId);
      }
    }
  }

  // ========== NAVIGATION ==========

  function navigateAnnotation(direction) {
    const textAnnotations = state.annotations.filter((a) => a.type !== 'draw');
    if (textAnnotations.length === 0) return;

    if (direction === 'next') {
      state.currentNavIndex = (state.currentNavIndex + 1) % textAnnotations.length;
    } else {
      state.currentNavIndex = (state.currentNavIndex - 1 + textAnnotations.length) % textAnnotations.length;
    }

    const annotation = textAnnotations[state.currentNavIndex];
    if (annotation) {
      highlightAnnotation(annotation.id);
    }
  }

  // ========== MESSAGE HANDLING ==========

  function handleMessage(msg, sender, sendResponse) {
    switch (msg.action) {
      case 'setTool':
        state.tool = msg.tool;
        if (msg.color) state.color = msg.color;
        if (state.tool === 'draw') {
          showDrawCanvas();
        } else {
          hideDrawCanvas();
          if (state.pathData.length > 0) saveDrawing();
        }
        break;

      case 'setColor':
        state.color = msg.color;
        break;

      case 'setDrawSize':
        state.drawSize = msg.size;
        break;

      case 'setAnnotationMode':
        state.enabled = msg.enabled;
        updateModeIndicator();
        if (!state.enabled) {
          hideMiniToolbar();
          hideDrawCanvas();
        }
        break;

      case 'getAnnotations':
        sendResponse({ annotations: state.annotations });
        break;

      case 'scrollToAnnotation':
        highlightAnnotation(msg.id);
        break;

      case 'deleteAnnotation':
        deleteAnnotation(msg.id);
        break;

      case 'editAnnotation':
        editAnnotationById(msg.id);
        break;

      case 'navigateAnnotation':
        navigateAnnotation(msg.direction);
        break;

      case 'clearAllAnnotations':
        clearAllAnnotations();
        break;

      case 'saveDrawing':
        saveDrawing();
        break;
    }
  }

  function editAnnotationById(id) {
    const annotation = state.annotations.find((a) => a.id === id);
    if (!annotation) return;

    if (annotation.type === 'note') {
      const noteEl = document.querySelector(`.pa-sticky-note[data-pa-id="${id}"]`);
      if (noteEl) {
        noteEl.classList.add('pa-note-editing');
        const editArea = noteEl.querySelector('.pa-note-body-edit');
        if (editArea) editArea.focus();
      }
    } else {
      highlightAnnotation(id);
    }
  }

  function toggleAnnotationMode() {
    state.enabled = !state.enabled;
    updateModeIndicator();
    if (!state.enabled) {
      hideMiniToolbar();
    }
  }

  // ========== DYNAMIC CONTENT OBSERVER ==========

  function observeDynamicContent() {
    const observer = new MutationObserver((mutations) => {
      // Re-render annotations if significant DOM changes occur
      let hasRelevantChange = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // Check if added nodes might affect our annotations
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && !node.classList?.contains('pa-') && !node.dataset?.paId) {
              hasRelevantChange = true;
              break;
            }
          }
        }
        if (hasRelevantChange) break;
      }

      if (hasRelevantChange) {
        // Debounced re-render
        clearTimeout(state._renderDebounce);
        state._renderDebounce = setTimeout(() => {
          // Only re-render if annotations still exist in DOM
          const existing = document.querySelectorAll('[data-pa-id]');
          if (existing.length === 0 && state.annotations.length > 0) {
            renderAllAnnotations();
          }
        }, 500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ========== POPUP NOTIFICATION ==========

  function notifyPopup() {
    chrome.runtime.sendMessage({ action: 'annotationsUpdated', url: window.location.href }).catch(() => {});
  }

  // ========== START ==========

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
