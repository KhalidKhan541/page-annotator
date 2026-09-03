/* ===== Page Annotator - Annotation Engine ===== */

(function () {
  'use strict';

  const STORAGE = window.PageAnnotatorStorage;

  /**
   * Generate a unique ID for annotations
   */
  function generateId() {
    return 'pa_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
  }

  /**
   * Generate a CSS selector path for a DOM node
   */
  function getNodeSelector(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentNode;
    }

    if (node === document.body) return 'body';
    if (node === document.documentElement) return 'html';

    const parts = [];
    let current = node;

    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector = '#' + CSS.escape(current.id);
        parts.unshift(selector);
        break;
      }

      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).filter((c) => c && !c.startsWith('pa-'));
        if (classes.length > 0) {
          selector += '.' + classes.slice(0, 2).map((c) => CSS.escape(c)).join('.');
        }
      }

      // Add nth-child if needed for disambiguation
      const parent = current.parentNode;
      if (parent) {
        const siblings = Array.from(parent.children).filter((s) => s.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + index + ')';
        }
      }

      parts.unshift(selector);
      current = current.parentNode;
    }

    return parts.join(' > ');
  }

  /**
   * Serialize a Range object into a portable format
   */
  function serializeRange(range) {
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    // Calculate text offsets relative to the text content of parent elements
    function getTextOffset(node, target) {
      if (node === target) return 0;

      let offset = 0;
      const walker = document.createTreeWalker(
        node.nodeType === Node.TEXT_NODE ? node.parentNode : node,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        null
      );

      let current;
      while ((current = walker.nextNode())) {
        if (current === target) break;
        if (current.nodeType === Node.TEXT_NODE) {
          offset += current.textContent.length;
        }
      }

      return offset;
    }

    // Get the full text content and offsets
    function getFullTextPath(node) {
      const selector = getNodeSelector(node);
      const parentEl = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
      const textNodes = [];
      const walker = document.createTreeWalker(parentEl, NodeFilter.SHOW_TEXT, null);
      let textNode;
      while ((textNode = walker.nextNode())) {
        textNodes.push(textNode);
      }
      const nodeIndex = textNodes.indexOf(node.nodeType === Node.TEXT_NODE ? node : parentEl.firstChild);
      return { selector, nodeIndex, isTextNode: node.nodeType === Node.TEXT_NODE };
    }

    const startPath = getFullTextPath(startContainer);
    const endPath = getFullTextPath(endContainer);

    // Calculate text offsets
    let startOffset = range.startOffset;
    let endOffset = range.endOffset;

    // For text nodes, we need the offset within the text content
    if (startContainer.nodeType === Node.TEXT_NODE) {
      // startOffset is already the character offset within the text node
    } else {
      // Element node - count text before offset position
      startOffset = 0;
      const childNodes = Array.from(startContainer.childNodes);
      for (let i = 0; i < range.startOffset && i < childNodes.length; i++) {
        if (childNodes[i].nodeType === Node.TEXT_NODE) {
          startOffset += childNodes[i].textContent.length;
        }
      }
    }

    if (endContainer.nodeType === Node.TEXT_NODE) {
      // endOffset is already the character offset within the text node
    } else {
      endOffset = 0;
      const childNodes = Array.from(endContainer.childNodes);
      for (let i = 0; i < range.endOffset && i < childNodes.length; i++) {
        if (childNodes[i].nodeType === Node.TEXT_NODE) {
          endOffset += childNodes[i].textContent.length;
        }
      }
    }

    return {
      startSelector: startPath.selector,
      startOffset,
      endSelector: endPath.selector,
      endOffset,
      startIsTextNode: startPath.isTextNode,
      endIsTextNode: endPath.isTextNode,
      startNodeIndex: startPath.nodeIndex,
      endNodeIndex: endPath.nodeIndex,
    };
  }

  /**
   * Restore a Range from serialized data
   */
  function deserializeRange(data) {
    try {
      const startEl = document.querySelector(data.startSelector);
      const endEl = document.querySelector(data.endSelector);

      if (!startEl || !endEl) return null;

      function findTextNode(parent, targetIndex) {
        const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT, null);
        let current;
        let index = 0;
        while ((current = walker.nextNode())) {
          if (index === targetIndex) return current;
          index++;
        }
        return null;
      }

      let startContainer, endContainer;

      if (data.startIsTextNode) {
        startContainer = startEl.childNodes[data.startNodeIndex] || startEl;
        if (startContainer.nodeType !== Node.TEXT_NODE) {
          startContainer = findTextNode(startEl, data.startNodeIndex) || startEl;
        }
      } else {
        startContainer = startEl;
      }

      if (data.endIsTextNode) {
        endContainer = endEl.childNodes[data.endNodeIndex] || endEl;
        if (endContainer.nodeType !== Node.TEXT_NODE) {
          endContainer = findTextNode(endEl, data.endNodeIndex) || endEl;
        }
      } else {
        endContainer = endEl;
      }

      // Validate offsets
      const startTextLen = startContainer.nodeType === Node.TEXT_NODE
        ? startContainer.textContent.length
        : startContainer.childNodes.length;
      const endTextLen = endContainer.nodeType === Node.TEXT_NODE
        ? endContainer.textContent.length
        : endContainer.childNodes.length;

      const startOffset = Math.min(data.startOffset, startTextLen);
      const endOffset = Math.min(data.endOffset, endTextLen);

      const range = document.createRange();
      range.setStart(startContainer, startOffset);
      range.setEnd(endContainer, endOffset);

      // Validate the range
      if (range.collapsed && startOffset !== endOffset) {
        return null;
      }

      return range;
    } catch (e) {
      console.warn('Page Annotator: Failed to restore range', e);
      return null;
    }
  }

  /**
   * Highlight text within a range
   */
  function highlightRange(range, color, annotationId) {
    const colorName = getColorName(color);
    const className = `pa-highlight pa-highlight-${colorName}`;

    const marks = [];
    const textNodes = getTextNodesInRange(range);

    textNodes.forEach((textNode) => {
      const { node, start, end } = textNode;
      const text = node.textContent;

      // Split the text node and wrap the selected portion
      const span = document.createElement('mark');
      span.className = className;
      span.dataset.paId = annotationId;
      span.dataset.paType = 'highlight';

      if (start > 0) {
        node.splitText(start);
        node = node.nextSibling;
      }

      if (end < node.textContent.length) {
        node.splitText(end - start);
      }

      const extracted = node.parentNode.replaceChild(span, node);
      span.appendChild(node);
      marks.push(span);
    });

    return marks;
  }

  /**
   * Get all text nodes within a range
   */
  function getTextNodesInRange(range) {
    const textNodes = [];
    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, null);

    let node;
    while ((node = walker.nextNode())) {
      const nodeRange = document.createRange();
      nodeRange.selectNodeContents(node);

      if (range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0 &&
          range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0) {

        let start = 0;
        let end = node.textContent.length;

        if (node === range.startContainer) {
          start = range.startOffset;
        }
        if (node === range.endContainer) {
          end = range.endOffset;
        }

        textNodes.push({ node, start, end });
      }
    }

    return textNodes;
  }

  /**
   * Apply underline decoration to a range
   */
  function underlineRange(range, color, annotationId) {
    const colorName = getColorName(color);
    const marks = [];
    const textNodes = getTextNodesInRange(range);

    textNodes.forEach(({ node, start, end }) => {
      const span = document.createElement('span');
      span.className = `pa-underline pa-underline-${colorName}`;
      span.dataset.paId = annotationId;
      span.dataset.paType = 'underline';

      if (start > 0) node.splitText(start);
      if (end < node.textContent.length) node.splitText(end - start);

      node.parentNode.replaceChild(span, node);
      span.appendChild(node);
      marks.push(span);
    });

    return marks;
  }

  /**
   * Apply strikethrough decoration to a range
   */
  function strikethroughRange(range, color, annotationId) {
    const colorName = getColorName(color);
    const marks = [];
    const textNodes = getTextNodesInRange(range);

    textNodes.forEach(({ node, start, end }) => {
      const span = document.createElement('span');
      span.className = `pa-strikethrough pa-strikethrough-${colorName}`;
      span.dataset.paId = annotationId;
      span.dataset.paType = 'strikethrough';

      if (start > 0) node.splitText(start);
      if (end < node.textContent.length) node.splitText(end - start);

      node.parentNode.replaceChild(span, node);
      span.appendChild(node);
      marks.push(span);
    });

    return marks;
  }

  /**
   * Convert color hex to color name
   */
  function getColorName(hex) {
    const map = {
      '#ffeb3b': 'yellow',
      '#4caf50': 'green',
      '#2196f3': 'blue',
      '#e91e63': 'pink',
      '#ff9800': 'orange',
    };
    return map[hex] || 'yellow';
  }

  /**
   * Remove annotation marks from DOM by annotation ID
   */
  function removeAnnotationMarks(annotationId) {
    const marks = document.querySelectorAll(`[data-pa-id="${annotationId}"]`);
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    });
  }

  /**
   * Create a sticky note element
   */
  function createStickyNote(annotation) {
    const colorName = getColorName(annotation.color);
    const note = document.createElement('div');
    note.className = `pa-sticky-note pa-sticky-note-${colorName}`;
    note.dataset.paId = annotation.id;
    note.dataset.paType = 'note';

    note.style.left = (annotation.x || 100) + 'px';
    note.style.top = (annotation.y || 100) + 'px';

    if (annotation.width) note.style.width = annotation.width + 'px';

    note.innerHTML = `
      <div class="pa-note-header">
        <span>${formatTimestamp(annotation.timestamp)}</span>
        <div class="pa-note-header-actions">
          <button class="pa-note-header-btn pa-edit-note" title="Edit">✎</button>
          <button class="pa-note-header-btn pa-delete-note" title="Delete">×</button>
        </div>
      </div>
      <div class="pa-note-body">${escapeHtml(annotation.note || 'Click to add a note...')}</div>
      <textarea class="pa-note-body-edit" placeholder="Type your note...">${escapeHtml(annotation.note || '')}</textarea>
      <div class="pa-note-resize"></div>
    `;

    // Make draggable
    makeDraggable(note, annotation);
    makeResizable(note, annotation);

    // Event handlers
    const editBtn = note.querySelector('.pa-edit-note');
    const deleteBtn = note.querySelector('.pa-delete-note');
    const bodyEl = note.querySelector('.pa-note-body');
    const editArea = note.querySelector('.pa-note-body-edit');

    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      note.classList.toggle('pa-note-editing');
      if (note.classList.contains('pa-note-editing')) {
        editArea.focus();
      }
    });

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.PageAnnotatorContent) {
        window.PageAnnotatorContent.deleteAnnotation(annotation.id);
      }
    });

    editArea.addEventListener('blur', () => {
      note.classList.remove('pa-note-editing');
      annotation.note = editArea.value;
      bodyEl.textContent = editArea.value;
      // Save updated note
      if (window.PageAnnotatorContent) {
        window.PageAnnotatorContent.updateAnnotation(annotation.id, { note: editArea.value });
      }
    });

    editArea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        editArea.blur();
      }
    });

    return note;
  }

  /**
   * Make an element draggable
   */
  function makeDraggable(el, annotation) {
    let isDragging = false;
    let startX, startY, origX, origY;

    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('.pa-note-header-btn') || e.target.closest('.pa-note-body-edit') || e.target.closest('.pa-note-resize')) return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origX = parseInt(el.style.left) || 0;
      origY = parseInt(el.style.top) || 0;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = (origX + dx) + 'px';
      el.style.top = (origY + dy) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;

      if (annotation && window.PageAnnotatorContent) {
        window.PageAnnotatorContent.updateAnnotation(annotation.id, {
          x: parseInt(el.style.left),
          y: parseInt(el.style.top),
        });
      }
    });
  }

  /**
   * Make a note resizable
   */
  function makeResizable(el, annotation) {
    const handle = el.querySelector('.pa-note-resize');
    if (!handle) return;

    let isResizing = false;
    let startX, startY, startW, startH;

    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = el.offsetWidth;
      startH = el.offsetHeight;
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const w = Math.max(160, startW + (e.clientX - startX));
      const h = Math.max(80, startH + (e.clientY - startY));
      el.style.width = w + 'px';
      el.style.height = h + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!isResizing) return;
      isResizing = false;

      if (annotation && window.PageAnnotatorContent) {
        window.PageAnnotatorContent.updateAnnotation(annotation.id, {
          width: el.offsetWidth,
        });
      }
    });
  }

  /**
   * Render SVG path data onto canvas
   */
  function renderDrawingOnCanvas(annotation) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'pa-drawing-element');
    svg.dataset.paId = annotation.id;
    svg.dataset.paType = 'draw';
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = document.documentElement.scrollWidth + 'px';
    svg.style.height = document.documentElement.scrollHeight + 'px';
    svg.style.pointerEvents = 'none';
    svg.style.overflow = 'visible';

    if (annotation.paths && annotation.paths.length > 0) {
      annotation.paths.forEach((pathData) => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData.d);
        path.setAttribute('stroke', pathData.color || annotation.color);
        path.setAttribute('stroke-width', pathData.size || 3);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
      });
    }

    return svg;
  }

  /**
   * Format timestamp
   */
  function formatTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Escape HTML
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Export the engine
  window.PageAnnotatorEngine = {
    generateId,
    getNodeSelector,
    serializeRange,
    deserializeRange,
    highlightRange,
    underlineRange,
    strikethroughRange,
    getTextNodesInRange,
    removeAnnotationMarks,
    createStickyNote,
    renderDrawingOnCanvas,
    getColorName,
    formatTimestamp,
    escapeHtml,
  };
})();
