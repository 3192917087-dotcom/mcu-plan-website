// File pickers omit parent directories unless a relative path is available.
// Never treat a matching basename alone as permission to replace saved content.
export function programFilePath(file, group = '') {
  const path = String(file.webkitRelativePath || file.name || '').replace(/\\/g, '/');
  const label = String(group || '').trim().replace(/[\\/\u0000-\u001f]+/g, '_');
  if (!label) return path;
  // A directory selection already carries its root name. Replace that label
  // with the user-visible group without losing the internal relative path.
  const relative = file.webkitRelativePath ? path.split('/').slice(1).join('/') : path;
  return `${label}/${relative || file.name}`;
}

export function appendMaterialFiles(existing = [], incoming = [], { keyField = 'path', contentField = 'content' } = {}) {
  const files = [...existing];
  const key = value => String(value || '').replace(/\\/g, '/').toLowerCase();
  let added = 0, duplicates = 0, renamed = 0;
  for (const record of incoming) {
    const originalPath = String(record.originalPath || record[keyField] || record.name || '');
    if (files.some(item => key(item.originalPath || item[keyField]) === key(originalPath)
      && String(item[contentField] || '') === String(record[contentField] || ''))) {
      duplicates++;
      continue;
    }
    const used = new Set(files.map(item => key(item[keyField])));
    let displayPath = originalPath;
    let number = 2;
    const extensionAt = originalPath.lastIndexOf('.') > originalPath.lastIndexOf('/')
      ? originalPath.lastIndexOf('.') : originalPath.length;
    while (used.has(key(displayPath))) {
      displayPath = `${originalPath.slice(0, extensionAt)}（${number++}）${originalPath.slice(extensionAt)}`;
    }
    if (displayPath !== originalPath) renamed++;
    files.push({ ...record, originalPath, [keyField]: displayPath });
    added++;
  }
  return { files, added, duplicates, renamed };
}
