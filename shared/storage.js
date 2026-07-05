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