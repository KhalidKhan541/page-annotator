/* ===== Page Annotator - Background Service Worker ===== */

(function () {
  'use strict';

  const STORAGE_KEY = 'pa_annotations';

  // ========== CONTEXT MENUS ==========

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: 'pa-highlight',
      title: 'Highlight Selection',
      contexts: ['selection'],
    });

    chrome.contextMenus.create({
      id: 'pa-note',
      title: 'Add Note Here',
      contexts: ['page', 'selection'],
    });

    chrome.contextMenus.create({
      id: 'pa-separator',
      type: 'separator',
      contexts: ['page', 'selection'],
    });

    chrome.contextMenus.create({
      id: 'pa-toggle',
      title: 'Toggle Annotation Mode',
      contexts: ['page'],
    });

    // Initialize storage
    chrome.storage.local.get(STORAGE_KEY, (data) => {
      if (!data[STORAGE_KEY]) {
        chrome.storage.local.set({ [STORAGE_KEY]: {} });
      }
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab || !tab.id) return;

    switch (info.menuItemId) {
      case 'pa-highlight':
        sendToTab(tab.id, {
          action: 'setTool',
          tool: 'highlight',
          color: '#ffeb3b',
        });
        // Small delay to ensure tool is set
        setTimeout(() => {
          sendToTab(tab.id, { action: 'applyContextHighlight' });
        }, 100);
        break;

      case 'pa-note':
        const x = info.selectionInfo ? info.selectionInfo.clientX : info.menuGroupId;
        const y = info.selectionInfo ? info.selectionInfo.clientY : 0;
        sendToTab(tab.id, {
          action: 'setTool',
          tool: 'note',
          color: '#ffeb3b',
        });
        setTimeout(() => {
          sendToTab(tab.id, {
            action: 'applyContextNote',
            x: x || 200,
            y: y || 200,
          });
        }, 100);
        break;

      case 'pa-toggle':
        sendToTab(tab.id, { action: 'toggleAnnotationMode' });
        break;
    }
  });

  // ========== MESSAGE HANDLING ==========

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.action) {
      case 'getAnnotations':
        getAnnotationsForUrl(msg.url || sender.tab?.url)
          .then((annotations) => sendResponse({ annotations }))
          .catch(() => sendResponse({ annotations: [] }));
        return true; // async response

      case 'saveAnnotation':
        saveAnnotation(msg.url, msg.annotation)
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;

      case 'deleteAnnotation':
        deleteAnnotation(msg.url, msg.id)
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;

      case 'annotationsUpdated':
        updateBadge(msg.url);
        break;

      case 'getStats':
        getStats()
          .then((stats) => sendResponse(stats))
          .catch(() => sendResponse({ total: 0, pages: 0 }));
        return true;
    }
  });

  // ========== TAB MANAGEMENT ==========

  chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
      if (tab && tab.url) {
        updateBadge(tab.url);
      }
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
      updateBadge(tab.url);
    }
  });

  // ========== BADGE MANAGEMENT ==========

  async function updateBadge(url) {
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }

    try {
      const annotations = await getAnnotationsForUrl(url);
      const count = annotations.length;

      chrome.action.setBadgeText({
        text: count > 0 ? String(count) : '',
        tabId: undefined, // works across all tabs
      });

      chrome.action.setBadgeBackgroundColor({
        color: count > 0 ? '#4a90d9' : '#888',
      });
    } catch (e) {
      // Silently fail for restricted URLs
    }
  }

  // ========== STORAGE HELPERS ==========

  async function getAnnotationsForUrl(url) {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (data) => {
        const all = data[STORAGE_KEY] || {};
        const key = normalizeUrl(url);
        resolve(all[key] || []);
      });
    });
  }

  async function saveAnnotation(url, annotation) {
    return new Promise((resolve, reject) => {
      const key = normalizeUrl(url);

      chrome.storage.local.get(STORAGE_KEY, (data) => {
        const all = data[STORAGE_KEY] || {};

        if (!all[key]) all[key] = [];

        const idx = all[key].findIndex((a) => a.id === annotation.id);
        if (idx >= 0) {
          all[key][idx] = annotation;
        } else {
          all[key].push(annotation);
        }

        chrome.storage.local.set({ [STORAGE_KEY]: all }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    });
  }

  async function deleteAnnotation(url, annotationId) {
    return new Promise((resolve) => {
      const key = normalizeUrl(url);

      chrome.storage.local.get(STORAGE_KEY, (data) => {
        const all = data[STORAGE_KEY] || {};

        if (all[key]) {
          all[key] = all[key].filter((a) => a.id !== annotationId);
          if (all[key].length === 0) delete all[key];
        }

        chrome.storage.local.set({ [STORAGE_KEY]: all }, resolve);
      });
    });
  }

  async function getStats() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (data) => {
        const all = data[STORAGE_KEY] || {};
        let total = 0;

        for (const url in all) {
          total += all[url].length;
        }

        resolve({
          total,
          pages: Object.keys(all).length,
        });
      });
    });
  }

  function normalizeUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      return u.origin + u.pathname + u.search;
    } catch {
      return url;
    }
  }

  // ========== TAB COMMUNICATION ==========

  function sendToTab(tabId, message) {
    chrome.tabs.sendMessage(tabId, message).catch(() => {
      // Content script not loaded on this page
    });
  }
})();
