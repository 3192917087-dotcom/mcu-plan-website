import { filterSignalMappings, isSignalPeripheral } from './hardware-signals.js?v=20261118-2';

// Share identities between planning and validation. Parentheses can contain a
// part number OR an instance label (left/right, heater/fan); never discard both.
const unique = values => [...new Set(values.filter(Boolean))];
export const deviceIdentityKey = value => String(value || '').normalize('NFKC')
  .replace(/[\s（）()_－—\-]/g, '').toLowerCase();
const deviceLabel = device => String(typeof device === 'string' ? device : device?.model || device?.name || '').trim();
const detail = value => {
  const match = String(value).match(/^(.*?)[（(]([^）)]+)[）)]\s*$/);
  // Only a recognizable part number qualifies as an alias expansion. A side,
  // channel or control target remains a separate instance.
  return match && /[A-Za-z]+[\w.-]*\d[\w.-]*/.test(match[2])
    && !/左|右|通道|第[一二三四五六七八九\d]|控制|加热|风扇|灯|泵|阀/i.test(match[2])
    ? { base: deviceIdentityKey(match[1]), qualifier: deviceIdentityKey(match[2]) } : null;
};

export function devicePlanGroups(devices = [], controller = '') {
  const records = devices.map((item, index) => {
    const record = typeof item === 'string' ? { model: item } : { ...item };
    const model = deviceLabel(record);
    return { ...record, model, id: record.id || `device-${index + 1}`,
      aliases: unique([model, ...(record.aliases || [])]),
      sourceFactIds: unique([record.id || `device-${index + 1}`, ...(record.sourceFactIds || [])]) };
  }).filter(record => record.model);
  if (controller && !records.some(record => record.aliases.some(alias => deviceIdentityKey(alias) === deviceIdentityKey(controller)))) {
    const id = `device-controller-${controller}`;
    records.unshift({ id, model: controller, role: '主控', aliases: [controller], sourceFactIds: [id] });
  }
  const groups = [];
  const merge = (group, record) => {
    group.aliases = unique([...group.aliases, ...record.aliases]);
    group.sourceFactIds = unique([...group.sourceFactIds, ...record.sourceFactIds]);
    group.role = unique([group.role, record.role]).join('；');
    group.interfaceType ||= record.interfaceType || '';
    if (detail(record.model) && !detail(group.model)) group.model = record.model;
  };
  // Exact names first. Resolve generic-to-specific aliases only when unambiguous;
  // two different real part numbers sharing a generic label must stay separate.
  records.forEach(record => {
    const existing = groups.find(group => deviceIdentityKey(group.model) === deviceIdentityKey(record.model));
    if (existing) merge(existing, record); else groups.push(record);
  });
  for (const generic of [...groups]) {
    if (detail(generic.model)) continue;
    const matches = groups.filter(group => detail(group.model)?.base === deviceIdentityKey(generic.model));
    if (matches.length === 1 && groups.includes(generic)) {
      merge(generic, matches[0]);
      groups.splice(groups.indexOf(matches[0]), 1);
    }
  }
  return groups;
}

export function matchesDevice(mappingName, device) {
  const key = deviceIdentityKey(mappingName);
  const aliases = unique([device.model, ...(device.aliases || [])]).map(deviceIdentityKey);
  if (!key) return false;
  if (aliases.includes(key)) return true;
  return aliases.some(alias => {
    // Do not match a generic name to an explicitly labelled left/right instance.
    const side = value => value.includes('左') ? '左' : value.includes('右') ? '右' : '';
    if (side(alias) !== side(key) && (side(alias) || side(key))) return false;
    return alias && (key.includes(alias) || alias.includes(key));
  });
}

export function functionPlanRecords(functions = []) {
  const records = [];
  functions.forEach((item, index) => {
    const record = typeof item === 'object' && item ? { ...item } : { name: String(item || '') };
    const source = String(record.source || record.name || record.description || '')
      .replace(/^\s*(?:\d+[.、]|[-•])\s*/, '').replace(/[。；;，,\s]+$/g, '').trim();
    if (!source) return;
    const id = record.id || `function-${index + 1}`;
    const ids = unique([id, ...(record.sourceFactIds || [])]);
    const key = source.replace(/[\s，,。；;、：:（）()“”'"·.]/g, '').toLowerCase();
    const existing = records.find(value => value.key === key);
    if (existing) existing.sourceFactIds = unique([...existing.sourceFactIds, ...ids]);
    else records.push({ ...record, id, source, key, sourceFactIds: ids });
  });
  return records;
}

export function paperMaterialPreflight(project) {
  const facts = project?.paper?.factSheet || {};
  const materials = project?.paper?.materials || {};
  const signalMappings = filterSignalMappings(facts.mappings || [], facts.devices || []);
  const issues = [];
  if (!String(project?.title || '').trim()) issues.push({ step: 'materials', message: '请先填写论文题目' });
  if (!String(facts.controller || '').trim()) issues.push({ step: 'pins', message: '尚未确定主控，请先分析并确认器件与引脚' });
  if (!devicePlanGroups(facts.devices || [], facts.controller).length) issues.push({ step: 'pins', message: '尚未整理器件，请先分析器件' });
  if (!functionPlanRecords(facts.functions || []).length) issues.push({ step: 'pins', message: '尚未整理项目功能，请先分析并确认功能建议' });
  if (!facts.analyzedAt) issues.push({ step: 'materials', message: '请先分析器件和功能；只提供题目时也可由系统整理建议' });
  const boards = Array.isArray(facts.boards) ? facts.boards : [];
  // Several PDFs or Core/Drivers folders can belong to one board. Only explicit
  // topology or clear board/firmware labels justify blocking a single-board result.
  const programRoots = new Set((materials.codeFiles || []).map(file => String(file?.group || String(file?.path || '').replace(/\\/g, '/').split('/').slice(0, -1)[0] || '').trim().toLowerCase()).filter(root => /^(?:主板|从板|主控板|从控板|采集板|控制板|节点\d+|main|master|slave|gateway|node\d+)$/.test(root)));
  const requestedMultiBoard = materials.projectTopology === 'multi' || (materials.projectTopology !== 'single' && programRoots.size > 1);
  if (requestedMultiBoard && boards.length < 2) issues.push({ step: 'pins', message: '已选择多板项目，但尚未识别出至少两块板，请重新分析原理图和程序资料' });
  if (boards.length > 1) {
    boards.forEach(board => {
      if (!String(board.controller || '').trim()) issues.push({ step: 'pins', message: `${board.name || '板卡'}尚未确定主控` });
    });
    const knownBoardIds = new Set(boards.map(board => board.id));
    const unassignedMappings = signalMappings.filter(mapping => !mapping.boardId || !knownBoardIds.has(mapping.boardId));
    if (unassignedMappings.length) issues.push({ step: 'pins', message: `${unassignedMappings.length}项引脚连接尚未归属到具体板卡` });
  }
  if (facts.conflicts?.length && !facts.conflictsAcknowledged) issues.push({ step: 'pins', message: '存在未确认的资料冲突，请先核对实际情况' });
  const seenFunctionIds = new Set();
  (facts.functions || []).forEach((func, index) => {
    const id = func?.id || `function-${index + 1}`;
    if (seenFunctionIds.has(id)) issues.push({ step: 'pins', message: '项目功能标识重复，请重新分析器件以整理功能对应关系' });
    seenFunctionIds.add(id);
  });
  const missingPins = signalMappings.filter(mapping => !mapping.pin || /待确认|待分配|未知|TBD|^[-?]+$/i.test(mapping.pin));
  if (missingPins.length) issues.push({ step: 'pins', message: `${missingPins.length}项硬件连接尚未确定引脚，请先确认` });
  if (!signalMappings.length && devicePlanGroups(facts.devices || [], facts.controller).some(isSignalPeripheral)) {
    issues.push({ step: 'pins', message: '尚未建立外设引脚连接，请先分析并确认器件与引脚' });
  }
  const invalidFiles = (materials.codeFiles || []).filter(file => !String(file.content || '').trim());
  if (invalidFiles.length) issues.push({ step: 'materials', message: `已选择的程序文件未读取到内容：${invalidFiles.slice(0, 3).map(file => file.name || file.path).join('、')}，请重新选择或移除空文件` });
  const assumptions = [];
  if (!materials.codeFiles?.length && !String(materials.codeText || '').trim()) assumptions.push('未提供源程序，依据确认方案说明软件设计，不声称已核对源代码');
  if (!String(materials.testInfo || '').trim()) assumptions.push('未提供实测记录，不把缺失记录视为功能未完成，也不声称推测值已经实测');
  if (!String(materials.schematicText || '').trim()) assumptions.push('未提供原理图，硬件描述以用户确认的引脚和供电约定为准');
  return { issues, assumptions };
}
