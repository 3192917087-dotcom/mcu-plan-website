const DB_NAME = 'mcu-paper-studio-v2';
const DB_VERSION = 1;
const PROJECT_STORE = 'projects';
const ACTIVE_PROJECT_KEY = 'mcu-paper-studio-v2.active-project';
const LEGACY_PROJECT_KEY = 'mcu-paper-studio.project.v1';

let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('当前浏览器不支持项目数据库，请使用新版 Chrome 或 Edge'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        const store = db.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('项目数据库打开失败'));
    request.onblocked = () => reject(new Error('项目数据库正在被其他页面占用，请关闭旧标签页后重试'));
  });
  return databasePromise;
}

async function transact(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PROJECT_STORE, mode);
    const store = transaction.objectStore(PROJECT_STORE);
    let result;
    try {
      result = operation(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(result?.result ?? result);
    transaction.onerror = () => reject(transaction.error || new Error('项目保存失败'));
    transaction.onabort = () => reject(transaction.error || new Error('项目保存已取消'));
  });
}

export async function listProjects() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PROJECT_STORE, 'readonly');
    const request = transaction.objectStore(PROJECT_STORE).getAll();
    request.onsuccess = () => {
      const projects = Array.isArray(request.result) ? request.result : [];
      projects.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      resolve(projects);
    };
    request.onerror = () => reject(request.error || new Error('项目列表读取失败'));
  });
}

export async function getProject(id) {
  if (!id) return null;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PROJECT_STORE, 'readonly');
    const request = transaction.objectStore(PROJECT_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('项目读取失败'));
  });
}

export async function saveProject(project) {
  if (!project?.id) throw new Error('项目编号缺失，无法保存');
  const snapshot = structuredClone(project);
  snapshot.updatedAt = new Date().toISOString();
  await transact('readwrite', store => store.put(snapshot));
  return snapshot;
}

export async function deleteProject(id) {
  if (!id) return;
  await transact('readwrite', store => store.delete(id));
  if (getActiveProjectId() === id) localStorage.removeItem(ACTIVE_PROJECT_KEY);
}

export function getActiveProjectId() {
  return localStorage.getItem(ACTIVE_PROJECT_KEY) || '';
}

export function setActiveProjectId(id) {
  if (id) localStorage.setItem(ACTIVE_PROJECT_KEY, id);
  else localStorage.removeItem(ACTIVE_PROJECT_KEY);
}

export function readLegacyProject() {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_PROJECT_KEY) || 'null');
  } catch (error) {
    return null;
  }
}

export function downloadProjectBackup(project) {
  const safeTitle = String(project?.title || project?.name || '未命名项目').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeTitle}_项目备份.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importProjectFile(file, normalizeProject) {
  const raw = JSON.parse(await file.text());
  const source = raw?.project || raw;
  if (!source || typeof source !== 'object') throw new Error('项目备份内容无效');
  const project = normalizeProject(source, { imported: true });
  await saveProject(project);
  setActiveProjectId(project.id);
  return project;
}

export async function duplicateProject(source, normalizeProject) {
  const copy = normalizeProject(structuredClone(source), { duplicate: true });
  await saveProject(copy);
  setActiveProjectId(copy.id);
  return copy;
}
