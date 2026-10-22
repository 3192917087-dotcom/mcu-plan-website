const text = { type: 'string' };
const texts = { type: 'array', items: text };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = items => ({ type: 'array', items });
const device = object({ model: text, role: text });

export const AI_SCHEMAS = Object.freeze({
  'reference-outline': object({outlineText:text,warnings:texts}),
  motivation: object({ text }),
  scheme: object({ title: text, devices: array(device), functions: texts }),
  import: object({ title: text, devices: array(device), functions: texts, sourceNotes: text }),
  hardware: object({
    controller: text, developmentTools: texts, backgroundNotes: text,
    devices: array(object({ model: text, role: text, interfaceType: text })),
    functions: array(object({ name: text, deviceModels: texts })),
    mappings: array(object({ device: text, interfaceType: text, signal: text, pin: text, alternatives: texts, busGroup: text, shareAllowed: { type: 'boolean' } })),
    powerNotes: texts, fixedFacts: texts, conflicts: texts,
  }),
  references: object({ selected: array(object({ id: text, reason: text })), summary: text }),
  outline: object({ summary: text, chapters: array(object({
    id: text, title: text, kind: { type: 'string', enum: ['introduction', 'overall', 'hardware', 'software', 'implementation', 'requirement', 'test', 'conclusion', 'other'] }, roles: texts, sections: texts,
  })), referenceUsage: array(object({ referenceId: text, action: { type: 'string', enum: ['adopted', 'adapted', 'not-applicable'] }, sections: texts, reason: text })) }),
  extras: object({ titleEn: text, abstractCn: text, abstractEn: text, keywords: text, keywordsEn: text, acknowledgment: text }),
  audit: object({ summary: text, issues: array(object({
    severity: { type: 'string', enum: ['blocking', 'warning'] }, type: text, chapterId: text, message: text,
    repairable: { type: 'boolean' }, find: text, replace: text,
  })) }),
  brief: object({
    overview: text,
    functionCoverage: array(object({ functionId: text, implementation: text, softwareFocus: text, testFocus: text })),
    sourceObservations: texts, uncertainties: texts,
  }),
  patch: object({ summary: text, patches: array(object({ find: text, replace: text })) }),
});

export function schemaForTask(task, label = '') {
  if (/方案资料分析/.test(label)) return AI_SCHEMAS.import;
  return AI_SCHEMAS[task] || null;
}
