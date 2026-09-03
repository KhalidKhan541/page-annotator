/* ===== Page Annotator - Storage Module ===== */

(function () {
  'use strict';

  const STORAGE_KEY = 'pa_annotations';
  const BACKUP_KEY = 'pa_annotations_backup';
  const MAX_STORAGE_BYTES = 5 * 1024 * 1024; // 5MB safety limit
  const BACKUP_INTERVAL = 50; // Backup every N writes

  let writeCount = 0;

  window.PageAnnotatorStorage = {
    STORAGE_KEY,
    BACKUP_KEY,

    /**
     * Get all annotations for all pages
     * @returns {Promise<Object>} Map of URL -> annotation[]
     */
    async getAllAnnotations() {
      return new Promise((resolve) => {
        chrome.storage.local.get(STORAGE_KEY, (data) => {
          resolve(data[STORAGE_KEY] || {});
        });
      });
    },

    /**
     * Get annotations for a specific URL
     * @param {string} url
     * @returns {Promise<Array>}
     */
    async getAnnotationsForUrl(url) {
      const key = this.normalizeUrl(url);
      const all = await this.getAllAnnotations();
      return all[key] || [];
    },

    /**
     * Save an annotation for a URL
     * @param {string} url
     * @param {Object} annotation
     * @returns {Promise<void>}
     */
    async saveAnnotation(url, annotation) {
      const key = this.normalizeUrl(url);
      const all = await this.getAllAnnotations();

      if (!all[key]) {
        all[key] = [];
      }

      // Check if annotation already exists (update)
      const idx = all[key].findIndex((a) => a.id === annotation.id);
      if (idx >= 0) {
        all[key][idx] = annotation;
      } else {
        all[key].push(annotation);
      }

      await this._writeStorage(all);
    },

    /**
     * Delete an annotation by ID from a URL
     * @param {string} url
     * @param {string} annotationId
     * @returns {Promise<void>}
     */
    async deleteAnnotation(url, annotationId) {
      const key = this.normalizeUrl(url);
      const all = await this.getAllAnnotations();

      if (all[key]) {
        all[key] = all[key].filter((a) => a.id !== annotationId);
        if (all[key].length === 0) {
          delete all[key];
        }
        await this._writeStorage(all);
      }
    },

    /**
     * Clear all annotations for a URL
     * @param {string} url
     * @returns {Promise<void>}
     */
    async clearAnnotationsForUrl(url) {
      const key = this.normalizeUrl(url);
      const all = await this.getAllAnnotations();
      delete all[key];
      await this._writeStorage(all);
    },

    /**
     * Clear all annotations
     * @returns {Promise<void>}
     */
    async clearAllAnnotations() {
      await this._writeStorage({});
    },

    /**
     * Full-text search across all annotations
     * @param {string} query
     * @returns {Promise<Array>} Matching annotations with URL info
     */
    async searchAnnotations(query) {
      if (!query || query.trim().length === 0) return [];

      const all = await this.getAllAnnotations();
      const q = query.toLowerCase().trim();
      const results = [];

      for (const url in all) {
        for (const annotation of all[url]) {
          const textMatch = annotation.text && annotation.text.toLowerCase().includes(q);
          const noteMatch = annotation.note && annotation.note.toLowerCase().includes(q);

          if (textMatch || noteMatch) {
            results.push({
              ...annotation,
              _sourceUrl: url,
              _matchType: textMatch ? 'text' : 'note',
            });
          }
        }
      }

      return results;
    },

    /**
     * Export all annotations as JSON string
     * @returns {Promise<string>}
     */
    async exportAsJson() {
      const all = await this.getAllAnnotations();
      return JSON.stringify(all, null, 2);
    },

    /**
     * Export annotations for a single page
     * @param {string} url
     * @returns {Promise<string>}
     */
    async exportPageAsJson(url) {
      const annotations = await this.getAnnotationsForUrl(url);
      return JSON.stringify({ url, annotations, exportedAt: new Date().toISOString() }, null, 2);
    },

    /**
     * Import annotations from JSON string
     * @param {string} jsonString
     * @returns {Promise<{imported: number, pages: number}>}
     */
    async importFromJson(jsonString) {
      const imported = JSON.parse(jsonString);

      if (typeof imported !== 'object' || Array.isArray(imported)) {
        throw new Error('Invalid import format: expected an object of URL -> annotations[]');
      }

      const all = await this.getAllAnnotations();
      let totalImported = 0;
      let pageCount = 0;

      for (const url in imported) {
        if (!Array.isArray(imported[url])) continue;

        if (!all[url]) {
          all[url] = [];
        }

        // Deduplicate by ID
        const existingIds = new Set(all[url].map((a) => a.id));
        for (const annotation of imported[url]) {
          if (!existingIds.has(annotation.id)) {
            all[url].push(annotation);
            totalImported++;
          }
        }
        pageCount++;
      }

      await this._writeStorage(all);
      return { imported: totalImported, pages: pageCount };
    },

    /**
     * Get storage statistics
     * @returns {Promise<Object>}
     */
    async getStats() {
      const all = await this.getAllAnnotations();
      let totalAnnotations = 0;
      let highlightCount = 0;
      let noteCount = 0;
      let drawCount = 0;

      for (const url in all) {
        totalAnnotations += all[url].length;
        for (const a of all[url]) {
          if (a.type === 'highlight' || a.type === 'underline' || a.type === 'strikethrough') highlightCount++;
          if (a.type === 'note') noteCount++;
          if (a.type === 'draw') drawCount++;
        }
      }

      return {
        totalAnnotations,
        pagesAnnotated: Object.keys(all).length,
        highlightCount,
        noteCount,
        drawCount,
      };
    },

    /**
     * Normalize URL for storage key
     * Strips hash, normalizes search params
     */
    normalizeUrl(url) {
      try {
        const u = new URL(url);
        // Remove hash for consistency
        return u.origin + u.pathname + u.search;
      } catch {
        return url;
      }
    },

    /**
     * Check storage quota
     * @returns {Promise<Object>}
     */
    async checkQuota() {
      return new Promise((resolve) => {
        chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
          resolve({
            bytesInUse,
            maxBytes: MAX_STORAGE_BYTES,
            percentage: Math.round((bytesInUse / MAX_STORAGE_BYTES) * 100),
            isNearLimit: bytesInUse > MAX_STORAGE_BYTES * 0.8,
          });
        });
      });
    },

    /**
     * Create a backup of current annotations
     */
    async createBackup() {
      const all = await this.getAllAnnotations();
      return new Promise((resolve) => {
        chrome.storage.local.set({ [BACKUP_KEY]: all }, resolve);
      });
    },

    /**
     * Restore from backup
     */
    async restoreBackup() {
      return new Promise((resolve) => {
        chrome.storage.local.get(BACKUP_KEY, async (data) => {
          if (data[BACKUP_KEY]) {
            await this._writeStorage(data[BACKUP_KEY]);
            resolve(true);
          } else {
            resolve(false);
          }
        });
      });
    },

    /**
     * Internal: Write to storage with backup rotation
     */
    async _writeStorage(data) {
      return new Promise((resolve, reject) => {
        // Check size
        const jsonSize = new Blob([JSON.stringify(data)]).size;
        if (jsonSize > MAX_STORAGE_BYTES) {
          reject(new Error('Storage quota exceeded. Please export and clear some annotations.'));
          return;
        }

        writeCount++;

        // Periodic backup
        if (writeCount % BACKUP_INTERVAL === 0) {
          chrome.storage.local.set({ [BACKUP_KEY]: data });
        }

        chrome.storage.local.set({ [STORAGE_KEY]: data }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    },
  };
})();
