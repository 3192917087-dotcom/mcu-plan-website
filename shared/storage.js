/* ============================================================
 * storage.js
 * localStorage 封装：跨页数据流
 * 规则：所有 key 前缀 mcu.shared.* 或 mcu.{page}.*
 * 不黑盒：每个方法都明确读写 key
 * ============================================================ */

const Storage = (() => {
  const PREFIX = 'mcu.';

  function get(key, fallback = null) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      console.warn('Storage.get failed:', key, e);
      return fallback;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('Storage.set failed:', key, e);
      return false;
    }
  }

  function remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch (e) {
      console.warn('Storage.remove failed:', key, e);
    }
  }

  function clear(prefix = '') {
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(PREFIX + prefix));
      keys.forEach(k => localStorage.removeItem(k));
    } catch (e) {
      console.warn('Storage.clear failed:', e);
    }
  }

  function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeDevices(value) {
    const list = Array.isArray(value)
      ? value
      : (typeof value === 'string' ? value.split(/\r?\n|[、，,；;]+/) : []);
    return dedupeStrings(list.map(item => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      const model = normalizeText(item.model || item.name);
      const role = normalizeText(item.role);
      return model && role ? `${model}（${role}）` : model;
    }));
  }

  function normalizeFuncs(value) {
    const list = Array.isArray(value)
      ? value
      : (typeof value === 'string' ? value.split(/\r?\n/) : []);
    return dedupeStrings(list.map(item => {
      const text = typeof item === 'string' ? item : item?.text;
      return normalizeText(text)
        .replace(/^[-*+]\s*/, '')
        .replace(/^\[[ xX]\]\s*/, '')
        .replace(/^\d+[.、]\s*/, '');
    }));
  }

  function dedupeStrings(values) {
    const seen = new Set();
    return values.filter(value => {
      const text = normalizeText(value);
      if (!text) return false;
      const key = text.toLowerCase().replace(/\s+/g, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(normalizeText);
  }

  function normalizeProjectContext(input = {}) {
    return {
      schemaVersion: 2,
      revision: normalizeText(input.revision),
      topic: normalizeText(input.topic),
      level: normalizeText(input.level) || 'B',
      devices: normalizeDevices(input.devices),
      funcs: normalizeFuncs(input.funcs),
      scheme: normalizeText(input.scheme),
      kaiti: normalizeText(input.kaiti),
      refs: normalizeFuncs(input.refs),
      source: normalizeText(input.source) || 'manual',
      updatedAt: normalizeText(input.updatedAt),
    };
  }

  function getProjectContext() {
    const stored = get('shared.projectContext', null);
    if (stored) return normalizeProjectContext(stored);

    const meta = get('shared.meta', {}) || {};
    const legacy = normalizeProjectContext({
      ...meta,
      topic: meta.topic || get('shared.topic', ''),
      devices: meta.devices || get('shared.devices', []),
      funcs: meta.funcs || get('shared.funcs', []),
      scheme: get('shared.scheme', ''),
      kaiti: get('shared.kaiti', ''),
      refs: meta.refs || [],
      source: meta.source || 'legacy',
    });
    return legacy.topic || legacy.devices.length || legacy.funcs.length ? legacy : null;
  }

  function setProjectContext(patch = {}) {
    const previous = getProjectContext() || normalizeProjectContext();
    const next = normalizeProjectContext({ ...previous, ...patch });
    const semanticFields = ['topic', 'level', 'devices', 'funcs', 'scheme', 'kaiti', 'refs', 'source'];
    const changed = semanticFields.some(key => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
    next.revision = changed || !previous.revision ? `project-${Date.now()}` : previous.revision;
    next.updatedAt = new Date().toISOString();

    set('shared.projectContext', next);
    // 同步旧字段，兼容现有页面与用户此前保存的数据。
    set('shared.topic', next.topic);
    set('shared.devices', next.devices);
    set('shared.funcs', next.funcs);
    set('shared.scheme', next.scheme);
    set('shared.kaiti', next.kaiti);
    set('shared.meta', {
      ...(get('shared.meta', {}) || {}),
      topic: next.topic,
      level: next.level,
      devices: next.devices,
      funcs: next.funcs,
      refs: next.refs,
      source: next.source,
      revision: next.revision,
      updatedAt: next.updatedAt,
      generatorVersion: 'v16.1.0',
    });
    return next;
  }

  // === 跨页数据流（shared） ===
  const Shared = {
    setTopic(topic) { set('shared.topic', topic); },
    getTopic() { return get('shared.topic', ''); },

    setScheme(scheme) { set('shared.scheme', scheme); },
    getScheme() { return get('shared.scheme', ''); },
    clearScheme() { remove('shared.scheme'); },

    setMeta(meta) { set('shared.meta', meta); },
    getMeta() { return get('shared.meta', null); },
    clearMeta() { remove('shared.meta'); },

    setProjectContext,
    getProjectContext,
    clearProjectContext() { remove('shared.projectContext'); },

    setDevices(devices) { set('shared.devices', devices); },
    getDevices() { return get('shared.devices', []); },

    setFuncs(funcs) { set('shared.funcs', funcs); },
    getFuncs() { return get('shared.funcs', []); },

    setKaiti(kaiti) { set('shared.kaiti', kaiti); },
    getKaiti() { return get('shared.kaiti', ''); },

    setThesis(thesis) { set('shared.thesis', thesis); },
    getThesis() { return get('shared.thesis', ''); },

    setPPT(ppt) { set('shared.ppt', ppt); },
    getPPT() { return get('shared.ppt', ''); },

    setProgress(stage) { set('shared.progress', stage); },  // 用 markComplete / 直接 set('shared.progress', ...) 代替
    getProgress() { return get('shared.progress', { topic: false, taskbook: false, thesis: false, ppt: false }); },

    markComplete(stage) {
      const p = get('shared.progress', { topic: false, taskbook: false, thesis: false, ppt: false });
      p[stage] = true;
      set('shared.progress', p);
    },

    markIncomplete(stage) {
      const p = get('shared.progress', { topic: false, taskbook: false, thesis: false, ppt: false });
      p[stage] = false;
      set('shared.progress', p);
    },

    clearAll() {
      clear('shared');
    },
  };

  return { get, set, remove, clear, Shared };
})();

window.Storage = Storage;
export default Storage;
