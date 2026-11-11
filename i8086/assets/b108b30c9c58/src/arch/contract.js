// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const CONTRACT_VERSION = 10;
export const OUTPUT_KEEP = 1 << 20;
export const STOP = Object.freeze({
 NONE: 'none',
 HALT: 'halt',
 ERROR: 'error',
 BREAK: 'break',
 WATCH: 'watch',
 BUDGET: 'budget',
 TARGET: 'target',
 PAUSE: 'pause',
 CHUNK: 'chunk',
});
export const CAPABILITIES = Object.freeze([
 'assembler',
 'cLanguage',
 'backStep',
 'breakpoints',
 'watchpoints',
 'stepOver',
 'callStack',
 'runToCursor',
 'scratch',
 'imageImport',
 'gccImport',
 'dataIO',
 'uninitCheck',
 'memoryModel',
 'cache',
 'devices',
 'traps',
 'compare',
 'waveform',
 'exercises',
 'share',
 'exportTrace',
 'exportGolden',
 'exportImage',
 'worker',
 'realtime',
 'audio',
 'projects',
]);
export const IMAGE_KINDS = Object.freeze(['hex', 'bin', 'uf2', 'elf']);
export const REALTIME_TRANSPORTS = Object.freeze(['postMessage', 'sab']);
export const VIEW_KINDS = Object.freeze(['isa', 'datapath', 'bus', 'compare']);
export function editionOf(d, wanted) {
 const e = d.editions ?? [];
 if (!e.length) return null;
 return e.some((x) => x.id === wanted) ? wanted : e[0].id;
}
export function withEdition(d, wanted) {
 const id = editionOf(d, wanted);
 if (id === null) return { ...d, activeEdition: null };
 const e = d.editions.find((x) => x.id === id);
 const out = { ...d, activeEdition: id, capabilities: { ...d.capabilities, ...e.capabilities } };
 if (e.languages && d.language) out.language = { ...d.language, extraLanguages: (d.language.extraLanguages ?? []).filter((x) => e.languages.includes(x.id)) };
 return out;
}
export const activeEdition = (d) => d.editions?.find((x) => x.id === d.activeEdition) ?? null;
export const VARIANT_KEYS = Object.freeze(['language', 'registers', 'addressSpace', 'views', 'panels', 'exports', 'exercises',
 'capabilities', 'strings', 'content']);
const VARIANT_CONTENT = ['templates', 'help'];
export function variantOf(d, profileId) {
 const p = d.engine?.profiles?.find((x) => x.id === profileId);
 return p ? p.variant ?? null : undefined;
}
export const variantProfiles = (d, variant) => (d.engine?.profiles ?? []).filter((p) => (p.variant ?? null) === variant);
const isPlain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o) && Object.getPrototypeOf(o) === Object.prototype;
function mergeDeep(base, over) {
 const out = { ...base };
 for (const [k, v] of Object.entries(over ?? {})) out[k] = isPlain(v) && isPlain(base?.[k]) ? mergeDeep(base[k], v) : v;
 return out;
}
export async function withVariant(d, variant) {
 if (!variant || !d.variants?.[variant]) return { ...d, activeVariant: null };
 const o = await d.variants[variant].load();
 const extra = Object.keys(o ?? {}).filter((k) => !VARIANT_KEYS.includes(k));
 if (extra.length) throw new Error(`variant ${variant}: ${extra.join(', ')} cannot be replaced`);
 const extraContent = Object.keys(o.content ?? {}).filter((k) => !VARIANT_CONTENT.includes(k));
 if (extraContent.length) throw new Error(`variant ${variant}: content.${extraContent.join(', content.')} cannot be replaced`);
 const out = { ...d, activeVariant: variant };
 for (const k of VARIANT_KEYS) {
 if (o[k] === undefined) continue;
 if (k === 'capabilities') out.capabilities = { ...d.capabilities, ...o.capabilities };
 else if (k === 'strings') out.strings = mergeDeep(d.strings, o.strings);
 else if (k === 'content') out.content = { ...d.content, ...o.content };
 else out[k] = o[k];
 }
 return out;
}
const LANGUAGE_HOOKS = ['fields', 'describe', 'inspector', 'loadImage', 'importers', 'scratch'];
const EXPORT_HOOKS = ['trace', 'traceJsonLines', 'traceCsv', 'golden', 'image'];
export const VIEW_REQUIRED = Object.freeze(['root', 'title', 'infoTitle', 'tabs', 'load', 'step', 'back', 'state', 'render']);
export const ENGINE_HOOKS = Object.freeze(['callDepth', 'stepOverTarget', 'stepOutTarget', 'loopRange', 'diagnostics', 'counters',
 'callStack', 'dataAccess', 'platform', 'input', 'inputs', 'advance', 'drainAudio', 'clock', 'live', 'stateHash', 'restart', 'configure']);
export const STEP_OVER_HOOKS = Object.freeze(['callDepth', 'stepOverTarget', 'stepOutTarget']);
const ID = /^[a-z][a-z0-9-]*$/;
const isFn = (f) => typeof f === 'function';
export function validateDescriptor(d) {
 const bad = [];
 const need = (cond, msg) => { if (!cond) bad.push(msg); };
 need(d && typeof d === 'object', 'not an object');
 if (bad.length) return bad;
 need(d.contract === CONTRACT_VERSION, `contract ${d.contract}, expected ${CONTRACT_VERSION}`);
 need(ID.test(d.id ?? ''), `id ${JSON.stringify(d.id)}`);
 need(typeof d.name === 'string' && d.name, 'name');
 need(d.strings && typeof d.strings === 'object', 'strings');
 for (const [k, v] of Object.entries(d.capabilities ?? {})) {
 need(CAPABILITIES.includes(k), `capability ${k} is not in CAPABILITIES`);
 need(v === true || (v && v.enabled === false && typeof v.reason === 'string' && v.reason), `capability ${k}: true or {enabled: false, reason}`);
 }
 const L = d.language ?? {};
 need(isFn(L.assemble) && isFn(L.disassemble), 'language.assemble and language.disassemble');
 need(typeof L.extension === 'string' && L.extension.startsWith('.'), 'language.extension');
 need(typeof L.comment === 'string' && L.comment, 'language.comment');
 need(typeof L.defaultSource === 'string', 'language.defaultSource');
 need(Array.isArray(L.editor?.mnemonics) && Array.isArray(L.editor?.registers) && Array.isArray(L.editor?.directives), 'language.editor lists');
 for (const k of LANGUAGE_HOOKS) if (L[k] !== undefined) need(isFn(L[k]), `language.${k} is a function`);
 if (L.imageKinds !== undefined) {
 const k = L.imageKinds;
 need(Array.isArray(k) && k.length > 0 && k.every((x) => IMAGE_KINDS.includes(x)) && new Set(k).size === k.length,
 `language.imageKinds: a non-empty list without repeats from ${IMAGE_KINDS.join(', ')}`);
 need(isFn(L.loadImage), 'language.imageKinds needs language.loadImage');
 }
 if (d.capabilities?.imageImport === true) need(isFn(L.loadImage), 'capability imageImport needs language.loadImage');
 if (L.disassembly) {
 need(L.disassembly.names === undefined || (Array.isArray(L.disassembly.names) && L.disassembly.names.length > 0),
 'language.disassembly.names: a non-empty list');
 }
 for (const o of L.options ?? []) {
 need(ID.test(o.id ?? '') && typeof o.label === 'string' && Array.isArray(o.values) && o.values.some((v) => v.id === o.default),
 `language option ${o.id}: id, label, default among values`);
 need(o.apply === undefined || o.apply === 'build' || o.apply === 'engine', `language option ${o.id}: apply is 'build' or 'engine'`);
 need(o.panel === undefined || (d.panels ?? []).some((p) => p.id === o.panel), `language option ${o.id}: panel names one of the descriptor's panels`);
 }
 if (L.extraLanguages) need(d.capabilities?.cLanguage === true || L.extraLanguages.every((x) => x.id !== 'c'), 'C without capability cLanguage');
 for (const k of ['help', 'detail']) if (L.editor?.[k] !== undefined) need(isFn(L.editor[k]), `language.editor.${k} is a function`);
 for (const x of L.extraLanguages ?? []) {
 need(ID.test(x.id ?? '') && typeof x.label === 'string' && isFn(x.load), `extra language ${x.id}: id, label, load`);
 if (x.image !== undefined) {
 need(x.image === true, `extra language ${x.id}: image is true or absent`);
 need(d.capabilities?.projects === true && d.capabilities?.imageImport === true && isFn(L.loadImage),
 `extra language ${x.id}: an image language needs capabilities projects and imageImport and language.loadImage`);
 }
 for (const o of x.options ?? []) {
 need(Array.isArray(o.values) && o.values.some((v) => v.id === o.default), `extra language ${x.id}: option ${o.id}: default among values`);
 }
 }
 const R = d.registers ?? {};
 const ids = new Set();
 need(Array.isArray(R.groups) && R.groups.length > 0, 'registers.groups');
 for (const g of R.groups ?? []) {
 need(ID.test(g.id ?? ''), `register group id ${g.id}`);
 for (const r of g.registers ?? []) {
 need(!ids.has(r.id), `register id ${r.id} twice`);
 ids.add(r.id);
 need(Number.isInteger(r.width) && r.width >= 1 && r.width <= 32, `register ${r.id}: width ${r.width}`);
 }
 }
 need(typeof R.pc === 'string' && (ids.has(R.pc) || R.pc === 'pc'), `registers.pc ${R.pc} is no register (or 'pc')`);
 if (R.status) need(ids.has(R.status.id) && R.status.fields?.length > 0, 'registers.status');
 for (const [role, id] of Object.entries(R.roles ?? {})) need(ids.has(id), `registers.roles.${role} ${id} is no register`);
 const A = d.addressSpace ?? {};
 need(Number.isInteger(A.addressBits) && A.addressBits >= 1 && A.addressBits <= 32, 'addressSpace.addressBits');
 need([8, 16, 32].includes(A.unitBits), 'addressSpace.unitBits');
 need([1, 2, 4].includes(A.wordBytes), 'addressSpace.wordBytes');
 need(['little', 'big'].includes(A.endianness), 'addressSpace.endianness');
 need(Array.isArray(A.regions) && A.regions.length > 0, 'addressSpace.regions');
 for (const r of A.regions ?? []) {
 need(['ram', 'rom', 'device'].includes(r.kind), `region ${r.name}: kind ${r.kind}`);
 need(r.base >= 0 && r.size > 0 && r.base + r.size <= 2 ** A.addressBits, `region ${r.name} outside the address space`);
 }
 need(isFn(d.engine?.create), 'engine.create');
 for (const k of EXPORT_HOOKS) if (d.exports?.[k] !== undefined) need(isFn(d.exports[k]), `exports.${k} is a function`);
 if (d.exercises) need(isFn(d.exercises.parse) && isFn(d.exercises.run), 'exercises.parse and exercises.run');
 if (d.panels !== undefined) {
 need(Array.isArray(d.panels), 'panels: a list');
 const pids = new Set();
 for (const p of Array.isArray(d.panels) ? d.panels : []) {
 need(ID.test(p.id ?? '') && !pids.has(p.id) && typeof p.label === 'string' && p.label && isFn(p.load), `panel ${p.id}: id, label, load`);
 pids.add(p.id);
 }
 }
 if (d.variants !== undefined) {
 need(d.variants && typeof d.variants === 'object' && !Array.isArray(d.variants), 'variants: an object');
 for (const [id, v] of Object.entries(d.variants ?? {})) {
 need(ID.test(id) && typeof v?.label === 'string' && v.label && isFn(v?.load), `variant ${id}: id, label, load`);
 need((d.engine?.profiles ?? []).some((p) => p.variant === id), `variant ${id}: no profile belongs to it`);
 if (v?.legacy !== undefined) need(typeof v.legacy === 'boolean', `variant ${id}: legacy is a boolean`);
 }
 need(Object.values(d.variants ?? {}).filter((v) => v?.legacy).length <= 1, 'variants: at most one is legacy');
 need((d.engine?.profiles ?? []).some((p) => p.variant === undefined), 'variants: the descriptor\'s own variant has no profile');
 }
 {
 const relative = (p) => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.includes('..') && !p.includes('\\') && !/^[a-z][a-z0-9+.-]*:/i.test(p);
 if (d.realtime !== undefined) {
 need(d.realtime && typeof d.realtime === 'object', 'realtime: an object');
 need(Number.isFinite(d.realtime?.floorHz) && d.realtime.floorHz > 0, 'realtime.floorHz: a positive number');
 const t = d.realtime?.transports;
 if (t !== undefined) need(Array.isArray(t) && t.length > 0 && t.every((x) => REALTIME_TRANSPORTS.includes(x)) && new Set(t).size === t.length,
 `realtime.transports: a non-empty list without repeats from ${REALTIME_TRANSPORTS.join(', ')}`);
 }
 need((d.capabilities?.realtime === true) === (d.realtime !== undefined), 'capability realtime true needs Descriptor.realtime, and the reverse');
 if (d.audio !== undefined) {
 const a = d.audio;
 need(a && typeof a === 'object', 'audio: an object');
 need(Number.isInteger(a?.sampleRate) && a.sampleRate >= 8000 && a.sampleRate <= 192000, 'audio.sampleRate: an integer from 8000 to 192000');
 if (a?.channels !== undefined) need(Number.isInteger(a.channels) && a.channels >= 1 && a.channels <= 2, 'audio.channels: 1 or 2');
 need(relative(a?.processor) && a.processor.endsWith('.js'), 'audio.processor: a relative path ending .js');
 }
 need((d.capabilities?.audio === true) === (d.audio !== undefined), 'capability audio true needs Descriptor.audio, and the reverse');
 if (d.assets !== undefined) {
 need(d.assets && typeof d.assets === 'object' && !Array.isArray(d.assets), 'assets: an object');
 const w = d.assets?.wasm;
 if (w !== undefined) need(Array.isArray(w) && w.every((p) => relative(p) && p.endsWith('.wasm')) && new Set(w).size === w.length,
 'assets.wasm: relative paths ending .wasm, without repeats');
 const o = d.assets?.optional;
 if (o !== undefined) need(Array.isArray(o) && o.every((a) => ID.test(a?.id ?? '') && typeof a.label === 'string' && relative(a.base) && a.base.endsWith('/'))
 && new Set(o.map((a) => a.id)).size === o.length, 'assets.optional: [{id, label, base}] with a relative base ending /, ids without repeats');
 const extra = Object.keys(d.assets ?? {}).filter((k) => k !== 'wasm' && k !== 'optional');
 need(!extra.length, `assets.${extra.join(', assets.')} is not in the contract`);
 }
 }
 if (d.editions !== undefined) {
 const E = d.editions;
 need(Array.isArray(E) && E.length >= 2, 'editions: a list of at least two');
 need(!Array.isArray(E) || E.some((e) => !e?.development), 'editions: at least one not marked development');
 const eids = new Set();
 const xids = (d.language?.extraLanguages ?? []).map((x) => x.id);
 for (const e of Array.isArray(E) ? E : []) {
 need(ID.test(e?.id ?? '') && !eids.has(e.id) && typeof e.label === 'string' && e.label, `edition ${e?.id}: id (no repeats), label`);
 eids.add(e?.id);
 if (e?.title !== undefined) need(typeof e.title === 'string', `edition ${e.id}: title is text`);
 for (const [k, v] of Object.entries(e?.capabilities ?? {})) {
 need(CAPABILITIES.includes(k), `edition ${e.id}: capability ${k} is not in CAPABILITIES`);
 need(v === true || (v && v.enabled === false && typeof v.reason === 'string' && v.reason), `edition ${e.id}: capability ${k}: true or {enabled: false, reason}`);
 }
 if (e?.languages !== undefined) need(Array.isArray(e.languages) && e.languages.every((x) => xids.includes(x)), `edition ${e.id}: languages are ids of language.extraLanguages`);
 if (e?.compiler !== undefined) need((e.languages ?? xids).includes(e.compiler), `edition ${e.id}: compiler is one of its languages`);
 if (e?.primary !== undefined) need(typeof e.primary === 'boolean', `edition ${e.id}: primary is a boolean`);
 if (e?.development !== undefined) need(typeof e.development === 'boolean', `edition ${e.id}: development is a boolean`);
 if (d.activeEdition === undefined && e && ID.test(e.id ?? '')) {
 const { editions: _e, ...rest } = withEdition(d, e.id);
 for (const m of validateDescriptor({ ...rest, activeEdition: undefined })) bad.push(`edition ${e.id}: ${m}`);
 }
 }
 }
 const active = d.activeVariant ?? null;
 const profiles = new Set();
 for (const p of d.engine?.profiles ?? []) {
 need(ID.test(p.id ?? '') && !profiles.has(p.id), `profile id ${p.id}`);
 profiles.add(p.id);
 if (p.variant !== undefined) need(Object.hasOwn(d.variants ?? {}, p.variant), `profile ${p.id}: variant ${p.variant} is not in variants`);
 if (p.memory !== undefined) need(['sparse', 'harvard', 'unified'].includes(p.memory), `profile ${p.id}: memory ${p.memory}`);
 for (const s of p.subsets ?? []) need(typeof s.id === 'string' && typeof s.label === 'string', `profile ${p.id}: subset`);
 }
 const V = d.views ?? [];
 need(V.length > 0 && V[0].kind === 'isa', 'views: the first is of kind isa');
 const vids = new Set();
 for (const v of V) {
 need(ID.test(v.id ?? '') && !vids.has(v.id), `view id ${v.id}`);
 vids.add(v.id);
 need(VIEW_KINDS.includes(v.kind), `view ${v.id}: kind ${v.kind}`);
 need(typeof v.label === 'string' && typeof v.icon === 'string', `view ${v.id}: label and icon`);
 need(v.kind === 'isa' || isFn(v.load), `view ${v.id}: load()`);
 if (v.kind === 'compare') need(d.capabilities?.compare === true, `view ${v.id}: kind compare without capability compare`);
 if (v.profile !== undefined) need(profiles.has(v.profile), `view ${v.id}: profile ${v.profile} is not in engine.profiles`);
 if (v.profile !== undefined && profiles.has(v.profile)) need(variantOf(d, v.profile) === active, `view ${v.id}: profile ${v.profile} is of another variant`);
 if (v.names !== undefined) need(L.disassembly?.names?.includes(v.names), `view ${v.id}: names ${v.names} not in language.disassembly.names`);
 if (v.layout !== undefined) {
 const { drawing, editor, ...rest } = v.layout ?? {};
 need(v.kind === 'datapath', `view ${v.id}: layout is for datapath views`);
 need(drawing === undefined || (Number.isFinite(drawing) && drawing >= 0.4 && drawing <= 0.9), `view ${v.id}: layout.drawing from 0.4 to 0.9`);
 need(editor === undefined || (Number.isFinite(editor) && editor >= 0.1 && editor <= 0.4), `view ${v.id}: layout.editor from 0.1 to 0.4`);
 need(!Object.keys(rest).length, `view ${v.id}: layout.${Object.keys(rest).join(', layout.')} is not in the contract`);
 }
 if (v.settings) {
 const s = v.settings;
 need(ID.test(s.key ?? '') && s.defaults && s.values, `view ${v.id}: settings key, defaults, values`);
 for (const [k, def] of Object.entries(s.defaults ?? {})) need(s.values?.[k]?.includes(def), `view ${v.id}: setting ${k}: default among values`);
 }
 if (v.openNote !== undefined) need(isFn(v.openNote), `view ${v.id}: openNote is a function`);
 }
 return bad;
}
export function capability(d, key, profile = null) {
 const v = profile?.capabilities?.[key] ?? d.capabilities?.[key];
 if (v === true) return { enabled: true, reason: null };
 return { enabled: false, reason: v?.reason ?? 'notSupported' };
}
