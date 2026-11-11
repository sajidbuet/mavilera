// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { STRINGS, mergeStrings } from './ui/strings.js';
import { el, hex8, hexAddr, download, store, scoped, setStorageVariant, moveToVariant } from './ui/dom.js';
import { Editor } from './ui/editor.js';
import { EditorStack } from './ui/editor-stack.js';
import { ProjectExplorer, ProjectsDialog } from './ui/project-explorer.js';
import { DownloadDialog } from './ui/download-dialog.js';
import { ProjectSession } from './shell/project-session.js';
import { openProjectStore } from './shell/project-store.js';
import { buildPlan, fileText, createProject } from './shell/project.js';
import { ListingPanel, FieldsTable, dataTable, symbolTable } from './ui/listing.js';
import { RegistersPanel, MemoryPanel, CountersPanel, ConsolePanel, CallStackPanel, OUTPUT_LIMIT } from './ui/state-panels.js';
import { STOP, IMAGE_KINDS, capability, withVariant, variantOf, withEdition, activeEdition } from './arch/contract.js';
import { primaryAction, PRIMARY } from './ui/primary-action.js';
import { VariantDialog } from './ui/variant-dialog.js';
import { capabilityStates, gate } from './shell/capabilities.js';
import { checkFits } from './shell/data-io.js';
import { createShare, isShareFragment, LINK_LIMIT, normalisePlatform, defaultPlatform } from './shell/share.js';
import { shareSchema, settingValue, projectExtensions } from './shell/share-schema.js';
import { DataDialog } from './ui/data-dialog.js';
import { ExamplesDialog } from './ui/examples-dialog.js';
import { HelpDialog } from './ui/help-dialog.js';
import { ExerciseDialog } from './ui/exercise-dialog.js';
import { recordFrames, vcd } from './shell/vcd.js';
import { Split } from './ui/split.js';
import { icon } from './ui/icons.js';
import { overflowBar } from './ui/overflow.js';
import { DOCKS, ToolbarDock } from './ui/dock.js';
import { MODES, ViewModes } from './ui/view-mode.js';
import { MobileWorkspaces } from './ui/workspaces.js';
import { PanZoom } from './ui/pan-zoom.js';
import { CONFIG_KEY, readConfig, writeConfig, validateConfig, buildMemsys, describe as describeMem } from './mem/config.js';
import { MemSettings, PeripheralsView } from './ui/mem-ui.js';
import { PlatformView } from './ui/platform-view.js';
import { parseStimulus, Platform } from './mem/platform.js';
import { CacheView } from './ui/cache-view.js';
import { isDirty } from './ui/mem-viewmodel.js';
import { traceCacheRun, TraceCache } from './mem/trace-cache.js';
import { ARCHITECTURES } from './arch/registry.js';
import { ARCH_ID } from './shell/arch-id.js';
import { archSwitcher } from './ui/arch-switcher.js';
import { currentTool, switchTargets, homeUrl, toolViews, NAME_AT } from './shell/platform-archs.js';
import { endBoot } from './ui/boot.js';
import { LiveRing, RING_BYTES } from './worker/live-ring.js';
import { AudioHost } from './shell/audio-host.js';
const base = (await ARCHITECTURES[ARCH_ID]()).descriptor;
const TOOL = currentTool(ARCH_ID, location.search);
const toolPlatform = () => normalisePlatform({ ...(TOOL?.platform ?? {}) });
{
 const legacy = Object.entries(base.variants ?? {}).find(([, v]) => v.legacy)?.[0];
 if (legacy && store.get('pips.v9') !== '1') {
 const kept = store.get('pips.profile');
 if (moveToVariant(legacy) && variantOf(base, kept) === undefined) store.set('pips.profile', base.engine.profiles.find((p) => p.variant === legacy).id);
 store.set('pips.v9', '1');
 }
}
const startProfile = [TOOL?.profile, store.get('pips.profile')].find((p) => p && variantOf(base, p) !== undefined) ?? null;
const preEditionAll = await withVariant(base, startProfile ? variantOf(base, startProfile) : null);
const DEVELOPMENT_PAGE = location.protocol !== 'file:' && !document.querySelector('meta[name="risc-vista-edition"][content="release"]');
const preEdition = !DEVELOPMENT_PAGE && preEditionAll.editions?.some((e) => e.development)
 ? { ...preEditionAll, editions: preEditionAll.editions.filter((e) => !e.development) } : preEditionAll;
const arch = withEdition(preEdition, new URLSearchParams(location.search).get('edition') ?? store.get('pips.edition'));
const EDITION = activeEdition(arch);
const PROJECT_EDITION = arch.editions?.find((e) => withEdition(preEdition, e.id).capabilities?.projects === true) ?? null;
setStorageVariant(arch.activeVariant ?? (TOOL?.within ? `tool-${TOOL.id}` : null));
if (EDITION) store.set('pips.edition', EDITION.id);
const variantLabel = (v) => (v ? base.variants[v].label : base.strings?.variantLabel ?? base.name);
const OWN_PROFILES = arch.engine.profiles.filter((p) => (p.variant ?? null) === arch.activeVariant);
mergeStrings(arch.strings);
const VIEWS = toolViews(arch, TOOL);
const { encodeFragment, decodeFragment, settingsFile, readSettingsFile } = createShare(shareSchema(arch));
const EXAMPLE = arch.language.defaultSource;
const contentUrl = (key) => (arch.content?.[key] ? new URL(arch.content[key], new URL('..', import.meta.url)) : null);
const REG_IDS = arch.registers.groups.flatMap((g) => g.registers.map((r) => r.id));
const REG_WIDTH = Object.fromEntries(arch.registers.groups.flatMap((g) => g.registers.map((r) => [r.id, r.width])));
const hexA = (a) => hexAddr(a, arch.addressSpace.addressBits);
const regsById = (x) => Object.fromEntries(REG_IDS.map((id, i) => [id, x[i]]));
const profileOf = (id) => arch.engine.profiles.find((p) => p.id === id) ?? null;
const CAP = capabilityStates(arch, STRINGS);
const can = (k) => CAP[k].enabled || (consolePanel.message(CAP[k].text, 'warn'), false);
const PROJECTS = CAP.projects.enabled;
let rt = null;
let rtNoted = false;
const RUN_LIMIT = 10_000_000;
const HISTORY_LIMIT = 1_000_000;
const session = {
 files: [{ name: `main${arch.language.extension}`, text: '' }],
 profile: OWN_PROFILES[0].id,
 subset: null,
 program: null,
 imported: null,
 cSource: null,
 breakpoints: new Set(),
 watchRegs: new Set(),
 watchWords: new Set(),
 dataLoads: [],
 loadReport: { applied: [], dropped: [] },
 platformConfig: toolPlatform(),
 get runnable() { return Boolean(this.program?.ok); },
 loadData(label, bytes, name) {
 checkFits(this.program, label, bytes);
 this.dataLoads = [...this.dataLoads.filter((l) => l.label !== label), { label, bytes, name }];
 },
 clearData() { this.dataLoads = []; },
};
let engine = null;
let enginePort = null;
function resetEngine(inputs = null) {
 engine = session.runnable ? withEngineOpts(arch.engine.create(session.program, { platformConfig: session.platformConfig, runLimit: RUN_LIMIT, historyLimit: HISTORY_LIMIT,
 ...(inputs ? { inputs } : {}) })) : null;
 enginePort = engine ? memoryPort(engine) : null;
 lastStop = null;
 diag.reset();
}
function memoryPort(e) {
 const little = arch.addressSpace.endianness === 'little';
 return { read: (a, size) => {
 const b = e.peek(a >>> 0, size);
 let v = 0;
 for (let i = 0; i < size; i++) v = v * 256 + b[little ? size - 1 - i : i];
 return v >>> 0;
 } };
}
function srcLoc(pc) {
 const l = session.program?.listing.find((x) => x.address === pc);
 return l ? { file: PROJECTS ? edLoc(l)?.file : l.file, line: edLine(l.line) } : null;
}
const diag = {
 seen: {}, at: {},
 reset() { this.seen = {}; this.at = {}; },
 counts() {
 const n = {};
 for (const d of engine?.diagnostics?.() ?? []) n[d.kind] = (n[d.kind] ?? 0) + 1;
 return n;
 },
 show() {
 const n = {};
 for (const d of engine?.diagnostics?.() ?? []) {
 const k = d.kind;
 n[k] = (n[k] ?? 0) + 1;
 if (d.at !== undefined) {
 if (d.at <= (this.at[k] ?? 0)) continue;
 this.at[k] = d.at;
 } else if (n[k] <= (this.seen[k] ?? 0)) continue;
 consolePanel.message(d.message, 'warn', d.pc !== undefined ? srcLoc(d.pc) : null, d.note ?? null);
 }
 Object.assign(this.seen, n);
 },
 skip() {
 Object.assign(this.seen, this.counts());
 for (const d of engine?.diagnostics?.() ?? []) if (d.at !== undefined) this.at[d.kind] = Math.max(this.at[d.kind] ?? 0, d.at);
 },
};
let running = false;
let lastStop = null;
let selected = null;
let dirty = false;
let lang = 'asm';
const XL = arch.language.extraLanguages?.[0] ?? null;
const XID = XL?.id ?? null;
const C_LANGS = XL ? (arch.language.extraLanguages ?? []).filter((x) => x.extension === XL.extension) : [];
const cCompiler = () => (EDITION?.compiler ? C_LANGS.find((x) => x.id === EDITION.compiler)
 : C_LANGS.find((x) => x.id === project()?.compiler) ?? C_LANGS[0]) ?? null;
let cc = null;
let cMap = null;
const sourceKey = () => (lang === 'asm' ? 'pips.source' : `pips.source.${lang}`);
const stem = (name) => name.replace(/\.\w+$/, '');
const consolePanel = new ConsolePanel({ onGoTo: (loc) => {
 ws.toggleSheet(false); ws.reveal('code');
 if (PROJECTS && loc.file && project()?.files.some((f) => f.name === loc.file)) selectFile(loc.file);
 if (COMP) showComp(Boolean(comp && loc.file === comp.name));
 activeEd().selectAt(loc.line, loc.column ?? 1, loc.length ?? 0);
} });
const CIN = arch.console?.input ?? null;
if (CIN) {
 const field = el('input.console-in-field.mono', { type: 'text', placeholder: CIN.placeholder ?? '', title: CIN.title ?? null, autocomplete: 'off', spellcheck: 'false' });
 const form = el('form.console-in', { onsubmit: (e) => {
 e.preventDefault();
 if (!session.runnable) { consolePanel.message(CIN.noProgram ?? STRINGS.noProgram ?? '', 'warn'); return; }
 giveInput({ kind: CIN.kind, uart: CIN.uart, bytes: [...new TextEncoder().encode(field.value), ...(CIN.lineEnd ?? [])] });
 field.value = '';
 } }, el('label.console-in-label', {}, el('span', { text: `${CIN.label} ` }), field));
 consolePanel.root.insertBefore(form, consolePanel.msgs);
}
const langOfFile = (name) => (XL && name.toLowerCase().endsWith(XL.extension) ? XID : 'asm');
const editor = PROJECTS ? new EditorStack({
 language: arch.language,
 onChange: (name, text) => { dirty = true; try { proj.setText(name, text); } catch { } editorStatus(); saveSoon(); },
 onCursorLine: () => { editorStatus(); saveSoon(); },
 onHoverLine: (line) => linkFromC(line),
 onGutterClick: (line, name) => toggleBreakLine(line, name),
 onSelect: (name) => selectFile(name),
 onClose: (name) => closeFile(name),
 langOf: langOfFile,
}) : new Editor({
 language: arch.language,
 onChange: (text) => { dirty = true; store.set(sourceKey(), text); editorStatus(); saveSoon(); syncPrimary(); },
 onCursorLine: () => { editorStatus(); saveSoon(); },
 onHoverLine: (line) => linkFromC(line),
 onGutterClick: (line) => toggleBreakLine(line),
});
const COMP = !PROJECTS ? arch.language.companion ?? null : null;
let comp = null;
let compOn = false;
const compEd = COMP ? new Editor({ language: { editor: COMP.editor ?? arch.language.editor, comment: COMP.comment ?? arch.language.comment },
 listId: 'ed-complete-companion',
 onChange: (text) => { if (!comp) return; comp.text = text; dirty = true; keepComp(); editorStatus(); saveSoon(); syncPrimary(); },
 onCursorLine: () => editorStatus() }) : null;
const compFiles = () => (comp ? [{ name: comp.name, text: comp.text }] : []);
const activeEd = () => (compOn && comp ? compEd : editor);
let proj = null;
const project = () => proj?.project ?? null;
const fields = arch.language.inspector ? (await arch.language.inspector()).create({ strings: STRINGS }) : new FieldsTable(arch.language, arch.addressSpace.addressBits);
const listing = new ListingPanel({ language: arch.language, addressBits: arch.addressSpace.addressBits,
 onSelect: (l) => {
 selected = l;
 fields.show(l);
 const loc = l?.line && !session.program?.imported ? edLoc(l) : null;
 if (loc && PROJECTS && loc.file && loc.file !== editor.active) selectFile(loc.file);
 if (loc) editor.scrollToLine(loc.line, true);
 },
 onToggleBreak: (addr) => toggleBreak(addr),
});
function toggleBreak(addr) {
 if (!can('breakpoints')) return;
 if (session.breakpoints.has(addr)) session.breakpoints.delete(addr);
 else session.breakpoints.add(addr);
 listing.render();
 showBreakLines();
 saveSoon();
}
function toggleBreakLine(line, file = PROJECTS ? editor.active : null) {
 const p = session.program;
 const l = p && !p.imported ? p.listing.find((x) => atLoc(x, line, file)) : null;
 if (!l) { consolePanel.message(STRINGS.tools.noBreakLine); return; }
 toggleBreak(l.address);
}
function showBreakLines() {
 const p = session.program;
 if (PROJECTS) {
 const by = new Map();
 for (const a of session.breakpoints) {
 const loc = p && !p.imported ? edLoc(p.listing.find((x) => x.address === a)) : null;
 if (loc?.file) { if (!by.has(loc.file)) by.set(loc.file, new Set()); by.get(loc.file).add(loc.line); }
 }
 editor.setBreaksByFile(by);
 return;
 }
 const lines = new Set();
 for (const a of session.breakpoints) {
 const l = p && !p.imported ? p.listing.find((x) => x.address === a) : null;
 const n = l ? edLine(l.line) : null;
 if (n) lines.add(n);
 }
 editor.setBreaks(lines);
}
const regs = new RegistersPanel({ registers: arch.registers, pcBits: arch.addressSpace.addressBits,
 onWatch: (id, on) => { watchReg(id, on); saveSoon(); } });
function watchReg(id, on) {
 if (on && !can('watchpoints')) return;
 if (on) session.watchRegs.add(id); else session.watchRegs.delete(id);
}
function watchHit(rec) {
 const word = (a) => session.watchWords.has(memory.wordOf(a));
 return rec.registers.some((w) => session.watchRegs.has(w.id)) || rec.memory.some((m) => word(m.address) || word(m.address + m.size - 1));
}
function stepEngine() {
 const rec = engine.step();
 if (!rec) return engine.state().error ? STOP.ERROR : STOP.HALT;
 if (rec.halt) return STOP.HALT;
 return watchHit(rec) ? STOP.WATCH : STOP.NONE;
}
const runOptions = (opts) => ({ ...opts, breakpoints: session.breakpoints, watch: { registers: session.watchRegs, memory: session.watchWords } });
const memory = new MemoryPanel({ registers: arch.registers, addressSpace: arch.addressSpace,
 onWatch: (addr) => {
 if (!session.watchWords.has(addr) && !can('watchpoints')) return;
 if (session.watchWords.has(addr)) session.watchWords.delete(addr);
 else session.watchWords.add(addr);
 consolePanel.message(STRINGS.watchWord(hexA(addr), session.watchWords.has(addr)));
 memory.render();
 saveSoon();
 },
});
let memCfg = readConfig(store.get(CONFIG_KEY));
const memProblems = validateConfig(memCfg);
if (memProblems.length) { memCfg = readConfig(null); consolePanel.message(STRINGS.mem.invalidSaved, 'warn'); }
const cacheView = new CacheView({ resolve: (t) => memory.resolve(t) });
const insertEvent = (list, ev) => { let i = list.length; while (i > 0 && list[i - 1].cycle > ev.cycle) i--; list.splice(i, 0, { ...ev }); };
function platformCtx() {
 const v = uv();
 if (v) {
 const ms = memsysOf[mode];
 const s = v.state();
 return ms?.platform && s ? { platform: ms.platform, privileged: null, cycle: s.cycle, memsys: ms, config: session.platformConfig } : null;
 }
 const p = engine?.platform?.() ?? null;
 return p ? { ...p, config: session.platformConfig } : null;
}
function otherPlatforms(except) {
 return Object.values(memsysOf).map((ms) => ms?.platform).filter((p) => p && p !== except);
}
const platformView = !CAP.devices.enabled ? null : new PlatformView({
 onPin: (mask, value) => {
 const c = platformCtx();
 if (!c) return;
 c.memsys?.detach();
 const ev = c.platform.gpio.setPins(mask, value, c.cycle);
 insertEvent(session.platformConfig.stimulus, ev);
 for (const p of otherPlatforms(c.platform)) insertEvent(p.gpio.stim, ev);
 refresh();
 },
 onReceive: (bytes) => {
 const c = platformCtx();
 const u = c?.platform.uart;
 if (!u) return;
 c.memsys?.detach();
 for (const b of bytes) {
 const ev = u.receive(b, c.cycle);
 insertEvent(session.platformConfig.rx, ev);
 for (const p of otherPlatforms(c.platform)) if (p.uart) insertEvent(p.uart.rxStim, ev);
 }
 consolePanel.message(STRINGS.platform.uartSent(bytes.length), 'info');
 refresh();
 },
 onClearScript: () => {
 session.platformConfig = { ...session.platformConfig, stimulus: [], rx: [] };
 consolePanel.message(STRINGS.platform.stimCleared, 'ok');
 applyMemory(memCfg);
 },
 onSettings: (change) => {
 session.platformConfig = normalisePlatform({ ...session.platformConfig, ...change });
 applyMemory(memCfg);
 },
});
const periph = platformView ? new PeripheralsView(platformView) : { root: el('div'), update: () => {} };
const archPanels = await Promise.all((arch.panels ?? []).map(async (p) => ({ p, inst: (await p.load()).create({ strings: STRINGS,
 input: (x) => giveInput(x), message: (text, kind) => consolePanel.message(text, kind),
 command: (c) => (c === 'replay' ? replayInputs() : c === 'forget' ? forgetInputs() : undefined),
 option: (id) => panelOption(id), setOption: (id, value) => setPanelOption(id, value) }) })));
const memSettings = new MemSettings({ get: () => memCfg, onApply: (cfg) => applyMemory(cfg) });
const counters = new CountersPanel();
const calls = new CallStackPanel({ onGoTo: (addr) => { if (session.program && !session.program.imported) { ws.reveal('listing'); listing.select(addr); } },
 unavailable: CAP.callStack.enabled ? null : CAP.callStack.text, addressBits: arch.addressSpace.addressBits });
const dataBox = el('div.scroll');
const symBox = el('div.scroll');
const asmBox = el('div.scroll');
function edLine(asmLine) {
 if (lang !== XID) return asmLine;
 return cMap?.[asmLine - 1] || null;
}
function edLoc(row) {
 if (!row?.line) return null;
 const line = edLine(row.line);
 if (!line) return null;
 return { file: PROJECTS ? (lang === XID ? project()?.entry : row.file) ?? null : null, line };
}
function atLoc(row, line, file) {
 const loc = edLoc(row);
 return Boolean(loc) && loc.line === line && (!PROJECTS || loc.file === file);
}
let markedAt = null;
function markCurrent(row) {
 if (!PROJECTS) { editor.setCurrentLine(row?.line ? edLine(row.line) : null); return; }
 const loc = edLoc(row);
 const key = loc ? `${loc.file}:${loc.line}` : null;
 editor.setCurrentAt(loc, key !== markedAt);
 markedAt = key;
}
const cLinksHere = () => !PROJECTS || editor.active === project()?.entry;
function renderAsm(asm) {
 if (!asm) { asmBox.replaceChildren(el('p.note', { text: STRINGS.cc.asmNone })); return; }
 const pre = el('pre.cc-asm', { onmouseover: (e) => {
 if (!cLinksHere()) return;
 const k = Number(e.target.closest('.cc-line')?.dataset.k);
 editor.setLinked(Number.isFinite(k) && cMap?.[k] ? [cMap[k]] : []);
 linkAsm(Number.isFinite(k) && cMap?.[k] ? cMap[k] : null);
 }, onmouseleave: () => { editor.setLinked([]); linkAsm(null); } },
 asm.trimEnd().split('\n').map((text, k) => el(`span.cc-line${cMap[k] ? '' : '.cc-lib'}`, { 'data-k': k,
 title: cMap[k] ? STRINGS.cc.sourceLine(cMap[k]) : null }, text || ' ')));
 asmBox.replaceChildren(el('p.note', { text: `${STRINGS.cc.note} ${STRINGS.cc.asmHint}` }), pre);
}
function linkAsm(line) {
 let first = null;
 for (const s of asmBox.querySelectorAll('.cc-line')) {
 const on = line !== null && cMap?.[Number(s.dataset.k)] === line;
 s.classList.toggle('cc-link', on);
 if (on && !first) first = s;
 }
 return first;
}
function linkFromC(line) {
 if (lang !== XID || !cMap || !cLinksHere()) return;
 const first = linkAsm(line);
 if (first) {
 const box = asmBox;
 const top = first.offsetTop - box.offsetTop;
 if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 20) box.scrollTop = Math.max(0, top - box.clientHeight / 3);
 }
}
const TL = STRINGS.tools;
const keyText = (k) => k.replace(/Control/g, 'Ctrl');
const btn = (label, action, key) => el('button', { type: 'button', onclick: action, 'aria-keyshortcuts': key ?? null,
 title: key ? `${label} (${keyText(key)})` : label, text: label });
function tool(name, label, action, { key = null, cls = '', iconOnly = false } = {}) {
 const tip = key ? `${label} (${keyText(key)})` : label;
 return el(`button.tool${cls}${iconOnly ? '.tool-icon' : ''}`, { type: 'button', onclick: action, 'aria-label': tip,
 'aria-keyshortcuts': key, title: tip, 'data-keys': key ? keyText(key) : null }, icon(name), el('span.tool-label', { text: label }));
}
let headerFit = null, toolbarFit = null;
function refit() { headerFit?.fitNow(); toolbarFit?.fitNow(); }
function setToolLabel(b, name, label, key) {
 const tip = key ? `${label} (${keyText(key)})` : label;
 b.replaceChildren(icon(name), el('span.tool-label', { text: label }));
 b.setAttribute('aria-label', tip);
 b.title = tip;
}
const runExport = (label, action, cls = '') => el(`button${cls}`, { type: 'button', onclick: action, title: STRINGS.exportRunTitle, text: label });
const profileOption = (p) => el('option', { value: p.id, text: p.label });
const profileSel = el('select', { 'aria-label': STRINGS.profile, onchange: (e) => {
 const id = e.target.value;
 if (variantOf(arch, id) !== arch.activeVariant) { e.target.value = session.profile; changeVariant(id); return; }
 session.profile = id; store.set('pips.profile', session.profile); syncLangControls(); doAssemble();
} },
 arch.variants ? [null, ...Object.keys(arch.variants)].map((v) => el('optgroup', { label: variantLabel(v) },
 arch.engine.profiles.filter((p) => (p.variant ?? null) === v).map(profileOption)))
 : arch.engine.profiles.map(profileOption));
const variantDialog = arch.variants ? new VariantDialog() : null;
if (variantDialog) document.body.append(variantDialog.root);
async function changeVariant(id) {
 if (!(await variantDialog.ask(variantLabel(arch.activeVariant), variantLabel(variantOf(arch, id))))) return;
 reloadIn(id);
}
function reloadIn(id) {
 saveWorkspace();
 store.set('pips.profile', id);
 store.set('pips.variantNote', 'menu');
 location.reload();
}
const REALTIME = Boolean(CAP.realtime?.enabled && arch.realtime);
const speedSel = el('select', { 'aria-label': STRINGS.speed },
 REALTIME ? el('option', { value: 'rt', text: STRINGS.speedRealtime, title: STRINGS.realtime.title }) : null,
 el('option', { value: 'max', text: STRINGS.speedMax }), el('option', { value: 'slow', text: STRINGS.speedSlow }));
const AUDIO = Boolean(CAP.audio?.enabled && arch.audio);
const SOUND_KEY = `pips.${arch.id}.sound`, RENDER_KEY = `pips.${arch.id}.renderSeconds`;
let soundOn = AUDIO && store.get(SOUND_KEY) === 'on';
const audioHost = AUDIO ? new AudioHost({ processorUrl: new URL(`./${arch.audio.processor}`, import.meta.url), sampleRate: arch.audio.sampleRate }) : null;
if (AUDIO) speedSel.append(el('option', { value: 'render', text: STRINGS.audio.render, title: STRINGS.audio.renderTitle }));
const renderSecs = el('input.render-secs', { type: 'number', min: '1', max: '60', step: '1', 'aria-label': STRINGS.audio.seconds, title: STRINGS.audio.secondsTitle,
 value: String(Math.min(60, Math.max(1, Number(store.get(RENDER_KEY)) || 5))), onchange: (e) => store.set(RENDER_KEY, e.target.value) });
renderSecs.hidden = true;
speedSel.addEventListener('change', () => { renderSecs.hidden = speedSel.value !== 'render'; });
const soundBtn = AUDIO ? tool(soundOn ? 'sound' : 'soundOff', soundOn ? STRINGS.audio.on : STRINGS.audio.off, () => toggleSound(), { iconOnly: true, cls: '.tool-sound' }) : null;
function syncSound() {
 if (!soundBtn) return;
 setToolLabel(soundBtn, soundOn ? 'sound' : 'soundOff', soundOn ? STRINGS.audio.on : STRINGS.audio.off);
 soundBtn.setAttribute('aria-pressed', String(soundOn));
}
syncSound();
async function toggleSound() {
 if (!soundOn) {
 if (!(await audioHost.enable())) { consolePanel.message(STRINGS.audio.unavailable, 'error'); return; }
 soundOn = true;
 } else { soundOn = false; await audioHost.disable(); }
 store.set(SOUND_KEY, soundOn ? 'on' : 'off');
 syncSound();
 if (running && rt) consolePanel.message(STRINGS.audio.nextRun);
}
if (soundOn) {
 const wake = () => { audioHost.enable(); document.removeEventListener('pointerdown', wake, true); document.removeEventListener('keydown', wake, true); };
 document.addEventListener('pointerdown', wake, true); document.addEventListener('keydown', wake, true);
}
const PRIMARY_BTN = Boolean(EDITION?.primary);
const runBtn = tool('play', STRINGS.run, () => (PRIMARY_BTN ? primaryClick() : running ? pause() : startRun()), { key: 'F5', cls: '.tool-run' });
const runStatus = el('span.run-status', { role: 'status', 'aria-live': 'polite' });
const imageKinds = () => arch.language.imageKinds ?? IMAGE_KINDS.slice(0, 2);
const pickImages = !(EDITION && !CAP.imageImport.enabled);
const fileInput = el('input', { type: 'file', accept: ['.s,.asm,.S,.c', ...(PROJECTS ? ['.h', '.zip', ...(arch.language.extraExtensions ?? [])] : []), ...(COMP ? [COMP.extension] : []), ...(pickImages ? imageKinds().map((k) => `.${k}`) : []), '.json'].join(','), hidden: true, onchange: (e) => { openFile(e.target.files[0]); e.target.value = ''; } });
const assembleBtn = gate(tool('build', TL.build, () => doAssemble({ user: true }), { key: 'Control+Enter', cls: '.tool-build' }), CAP.assembler);
function primaryNow() {
 const st = engine?.state();
 const ended = lastStop?.stop === STOP.HALT || lastStop?.stop === STOP.ERROR || Boolean(st && (st.halted || st.error));
 return primaryAction({ running, changed: dirty || !session.program, runnable: session.runnable, ended });
}
function primaryClick() {
 const a = primaryNow();
 if (a === 'build') { doAssemble({ user: true }); if (!dirty && session.runnable) startRun(); }
 else if (a === 'pause') pause();
 else if (a === 'again') { doReset(); startRun(); }
 else startRun();
}
function syncPrimary() {
 if (!PRIMARY_BTN) return;
 const a = primaryNow();
 if (runBtn.dataset.action === a) return;
 runBtn.dataset.action = a;
 const shown = a === 'build' ? 'run' : a;
 const label = { run: STRINGS.run, pause: STRINGS.pause, again: STRINGS.runAgain }[shown];
 setToolLabel(runBtn, PRIMARY[shown].icon, label, PRIMARY[shown].key);
 if (PRIMARY[shown].key) runBtn.setAttribute('aria-keyshortcuts', PRIMARY[shown].key); else runBtn.removeAttribute('aria-keyshortcuts');
 runBtn.dataset.keys = PRIMARY[shown].key ? keyText(PRIMARY[shown].key) : '';
}
async function switchEdition(id, hash = '') {
 saveWorkspace();
 if (proj) await proj.saveNow();
 store.set('pips.edition', id);
 const u = new URL(location.href);
 u.searchParams.delete('edition');
 history.replaceState(null, '', `${u.pathname}${u.search}${hash}`);
 location.reload();
}
async function openInEdition(e) {
 const E = STRINGS.edition;
 if (lang === XID && e.compiler && e.compiler !== XID) {
 const thereC = preEdition.language.extraLanguages?.find((x) => x.id === e.compiler)?.label ?? e.compiler;
 consolePanel.message(E.cStays(XL.label, EDITION.label, e.label, thereC), 'warn');
 return;
 }
 try {
 const pstore = await openProjectStore();
 if (pstore.kind === 'memory') { consolePanel.message(STRINGS.projects.notKept, 'warn'); return; }
 const name = singleName({ name: lang === XID ? cName : session.files[0].name, lang });
 const p = createProject({ module: arch.id, name: name.replace(/\.\w+$/, ''), files: [{ name, text: editor.value }, ...compFiles().filter((f) => f.name !== name)],
 extensions: projectExtensions(withEdition(preEdition, e.id)) });
 await pstore.put(p);
 store.set('pips.project', p.id);
 store.set('pips.editionNote', E.copied(p.name, e.label, EDITION.label));
 await switchEdition(e.id);
 } catch (err) { consolePanel.message(STRINGS.projects.refused(err.message), 'error'); }
}
const C = STRINGS.cc;
const savedOpt = (k, list, d) => { const v = store.get(k); return list.includes(v) ? v : d; };
const langSel = el('select', { 'aria-label': C.language, title: C.language, onchange: (e) => setLang(e.target.value, { user: true }) },
 el('option', { value: 'asm', text: C.languages.asm }), XL ? gate(el('option', { value: XID, text: XL.label }), CAP.cLanguage) : null);
const xlOpts = (XL?.options ?? []).map((o) => {
 const sel = el('select', { 'aria-label': o.label, onchange: (e) => { store.set(`pips.cc.${o.id}`, e.target.value); doAssemble(); } },
 o.values.map((v) => el('option', { value: v.id, text: v.label })));
 sel.value = savedOpt(`pips.cc.${o.id}`, o.values.map((v) => v.id), o.default);
 return { o, sel, label: el('label', { title: o.title ?? null }, el('span.ed-opt-label', { text: `${o.label} ` }), sel) };
});
for (const x of xlOpts) x.sel.title = x.o.title ?? x.o.label;
const xlValues = () => Object.fromEntries(xlOpts.map((x) => [x.o.id, x.sel.value]));
const ccOpts = el('span.cc-opts', { hidden: true }, xlOpts.map((x) => x.label));
const asmOpts = (arch.language.options ?? []).map((o) => {
 const key = `pips.${arch.id}.opt.${o.id}`;
 const sel = el('select', { 'aria-label': o.label, title: o.title ?? o.label, onchange: (e) => { store.set(key, e.target.value); if (o.apply === 'engine') applyEngineOpts(); else doAssemble(); } },
 o.values.map((v) => el('option', { value: v.id, text: v.label })));
 sel.value = savedOpt(key, o.values.map((v) => v.id), o.default);
 return { o, key, sel, label: el('label', { title: o.title ?? null }, el('span.ed-opt-label', { text: `${o.label} ` }), sel) };
});
const asmValues = () => Object.fromEntries(asmOpts.map((x) => [x.o.id, x.sel.value]));
const buildValues = () => Object.fromEntries(asmOpts.filter((x) => x.o.apply !== 'engine').map((x) => [x.o.id, x.sel.value]));
const engineValues = () => Object.fromEntries(asmOpts.filter((x) => x.o.apply === 'engine').map((x) => [x.o.id, x.sel.value]));
const HAS_ENGINE_OPTS = asmOpts.some((x) => x.o.apply === 'engine');
const shownOpts = asmOpts.filter((x) => !x.o.panel);
const buildOpts = el('span.cc-opts.build-opts', { hidden: shownOpts.length === 0 }, shownOpts.map((x) => x.label));
function withEngineOpts(e) { if (HAS_ENGINE_OPTS) e?.configure?.(engineValues()); return e; }
function applyEngineOpts() {
 if (!HAS_ENGINE_OPTS) return;
 const v = engineValues();
 engine?.configure?.(v);
 const ve = uv()?.realtime?.engine?.();
 if (ve && ve !== engine) ve.configure?.(v);
 if (running && workerRun && worker) worker.postMessage({ type: 'configure', values: v });
 if (running) updateArchPanels(); else refresh();
}
const panelOption = (id) => asmOpts.find((x) => x.o.id === id)?.sel.value ?? null;
function setPanelOption(id, value) {
 const x = asmOpts.find((y) => y.o.id === id);
 if (!x || !x.o.values.some((v) => v.id === value)) return;
 x.sel.value = value; store.set(x.key, value);
 if (x.o.apply === 'engine') applyEngineOpts(); else doAssemble();
}
function doReset() {
 cancelRun();
 resetEngine();
 if (uv()) { if (uv().reset) uv().reset(); else uv().load(session.runnable ? session.program : null); }
 consolePanel.message(STRINGS.resetDone);
 refresh();
}
let templateIndex = null;
async function loadTemplates() {
 if (!templateIndex && !contentUrl('templates')) templateIndex = { groups: {}, templates: [] };
 if (!templateIndex) {
 const r = await fetch(contentUrl('templates'));
 if (!r.ok) throw new Error(`index.json: ${r.status}`);
 templateIndex = await r.json();
 }
 return templateIndex;
}
async function openTemplate(t) {
 const r = await fetch(new URL(t.file, contentUrl('templates')));
 if (!r.ok) { consolePanel.message(STRINGS.templates.failed(`${t.file}: ${r.status}`), 'error'); return; }
 let stimulus = [];
 try { stimulus = t.stimulus ? parseStimulus(t.stimulus) : []; } catch (e) { consolePanel.message(STRINGS.platform.scriptError(e.message), 'error'); }
 session.platformConfig = { ...toolPlatform(), stimulus, rx: (t.rx ?? []).map((e) => ({ ...e })), mtimeDiv: t.mtimeDiv ?? 1 };
 let companion = null;
 if (t.companion) {
 const rc = await fetch(new URL(t.companion, contentUrl('templates')));
 if (!rc.ok) { consolePanel.message(STRINGS.templates.failed(`${t.companion}: ${rc.status}`), 'error'); return; }
 companion = { name: t.companion, text: await rc.text() };
 }
 await applyShared({ view: t.view, profile: t.profile ?? OWN_PROFILES[0].id, lang: t.lang, name: t.file, source: await r.text(), opts: t.opts ?? null, companion,
 ...Object.fromEntries(SETTINGS.map((v) => [v.settings.key, t[v.settings.key] ?? null])), mem: t.mem ? readConfig(t.mem) : null },
 STRINGS.templates.opened(t.title));
}
function templateItems(ix, make) {
 return Object.entries(ix.groups).flatMap(([g, title]) => {
 const items = ix.templates.filter((t) => t.group === g && (!t.tool || t.tool === TOOL?.id)
 && (!EDITION?.compiler || !t.lang || t.lang === 'asm' || t.lang === EDITION.compiler));
 return items.length ? [el('p.menu-head', { text: title }), ...items.map(make)] : [];
 });
}
const templatesMenu = dropMenu(
 el('summary.tool', { title: STRINGS.templates.menuTitle }, icon('code'), el('span.tool-label', { text: STRINGS.templates.menu })),
 [el('p.note', { text: STRINGS.templates.loading })],
 { cls: '.templates-menu', onOpen: async (list) => {
 if (list.dataset.filled) return;
 try {
 const ix = await loadTemplates();
 list.replaceChildren(...templateItems(ix, (t) => el('button', { type: 'button', text: t.title, onclick: () => openTemplate(t) })),
 el('hr.menu-sep'), el('button', { type: 'button', text: STRINGS.templates.more, onclick: () => examplesDialog.open() }));
 list.dataset.filled = '1';
 } catch (e) {
 list.replaceChildren(el('p.note', { text: STRINGS.templates.failed(e.message) }));
 }
 } });
const exerciseBtn = el('button.tool', { type: 'button', hidden: true, title: STRINGS.exercise.buttonTitle, onclick: () => exerciseDialog.open() },
 icon('list'), el('span.tool-label', { text: STRINGS.exercise.button }));
const memBtn = gate(tool('memory', STRINGS.mem.button, () => memSettings.open()), CAP.memoryModel);
memBtn.hidden = !CAP.memoryModel.enabled;
function syncMemButton() {
 if (!CAP.memoryModel.enabled) return;
 const tip = `${STRINGS.mem.buttonTitle}: ${memCfg.mode === 'ideal' && memCfg.words === 256 ? STRINGS.mem.describeIdeal : describeMem(memCfg)}`;
 memBtn.title = tip;
 memBtn.setAttribute('aria-label', tip);
 memBtn.classList.toggle('tool-active', memCfg.mode !== 'ideal' || memCfg.words !== 256);
}
const stepBackBtn = gate(tool('stepBack', STRINGS.stepBack, () => stepBack(), { key: 'Shift+F10', iconOnly: true }), CAP.backStep);
const stepBtn = tool('step', STRINGS.step, () => stepOnce(), { key: 'F10', cls: '.tool-step' });
const lineStepBtn = tool('step', STRINGS.lineStep.step, () => lineStep('stepLine'), { key: 'Alt+F10', cls: '.tool-line' });
const lineBackBtn = tool('stepBack', STRINGS.lineStep.back, () => lineStep('backLine'), { key: 'Alt+Shift+F10', cls: '.tool-line' });
lineStepBtn.hidden = lineBackBtn.hidden = true;
const stepOverBtn = gate(tool('stepOver', STRINGS.stepOver, () => stepOver(), { key: 'F11' }), CAP.stepOver);
const stepOutBtn = gate(tool('stepOut', STRINGS.stepOut, () => stepOut(), { key: 'Shift+F11' }), CAP.stepOver);
const runToCursorBtn = gate(tool('runToCursor', STRINGS.runToCursor, () => runToCursor(), { key: 'Control+F10', iconOnly: true }), CAP.runToCursor);
const resetBtn = tool('reset', STRINGS.reset, doReset, { iconOnly: true });
const speedField = el('label.tool-field', {}, el('span', { text: STRINGS.speed }), speedSel, renderSecs);
const profileField = el('label.tool-field.arch-field', {}, el('span', { text: STRINGS.profile }), profileSel);
const group = (cls, ...items) => el(`div.tb-group${cls}`, {}, items);
const saveBtn = btn(STRINGS.save(arch.language.extension), () => { download(sourceName(), editor.value); if (comp) download(comp.name, comp.text); });
const removeCompBtn = COMP ? el('button', { type: 'button', text: COMP.remove, hidden: true, onclick: () => removeComp() }) : null;
const fileMenuBox = fileMenu(
 btn(STRINGS.open, () => fileInput.click()),
 btn(STRINGS.examples.menu, () => examplesDialog.open()),
 gate(btn(STRINGS.exercise.menu, () => exerciseDialog.open()), CAP.exercises),
 saveBtn,
 ...(COMP ? [el('button', { type: 'button', text: COMP.add, title: COMP.addTitle ?? null, onclick: () => addComp() }), removeCompBtn] : []),
 PROJECT_EDITION && !PROJECTS ? el('button', { type: 'button', text: STRINGS.edition.openIn(PROJECT_EDITION.label),
 title: STRINGS.edition.openInTitle(PROJECT_EDITION.label), onclick: () => openInEdition(PROJECT_EDITION) }) : null,
 gate(btn(STRINGS.exportHex, () => session.program && download('prog.hex', arch.exports.image(session.program).hex)), CAP.exportImage),
 gate(btn(STRINGS.exportBin, () => session.program && download('prog.bin', arch.exports.image(session.program).bin, 'application/octet-stream')), CAP.exportImage),
 btn(STRINGS.exportListing, () => session.program && download('prog.lst', listingText(session.program))),
 ...(PROJECTS ? C_LANGS.filter((x) => x.image).flatMap((x) => [{ extension: '.elf', convert: (b) => b }, ...(x.saveAs ?? [])].map((f) =>
 btn(STRINGS.download.saveBuilt(f.extension), () => saveBuilt(f)))) : []),
 gate(runExport(STRINGS.exportTrace, () => exportTrace('jsonl')), CAP.exportTrace),
 gate(runExport(STRINGS.exportTraceCsv, () => exportTrace('csv')), CAP.exportTrace),
 gate(runExport(STRINGS.exportGolden, () => exportGolden(), '.dp-only'), CAP.exportGolden),
 gate(runExport(STRINGS.exportVcd, () => exportVcd(), '.dp-only'), CAP.waveform),
 gate(el('button', { type: 'button', text: STRINGS.dataIo.menu, title: STRINGS.dataIo.menuTitle, onclick: () => dataDialog.open() }), CAP.dataIO),
 el('hr.menu-sep'),
 gate(el('button', { type: 'button', text: STRINGS.share.copyLink, title: STRINGS.share.copyLinkTitle, onclick: () => copyShareLink() }), CAP.share),
 gate(el('button', { type: 'button', text: STRINGS.share.saveSettings, title: STRINGS.share.saveSettingsTitle, onclick: () => saveSettings() }), CAP.share),
 el('button', { type: 'button', text: STRINGS.share.restore, title: STRINGS.share.restoreTitle, onclick: () => restoreBefore() }));
const toolbarMore = moreMenu(TL.more, TL.moreTitle, ['simulation', 'processor', 'program']);
const archCtx = el('div.arch-ctx', {}, profileField);
const flyMenu = (iconName, name, cls) => dropMenu(el('summary.tool.tool-icon', { title: name, 'aria-label': name },
 icon(iconName), el('span.tool-label', { text: name })), [], { cls: `.dock-fly${cls}` });
const speedFly = flyMenu('speed', STRINGS.speed, '.fly-speed');
const archFly = flyMenu('chip', STRINGS.profile, '.fly-arch');
speedFly.hidden = archFly.hidden = true;
const flyTitles = () => {
 speedFly.querySelector('summary').title = TL.flyout(STRINGS.speed, speedSel.selectedOptions[0]?.text ?? '');
 archFly.querySelector('summary').title = TL.flyout(STRINGS.profile, profileSel.selectedOptions[0]?.text ?? '');
};
for (const f of [speedFly, archFly]) for (const ev of ['pointerenter', 'focus']) f.querySelector('summary').addEventListener(ev, flyTitles);
const toolbar = el('div.toolbar', { role: 'toolbar', 'aria-label': TL.group },
 group('.tb-run', assembleBtn, runBtn),
 group('.tb-step', stepBackBtn, stepBtn, lineBackBtn, lineStepBtn, stepOverBtn, stepOutBtn, runToCursorBtn, resetBtn),
 group('.tb-speed', speedField, soundBtn, archCtx, speedFly, archFly),
 runStatus,
 el('span.sep'),
 group('.tb-program', memBtn, templatesMenu, exerciseBtn, fileMenuBox),
 toolbarMore.menu,
 fileInput);
function dropMenu(summary, items, { onOpen = null, cls = '' } = {}) {
 const list = el('div.menu-list', { role: 'group' }, items);
 const menu = el(`details.menu${cls}`, {}, summary, list);
 menu.addEventListener('toggle', () => { if (menu.open) onOpen?.(list); });
 menu.addEventListener('click', (e) => { if (e.target.closest('.menu-list button')) menu.open = false; });
 menu.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.open) { e.stopPropagation(); menu.open = false; menu.querySelector('summary').focus(); } });
 document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.open = false; });
 return menu;
}
function fileMenu(...items) {
 return dropMenu(el('summary.tool', { title: STRINGS.file }, icon('folder'), el('span.tool-label', { text: STRINGS.file })), items);
}
function moreMenu(label, title, groups) {
 const bodies = Object.fromEntries(groups.map((g) => [g, el('div.ovf-body')]));
 const sections = groups.map((g) => el('div.ovf-sec', { role: 'group', 'aria-label': TL.sections[g], hidden: true },
 el('p.menu-head', { text: TL.sections[g], 'aria-hidden': 'true' }), bodies[g]));
 const menu = dropMenu(el('summary.tool.tool-icon.ovf-btn', { title, 'aria-label': title }, icon('more'), el('span.tool-label', { text: label })),
 sections, { cls: '.ovf' });
 menu.hidden = true;
 return { menu, bodies };
}
const header = document.querySelector('.app-header');
const THEMES = ['', 'light', 'dark', 'dim', 'black', 'sepia', 'hc-light', 'hc-dark'];
function setTheme(t) {
 if (!THEMES.includes(t)) t = '';
 if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
 store.set('pips.theme', t);
}
function themeRow() {
 const cur = document.documentElement.dataset.theme ?? '';
 const sel = el('select.theme-sel', { 'aria-label': TL.themes.group, 'data-cmd': 'theme', onchange: () => setTheme(sel.value) },
 THEMES.map((t) => el('option', { value: t, text: TL.themes.names[t], selected: t === cur })));
 return el('label.menu-check.theme-row', { title: TL.themes.title }, el('span', { text: TL.themes.group }), sel);
}
const VM = STRINGS.viewModes;
const viewModes = new ViewModes({ onChange: (s) => applyViewMode(s),
 onError: (e) => consolePanel.message(e.message === 'unsupported' ? VM.unavailable : STRINGS.fullScreenRefused(e.message), 'warn') });
const fullBtn = tool('fullscreen', STRINGS.fullScreen, () => (viewModes.fullscreen ? viewModes.exit() : viewModes.set('fullscreen')), { iconOnly: true });
fullBtn.hidden = !viewModes.supported;
document.addEventListener('fullscreenchange', () => {
 setToolLabel(fullBtn, 'fullscreen', document.fullscreenElement ? STRINGS.exitFullScreen : STRINGS.fullScreen);
 fullBtn.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
});
let projector = store.get('pips.projector') === '1';
const projBtn = tool('projector', STRINGS.projector, () => setProjector(!projector), { iconOnly: true });
function setProjector(on, quiet = false) {
 projector = on;
 document.documentElement.toggleAttribute('data-projector', on);
 projBtn.title = STRINGS.projectorTitle;
 projBtn.setAttribute('aria-pressed', String(on));
 store.set('pips.projector', on ? '1' : '');
 if (!quiet) { configureLayout(); refit(); }
}
setProjector(projector, true);
const keysBox = el('details.keys', {}, el('summary.tool.tool-icon', { title: STRINGS.keys, 'aria-label': STRINGS.keys }, icon('keyboard'),
 el('span.tool-label', { text: STRINGS.keys })),
el('p', {}, STRINGS.shortcutList
 .filter(([, , needs]) => !needs || (needs === 'stepOver' ? CAP.stepOver.enabled : VIEWS.some((v) => ['datapath', 'bus'].includes(v.kind))))
 .map(([keys, what]) => el('span.key-line', {}, el('kbd.mono', { text: keys }), el('span', { text: what })))));
document.addEventListener('keydown', (e) => {
 if (e.key !== 'Escape' || !keysBox.open) return;
 keysBox.open = false;
 if (keysBox.contains(document.activeElement)) { e.stopPropagation(); keysBox.querySelector('summary').focus(); }
}, true);
document.addEventListener('click', (e) => { if (!keysBox.contains(e.target)) keysBox.open = false; });
const viewMenu = dropMenu(el('summary.tool', { title: STRINGS.layout.view }, icon('layout'), el('span.tool-label', { text: STRINGS.layout.view })),
 [], { onOpen: (list) => fillViewMenu(list), cls: '.view-menu-top' });
const DOCK_ICON = { top: 'dockTop', left: 'dockLeft', right: 'dockRight' };
let tbDock = null;
const dockRadios = DOCKS.map((p) => el('input', { type: 'radio', name: 'tb-dock', value: p, onchange: () => {
 tbDock?.choose(p);
 if (p === 'top' && viewModes.state.compact) viewModes.set('normal');
} }));
const dockMenu = dropMenu(el('summary.tool.tool-icon', { title: TL.dock, 'aria-label': TL.dock }, icon('dockTop'), el('span.tool-label', { text: TL.dockLabel })),
 [el('p.menu-head', { text: TL.dock, 'aria-hidden': 'true' }),
 ...DOCKS.map((p, i) => el('label.menu-check.dock-opt', {}, dockRadios[i], icon(DOCK_ICON[p], { size: 16 }), el('span', { text: TL.docks[p] })))],
 { cls: '.dock-menu' });
dockMenu.querySelector('.menu-list').setAttribute('aria-label', TL.dock);
const panel = (title, body, cls = '', iconName = null) => el(`section.panel${cls}`, { 'aria-label': title }, head(title, iconName), body);
function head(title, iconName = null, ...tools) {
 return el('h2', {}, iconName ? icon(iconName, { size: 15 }) : null, el('span.panel-title', { text: title }),
 tools.length ? el('span.panel-head-tools', {}, tools) : null);
}
const tabs = (items, { onSelect = null } = {}) => {
 const bar = el('div.tabs', { role: 'tablist' });
 const host = el('div.tab-body');
 const buttons = items.map(([title, , , cap], i) => {
 const b = el('button', { type: 'button', role: 'tab', text: title, 'aria-selected': String(i === 0), onclick: () => select(i) });
 return cap ? gate(b, cap) : b;
 });
 function select(i) {
 if (buttons[i].disabled) return;
 buttons.forEach((b, k) => b.setAttribute('aria-selected', String(k === i)));
 host.replaceChildren(items[i][1]);
 items[i][2]?.();
 onSelect?.(i, items[i][0]);
 }
 bar.append(...buttons);
 select(0);
 const selectTitle = (title) => { const i = items.findIndex(([t]) => t === title); if (i >= 0) select(i); return i >= 0; };
 return { root: el('div.tabbed', {}, bar, host), bar, select, selectTitle };
};
let mode = VIEWS[0].id;
const viewOf = (id) => VIEWS.find((v) => v.id === id) ?? null;
const inst = {};
const memsysOf = {};
const isDp = (id = mode) => ['datapath', 'bus'].includes(viewOf(id)?.kind);
const isCmp = (id = mode) => viewOf(id)?.kind === 'compare';
const uv = () => (isDp() ? inst[mode] ?? null : null);
const makeMemsys = () => buildMemsys(memCfg, { platform: memCfg.devices ? new Platform(session.platformConfig) : null }).memsys;
document.body.append(memSettings.root);
syncMemButton();
function applyMemory(cfg, { assemble = true } = {}) {
 cancelRun();
 memCfg = cfg;
 store.set(CONFIG_KEY, writeConfig(cfg));
 for (const id of Object.keys(inst)) {
 if (!isDp(id)) continue;
 memsysOf[id] = makeMemsys();
 inst[id].setMemsys?.(memsysOf[id]);
 }
 syncMemButton();
 consolePanel.message(STRINGS.mem.applied(cfg.mode === 'ideal' && cfg.words === 256 ? STRINGS.mem.describeIdeal : describeMem(cfg)), 'ok');
 if (assemble) doAssemble();
}
function dataAccessNow() {
 try {
 const a = (uv() ? uv().dataAccess?.() : engine?.dataAccess?.()) ?? null;
 return a ? { addr: a.address, size: a.size } : null;
 } catch { return null; }
}
const DEVICES = arch.addressSpace.regions.filter((r) => r.kind === 'device');
const traceRun = () => ({ program: session.program, harvard: profileOf(session.profile)?.memory === 'harvard',
 devices: DEVICES,
 create: () => withEngineOpts(arch.engine.create(session.program, { platformConfig: session.platformConfig, historyLimit: 1 })) });
let traceResult = null;
function analyseTrace() {
 if (!ensureRunnable()) { consolePanel.message(STRINGS.exportNothing, 'error'); return; }
 const r = traceCacheRun(traceRun(), memCfg);
 traceResult = { caches: r.caches, instructions: r.instructions, stop: r.stop, error: r.error, program: session.program, cfg: memCfg,
 at: engine?.state().retired ?? 0 };
 updateMemPanels();
}
const LIVE_CAP = 300_000;
let live = null;
function liveTrace() {
 if (!engine || !session.program || memCfg.mode !== 'cache' || !(memCfg.l1i.on || memCfg.l1d.on)) { live = null; return null; }
 const n = Math.min(engine.state().retired, LIVE_CAP);
 if (!live || live.program !== session.program || live.cfg !== memCfg || live.retired > n) live = new TraceCache(traceRun(), memCfg);
 live.advanceTo(n);
 return { caches: live.caches, instructions: live.instructions, stop: live.stop === 'limit' ? 'here' : live.stop, error: live.error };
}
function updateMemPanels() {
 const v = uv();
 const ms = v ? memsysOf[mode] ?? null : null;
 const ctx = { memsys: ms, cfg: memCfg, mode, accessed: dataAccessNow(), fetch: v ? v.state()?.pc ?? null : engine?.state().pc ?? null, words: ms?.memWords, dev: platformCtx(),
 ...(mode === VIEWS[0].id ? { analyse: analyseTrace, trace: traceResult && traceResult.at === (engine?.state().retired ?? 0) ? traceResult : liveTrace(),
 traceStale: traceResult && (traceResult.program !== session.program || traceResult.cfg !== memCfg) } : {}) };
 cacheView.update(ctx);
 periph.update(ctx);
}
function updateArchPanels() {
 if (!archPanels.length) return;
 const v = uv();
 const s = v ? v.state() : engine?.state() ?? null;
 const accepts = Boolean(session.runnable && s && (v ? v.input : engine?.input));
 const state = s ? { registers: s.registers, steps: v ? s.cycle : s.steps ?? s.retired, clock: Boolean(v) } : null;
 const ie = inputEngine();
 const live = s && !rt ? ie?.live?.({ uartFrom: Infinity }) : null;
 if (state && live) { state.pins = live.pins; state.parts = live.parts; }
 if (state && ie?.restart) state.inputs = (ie.inputs?.().length ?? 0) + (workerRun ? workerInputs.length : 0);
 if (state && ie?.audioStatus) state.audio = ie.audioStatus();
 if (state && !rt && ie?.panelState) state.panel = ie.panelState();
 for (const { inst } of archPanels) inst.update(state, { accepts, running });
}
const inputEngine = () => (uv() ? uv().realtime?.engine?.() ?? null : engine);
function replayInputs() {
 const e = inputEngine();
 if (running || !e?.restart || !e.inputs) return;
 const list = e.inputs();
 e.restart(list);
 uv()?.realtime?.sync?.();
 diag.reset();
 consolePanel.message(STRINGS.realtime.replaying(list.length));
 refresh();
 startRun();
}
if (new URLSearchParams(location.search).has('selftest')) {
 globalThis.__mavileraTest = {
 stateHash: () => inputEngine()?.stateHash?.() ?? null,
 registers: () => inputEngine()?.state?.().registers ?? null,
 audioStats: () => audioHost?.stats() ?? null,
 audioResetStats: () => audioHost?.resetStats(),
 replayCheck: () => {
 const e = inputEngine();
 if (!e?.stateHash || !session.runnable) return null;
 const s = e.state(), hash = e.stateHash();
 const f = withEngineOpts(arch.engine.create(session.program, { inputs: e.inputs(), runLimit: Infinity }));
 f.run({ chunk: s.steps, breakpoints: new Set() });
 return { steps: s.steps, inputs: e.inputs().length, hash, replay: f.stateHash(), replaySteps: f.state().steps, equal: f.stateHash() === hash && f.state().steps === s.steps };
 },
 };
}
function forgetInputs() {
 const e = inputEngine();
 if (running || !e?.restart) return;
 e.restart([]);
 uv()?.realtime?.sync?.();
 consolePanel.message(STRINGS.realtime.forgot);
 refresh();
}
function applyInputs(list) {
 const e = inputEngine();
 if (!Array.isArray(list) || !list.length || !e?.restart) return false;
 try { e.restart(list); } catch (err) { consolePanel.message(STRINGS.realtime.badInputs(err.message), 'error'); return false; }
 uv()?.realtime?.sync?.();
 return true;
}
function giveInput(x) {
 if (running && workerRun && session.runnable) { workerInputs.push(x); worker.postMessage({ type: 'input', x }); updateArchPanels(); return; }
 const v = uv();
 if (v) { if (v.input) { v.input(x); refresh(); } return; }
 if (!session.runnable || !engine?.input) return;
 engine.input(x);
 if (running) updateArchPanels(); else refresh();
}
let isaProfile = session.profile;
const viewTabs = el('nav.mode-nav', { role: 'tablist', 'aria-label': STRINGS.views });
const viewButtons = VIEWS.map((v) =>
 el('button.mode-btn', { type: 'button', role: 'tab', title: v.label, 'aria-label': v.label, 'aria-selected': String(v.id === mode), onclick: () => setMode(v.id) },
 icon(v.icon), el('span', { text: v.label })));
viewTabs.append(...viewButtons);
const SUBSETS = profileOf(VIEWS.find((v) => v.subsets)?.profile)?.subsets ?? [];
const noSubset = (value) => !SUBSETS.length || value === SUBSETS[0].id;
const subsetSel = el('select', { 'aria-label': STRINGS.view.subset, hidden: true, onchange: (e) => {
 session.subset = noSubset(e.target.value) ? null : e.target.value;
 store.set('pips.subset', e.target.value);
 doAssemble();
} }, SUBSETS.map((s) => el('option', { value: s.id, text: s.label })));
archCtx.append(subsetSel);
const helpBtn = tool('help', STRINGS.help.button, () => helpDialog.open(), { iconOnly: true });
const headerMore = moreMenu(TL.menu, TL.menuTitle, ['views', 'workspace', 'application']);
const focusView = el('span.focus-view');
const focusBadge = el('span.focus-badge');
const focusCrumb = el('span.focus-crumb', { hidden: true }, focusView, focusBadge);
const exitBtn = el('button.tool.focus-exit', { type: 'button', hidden: true, onclick: () => viewModes.exit() });
function syncCrumb(s = viewModes.state) {
 focusView.textContent = viewOf(mode)?.label ?? '';
 if (!s.compact) return;
 focusBadge.textContent = VM.badge[s.mode] ?? VM.badge.focus;
 const k = s.fullscreen ? 'fullscreen' : 'focus';
 exitBtn.replaceChildren(icon(s.fullscreen ? 'restore' : 'close'), el('span.tool-label', { text: VM.exit[k] }));
 exitBtn.setAttribute('aria-label', VM.exit[k]);
 exitBtn.title = VM.exitTitle[k];
}
const editionSwitch = arch.editions?.length > 1 ? el('div.edition-switch', { role: 'group', 'aria-label': STRINGS.edition.group },
 arch.editions.map((e) => {
 const on = e.id === arch.activeEdition;
 return el('button', { type: 'button', text: e.label, 'aria-pressed': String(on),
 title: on ? STRINGS.edition.current(e.title ?? e.label) : STRINGS.edition.switchTo(e.title ?? e.label),
 onclick: () => { if (!on) switchEdition(e.id); } });
 })) : null;
header.replaceChildren(
 el('div.brand', {}, header.querySelector('.app-logo') ?? el('span.app-logo', { 'aria-hidden': 'true' }),
 el('div.brand-text', {}, header.querySelector('.app-title'), el('span.app-subtitle', { text: STRINGS.appFull }))),
 ...(editionSwitch ? [editionSwitch] : []),
 focusCrumb,
 viewTabs,
 el('div.header-tools', {}, viewMenu, dockMenu, projBtn, fullBtn, keysBox, helpBtn),
 exitBtn,
 headerMore.menu);
for (const [cmd, node] of Object.entries({ assemble: assembleBtn, run: runBtn, stepBack: stepBackBtn, step: stepBtn, lineStep: lineStepBtn, lineBack: lineBackBtn, stepOver: stepOverBtn,
 stepOut: stepOutBtn, runToCursor: runToCursorBtn, reset: resetBtn, speed: speedSel, memory: memBtn, templates: templatesMenu, exercise: exerciseBtn,
 file: fileMenuBox, profile: profileSel, subset: subsetSel, views: viewTabs, layout: viewMenu, projector: projBtn,
 fullScreen: fullBtn, keys: keysBox, help: helpBtn, moreHeader: headerMore.menu, moreToolbar: toolbarMore.menu,
 dock: dockMenu, speedMenu: speedFly, profileMenu: archFly, viewExit: exitBtn, ...(editionSwitch ? { edition: editionSwitch } : {}) })) node.dataset.cmd = cmd;
headerFit = overflowBar({ bar: header, more: headerMore.menu, sections: headerMore.bodies, steps: [
 { cls: 'hb-tight' }, { cls: 'hb-views-active' },
 { node: projBtn, group: 'workspace' }, { node: dockMenu, group: 'workspace' }, { node: keysBox, group: 'application' }, { node: fullBtn, group: 'application' },
 { node: viewMenu, group: 'workspace' }, { cls: 'hb-views-icons' },
 { node: viewTabs, group: 'views' }, { node: helpBtn, group: 'application' },
 ...(editionSwitch ? [{ node: editionSwitch, group: 'workspace' }] : []),
 { cls: 'hb-mini' }] });
toolbarFit = overflowBar({ bar: toolbar, more: toolbarMore.menu, sections: toolbarMore.bodies, steps: [
 { cls: 'tb-compact' },
 { node: runToCursorBtn, group: 'simulation' }, { node: memBtn, group: 'program' }, { node: templatesMenu, group: 'program' },
 { node: archCtx, group: 'processor' }, { node: speedField, group: 'simulation' },
 { node: exerciseBtn, group: 'program' }, { node: fileMenuBox, group: 'program' },
 { node: resetBtn, group: 'simulation' }, { node: stepOutBtn, group: 'simulation' }, { node: stepOverBtn, group: 'simulation' },
 { node: lineBackBtn, group: 'simulation' }, { node: stepBackBtn, group: 'simulation' }, { node: lineStepBtn, group: 'simulation' },
 { cls: 'tb-mini' }] });
refit();
document.fonts?.ready.then(refit);
async function brandSvg(file, decorative = true) {
 const r = await fetch(new URL(`../content/branding/mavilera/${file}`, import.meta.url));
 if (!r.ok) throw new Error(`${file}: ${r.status}`);
 const svg = document.importNode(new DOMParser().parseFromString(await r.text(), 'image/svg+xml').documentElement, true);
 if (decorative) {
 svg.setAttribute('aria-hidden', 'true');
 svg.removeAttribute('role');
 svg.removeAttribute('aria-labelledby');
 for (const n of svg.querySelectorAll('title, desc')) n.remove();
 }
 return svg;
}
const brandReady = (async () => {
 try {
 const [full, small] = await Promise.all([brandSvg(TOOL?.header ?? arch.content?.logo ?? 'mavilera-logo.svg'), brandSvg('mavilera-icon.svg')]);
 full.classList.add('brand-logo', 'brand-full');
 small.classList.add('brand-logo', 'brand-icon');
 const where = { protocol: location.protocol, href: location.href, release: !!document.querySelector('meta[name="risc-vista-edition"][content="release"]') };
 const switcher = archSwitcher({ logo: full, targets: switchTargets(TOOL?.within ?? TOOL?.id ?? ARCH_ID, where), home: homeUrl(where), current: TOOL?.name ?? STRINGS.appFull,
 loadLogo: (file) => brandSvg(file), strings: STRINGS.archSwitch, nameAt: NAME_AT });
 header.querySelector('.app-logo')?.replaceChildren(switcher, small);
 header.classList.add('has-logo');
 refit();
 } catch { }
})();
const RELEASE = document.querySelector('meta[name="risc-vista-edition"][content="release"]')
 ? document.querySelector('meta[name="risc-vista-version"]')?.content ?? '' : null;
const aboutLogo = el('div.about-logo');
const about = el('dialog.about', { 'aria-labelledby': 'about-title' },
 aboutLogo,
 el('h2', { id: 'about-title', text: `${STRINGS.appName}: ${STRINGS.appFull}` }),
 el('p.about-expansion', { text: `${STRINGS.appName}: ${STRINGS.appExpansion}` }),
 el('p.about-tag', { text: STRINGS.tagline }),
 el('p', { text: STRINGS.aboutText }),
 el('p.about-meta', { text: RELEASE ? STRINGS.aboutVersionRelease(RELEASE) : STRINGS.aboutVersion }),
 el('p.about-meta', { text: RELEASE ? STRINGS.aboutRightsRelease : STRINGS.aboutRights }),
 el('form', { method: 'dialog' }, el('button', { type: 'submit', text: STRINGS.aboutClose })));
document.body.append(about);
const dataDialog = new DataDialog({
 hex: (a) => hexA(a),
 program: () => session.program,
 memory: () => (uv() ? uv().memoryPort?.() ?? null : enginePort),
 loads: () => session.dataLoads,
 onLoad: (label, bytes, name) => { session.loadData(label, bytes, name); doAssemble(); },
 onClear: () => { session.clearData(); doAssemble(); },
 onSave: (name, data, type) => download(name, data, type),
});
document.body.append(dataDialog.root);
const viewForProfile = (profile) => VIEWS.find((v) => !isCmp(v.id) && (v.profile ?? OWN_PROFILES[0].id) === profile)?.id ?? VIEWS[0].id;
const examplesDialog = new ExamplesDialog({ index: contentUrl('examples'), templates: () => loadTemplates(), onTemplate: (t) => openTemplate(t), templateItems, onOpen: async (x, text) => {
 let source = text;
 if (x.gcc) { const imps = await arch.language.importers(); source = (imps.find((i) => i.test(text)) ?? imps[0]).convert(text, x.file).text; }
 await applyShared({ view: viewForProfile(x.profile), profile: x.profile === OWN_PROFILES[0].id ? x.profile : isaProfile,
 subset: profileOf(x.profile)?.subsets ? x.subset ?? profileOf(x.profile).subsets[0].id : null,
 lang: x.lang, name: x.file, source }, STRINGS.examples.opened(x.title));
 const note = await viewOf(viewForProfile(x.profile))?.openNote?.(x);
 if (note) consolePanel.message(note, 'warn');
 if (x.halts === false) consolePanel.message(STRINGS.examples.noHalt, 'warn');
} });
document.body.append(examplesDialog.root);
const helpDialog = new HelpDialog({ index: contentUrl('help'), onAbout: () => openAbout(), logo: () => brandSvg('mavilera-full.svg'),
 docsUrl: !contentUrl('docs') ? null : RELEASE === null ? contentUrl('docs').href
 : location.protocol === 'file:' ? `https://sajidlab.org/mavilera/${arch.id}/docs/` : new URL('./docs/', location.href).href });
document.body.append(helpDialog.root);
async function openAbout() {
 if (!aboutLogo.firstChild) aboutLogo.append(await brandSvg('mavilera-full.svg').catch(() => el('strong', { text: STRINGS.appName })));
 about.showModal();
}
const listingTabs = tabs([[STRINGS.listing, listing.root], [STRINGS.data, dataBox], [STRINGS.symbols, symBox],
 ...(arch.language.extraLanguages?.length ? [[C.asmTab, asmBox]] : [])]);
const pListing = panel(STRINGS.listing, listingTabs.root, '.p-listing', 'list');
const scratchOut = el('div.scratch-out.mono', { 'aria-live': 'polite' });
const scratchIn = el('input.mono.scratch-in', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': STRINGS.scratch.label,
 placeholder: STRINGS.scratch.placeholder, title: STRINGS.scratch.title, oninput: () => runScratch() });
function runScratch() {
 const X = STRINGS.scratch;
 const r = arch.language.scratch(scratchIn.value);
 if (r.kind === 'empty') { scratchOut.replaceChildren(); return; }
 if (r.kind === 'decode') {
 scratchOut.replaceChildren(el('div', { text: r.ok ? X.decoded(r.text) : X.notInstr }));
 if (r.ok) fields.show(r.rows[0]);
 return;
 }
 if (!r.ok) {
 scratchOut.replaceChildren(el('div.scratch-err', { text: `✖ ${r.error.message}` }), ...(r.error.note ? [el('div.note', { text: r.error.note })] : []));
 return;
 }
 const bin = (l) => (l.word >>> 0).toString(2).padStart(8 * l.size, '0').replace(/(.{4})(?!$)/g, '$1_');
 scratchOut.replaceChildren(...r.rows.map((l) => el('button.link-btn.mono', { type: 'button', title: X.pick, onclick: () => fields.show(l) },
 X.word(hex8(l.word), bin(l)))));
 fields.show(r.rows[0]);
}
const pFields = panel(STRINGS.layout.panes.inspector, el('div.col', {},
 el('label.scratch', { title: STRINGS.scratch.title }, el('span', { text: STRINGS.scratch.label }), gate(scratchIn, CAP.scratch)), scratchOut, fields.root), '.p-fields', 'inspect');
const pDatapath = panel(STRINGS.view.panel, el('p.note', { text: STRINGS.loadingView }), '.p-datapath');
const pInfo = panel(STRINGS.view.info, el('div'), '.p-info', 'inspect');
function paneControls(node, title) {
 const L = STRINGS.layout;
 const up = el('button.pane-up', { type: 'button', onclick: () => midSplit.setCollapsed(midSplit.panes[0].id, !midSplit.collapsed[0]) });
 const max = el('button.pane-max', { type: 'button', onclick: () => setMidMax(node, !workspace.classList.contains('mid-max')) });
 node.querySelector(':scope > h2').append(up, max);
 node.addEventListener('keydown', (e) => { if (e.key === 'Escape' && workspace.classList.contains('mid-max')) { setMidMax(node, false); max.focus(); } });
 const sync = () => {
 const here = node._split === midSplit && midSplit.panes[1]?.node === node;
 up.hidden = !here;
 max.hidden = !here;
 if (!here) return;
 const h = node.querySelector(':scope > h2');
 if (h && up.parentNode !== h) h.insertBefore(max, node._toggle?.parentNode === h ? node._toggle : null), h.insertBefore(up, max);
 const aboveFolded = midSplit.collapsed[0];
 up.replaceChildren(icon(aboveFolded ? 'growBack' : 'growUp'));
 const label = aboveFolded ? L.openAbove : L.enlargeUp(title);
 up.setAttribute('aria-label', label);
 up.setAttribute('aria-pressed', String(aboveFolded));
 up.title = label;
 if (node._toggle) node._toggle.hidden = aboveFolded;
 const on = workspace.classList.contains('mid-max') && node.classList.contains('max-pane');
 const ml = on ? L.restorePane(title) : L.maximisePane(title);
 max.replaceChildren(icon(on ? 'restore' : 'fullscreen'), el('span.pane-max-label', { text: on ? L.restoreShort : L.maximiseShort }));
 max.setAttribute('aria-label', ml);
 max.setAttribute('aria-pressed', String(on));
 max.title = on ? `${ml} (Esc)` : ml;
 };
 return sync;
}
function setMidMax(node, on) {
 if (on && midSplit.isCollapsed(midSplit.panes[1].id)) midSplit.setCollapsed(midSplit.panes[1].id, false);
 if (on) setDockMax(false);
 workspace.classList.toggle('mid-max', on);
 for (const n of [pInfo, pFields]) n.classList.toggle('max-pane', on && n === node);
 midSplit.onApply();
}
const pCompare = panel(STRINGS.view.comparison, el('p.note', { text: STRINGS.loadingView }), '.p-compare', 'compare');
let memHead = null, memTabName = STRINGS.mem.tabMemory, dockDp = false;
function memTabChanged(name) {
 memTabName = name;
 if (!memHead) return;
 memHead.querySelector('.panel-title').textContent = name;
 syncDockBar();
}
const memTabs = tabs([[STRINGS.mem.tabMemory, memory.root], [STRINGS.mem.tabCache, cacheView.root, () => updateMemPanels(), CAP.cache],
 [STRINGS.mem.tabPeripherals, periph.root, () => updateMemPanels(), CAP.devices],
 ...archPanels.map(({ p, inst }) => [p.label, inst.root, () => updateArchPanels()])], { onSelect: (i, name) => memTabChanged(name) });
const MEM_PANE = CAP.cache.enabled ? { panel: STRINGS.mem.panel, link: STRINGS.mem.link, bar: STRINGS.layout.dockBarDp }
 : { panel: STRINGS.mem.panelPlain, link: STRINGS.mem.linkPlain, bar: STRINGS.layout.dockBarDpPlain };
const pMemory = panel(MEM_PANE.panel, memTabs.root, '.p-memory', 'memory');
memHead = pMemory.querySelector(':scope > h2');
memHead.querySelector('.panel-title').textContent = memTabName;
memHead.querySelector('.panel-title').after(memTabs.bar);
const maxBtn = el('button.pane-max', { type: 'button', onclick: () => setDockMax(!workspace.classList.contains('dock-max')) });
pMemory.querySelector(':scope > h2').append(maxBtn);
pMemory.addEventListener('keydown', (e) => { if (e.key === 'Escape' && workspace.classList.contains('dock-max')) { setDockMax(false); maxBtn.focus(); } });
function setDockMax(on) {
 if (on && rootSplit.isCollapsed('dock')) rootSplit.setCollapsed('dock', false);
 workspace.classList.toggle('dock-max', on);
 const label = on ? STRINGS.mem.restorePanel : STRINGS.mem.maximisePanel;
 maxBtn.replaceChildren(icon(on ? 'restore' : 'fullscreen'), el('span.pane-max-label', { text: on ? STRINGS.mem.restoreShort : STRINGS.mem.maximiseShort }));
 maxBtn.setAttribute('aria-label', label);
 maxBtn.setAttribute('aria-pressed', String(on));
 maxBtn.title = on ? `${label} (Esc)` : label;
}
const memLink = () => el('div.mem-link', {}, el('p.note', { text: MEM_PANE.link }),
 el('button', { type: 'button', text: STRINGS.mem.openPanel, onclick: () => showMemoryPanel() }));
function showMemoryPanel(tab = 0) {
 if (rootSplit.isCollapsed('dock')) rootSplit.setCollapsed('dock', false);
 memTabs.select(tab);
 flashPanel(pMemory);
}
const clearBtn = tool('trash', TL.clear, () => consolePanel.clearMessages(), { iconOnly: true, cls: '.tool-small' });
const pConsole = el('section.panel.p-console', { 'aria-label': `${STRINGS.console} · ${STRINGS.messages}` },
 head(`${STRINGS.console} · ${STRINGS.messages}`, 'terminal', clearBtn), consolePanel.root);
const pRegs = panel(STRINGS.registers, regs.root, '.p-regs', 'registers');
const pCounters = panel(STRINGS.counters, counters.root, '.p-counters', 'gauge');
const pCalls = panel(STRINGS.calls.title, calls.root, '.p-calls', 'steps');
const explorer = PROJECTS ? new ProjectExplorer({
 onOpen: (name) => selectFile(name),
 onNew: (name) => {
 const text = XL && langOfFile(name) === XID && !project().files.some((f) => langOfFile(f.name) === XID) ? cCompiler()?.example ?? XL.example ?? '' : '';
 proj.addFile(name, text); editor.show(name, text); afterFiles();
 },
 onRename: (from, to) => { proj.renameFile(from, to); editor.rename(from, to); afterFiles(true); },
 onDuplicate: (name) => { proj.duplicateFile(name); const n = project().active; editor.show(n, fileText(project(), n)); afterFiles(); },
 onEntry: (name) => { proj.setEntry(name); afterFiles(true); },
 onDelete: (name) => {
 proj.deleteFile(name);
 editor.close(name);
 editor.show(project().active, fileText(project(), project().active));
 afterFiles(true);
 explorer.note(STRINGS.projects.deleted(name), 'info', [STRINGS.projects.undo, () => {
 const n = proj.undoDelete();
 if (n) { editor.show(n, fileText(project(), n)); afterFiles(true); explorer.note(STRINGS.projects.undone(n)); }
 }]);
 },
 onNewProject: (name) => proj.newProject(name || STRINGS.projects.untitled, [{ name: `main${arch.language.extension}`, text: EXAMPLE }]),
 onOpenProjects: () => projectsDialog.open(project().id),
 onRenameProject: (name) => { proj.renameProject(name); explorer.render(project(), editor.active, proj.status); },
 onDeleteProject: async () => {
 const name = project().name;
 await proj.deleteProject(project().id, defaultProject);
 consolePanel.message(STRINGS.projects.deletedProject(name), 'ok');
 },
 onImport: async (file) => {
 await proj.importZip(new Uint8Array(await file.arrayBuffer()), file.name);
 consolePanel.message(STRINGS.projects.imported(file.name, project().files.length), 'ok');
 },
 onExport: async () => {
 const { bytes, fileName: zipName } = await proj.exportZip();
 download(zipName, bytes, 'application/zip');
 consolePanel.message(STRINGS.projects.exported(zipName), 'ok');
 },
 onCompiler: (id) => {
 proj.setCompiler(id === C_LANGS[0]?.id ? null : id);
 doAssemble();
 consolePanel.message(STRINGS.projects.compilerSet(cCompiler().label), 'ok');
 },
}, projectExtensions(arch), EDITION?.compiler ? [] : C_LANGS.map((x) => ({ id: x.id, label: x.label }))) : null;
const projectsDialog = PROJECTS ? new ProjectsDialog({
 list: () => proj.list(),
 onOpen: (id) => proj.openProject(id).catch((e) => consolePanel.message(STRINGS.projects.refused(e.message), 'error')),
 onDelete: (id) => proj.deleteProject(id, defaultProject),
}) : null;
if (projectsDialog) document.body.append(projectsDialog.root);
const fileName = el('span.ed-tab-name');
const dirtyMark = el('span.ed-dirty', { text: '●', title: TL.modified, hidden: true });
const edPos = el('span.ed-pos');
const edState = el('span.ed-state');
const edProfile = el('span.ed-prof');
const progTab = PROJECTS ? null : el('span.ed-tab', {}, icon('file', { size: 14 }), fileName, dirtyMark);
const compTabs = COMP ? el('div.ed-tabs', { role: 'tablist', 'aria-label': STRINGS.companion.tabs, onkeydown: (e) => compTabKey(e) }) : null;
const compTabsBox = COMP ? el('span.ed-tabs-box.ed-comp', { hidden: true }, compTabs) : null;
const mainPanel = COMP ? el('div.ed-panel', { id: 'ed-cpanel-0' }, editor.root) : null;
const compPanel = COMP ? el('div.ed-panel', { id: 'ed-cpanel-1', hidden: true }, compEd.root) : null;
function renderCompTabs() {
 if (!COMP) return;
 const on = Boolean(comp);
 if (!on) compOn = false;
 progTab.hidden = on;
 compTabsBox.hidden = !on;
 removeCompBtn.hidden = !on;
 mainPanel.hidden = compOn;
 compPanel.hidden = !compOn;
 saveBtn.textContent = on ? STRINGS.companion.save(arch.language.extension, COMP.extension) : STRINGS.save(arch.language.extension);
 for (const [panel, i] of [[mainPanel, 0], [compPanel, 1]]) {
 if (on) { panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `ed-ctab-${i}`); }
 else { panel.removeAttribute('role'); panel.removeAttribute('aria-labelledby'); }
 }
 if (!on) { progTab.append(dirtyMark); compTabs.replaceChildren(); return; }
 compEd.area.setAttribute('aria-label', `${STRINGS.editor}: ${comp.name}`);
 const tab = (i, name, sel, close) => el('span.ed-tab-item', { role: 'presentation' },
 el('button.ed-tab', { type: 'button', role: 'tab', id: `ed-ctab-${i}`, 'aria-selected': String(sel), 'aria-controls': `ed-cpanel-${i}`,
 tabindex: sel ? '0' : '-1', 'data-i': String(i), 'aria-keyshortcuts': close ? 'Delete' : null, onclick: () => showComp(i === 1) },
 el('span.ed-tab-name', { text: name })),
 close ? el('button.ed-tab-close', { type: 'button', tabindex: '-1', 'aria-hidden': 'true', title: COMP.remove, onclick: (e) => { e.stopPropagation(); removeComp(); } }, '×') : null);
 compTabs.replaceChildren(tab(0, sourceName(), !compOn, false), tab(1, comp.name, compOn, true));
 compTabs.append(dirtyMark);
}
function compTabKey(e) {
 const t = e.target.closest?.('[role=tab]');
 if (!t) return;
 if (e.key === 'Delete' && t.dataset.i === '1') { e.preventDefault(); removeComp(); compTabs.querySelector('[role=tab]')?.focus(); return; }
 if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
 e.preventDefault();
 const to = e.key === 'Home' ? 0 : e.key === 'End' ? 1 : t.dataset.i === '1' ? 0 : 1;
 showComp(to === 1);
 compTabs.querySelector(`[role=tab][data-i="${to}"]`)?.focus();
}
function showComp(on) {
 compOn = on && Boolean(comp);
 renderCompTabs();
 editorStatus();
}
function keepComp() { if (COMP) store.set('pips.companion', comp ? JSON.stringify(comp) : ''); }
function setComp(c) {
 if (!COMP) return;
 comp = c && typeof c.name === 'string' && typeof c.text === 'string' ? { name: c.name, text: c.text } : null;
 compEd.value = comp ? comp.text : '';
 compEd.setErrors([]);
 compOn = false;
 keepComp();
 renderCompTabs();
}
function addComp() {
 if (comp) { showComp(true); return; }
 let kept = null;
 try { kept = JSON.parse(store.get('pips.companion.removed') ?? 'null'); } catch { }
 const name = kept?.name ?? `${sourceName().replace(/\.\w+$/, '')}${COMP.extension}`;
 setComp({ name, text: typeof kept?.text === 'string' ? kept.text : typeof COMP.example === 'function' ? COMP.example(name) : COMP.example ?? '' });
 store.set('pips.companion.removed', '');
 showComp(true);
 dirty = true; editorStatus(); syncPrimary(); saveSoon();
 consolePanel.message(STRINGS.companion.added(name), 'ok');
}
function removeComp() {
 if (!comp) return;
 const name = comp.name;
 store.set('pips.companion.removed', JSON.stringify(comp));
 setComp(null);
 dirty = true; editorStatus(); syncPrimary(); saveSoon();
 consolePanel.message(STRINGS.companion.removed(name, COMP.add), 'ok');
}
function setLiteErrors(diags) {
 if (!COMP) { editor.setErrors(diags); return; }
 const inComp = diags.filter((d) => comp && d.file === comp.name);
 editor.setErrors(diags.filter((d) => !inComp.includes(d)));
 compEd.setErrors(inComp);
 if (inComp.some((d) => d.severity !== 'warning') && inComp.length === diags.length) showComp(true);
}
const pEditor = el('section.panel.p-editor', { 'aria-label': STRINGS.editor },
 el('h2.ed-head', {}, PROJECTS ? el('span.ed-tabs-box', {}, editor.tabs, dirtyMark) : progTab, COMP ? compTabsBox : null, el('span.panel-title.ed-title', { text: STRINGS.editor }),
 el('span.panel-head-tools', {}, PROJECTS ? null : el('label', {}, el('span.ed-lang-label', { text: `${C.language} ` }), langSel), ccOpts, buildOpts)),
 el('div.col', {}, COMP ? [mainPanel, compPanel] : editor.root),
 el('div.ed-status', { title: STRINGS.storageNote }, edPos, edProfile, edState));
const wideBtn = el('button.ed-wide-btn', { type: 'button', onclick: () => setEditorWide(!workspace.classList.contains('ed-wide')) });
pEditor.querySelector(':scope > h2 .panel-head-tools').append(wideBtn);
function setEditorWide(on, { quiet = false } = {}) {
 if (on && workSplit.isCollapsed('editor')) workSplit.setCollapsed('editor', false);
 workspace?.classList.toggle('ed-wide', on);
 const L = STRINGS.layout, label = on ? L.editorNarrow : L.editorWide;
 wideBtn.replaceChildren(icon(on ? 'restore' : 'fitWidth', { size: 15 }));
 wideBtn.setAttribute('aria-label', label);
 wideBtn.setAttribute('aria-pressed', String(on));
 wideBtn.title = on ? `${label} (Esc)` : label;
 if (!quiet) window.dispatchEvent(new Event('resize'));
}
pEditor.addEventListener('keydown', (e) => { if (e.key === 'Escape' && workspace.classList.contains('ed-wide') && e.target === wideBtn) setEditorWide(false); });
const pExplorer = PROJECTS ? el('section.panel.p-explorer', { 'aria-label': STRINGS.projects.files },
 head(STRINGS.projects.files, 'folder', explorer.menu), explorer.root) : null;
const viewParts = {};
function editorStatus() {
 const a = activeEd().area;
 const before = a.value.slice(0, a.selectionStart);
 const line = before.split('\n').length;
 const col = a.selectionStart - before.lastIndexOf('\n');
 edPos.textContent = TL.status(line, col, a.value.split('\n').length);
 edProfile.textContent = profileOf(session.profile)?.label ?? session.profile;
 edState.textContent = dirty ? TL.modified : TL.saved;
 edState.classList.toggle('ed-modified', dirty);
 dirtyMark.hidden = !dirty;
 fileName.textContent = sourceName();
 if (comp) { const t = compTabs.querySelector('[data-i="0"] .ed-tab-name'); if (t && t.textContent !== sourceName()) t.textContent = sourceName(); }
}
const midSplit = new Split('column', 'mid');
const rightSplit = new Split('column', 'right');
const workSplit = new Split('row', 'work');
const dockSplit = new Split('row', 'dock');
const rootSplit = new Split('column', 'root');
const dockBarText = el('span', { text: STRINGS.layout.dockBar });
const dockBar = el('div.dock-bar', { onclick: () => rootSplit.setCollapsed('dock', false) }, icon('unfold', { size: 14 }), dockBarText);
const dock = el('div.dock', {}, dockBar, dockSplit.root);
const workspace = el('div.workspace', {}, rootSplit.root);
const syncMidControls = [paneControls(pInfo, STRINGS.view.info), paneControls(pFields, STRINGS.layout.panes.inspector)];
midSplit.onApply = () => syncMidControls.forEach((f) => f());
workSplit.onApply = () => { if (workspace.classList.contains('ed-wide') && workSplit.isCollapsed('editor')) setEditorWide(false); };
const P = STRINGS.layout.panes;
const LOW_WINDOW = 650;
function configureLayout() {
 const dp = isDp();
 const cmp = isCmp();
 const pj = projector;
 const k = pj ? `${mode}.proj` : mode;
 const low = !dp && window.innerHeight / pageZoom < LOW_WINDOW && window.innerWidth / pageZoom >= 900;
 const sec = pj || low;
 const vl = dp ? viewOf(mode)?.layout ?? {} : {};
 const drawingSize = vl.drawing ?? (pj ? 0.74 : 0.64);
 const editorSize = vl.editor ?? 0.22;
 workspace.classList.toggle('projector', pj);
 workspace.classList.remove('mid-max');
 setEditorWide(false, { quiet: true });
 pInfo.classList.remove('max-pane'); pFields.classList.remove('max-pane');
 midSplit.configure(dp ? [{ node: pDatapath, id: 'datapath', min: 220, size: drawingSize, title: STRINGS.view.panel },
 { node: pInfo, id: 'info', min: 90, size: 1 - drawingSize, collapsible: true, collapsed: pj, title: P.info }]
 : cmp ? [{ node: pCompare, id: 'compare', min: 120, size: 1 }]
 : [{ node: pListing, id: 'listing', min: 120, size: 0.6, title: STRINGS.listing },
 { node: pFields, id: 'inspector', min: 90, size: 0.4, collapsible: true, collapsed: sec, title: P.inspector }],
 `mid.${k}`);
 rightSplit.configure(dp ? [{ node: pRegs, id: 'registers', min: 140, size: 0.5 },
 { node: pCounters, id: 'counters', min: 70, size: 0.26, collapsible: true, collapsed: pj, title: P.counters },
 { node: pConsole, id: 'console', min: 80, size: 0.24, collapsible: true, collapsed: pj, title: STRINGS.console }]
 : [{ node: pRegs, id: 'registers', min: 140, size: 0.56 },
 { node: pCalls, id: 'calls', min: 64, size: 0.14, collapsible: true, collapsed: sec || !CAP.callStack.enabled, title: P.calls },
 { node: pCounters, id: 'counters', min: 70, size: 0.3, collapsible: true, collapsed: sec, title: P.counters }],
 `right.${k}`);
 const ex = PROJECTS ? 0.14 : 0;
 workSplit.configure([...(PROJECTS ? [{ node: pExplorer, id: 'explorer', min: 185, size: ex, collapsible: true, collapsed: pj, title: STRINGS.projects.files }] : []),
 { node: pEditor, id: 'editor', min: 220, size: dp ? editorSize : 0.3 - ex / 2, collapsible: true, title: P.editor },
 { node: midSplit.root, id: 'mid', min: dp ? 360 : 300, size: dp ? 0.78 - editorSize - ex : 0.44 - ex / 2 },
 { node: rightSplit.root, id: 'right', min: 230, size: dp ? 0.22 : 0.26, foldable: true,
 title: (dp ? [STRINGS.registers, P.counters, STRINGS.console] : [STRINGS.registers, P.calls, P.counters]).join(' · ') }], `work.${k}${PROJECTS ? '.files' : ''}`);
 dockSplit.configure(dp ? [{ node: pMemory, id: 'memory', min: 220, size: 1 }]
 : [{ node: pMemory, id: 'memory', min: 220, size: 0.58, collapsible: true, title: MEM_PANE.panel },
 { node: pConsole, id: 'console', min: 200, size: 0.42, collapsible: true, title: STRINGS.console }], `dock.${k}`);
 dockDp = dp;
 syncDockBar();
 rootSplit.configure([{ node: workSplit.root, id: 'work', min: 200, size: dp ? 0.6 : 0.7 },
 { node: dock, id: 'dock', min: 90, size: dp ? 0.4 : 0.3, collapsible: true, collapsed: sec || dp, title: dp ? MEM_PANE.panel : P.dock, header: dockBar }], `root.${k}`);
 ws?.afterLayout();
}
const PAGE_ZOOMS = Object.freeze([0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]);
let pageZoom = (() => { const z = Number(store.get('pips.pageZoom')); return PAGE_ZOOMS.includes(z) ? z : 1; })();
function applyPageZoom() {
 document.documentElement.style.zoom = pageZoom === 1 ? '' : String(pageZoom);
 window.dispatchEvent(new Event('resize'));
}
function setPageZoom(z) {
 pageZoom = PAGE_ZOOMS.includes(z) ? z : 1;
 store.set('pips.pageZoom', String(pageZoom));
 applyPageZoom();
}
const zoomStep = (dir) => setPageZoom(PAGE_ZOOMS[Math.min(PAGE_ZOOMS.length - 1, Math.max(0, PAGE_ZOOMS.indexOf(pageZoom) + dir))]);
if (pageZoom !== 1) applyPageZoom();
function pageZoomRow() {
 const Z = STRINGS.pageZoom;
 const now = el('button.pz-now', { type: 'button', title: Z.reset });
 const out = el('button.pz-out', { type: 'button', title: Z.out, 'aria-label': Z.out }, icon('zoomOut', { size: 16 }));
 const inn = el('button.pz-in', { type: 'button', title: Z.in, 'aria-label': Z.in }, icon('zoomIn', { size: 16 }));
 const sync = () => {
 now.textContent = `${Math.round(pageZoom * 100)} %`;
 now.setAttribute('aria-label', `${Math.round(pageZoom * 100)} %: ${Z.reset}`);
 out.disabled = pageZoom === PAGE_ZOOMS[0];
 inn.disabled = pageZoom === PAGE_ZOOMS[PAGE_ZOOMS.length - 1];
 };
 const act = (f) => (e) => { e.stopPropagation(); f(); sync(); };
 out.onclick = act(() => zoomStep(-1)); inn.onclick = act(() => zoomStep(1)); now.onclick = act(() => setPageZoom(1));
 sync();
 return [el('p.menu-head', { text: Z.group, 'aria-hidden': 'true' }), el('div.pz-row', { role: 'group', 'aria-label': Z.group }, out, now, inn)];
}
function syncDockBar() {
 try { dockBarText.textContent = dockDp ? STRINGS.layout.dockBarOne(memTabName) : STRINGS.layout.dockBarWith(memTabName); } catch { }
}
function fillViewMenu(list) {
 const dp = isDp();
 const panes = [...(PROJECTS ? [[workSplit, 'explorer', STRINGS.projects.files]] : []), [workSplit, 'editor', P.editor],
 ...(dp ? [[midSplit, 'info', P.info], [rightSplit, 'counters', P.counters], [rightSplit, 'console', STRINGS.console], [rootSplit, 'dock', MEM_PANE.panel]]
 : [...(isCmp() ? [] : [[midSplit, 'inspector', P.inspector]]), [rightSplit, 'calls', P.calls], [rightSplit, 'counters', P.counters], [rootSplit, 'dock', P.dock]])];
 panes.splice(panes.findIndex(([s]) => s === rightSplit), 0, [workSplit, 'right', P.right]);
 const now = viewModes.state.mode;
 const modeIcon = { normal: 'normalView', focus: 'focusView', fullscreen: 'fullscreen' };
 const modeItems = MODES.map((m) => {
 const off = m === 'fullscreen' && !viewModes.supported;
 const name = m === 'focus' && !dp ? VM.focusPlain : VM[m];
 return el('label.menu-check.vm-opt', { title: off ? VM.unavailable : m === 'focus' ? `${name} (${VM.focusKey})` : null },
 el('input', { type: 'radio', name: 'view-mode', value: m, checked: m === now, disabled: off, 'data-mode': m,
 onchange: () => {
 viewMenu.open = false;
 viewModes.set(m).then(() => viewMenu.querySelector('summary').focus({ preventScroll: true }));
 } }), icon(modeIcon[m], { size: 16 }), el('span', { text: name }));
 });
 list.replaceChildren(
 el('p.menu-head', { text: VM.group, 'aria-hidden': 'true' }),
 el('div.vm-group', { role: 'radiogroup', 'aria-label': VM.group }, modeItems),
 el('hr.menu-sep'),
 ...pageZoomRow(),
 el('hr.menu-sep'),
 el('label.menu-check', { title: STRINGS.projectorTitle }, el('input', { type: 'checkbox', checked: projector,
 onchange: (e) => setProjector(e.target.checked) }), ` ${STRINGS.projector}`),
 themeRow(),
 el('hr.menu-sep'),
 btn(STRINGS.layout.reset, () => { Split.resetAll(); consolePanel.message(STRINGS.layout.resetDone, 'ok'); }),
 el('p.menu-head', { text: STRINGS.layout.show }),
 ...panes.map(([s, id, label]) => el('label.menu-check', {}, el('input', { type: 'checkbox', checked: !s.isCollapsed(id),
 onchange: (e) => s.setCollapsed(id, !e.target.checked) }), ` ${label}`)),
 el('p.note.menu-note', { text: STRINGS.layout.note }));
}
const zoomBtn = el('button.zoom-btn', { type: 'button', text: STRINGS.zoomOn, title: STRINGS.zoomTitle, 'aria-pressed': 'false',
 onclick: () => setZoom(!workspace.classList.contains('zoomed')) });
function setZoom(on) {
 workspace.classList.toggle('zoomed', on);
 zoomBtn.textContent = on ? STRINGS.zoomOff : STRINGS.zoomOn;
 zoomBtn.setAttribute('aria-pressed', String(on));
}
function openTarget(t) {
 if (!t) return;
 if (t.panel === 'registers') { flashPanel(pRegs); return; }
 if (t.panel === 'memory') { setZoom(false); showMemoryPanel(0); return; }
 setZoom(false);
 ws.reveal('datapath');
 if (midSplit.isCollapsed('info')) midSplit.setCollapsed('info', false);
 if (viewParts[mode]?.tabs.selectTitle(t.tab)) flashPanel(pInfo);
}
function flashPanel(p) {
 ws.revealPane(p.dataset.pane);
 p.classList.remove('flash');
 void p.offsetWidth;
 p.classList.add('flash');
 setTimeout(() => p.classList.remove('flash'), 1300);
}
let drawingStale = false;
let listingForced = false;
const seen = { listing: null, line: null };
const ws = new MobileWorkspaces({
 workspace, strings: STRINGS.ws, context: () => ({ dp: isDp() }),
 relayout: () => { setDockMax(false); setZoom(false); configureLayout(); },
 sheet: { id: 'console', node: pConsole, label: STRINGS.console, icon: 'terminal' },
 onShow: (id) => {
 const parts = viewParts[mode];
 if (isDp() && parts) {
 if (id === 'listing') { parts.tabs.selectTitle(STRINGS.listing); listingForced = true; } else if (id === 'datapath' && listingForced) { parts.tabs.select(0); listingForced = false; }
 }
 if (drawingStale) redrawDrawing();
 if (id === 'listing' && listing.pc !== seen.listing) listing.markPc(listing.pc);
 if (id === 'code' && editor.current && editor.current !== seen.line) editor.scrollToLine(editor.current, true);
 seen.listing = listing.pc;
 seen.line = editor.current;
 },
});
consolePanel.onNote = (kind) => ws.note(kind);
for (const li of consolePanel.msgs.children) ws.note(li.className === 'msg-error' ? 'error' : li.className === 'msg-warn' ? 'warn' : null);
function redrawDrawing() {
 const v = uv();
 drawingStale = false;
 if (!v) return;
 v.render();
 refreshWave();
}
const drawingHidden = () => ws.mobile && pDatapath.classList.contains('ws-off') && pInfo.classList.contains('ws-off');
const syncDensity = () => memory.setRowBytes(ws.mobile ? 8 : 16);
ws.mq.addEventListener('change', () => { syncDensity(); syncPanAuto(); });
function currentPc() {
 const v = uv();
 const st = v ? v.state() : engine?.state() ?? null;
 return st ? hexA(v ? st.instruction ?? st.pc : st.pc) : null;
}
function updateWsStatus() {
 const W = STRINGS.ws;
 const v = uv();
 const st = v ? v.state() : engine?.state() ?? null;
 if (!session.program || !st) { ws.setStatus(W.status(null, W.state.none)); return; }
 const pc = currentPc();
 const fresh = !(st.retired > 0) && !(st.cycle > 0);
 const stopped = lastStop && lastStop.pc === pc ? lastStop.stop : null;
 const state = running ? W.state.running : st.error ? W.state.error : st.halted ? W.state.halted
 : stopped === STOP.BREAK ? W.state.breakpoint : stopped === STOP.WATCH ? W.state.watch : fresh ? W.state.ready : W.state.paused;
 ws.setStatus(W.status(pc, state));
}
const app = document.getElementById('app');
app.replaceChildren(toolbar, ws.nav, workspace, ws.sheet);
tbDock = new ToolbarDock({ main: app, toolbar, fit: toolbarFit, narrow: ws.mq,
 flyouts: [{ menu: speedFly, body: speedFly.querySelector('.menu-list'), nodes: [speedField] },
 { menu: archFly, body: archFly.querySelector('.menu-list'), nodes: [archCtx] }],
 onChange: (place, chosen) => {
 const shown = ws.mobile ? chosen : place;
 dockRadios.forEach((r) => { r.checked = r.value === shown; });
 dockMenu.querySelector('summary > .icon').replaceWith(icon(DOCK_ICON[shown]));
 dockMenu.hidden = ws.mobile;
 refit();
 } });
tbDock.apply(true);
let preFocus = null;
function applyViewMode(s) {
 const was = workspace.classList.contains('focus');
 const c = s.compact;
 const focusLost = () => { const a = document.activeElement; return !a || a === document.body || !a.checkVisibility?.(); };
 if (c && !was) {
 const maxed = workspace.classList.contains('mid-max') ? [pInfo, pFields].find((n) => n.classList.contains('max-pane')) ?? null : null;
 preFocus = { zoomed: workspace.classList.contains('zoomed'), dockMax: workspace.classList.contains('dock-max'), midMax: maxed, wsTab: ws.mobile ? ws.active : null };
 setZoom(false);
 setDockMax(false);
 if (maxed) setMidMax(maxed, false);
 if (ws.mobile) ws.reveal('datapath', false);
 }
 header.classList.toggle('hb-focus', c);
 workspace.classList.toggle('focus', c);
 document.documentElement.dataset.viewMode = s.mode;
 focusCrumb.hidden = !c;
 exitBtn.hidden = !c;
 syncCrumb(s);
 headerFit.pause(c);
 tbDock.setCompact(c);
 if (!c && was && preFocus) {
 if (preFocus.zoomed && isDp()) setZoom(true);
 if (preFocus.dockMax) setDockMax(true);
 if (preFocus.midMax && preFocus.midMax._split === midSplit) setMidMax(preFocus.midMax, true);
 if (ws.mobile && preFocus.wsTab && ws.active === 'datapath') ws.reveal(preFocus.wsTab, false);
 preFocus = null;
 }
 const menuList = viewMenu.querySelector('.menu-list');
 if (viewMenu.open) fillViewMenu(menuList);
 refit();
 if (focusLost() && c !== was) (c ? exitBtn : viewMenu.querySelector('summary')).focus({ preventScroll: true });
}
viewModes.notify(true);
refit();
configureLayout();
setDockMax(false);
syncDensity();
const panShared = { pan: false };
let panAuto = false;
function syncPanAuto() {
 const any = panShared.all ? [...panShared.all][0] : null;
 if (!any) return;
 if (ws.mobile && matchMedia('(pointer: coarse)').matches && !panShared.pan) { any.setPan(true); panAuto = true; }
 else if (!ws.mobile && panAuto) { any.setPan(false); panAuto = false; }
}
const viewContext = () => ({
 strings: STRINGS, memsys: null,
 message: (text, kind) => consolePanel.message(text, kind),
 openPanel: (t) => openTarget(t), refresh: () => refresh(), goToCycle: (k) => goToCycle(k),
 command: (name) => (name === 'stepUnit' ? stepUnit() : name === 'backUnit' ? backUnit() : name.startsWith('view:') ? setMode(name.slice(5)) : undefined),
 memConfig: () => memCfg,
 download: (name, data, type) => download(name, data, type),
});
async function loadView(id) {
 if (inst[id]) return true;
 let v;
 try {
 const mod = await viewOf(id).load();
 v = mod.create(viewContext());
 if (isCmp(id)) {
 inst[id] = v;
 pCompare.replaceChildren(el('h2', { text: v.title }), v.root);
 return true;
 }
 const wave = !v.waveform || !v.exportModel ? [] : CAP.waveform.enabled ? [await waveTab(id, v)] : [[STRINGS.wave.title, el('div'), null, CAP.waveform]];
 viewParts[id] = {
 header: el('h2.with-status', {}, el('span', { text: v.title }), v.status ?? null, v.headerTools ?? null), info: v.infoTitle,
 tabs: tabs([...v.tabs, ...wave, [STRINGS.listing, listing.root], [v.memoryTab ?? STRINGS.memory, memLink()]]),
 };
 for (const svg of v.diagrams ?? []) new PanZoom(svg, { name: svg.querySelector(':scope > title')?.textContent || v.title, shared: panShared });
 syncPanAuto();
 inst[id] = v;
 } catch (e) {
 consolePanel.message(STRINGS.loadFailed(e.message), 'error');
 return false;
 }
 const ms = makeMemsys();
 memsysOf[id] = ms;
 if (ms) v.setMemsys?.(ms);
 return true;
}
const waves = {};
const waveRec = {};
async function waveTab(id, v) {
 const { WaveformPanel } = await import('./ui/waveform.js');
 waves[id] = new WaveformPanel({ id, signals: v.exportModel().signals, defaults: v.waveform.defaults, format: v.waveform.format ?? null, base: v.waveform.base ?? 0, onGoTo: (k) => goToCycle(k) });
 return [STRINGS.wave.title, waves[id].root, () => refreshWave(true)];
}
let waveShownAt = 0;
function refreshWave(force = false) {
 const v = uv();
 const w = waves[mode];
 if (!v || !w || !w.root.isConnected) return;
 if (running && !force && performance.now() - waveShownAt < 500) return;
 waveShownAt = performance.now();
 const s = v.state();
 if (!s) { w.update([], 0); return; }
 const opt = v.revision?.() ?? '';
 const pc = session.platformConfig;
 const script = memCfg.devices ? `${pc.stimulus.length}|${pc.rx.length}` : '';
 let rec = waveRec[mode];
 if (!rec || rec.program !== session.program || rec.memsys !== memsysOf[mode] || rec.opt !== opt || rec.script !== script) {
 const x = v.exportModel();
 rec = waveRec[mode] = { program: session.program, memsys: memsysOf[mode], opt, script, model: x.model, frames: [], done: false, max: 0 };
 w.setSignals(x.signals);
 }
 const cur = s.cycle;
 rec.max = Math.min(Math.max(rec.max, cur), VCD_CAP);
 while (!rec.done && rec.frames.length <= rec.max) {
 if (rec.frames.length && rec.model.step() !== 'step') { rec.done = true; break; }
 rec.frames.push({ ...rec.model.evaluate().signals });
 }
 w.update(rec.frames.slice(0, rec.max + 1), Math.min(cur, rec.frames.length - 1));
}
function goToCycle(k) {
 const v = uv();
 if (!v || running || k < 0) return;
 const cycle = () => v.state()?.cycle ?? 0;
 while (cycle() > k && v.back());
 while (cycle() < k && v.step() === STOP.NONE);
 refresh();
}
async function setMode(next) {
 if (next === mode || !viewOf(next)) return;
 cancelRun();
 const isa = VIEWS[0].id;
 if (next !== isa && !(await loadView(next))) return;
 const wasIsa = mode === isa;
 mode = next;
 viewButtons.forEach((b, i) => b.setAttribute('aria-selected', String(VIEWS[i].id === mode)));
 const sc = isDp();
 const cmp = isCmp();
 for (const b of toolbar.querySelectorAll('.dp-only')) b.hidden = !sc;
 if (sc) {
 const parts = viewParts[mode];
 parts.header.append(zoomBtn);
 pDatapath.replaceChildren(parts.header, uv().root);
 pInfo.replaceChildren(head(parts.info, 'inspect'), parts.tabs.root);
 } else setZoom(false);
 workspace.classList.toggle('dp-mode', sc);
 configureLayout();
 subsetSel.hidden = !viewOf(mode).subsets;
 profileSel.disabled = sc || cmp;
 profileField.hidden = sc || cmp;
 archCtx.hidden = profileField.hidden && subsetSel.hidden;
 tbDock?.sync();
 syncCrumb();
 refit();
 listing.names = viewOf(mode).names ?? arch.language.disassembly?.names?.[0];
 if (sc || cmp) {
 if (sc) viewParts[mode].tabs.select(0);
 if (wasIsa) isaProfile = session.profile;
 session.profile = viewOf(mode).profile;
 session.subset = viewOf(mode).subsets && !noSubset(subsetSel.value) ? subsetSel.value : null;
 memory.base = 0;
 } else {
 session.profile = isaProfile;
 session.subset = null;
 listingTabs.select(0);
 }
 profileSel.value = session.profile;
 syncLangControls();
 store.set('pips.view', mode);
 if (session.imported) reimport(); else doAssemble();
}
function reimport() {
 const { content, kind, name, built } = session.imported;
 if (built) {
 try { loadBuiltImage(content); } catch { session.imported = null; doAssemble(); }
 return;
 }
 try {
 session.program = arch.language.loadImage(content, kind, name, { profile: session.profile });
 } catch (e) {
 session.imported = null;
 consolePanel.message(`${name}: ${e.message}`, 'error');
 doAssemble();
 return;
 }
 cancelRun();
 resetEngine();
 if (uv() || isCmp()) inst[mode].load(session.program);
 refresh(true);
}
let cName = `main${XL?.extension ?? ''}`;
const sourceName = () => (PROJECTS ? editor.active ?? project()?.entry ?? `main${arch.language.extension}`
 : lang === XID ? cName : session.files[0].name.replace(/\.\w+$/, '') + arch.language.extension);
const COMPX = arch.language.companion?.extension?.toLowerCase() ?? null;
const plan = () => buildPlan(project(), { cExtension: XL?.extension ?? '\0' });
function syncLangControls() {
 langSel.value = lang;
 ccOpts.hidden = lang !== XID;
 for (const x of xlOpts) x.label.hidden = Boolean(x.o.profiles) && !x.o.profiles.includes(session.profile);
 syncBuildLabel();
 refit();
 editor.setLanguage(lang);
 editorStatus();
}
function syncBuildLabel() {
 let c = lang === XID, image = false;
 if (PROJECTS) { try { c = plan().lang === 'c'; image = Boolean(cCompiler()?.image) && usesImageLanguage(); } catch { } }
 setToolLabel(assembleBtn, 'build', c || image ? TL.buildC : TL.build, 'Control+Enter');
 if (image) { const tip = `${TL.buildProject} (${keyText('Control+Enter')})`; assembleBtn.title = tip; assembleBtn.setAttribute('aria-label', tip); }
}
async function setLang(next, { user = false } = {}) {
 if (next === lang) return;
 if (next === XID && !(await loadExtra())) { langSel.value = lang; return; }
 store.set(sourceKey(), editor.value);
 const from = langLabel(lang);
 lang = next;
 store.set('pips.lang', lang);
 const kept = store.get(sourceKey());
 editor.value = kept ?? (lang === XID ? XL.example : EXAMPLE);
 if (lang !== XID) { cMap = null; renderAsm(null); editor.setLinked([]); }
 syncLangControls();
 doAssemble();
 if (user) consolePanel.message(STRINGS.langKept(from, langLabel(lang), kept === null || kept === undefined));
}
const langLabel = (id) => (id === XID ? XL.label : C.languages.asm);
async function loadExtra() {
 if (cc) return true;
 try {
 cc = await XL.load();
 return true;
 } catch (e) {
 consolePanel.message(STRINGS.loadFailed(e.message), 'error');
 return false;
 }
}
function compileExtra() {
 const src = PROJECTS ? plan().file : { name: cName, text: editor.value };
 const companions = PROJECTS ? project().files.filter((f) => COMPX && f.name.toLowerCase().endsWith(COMPX)) : compFiles();
 const r = cc.compile(src.text, { name: src.name, profile: session.profile, subset: session.subset, options: { ...buildValues(), ...xlValues() }, companions });
 if (!r.ok) {
 cMap = null;
 renderAsm(null);
 if (PROJECTS) editor.setErrorsByFile(r.diagnostics.map((e) => ({ ...e, file: e.file ?? src.name })), src.name);
 else setLiteErrors(r.diagnostics);
 for (const e of r.diagnostics) consolePanel.message(e.message, 'error', { file: e.file ?? src.name, line: e.line, column: e.column }, e.note ?? null);
 consolePanel.message(C.errors, 'error');
 return false;
 }
 cMap = r.lines;
 session.cSource = { file: src.name, text: src.text, lines: r.lines };
 session.files = [{ name: stem(src.name) + arch.language.extension, text: r.text }];
 renderAsm(r.text);
 return true;
}
function assembleSession() {
 const source = lang === XID && cMap && session.cSource ? { source: session.cSource } : {};
 const p = arch.language.assemble(session.files, { profile: session.profile, subset: session.subset ?? undefined, data: session.dataLoads, options: buildValues(), ...source });
 session.program = p;
 session.loadReport = p.loadReport ?? { applied: [], dropped: [] };
 resetEngine();
 return p;
}
function doAssemble({ user = false } = {}) {
 syncBuildLabel();
 if (PROJECTS && cCompiler()?.image && usesImageLanguage()) { buildOpts.hidden = true; imageBuildRun(cCompiler(), user); return; }
 buildOpts.hidden = shownOpts.length === 0;
 cancelRun();
 session.imported = null;
 if (PROJECTS) {
 const pl = plan();
 const next = pl.lang === 'c' ? XID : 'asm';
 if (next === XID && !cc) { loadExtra().then((ok) => { if (ok) doAssemble(); }); return; }
 if (next !== lang) { lang = next; if (lang !== XID) { cMap = null; renderAsm(null); editor.setLinked([]); } syncLangControls(); }
 if (lang === XID) { doCompile(); return; }
 session.files = pl.files.length ? pl.files : [{ name: project().entry, text: '' }];
 if (COMPX) session.files = [...session.files, ...project().files.filter((f) => f.name.toLowerCase().endsWith(COMPX))];
 } else {
 if (lang === XID) { doCompile(); return; }
 session.files = [{ name: session.files[0].name, text: editor.value }, ...compFiles()];
 }
 const p = assembleSession();
 dirty = false;
 consolePanel.clearMessages();
 if (PROJECTS) editor.setErrorsByFile(p.diagnostics, project().entry);
 else setLiteErrors(p.diagnostics);
 for (const d of p.diagnostics) consolePanel.message(d.message, d.severity === 'warning' ? 'warn' : 'error', d, d.note ?? null);
 if (p.assembled ?? p.ok) {
 const n = p.listing.length;
 const d = p.segments.filter((s) => !s.executable).reduce((k, s) => k + s.bytes.length, 0);
 consolePanel.message(STRINGS.assembled(n, d), p.ok ? 'ok' : 'warn');
 } else {
 consolePanel.message(STRINGS.asmErrors(errorCount(p)), 'error');
 }
 afterAssemble(p);
}
function doCompile() {
 dirty = false;
 consolePanel.clearMessages();
 let p;
 if (cc && compileExtra()) {
 p = assembleSession();
 const at = (e) => edLine(e.line) ?? 1;
 const inFile = { file: PROJECTS ? project().entry : cName };
 const errs = p.diagnostics.map((e) => ({ line: at(e), column: 1, message: C.asmError(e.line, e.message), ...inFile }));
 if (PROJECTS) editor.setErrorsByFile(errs, project().entry); else setLiteErrors(errs);
 for (const e of p.diagnostics) consolePanel.message(C.asmError(e.line, e.message), 'error', { line: at(e), ...inFile }, XL.asmNote?.(e) ?? null);
 if (p.ok) consolePanel.message(C.compiled(cMap.length, p.listing.length), 'ok');
 } else {
 session.files = [{ name: stem(PROJECTS ? project().entry : cName) + arch.language.extension, text: '' }];
 p = assembleSession();
 p.ok = false;
 resetEngine();
 }
 afterAssemble(p);
}
const imageBuild = { busy: false, langs: new Map(), dialog: null };
const usesImageLanguage = () => project().files.some((f) => f.name.toLowerCase().endsWith(XL.extension));
async function imageLanguage(x) {
 if (!imageBuild.langs.has(x.id)) imageBuild.langs.set(x.id, await x.load());
 return imageBuild.langs.get(x.id);
}
async function imageDownload(x, b, user) {
 const D = STRINGS.download;
 const dl = b.download;
 if (!dl || dl.ready()) return true;
 const info = await dl.probe();
 if (info.toDownload > 0) {
 if (!user) { consolePanel.message(D.declined(x.label), 'warn'); return false; }
 imageBuild.dialog ??= new DownloadDialog();
 if (!(await imageBuild.dialog.ask(x.label, info))) { consolePanel.message(D.declined(x.label), 'warn'); return false; }
 dl.persist?.();
 }
 const t0 = performance.now();
 for (;;) {
 const update = info.toDownload > 0 ? imageBuild.dialog.progress(x.label, info.files) : () => {};
 const done = new Set();
 try {
 await dl.fetch((e) => { update(e); if (e.done) done.add(e.file); if (done.size === info.files.length) imageBuild.dialog?.preparing(); });
 imageBuild.dialog?.close();
 consolePanel.message(D.ready(x.label, ((performance.now() - t0) / 1000).toFixed(1)), 'ok');
 return true;
 } catch (e) {
 if (info.toDownload === 0) { consolePanel.message(D.failed(e.message), 'error'); return false; }
 if (!(await imageBuild.dialog.failed(e.message))) return false;
 }
 }
}
async function imageBuildRun(x, user) {
 if (imageBuild.busy) { if (user) imageBuild.again = true; return; }
 imageBuild.busy = true;
 const D = STRINGS.download;
 try {
 cancelRun();
 if (lang === XID) { lang = 'asm'; cMap = null; renderAsm(null); editor.setLinked([]); syncLangControls(); }
 let b;
 try { b = await imageLanguage(x); } catch (e) { consolePanel.message(STRINGS.loadFailed(e.message), 'error'); return; }
 let ok = false;
 try { ok = await imageDownload(x, b, user); } catch (e) {
 if (/\b404\b/.test(e.message)) consolePanel.message(D.missing(x.label), 'error', null, e.message);
 else consolePanel.message(D.failed(e.message), 'error');
 }
 if (!ok) { if (!session.program) imageBuildFailed(); return; }
 const t0 = performance.now();
 consolePanel.clearMessages();
 consolePanel.message(D.building(x.label));
 const r = await b.build(project().files);
 consolePanel.clearMessages();
 editor.setErrorsByFile(r.diagnostics.filter((d) => d.file), project().entry);
 for (const d of r.diagnostics) consolePanel.message(d.message, d.severity === 'warning' ? 'warn' : 'error', d.file ? { file: d.file, line: d.line, column: d.column } : null);
 if (!r.ok || !r.image) {
 consolePanel.message(r.diagnostics.length && !r.diagnostics.some((d) => d.file) && r.log?.some((j) => j.step === 'link') ? D.linkFailed
 : D.buildFailed(r.diagnostics.filter((d) => d.severity === 'error').length), 'error');
 imageBuildFailed();
 return;
 }
 try { loadBuiltImage(r.image.bytes); } catch (e) { consolePanel.message(`${e.message}`, 'error'); imageBuildFailed(); return; }
 const image = session.program.segments.reduce((n, s) => n + s.bytes.length, 0);
 consolePanel.message(D.built(x.label, (image / 1024).toFixed(1), Math.round(performance.now() - t0)), 'ok');
 flushNotes();
 } finally {
 imageBuild.busy = false;
 if (imageBuild.again) { imageBuild.again = false; imageBuildRun(cCompiler(), true); }
 }
}
async function saveBuilt(f) {
 const im = session.imported;
 if (!im?.built) { consolePanel.message(STRINGS.download.buildFirst(cCompiler()?.label ?? ''), 'warn'); return; }
 try {
 const bytes = await f.convert(im.content);
 const base = (project()?.name ?? 'program').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'program';
 download(`${base}${f.extension}`, bytes, 'application/octet-stream');
 consolePanel.message(STRINGS.download.savedBuilt(`${base}${f.extension}`, bytes.length), 'ok');
 } catch (e) { consolePanel.message(e.message, 'error'); }
}
function imageBuildFailed() {
 session.imported = null;
 session.files = [{ name: `main${arch.language.extension}`, text: '' }];
 const p = assembleSession();
 p.ok = false;
 resetEngine();
 afterAssemble(p);
 dirty = false;
}
function loadBuiltImage(bytes) {
 const p = arch.language.loadImage(bytes, 'elf', 'program.elf', { profile: session.profile });
 const lt = p.debug?.lineTable;
 const names = new Set(project().files.map((f) => f.name));
 if (lt) {
 let prev = null, k = 0;
 for (const row of p.listing) {
 const at = lt.lineAt(row.address);
 const name = at?.file?.startsWith('/project/') ? at.file.slice('/project/'.length) : null;
 if (name && names.has(name)) {
 const key = `${name}:${at.line}`;
 k = key === prev ? k + 1 : 0;
 prev = key;
 row.file = name; row.line = at.line; row.part = k;
 } else prev = null;
 }
 }
 p.imported = false;
 p.built = true;
 if (p.debug) p.debug.sources = new Map(project().files.map((f) => [`/project/${f.name}`, f.text]));
 session.program = p;
 session.loadReport = { applied: [], dropped: [] };
 session.imported = { content: bytes, kind: 'elf', name: 'program.elf', built: true };
 resetEngine();
 if (uv() || isCmp()) inst[mode].load(p);
 editorStatus();
 refresh(true);
 dirty = false;
}
function afterAssemble(p) {
 const lr = session.loadReport;
 if (lr.applied.length) consolePanel.message(STRINGS.dataIo.assembledLoads(lr.applied.map((a) => `${a.label} (${a.n} bytes)`).join(', ')));
 for (const d of lr.dropped) consolePanel.message(STRINGS.dataIo.droppedLoad(d.label, d.why), 'warn');
 consolePanel.msgs.scrollTop = 0;
 if (p.segments[1]) memory.base = p.segments[1].address;
 if (uv() || isCmp()) inst[mode].load(session.runnable ? p : null);
 refresh(true);
 flushNotes();
}
const TRACE_CAP = 1_000_000;
const VCD_CAP = 20_000;
function exportTrace(kind) {
 if (!ensureRunnable()) { consolePanel.message(STRINGS.exportNothing, 'error'); return; }
 const X = arch.exports;
 const { records, error } = X.trace(session.program, { profile: session.profile, platformConfig: session.platformConfig, cap: TRACE_CAP,
 inputs: engine?.inputs?.() ?? [] });
 if (kind === 'csv') download('trace.csv', X.traceCsv(records), 'text/csv');
 else download('trace.jsonl', X.traceJsonLines(records), 'application/x-ndjson');
 consolePanel.message(records.length === TRACE_CAP && !error ? STRINGS.exportedTraceCut(TRACE_CAP) : STRINGS.exportedTrace(records.length, error), 'ok');
}
function exportGolden() {
 if (!uv() || !ensureRunnable()) { consolePanel.message(STRINGS.exportNothing, 'error'); return; }
 const { model, label } = uv().exportModel();
 let stop;
 try { stop = model.run(RUN_LIMIT); } catch (e) { consolePanel.message(STRINGS.exportNoHalt(e.message), 'error'); return; }
 if (stop !== 'halt') { consolePanel.message(STRINGS.exportNoHalt(model.error ?? stop), 'error'); return; }
 const { text, count } = arch.exports.golden(model);
 download('golden.hex', text);
 consolePanel.message(STRINGS.exportedGolden(label, count), 'ok');
}
function exportVcd() {
 if (!uv() || !ensureRunnable()) { consolePanel.message(STRINGS.exportNothing, 'error'); return; }
 const { model, signals, module, label } = uv().exportModel();
 const { frames, stop } = recordFrames(model, VCD_CAP);
 const name = session.files[0].name.replace(/\.\w+$/, '');
 const npu = signals.some((s) => s.kind === 'npu') ? '; scope npu: the simulator\'s NPU model (FIG-0114 names), not an RTL net' : '';
 download(`${name}-${viewOf(mode).profile}.vcd`, vcd(frames, signals, { module, comment: `${name}, ${label}; one cycle = 10 ns of the time axis${npu}` }));
 consolePanel.message(STRINGS.exportedVcd(label, frames.length), 'ok');
 if (stop === 'step') consolePanel.message(STRINGS.exportedVcdCut(VCD_CAP + 1), 'warn');
 else if (stop === 'error') consolePanel.message(STRINGS.exportNoHalt(model.error), 'warn');
}
function ensureRunnable() {
 if (PROJECTS && cCompiler()?.image && (dirty || !session.program || imageBuild.busy) && usesImageLanguage()) {
 if (!imageBuild.busy) doAssemble({ user: true });
 return false;
 }
 if (dirty || !session.program) doAssemble();
 if (!session.runnable) { consolePanel.message(STRINGS.notRunnable, 'error'); return false; }
 return true;
}
function report(stop) {
 const s = engine.state();
 switch (stop) {
 case STOP.HALT: consolePanel.message(STRINGS.halted(hexA(s.pc), s.exitCode), 'ok'); break;
 case STOP.ERROR: consolePanel.message(STRINGS.simError(s.error), 'error', srcLoc(s.pc), STRINGS.simHint(s.error)); break;
 case STOP.BREAK: consolePanel.message(STRINGS.stoppedBreak(hexA(s.pc))); break;
 case STOP.WATCH: {
 const last = engine.last();
 const r = last?.registers.find((w) => session.watchRegs.has(w.id));
 if (r) {
 consolePanel.message(STRINGS.stoppedWatchReg(regs.label(r.id), hexAddr(s.registers[r.id], REG_WIDTH[r.id]), hexA(last.pc)));
 } else if (last?.memory.length) {
 const a = memory.wordOf(last.memory[0].address);
 consolePanel.message(STRINGS.stoppedWatchWord(hexA(a), hexAddr(enginePort.read(a, arch.addressSpace.wordBytes), 8 * arch.addressSpace.wordBytes), hexA(last.pc)));
 }
 break;
 }
 case STOP.BUDGET: {
 const r = engine.loopRange?.() ?? { from: s.pc, to: s.pc };
 consolePanel.message(STRINGS.stoppedBudget(RUN_LIMIT, hexA(r.from), hexA(r.to)), 'warn');
 break;
 }
 default: break;
 }
 if (s.historyDropped && !report.droppedShown) {
 report.droppedShown = true;
 consolePanel.message(STRINGS.historyDropped(s.historyDropped), 'warn');
 }
 diag.show();
}
function errorCount(p) { return p.diagnostics.filter((x) => x.severity === 'error' && x.kind !== 'profile').length; }
function reportSingle(stop) {
 const v = uv();
 const s = v.state() ?? { pc: 0, cycle: 0 };
 const at = s.instruction ?? s.pc;
 if (stop === STOP.HALT) consolePanel.message(v.stopMessage?.(stop) ?? STRINGS.view.halted(hexA(s.pc), s.cycle), 'ok');
 else if (stop === STOP.ERROR) consolePanel.message(STRINGS.simError(s.error), 'error', srcLoc(at));
 else if (stop === STOP.BREAK) consolePanel.message(STRINGS.stoppedBreak(hexA(s.pc)));
 else if (stop === STOP.PAUSE) consolePanel.message(STRINGS.paused(hexA(s.pc)));
 else if (stop === 'event') consolePanel.message(reportSingle.event);
 if (s.dropped && !reportSingle.dropped) {
 reportSingle.dropped = true;
 consolePanel.message(STRINGS.view.historyNote(s.dropped), 'warn');
 }
}
function stepOnce() {
 if (running || !ensureRunnable()) return;
 if (uv()) {
 const r = uv().step();
 if (r !== STOP.NONE) reportSingle(r);
 } else {
 report(stepEngine());
 }
 refresh();
}
let lineStepMod = null;
let lineStepper = null;
const lineStepOffered = () => Boolean(arch.language.lineStep && !uv() && !isCmp() && session.runnable && session.program?.debug?.lineTable);
function syncLineButtons() {
 const on = lineStepOffered();
 if (lineStepBtn.hidden === !on) return;
 lineStepBtn.hidden = lineBackBtn.hidden = !on;
 refit();
}
async function lineStep(kind) {
 if (running || !ensureRunnable() || !lineStepOffered()) return;
 try { lineStepMod ??= await arch.language.lineStep.load(); } catch (e) { consolePanel.message(STRINGS.loadFailed(e.message), 'error'); return; }
 if (lineStepper?.engine !== engine || lineStepper.program !== session.program) {
 lineStepper = { engine, program: session.program, s: lineStepMod.create(session.program, engine) };
 }
 const r = lineStepper.s[kind]();
 if (kind === 'backLine') { if (!r) consolePanel.message(STRINGS.nothingToUndo); }
 else if (r === 'limit') consolePanel.message(STRINGS.lineStep.limit(lineStepper.s.message()), 'warn');
 else if (r !== STOP.NONE) report(r);
 refresh();
}
function stepUnit() {
 if (running || !ensureRunnable() || !uv()?.unit) return;
 const r = uv().unit.step();
 if (r !== STOP.NONE) reportSingle(r);
 refresh();
}
function backUnit() {
 if (running) { pause(); return; }
 if (!uv()?.unit) return;
 if (!uv().unit.back()) consolePanel.message(STRINGS.nothingToUndo);
 refresh();
}
function stepBack() {
 if (!can('backStep')) return;
 if (running) { pause(); return; }
 if (uv()) {
 if (!uv().back()) consolePanel.message(STRINGS.nothingToUndo);
 refresh();
 return;
 }
 if (!engine || !engine.back()) { consolePanel.message(STRINGS.nothingToUndo); return; }
 diag.skip();
 refresh();
}
function stepOver() {
 if (!can('stepOver')) return;
 if (running || !ensureRunnable()) return;
 if (uv()?.unit) { stepUnit(); return; }
 const t = uv() ? null : engine.stepOverTarget?.() ?? null;
 if (t === null) stepOnce(); else startRun({ target: t, depth: engine.callDepth() });
}
function stepOut() {
 if (!can('stepOver')) return;
 if (running || !ensureRunnable()) return;
 if (uv()) { stepOnce(); return; }
 const t = engine.stepOutTarget?.() ?? null;
 if (t === null) stepOnce(); else startRun({ target: t, depth: engine.callDepth() - 1 });
}
function runToCursor() {
 if (!can('runToCursor')) return;
 if (running || !ensureRunnable()) return;
 const line = editor.cursorLine();
 const here = PROJECTS ? editor.active : null;
 const l = session.program.listing.find((x) => (lang === XID ? atLoc(x, line, here) : x.line === line && x.part === 0 && (!PROJECTS || x.file === here)));
 if (!l) { consolePanel.message(STRINGS.noLine); return; }
 startRun({ target: l.address, depth: null });
}
let worker;
let workerRun = false;
let workerInputs = [];
let runId = 0;
let runOpts = null;
function getWorker() {
 if (worker !== undefined) return worker;
 try {
 worker = new Worker(new URL('./worker/run.js', import.meta.url), { type: 'module' });
 worker.onmessage = onWorkerMessage;
 worker.onerror = (e) => {
 e.preventDefault?.();
 worker = null;
 workerRun = false;
 endRealtime();
 for (const x of workerInputs.splice(0)) engine?.input?.(x);
 if (running) runOnMainThread(true);
 };
 } catch {
 worker = null;
 }
 return worker;
}
function postRun(w, opts) {
 try {
 w.postMessage({ type: 'run', id: runId, arch: arch.id, program: session.program,
 options: { platformConfig: session.platformConfig, runLimit: RUN_LIMIT, historyLimit: HISTORY_LIMIT },
 snapshot: engine.snapshot(), run: runOptions({ ...opts, resumed: true }) });
 return true;
 } catch {
 return false;
 }
}
function setRunning(on) {
 running = on;
 if (on) lastStop = null;
 if (PRIMARY_BTN) syncPrimary();
 else setToolLabel(runBtn, on ? 'pause' : 'play', on ? STRINGS.pause : STRINGS.run, 'F5');
 runBtn.setAttribute('aria-pressed', String(on));
 runStatus.textContent = on ? STRINGS.runningStatus(engine?.state().retired ?? 0) : '';
 updateWsStatus();
}
function finishRun(stop) {
 lastStop = { stop, pc: currentPc() };
 setRunning(false);
 workerRun = false;
 if (uv()) reportSingle(stop);
 else if (stop === STOP.PAUSE) consolePanel.message(STRINGS.paused(hexA(engine.state().pc)));
 else report(stop);
 refresh();
}
function runSingle(id, opts) {
 const v = uv();
 const tick = (first) => {
 if (!running || id !== runId) return;
 const slow = speedSel.value === 'slow';
 const t0 = performance.now();
 let r = STOP.NONE;
 let k = 0;
 do {
 if (!first || k > 0) {
 const at = v.breakAt ? v.breakAt() : v.state().pc;
 if (at !== null && session.breakpoints.has(at)) { r = STOP.BREAK; break; }
 if (at !== null && opts.target === at) { r = STOP.TARGET; break; }
 }
 if (v.state().cycle >= RUN_LIMIT) { r = STOP.BUDGET; break; }
 r = v.step();
 k += 1;
 const why = r === STOP.NONE ? v.event?.() : null;
 if (why) { reportSingle.event = why; r = 'event'; }
 } while (r === STOP.NONE && !slow && performance.now() - t0 < 12);
 if (r === STOP.NONE) {
 runStatus.textContent = `${STRINGS.view.cycles}: ${v.state().cycle}`;
 if (slow) { refresh(); setTimeout(() => tick(false), 400); } else requestAnimationFrame(() => tick(false));
 return;
 }
 finishRun(r === STOP.TARGET ? STOP.PAUSE : r);
 };
 tick(true);
}
const rtEngine = () => (uv() ? uv().realtime?.engine?.() ?? null : engine);
const rtTransport = () => (arch.realtime?.transports?.includes('sab') && globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function' ? 'sab' : 'postMessage');
function startRealtime(opts) {
 const eng = rtEngine();
 const w = eng?.clock && eng.live ? getWorker() : null;
 if (!w) return false;
 const sab = rtTransport() === 'sab' ? new SharedArrayBuffer(RING_BYTES) : null;
 withEngineOpts(eng);
 const now = eng.live({ uartFrom: Infinity });
 const shown = eng.state();
 const bps = [...session.breakpoints, ...(uv()?.realtime?.breakpoints?.() ?? [])];
 const { debug, ...program } = session.program;
 const link = AUDIO && soundOn && audioHost.on && eng.drainAudio ? audioHost.connect({ shared: arch.realtime?.transports?.includes('sab') }) : null;
 try {
 w.postMessage({ type: 'run', id: runId, arch: arch.id, program,
 options: { platformConfig: session.platformConfig, runLimit: Infinity, historyLimit: HISTORY_LIMIT },
 snapshot: eng.snapshot(), run: { breakpoints: bps, resumed: Boolean(opts.resumed) },
 realtime: { ring: sab, uartFrom: now.uart.total, audio: link ? { port: link.port ?? null, sab: link.sab ?? null, rate: arch.audio.sampleRate } : null } },
 link?.port ? [link.port] : []);
 } catch { audioHost?.disconnect(); return false; }
 if (link) runStatus.dataset.audio = link.transport;
 const out = Array.from(shown.output ?? '', (c) => c.charCodeAt(0));
 rt = { engine: eng, ring: sab ? new LiveRing(sab) : null, out, dropped: (shown.outputDropped ?? 0), raf: 0, fraction: null, last: null };
 workerRun = true;
 workerInputs = [];
 runStatus.textContent = STRINGS.realtime.starting;
 runStatus.dataset.transport = sab ? 'sab' : 'postMessage';
 if (rt.ring) { const poll = () => { if (!rt?.ring) return; const r = rt.ring.read(); if (r.live || r.bytes.length) { rtLive(r.live, r.bytes); rtDraw(); } rt.raf = requestAnimationFrame(poll); }; rt.raf = requestAnimationFrame(poll); }
 return true;
}
function rtLive(msg, bytes) {
 if (!rt) return;
 if (bytes?.length) {
 for (const b of bytes) rt.out.push(b);
 if (rt.out.length > OUTPUT_LIMIT * 2) { const k = rt.out.length - OUTPUT_LIMIT; rt.out.splice(0, k); rt.dropped += k; }
 rt.outDirty = true;
 }
 if (msg) rt.pending = msg;
 if (!rt.ring && !rt.drawQueued) { rt.drawQueued = true; requestAnimationFrame(rtDraw); }
}
function rtDraw() {
 if (!rt) return;
 rt.drawQueued = false;
 if (rt.outDirty) { rt.outDirty = false; consolePanel.setOutput(rt.out.slice(-OUTPUT_LIMIT), rt.dropped + Math.max(0, rt.out.length - OUTPUT_LIMIT)); }
 const msg = rt.pending;
 if (!msg) return;
 rt.pending = null;
 const s = msg.state;
 rt.last = s; rt.fraction = msg.fraction;
 runStatus.textContent = STRINGS.realtime.status(s.timeNs, s.clkSys, msg.fraction, msg.ips);
 regs.update({ registers: s.registers, pc: s.pc, changed: [] });
 listing.markPc(s.pc);
 for (const { inst } of archPanels) inst.live?.(s.pins, s);
}
function endRealtime() {
 if (!rt) return null;
 if (rt.raf) cancelAnimationFrame(rt.raf);
 audioHost?.disconnect();
 delete runStatus.dataset.audio;
 const r = rt; rt = null;
 return r;
}
let renderRun = null;
function startRender(opts) {
 const eng = rtEngine();
 const w = eng?.clock && eng.advance && eng.drainAudio ? getWorker() : null;
 if (!w) return false;
 withEngineOpts(eng);
 if (eng.audioStatus && eng.audioStatus().pin < 0) consolePanel.message(STRINGS.audio.noSpeaker);
 const seconds = Math.min(60, Math.max(1, Number(renderSecs.value) || 5));
 const bps = [...session.breakpoints, ...(uv()?.realtime?.breakpoints?.() ?? [])];
 const { debug, ...program } = session.program;
 try {
 w.postMessage({ type: 'run', id: runId, arch: arch.id, program,
 options: { platformConfig: session.platformConfig, runLimit: Infinity, historyLimit: HISTORY_LIMIT },
 snapshot: eng.snapshot(), run: { breakpoints: bps, resumed: Boolean(opts.resumed) }, render: { seconds } });
 } catch { return false; }
 renderRun = { engine: eng, seconds };
 workerRun = true;
 workerInputs = [];
 if (soundOn) audioHost.enable();
 runStatus.textContent = STRINGS.audio.rendering(0, seconds);
 return true;
}
function playRendered(frames, seconds) {
 if (!frames?.length) { consolePanel.message(STRINGS.audio.noSpeaker); return; }
 if (!soundOn) { consolePanel.message(STRINGS.audio.soundOff); return; }
 const secs = frames.length / arch.audio.sampleRate;
 audioHost.enable().then((ok) => {
 if (!ok) { consolePanel.message(STRINGS.audio.unavailable, 'error'); return; }
 consolePanel.message(STRINGS.audio.playing(secs, seconds));
 audioHost.playBuffer(frames);
 });
}
function startRun(opts = {}) {
 if (running || !ensureRunnable()) return;
 runId += 1;
 runOpts = opts;
 setRunning(true);
 if (AUDIO && speedSel.value === 'render' && !opts.target) {
 if (startRender(opts)) return;
 }
 if (REALTIME && (speedSel.value === 'rt' || speedSel.value === 'render') && !opts.target) {
 if (AUDIO && soundOn && !audioHost.on) {
 const id = runId;
 audioHost.enable().then((ok) => {
 if (!ok) { soundOn = false; syncSound(); consolePanel.message(STRINGS.audio.unavailable, 'error'); }
 if (!running || id !== runId) return;
 if (!startRealtime(opts)) { setRunning(false); startRun(opts); }
 });
 return;
 }
 if (startRealtime(opts)) return;
 if (uv() && !rtNoted) { rtNoted = true; consolePanel.message(STRINGS.realtime.notInView); }
 }
 if (uv()) { runSingle(runId, opts); return; }
 if (speedSel.value === 'slow') { animate(runId, false); return; }
 const t0 = performance.now();
 let stop;
 let resumed = false;
 do {
 stop = engine.run(runOptions({ ...opts, chunk: 20_000, resumed }));
 resumed = true;
 } while (stop === STOP.CHUNK && performance.now() - t0 < 10);
 if (stop !== STOP.CHUNK) { finishRun(stop); return; }
 const w = capability(arch, 'worker', profileOf(session.profile)).enabled ? getWorker() : null;
 if (w && postRun(w, opts)) {
 workerRun = true;
 workerInputs = [];
 refresh();
 } else {
 runOnMainThread(true);
 }
}
function runOnMainThread(resumed) {
 const id = runId;
 const tick = (first) => {
 if (!running || id !== runId) return;
 const t0 = performance.now();
 let stop;
 let r = first;
 do {
 stop = engine.run(runOptions({ ...runOpts, chunk: 20_000, resumed: r }));
 r = true;
 } while (stop === STOP.CHUNK && performance.now() - t0 < 12);
 if (stop === STOP.CHUNK) {
 runStatus.textContent = STRINGS.runningStatus(engine.state().retired);
 requestAnimationFrame(() => tick(true));
 return;
 }
 finishRun(stop);
 };
 tick(resumed);
}
function animate(id, resumed) {
 if (!running || id !== runId) return;
 const stop = engine.run(runOptions({ ...runOpts, chunk: 1, resumed }));
 if (stop === STOP.CHUNK) { refresh(); setTimeout(() => animate(id, true), 150); return; }
 finishRun(stop);
}
function onWorkerMessage(e) {
 const m = e.data;
 if (!running) return;
 if (m.type === 'progress') {
 runStatus.textContent = m.render !== undefined && renderRun ? STRINGS.audio.rendering(m.render, renderRun.seconds) : STRINGS.runningStatus(m.retired);
 } else if (m.type === 'live') {
 rtLive(m, m.state.uart?.bytes);
 } else if (m.type === 'done') {
 if (rt?.ring) { const last = rt.ring.read(); if (last.live || last.bytes.length) rtLive(last.live, last.bytes); }
 const r = endRealtime();
 const rr = m.rendered ? renderRun : null; renderRun = null;
 const eng = r ? r.engine : rr ? rr.engine : engine;
 eng.restore(m.snapshot);
 if (rr) { for (const x of workerInputs.splice(0).slice(m.applied ?? 0)) eng.input?.(x); if (uv()) uv().realtime?.sync?.(); finishRun(m.stop); playRendered(m.audio, rr.seconds); return; }
 if (r && uv()) uv().realtime?.sync?.();
 for (const x of workerInputs.splice(0).slice(m.applied ?? 0)) eng.input?.(x);
 if (r && uv() && m.stop === STOP.BREAK && !session.breakpoints.has(uv().breakAt?.() ?? -1)) {
 const why = uv().event?.();
 if (why) { reportSingle.event = why; finishRun('event'); return; }
 }
 finishRun(m.stop);
 }
}
function pause() {
 if (!running) return;
 if ((rt || (!uv() && speedSel.value !== 'slow')) && worker) { worker.postMessage({ type: 'pause' }); return; }
 runId += 1;
 finishRun(STOP.PAUSE);
}
function cancelRun() {
 if (!running) return;
 runId += 1;
 renderRun = null;
 if (worker) {
 worker.terminate();
 worker = undefined;
 }
 workerRun = false;
 workerInputs = [];
 endRealtime();
 setRunning(false);
}
let followed = null;
function followPc(p, s) {
 if (selected) return;
 const l = s && !s.halted ? p?.listing.find((x) => x.address === s.pc) ?? null : null;
 if (l === followed) return;
 followed = l;
 fields.show(l);
 if (l) fields.root.prepend(el('p.note.fields-follow', { text: STRINGS.fieldsFollow }));
}
let imageViewSwitch = false;
function syncImageViews() {
 const img = Boolean(session.imported && !session.imported.built);
 let changed = false;
 VIEWS.forEach((v, i) => { if (v.imageOnly && viewButtons[i].hidden !== !img) { viewButtons[i].hidden = !img; changed = true; } });
 if (changed) refit();
 if (!img && viewOf(mode)?.imageOnly && !imageViewSwitch) {
 imageViewSwitch = true;
 setMode(VIEWS[0].id).finally(() => { imageViewSwitch = false; });
 }
}
function refresh(programChanged = false) {
 saveSoon();
 syncPrimary();
 syncImageViews();
 syncLineButtons();
 const p = session.program;
 if (programChanged) {
 listing.setProgram(p, session.breakpoints);
 dataBox.replaceChildren(dataTable(p, arch.addressSpace));
 symBox.replaceChildren(symbolTable(p, (s) => {
 memory.goTo(s.name);
 const loc = edLoc(s);
 if (loc && PROJECTS && loc.file && loc.file !== editor.active) selectFile(loc.file);
 if (loc) editor.goToLine(loc.line);
 }, arch.addressSpace.addressBits));
 selected = null;
 followed = null;
 fields.show(null);
 report.droppedShown = false;
 reportSingle.dropped = false;
 showBreakLines();
 }
 editorStatus();
 updateArchPanels();
 if (uv()) { refreshSingle(p); return; }
 const st = engine?.state() ?? null;
 const s = st ? { ...st, halted: st.halted && !st.error } : null;
 const last = engine?.last() ?? null;
 const w = last?.memory[0];
 regs.update(s ? { registers: s.registers, pc: s.pc, changed: last ? last.registers.map((r) => r.id) : [] } : null);
 listing.markPc(s?.pc);
 followPc(p, s);
 const row = p?.listing.find((l) => l.address === s?.pc) ?? null;
 markCurrent(s && !s.halted && !p?.imported ? row : null);
 memory.setContext({ mem: enginePort ?? undefined, program: p, registers: s?.registers ?? null, watched: session.watchWords, written: w ? { addr: w.address, size: w.size } : null, profile: profileOf(session.profile),
 accessed: dataAccessNow() });
 updateMemPanels();
 counters.show(engine?.counters?.() ?? null);
 calls.update(CAP.callStack.enabled && engine?.callStack ? engine.callStack() : null);
 const output = s?.output ?? '';
 const from = output.length - OUTPUT_LIMIT;
 const nl = from > 0 ? output.indexOf('\n', from) : -1;
 const shown = from > 0 ? output.slice(nl >= 0 && nl < output.length - 1 ? nl + 1 : from) : output;
 consolePanel.setOutput(Array.from(shown, (c) => c.charCodeAt(0)), (s?.outputDropped ?? 0) + output.length - shown.length);
 updateWsStatus();
}
function refreshSingle(p) {
 const v = uv();
 const s = v.state();
 const at = s ? s.instruction ?? s.pc : undefined;
 regs.update(s ? { registers: s.registers, pc: s.pc, changed: s.changed ?? [] } : null);
 listing.markPc(at);
 const row = s ? p?.listing.find((l) => l.address === at) ?? null : null;
 markCurrent(s && !s.halted && !p?.imported ? row : null);
 const port = v.memoryPort?.() ?? null;
 const ms = memsysOf[mode] ?? null;
 const dcache = ms?.caches.D ?? null;
 memory.setContext({ mem: port, program: p, registers: s?.registers ?? null, watched: session.watchWords,
 written: s?.written ? { addr: s.written.address, size: s.written.size } : null, profile: profileOf(viewOf(mode).profile),
 ram: port && dcache ? port.store : null, dirty: dcache ? (a) => isDirty([dcache], a) : null, accessed: s ? dataAccessNow() : null });
 updateMemPanels();
 const waits = ms?.timed ? ms.stats.waitCycles : 0;
 counters.updateCycles({ cycles: s?.cycle ?? 0, instructions: s?.retired ?? 0,
 extra: [...(v.counters?.() ?? []), ...(ms?.timed ? [[STRINGS.mem.waitCycles, waits]] : [])] });
 consolePanel.setOutput(typeof s?.output === 'string' ? Array.from(s.output.slice(-OUTPUT_LIMIT), (c) => c.charCodeAt(0)) : []);
 if (drawingHidden()) drawingStale = true;
 else { drawingStale = false; v.render(); refreshWave(); }
 updateWsStatus();
}
function listingText(p) {
 return p.listing.map((l) => `${l.address.toString(16).padStart(8, '0')}  ${(l.word >>> 0).toString(16).padStart(8, '0')}  `
 + `${arch.language.disassemble(l.word, l.address).padEnd(28)}  ${l.part === 0 ? l.text.trim() : ''}`.trimEnd()).join('\n') + '\n';
}
function reportImport(name, report) {
 for (const m of report) consolePanel.message(m.message, m.kind ?? 'info', m.line ? { file: name, line: m.line } : null, m.note ?? null);
}
const SETTINGS = arch.views.filter((v) => v.settings);
function viewSettings(v) {
 const { key, defaults, values } = v.settings;
 const o = inst[v.id]?.options?.get();
 return Object.fromEntries(Object.keys(defaults).map((k) => [k, settingValue(o ? o[k] : savedOpt(`pips.${key}.${k}`, values[k], defaults[k]))]));
}
const hasTraps = (id) => capability(arch, 'traps', profileOf(id)).enabled;
function shareState() {
 return { arch: arch.id, view: mode, profile: mode === VIEWS[0].id ? session.profile : isaProfile, subset: subsetSel.value || null, lang, name: sourceName(),
 source: editor.value, cc: xlValues(), ...(asmOpts.length ? { opts: asmValues() } : {}), ...(comp ? { companion: { ...comp } } : {}),
 ...(inputEngine()?.restart && inputEngine().inputs?.().length ? { inputs: inputEngine().inputs() } : {}),
 ...Object.fromEntries(SETTINGS.map((v) => [v.settings.key, viewSettings(v)])),
 ...(memCfg.mode !== 'ideal' || memCfg.words !== 256 || memCfg.devices ? { mem: memCfg } : {}),
 ...(hasTraps(session.profile) || hasTraps(isaProfile) || memCfg.devices ? { platform: session.platformConfig } : {}),
 ...(PROJECTS ? { files: project().files, entry: project().entry, project: project().name } : {}) };
}
async function copyShareLink() {
 const S = STRINGS.share;
 const frag = await encodeFragment(shareState());
 if (frag.length > LINK_LIMIT) { consolePanel.message((PROJECTS ? STRINGS.projects.tooLong : S.tooLong)(frag.length, LINK_LIMIT), 'warn'); return; }
 const url = `${location.origin}${location.pathname}${location.search}#${frag}`;
 try {
 await navigator.clipboard.writeText(url);
 consolePanel.message(S.copied(url.length), 'ok');
 } catch {
 consolePanel.message(S.copyFailed, 'warn', null, url);
 }
}
function saveSettings() {
 download(`${sourceName().replace(/\.\w+$/, '')}.risc-vista.json`, settingsFile(shareState()), 'application/json');
}
async function applyShared(st, message) {
 if (variantOf(arch, st.profile) !== arch.activeVariant) { consolePanel.message(STRINGS.share.refusedVariant(profileOf(st.profile)?.label ?? st.profile), 'error'); return; }
 cancelRun();
 const dropped = session.breakpoints.size;
 session.breakpoints.clear();
 store.set('pips.source.before', JSON.stringify(PROJECTS ? { project: project().id } : { lang, text: editor.value, companion: comp }));
 for (const x of xlOpts) { const v = st.cc?.[x.o.id]; if (v) { x.sel.value = v; store.set(`pips.cc.${x.o.id}`, v); } }
 for (const x of asmOpts) { const v = st.opts?.[x.o.id]; if (v && x.o.values.some((o) => o.id === v)) { x.sel.value = v; store.set(x.key, v); } }
 queueMicrotask(() => applyEngineOpts());
 for (const v of SETTINGS) {
 const s = st[v.settings.key];
 if (!s) continue;
 for (const k of Object.keys(v.settings.defaults)) if (s[k] !== null && s[k] !== undefined) store.set(`pips.${v.settings.key}.${k}`, String(s[k]));
 inst[v.id]?.options?.apply(s);
 }
 if (st.subset) { subsetSel.value = st.subset; store.set('pips.subset', st.subset); }
 if (st.platform) session.platformConfig = st.platform;
 if (st.mem && validateConfig(st.mem).length === 0) applyMemory(st.mem, { assemble: false });
 isaProfile = st.profile;
 store.set('pips.profile', st.profile);
 if (PROJECTS) {
 const one = singleName(st);
 const files = st.files ?? [{ name: one, text: st.source }, ...(st.companion && st.companion.name !== one ? [st.companion] : [])];
 const title = st.project ?? (st.files ? STRINGS.projects.sharedProject : files[0].name.replace(/\.\w+$/, ''));
 await proj.newProject(title, files, st.entry ?? files[0].name);
 message = { text: message, note: STRINGS.projects.fromLink(project().name) };
 } else {
 if (st.lang === XID && !(await loadExtra())) return;
 lang = st.lang;
 store.set('pips.lang', lang);
 if (lang === XID) cName = st.name?.endsWith(XL.extension) ? st.name : `main${XL.extension}`;
 else { session.files = [{ name: st.name && !(XL && st.name.endsWith(XL.extension)) ? st.name : `main${arch.language.extension}`, text: st.source }]; cMap = null; renderAsm(null); }
 editor.value = st.source;
 store.set(sourceKey(), st.source);
 setComp(st.companion ?? null);
 syncLangControls();
 }
 if (st.view === mode) {
 if (mode === VIEWS[0].id) { session.profile = st.profile; profileSel.value = st.profile; }
 else if (viewOf(mode).subsets) session.subset = noSubset(subsetSel.value) ? null : subsetSel.value;
 doAssemble();
 } else await setMode(st.view);
 if (message?.note) consolePanel.message(message.text, 'ok', null, message.note);
 else consolePanel.message(message, 'ok', null, STRINGS.share.keptNote);
 if (dropped) consolePanel.message(STRINGS.breakpointsCleared(dropped));
 if (st.inputs?.length && applyInputs(st.inputs)) { consolePanel.message(STRINGS.realtime.inputsKept(st.inputs.length)); refresh(); }
}
function singleName(st) {
 const exts = projectExtensions(arch);
 const ok = st.name && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(st.name) && exts.includes(st.name.slice(st.name.lastIndexOf('.')).toLowerCase());
 if (ok && (st.lang === XID) === (langOfFile(st.name) === XID)) return st.name;
 return `main${st.lang === XID ? XL.extension : arch.language.extension}`;
}
async function openFragment() {
 if (!isShareFragment(location.hash)) return;
 const frag = location.hash;
 history.replaceState(null, '', `${location.pathname}${location.search}`);
 try {
 const st = await decodeFragment(frag);
 const single = PROJECTS && !st.files ? arch.editions?.find((e) => e.id !== EDITION.id && withEdition(preEdition, e.id).capabilities?.projects !== true
 && (st.lang === 'asm' || (e.languages ?? []).includes(st.lang))) : null;
 if (single) { store.set('pips.editionNote', STRINGS.edition.linkIn(single.label)); await switchEdition(single.id, frag); return; }
 await applyShared(st, STRINGS.share.opened(viewName(st.view)));
 } catch (e) {
 if (e.code === 'field' && e.data?.field === 'files' && !PROJECTS && PROJECT_EDITION) {
 store.set('pips.editionNote', STRINGS.edition.linkIn(PROJECT_EDITION.label));
 await switchEdition(PROJECT_EDITION.id, frag);
 return;
 }
 if (e.code === 'variant') {
 history.replaceState(null, '', `${location.pathname}${location.search}${frag}`);
 saveWorkspace();
 store.set('pips.profile', e.data.profile);
 store.set('pips.variantNote', 'link');
 location.reload();
 return;
 }
 consolePanel.message(STRINGS.share.refused(e.message), 'error', null, refusedNote(e));
 }
}
const viewName = (v) => viewOf(v)?.label;
const refusedNote = (e) => (e.code === 'version' ? STRINGS.share.refusedVersion : e.code === 'arch' ? STRINGS.share.refusedArch(e.data.arch)
 : e.code === 'field' && e.data?.field === 'files' && !PROJECTS && PROJECT_EDITION ? CAP.projects.text
 : e.code === 'variant' ? STRINGS.share.refusedVariant(profileOf(e.data.profile)?.label ?? e.data.profile) : null);
function restoreBefore() {
 let b = null;
 try { b = JSON.parse(store.get('pips.source.before') ?? 'null'); } catch { }
 if (PROJECTS && b?.project) {
 proj.openProject(b.project).then(() => { store.set('pips.source.before', ''); consolePanel.message(STRINGS.projects.restoreProject(project().name), 'ok'); })
 .catch(() => consolePanel.message(STRINGS.share.nothingToRestore));
 return;
 }
 if (!b || typeof b.text !== 'string') { consolePanel.message(STRINGS.share.nothingToRestore); return; }
 (async () => {
 if (b.lang !== lang) await setLang(b.lang === XID ? XID : 'asm');
 editor.value = b.text;
 store.set(sourceKey(), b.text);
 setComp(b.companion ?? null);
 store.set('pips.source.before', '');
 doAssemble();
 consolePanel.message(STRINGS.share.restored, 'ok');
 })();
}
let exercise = null;
async function openExercise(raw, name = null, quiet = false) {
 if (!can('exercises')) return;
 try {
 exercise = await arch.exercises.parse(raw);
 } catch (e) {
 consolePanel.message(STRINGS.exercise.refused(e.message), 'error');
 return;
 }
 store.set('pips.exercise', JSON.stringify(raw));
 exerciseDialog.set(exercise);
 exerciseBtn.hidden = false;
 refit();
 if (!quiet) {
 consolePanel.message(STRINGS.exercise.opened(exercise.title, name), 'ok');
 if (!exerciseDialog.root.open) exerciseDialog.open();
 }
}
async function runExerciseTests() {
 if (!exercise) return null;
 if (exercise.lang !== lang) { consolePanel.message(STRINGS.exercise.wrongLang(exercise.lang), 'error'); return null; }
 let text = editor.value;
 if (lang === XID) {
 if (!(await loadExtra())) return null;
 const c = cc.compile(editor.value, { name: cName, profile: OWN_PROFILES[0].id, options: { ...buildValues(), ...xlValues() }, ...(COMP ? { companions: compFiles() } : {}) });
 if (!c.ok) { consolePanel.message(STRINGS.cc.errors, 'error'); return null; }
 text = c.text;
 }
 const p = arch.language.assemble([{ name: lang === XID ? stem(cName) + arch.language.extension : session.files[0].name, text },
 ...(COMP && lang !== XID ? compFiles() : [])], { profile: exercise.profile ?? OWN_PROFILES[0].id, options: buildValues() });
 if (!(p.assembled ?? p.ok)) { consolePanel.message(STRINGS.asmErrors(errorCount(p)), 'error'); return null; }
 return arch.exercises.run(p, exercise);
}
const exerciseDialog = new ExerciseDialog({
 onRun: () => runExerciseTests(),
 onStarter: async (source, l, companion = null) => {
 exerciseDialog.root.close();
 await applyShared({ view: mode, profile: exercise?.profile ?? OWN_PROFILES[0].id, lang: l, name: `exercise${l === XID ? XL.extension : arch.language.extension}`, source,
 ...(COMP && companion ? { companion } : {}) }, STRINGS.exercise.starterLoaded);
 },
 onClose: () => { exercise = null; store.set('pips.exercise', ''); exerciseBtn.hidden = true; refit(); },
 onOpenFile: () => { exerciseDialog.root.close(); fileInput.click(); },
 list: async () => {
 if (!contentUrl('exercises')) throw new Error(STRINGS.capability.notSupported);
 const r = await fetch(contentUrl('exercises'));
 if (!r.ok) throw new Error(`index.json: ${r.status}`);
 return r.json();
 },
 onPick: async (e) => {
 const r = await fetch(new URL(e.file, contentUrl('exercises')));
 if (!r.ok) { consolePanel.message(STRINGS.exercise.refused(`: ${r.status}`), 'error'); return; }
 await openExercise(await r.json());
 },
});
exerciseDialog.set(null);
document.body.append(exerciseDialog.root);
async function openFile(file) {
 if (!file) return;
 const low = file.name.toLowerCase();
 if (low.endsWith('.json')) {
 const text = await file.text();
 let parsed = null;
 try { parsed = JSON.parse(text); } catch { }
 if (parsed?.format === 'risc-vista-exercise') { await openExercise(parsed, file.name); return; }
 try {
 const st = readSettingsFile(text);
 await applyShared(st, STRINGS.share.openedFile(file.name, viewName(st.view)));
 } catch (e) {
 consolePanel.message(STRINGS.share.refused(e.message), 'error', null, refusedNote(e));
 }
 return;
 }
 const ext = low.slice(low.lastIndexOf('.') + 1);
 if (!PROJECTS && ext === 'zip' && PROJECT_EDITION) { can('projects'); return; }
 if (PROJECTS && ext === 'zip') {
 try {
 await proj.importZip(new Uint8Array(await file.arrayBuffer()), file.name);
 consolePanel.message(STRINGS.projects.imported(file.name, project().files.length), 'ok');
 } catch (e) { consolePanel.message(STRINGS.projects.importRefused(e.message), 'error'); }
 return;
 }
 if (PROJECTS && projectExtensions(arch).includes(`.${ext}`)) {
 try {
 const text = await file.text();
 const name = proj.freeName(file.name);
 proj.addFile(name, text);
 editor.show(name, text);
 afterFiles(true);
 consolePanel.message(STRINGS.projects.addedFile(name), 'ok');
 } catch (e) { consolePanel.message(STRINGS.projects.refused(e.message), 'error'); }
 return;
 }
 if (COMP && low.endsWith(COMP.extension.toLowerCase())) {
 if (comp) store.set('pips.companion.removed', JSON.stringify(comp));
 setComp({ name: file.name, text: await file.text() });
 showComp(true);
 dirty = true; editorStatus(); syncPrimary(); saveSoon();
 consolePanel.message(STRINGS.companion.opened(file.name), 'ok');
 return;
 }
 const kind = IMAGE_KINDS.includes(ext) ? ext : XL && low.endsWith(XL.extension) ? XID : 's';
 if (kind === 's' || kind === XID) {
 let text = await file.text();
 let gccReport = null;
 if (kind === 's') {
 const imp = CAP.gccImport.enabled ? (await arch.language.importers?.() ?? []).find((i) => i.test(text)) : null;
 if (imp) {
 gccReport = imp.convert(text, file.name);
 text = gccReport.text;
 }
 }
 if (kind === XID && !(await loadExtra())) return;
 store.set(sourceKey(), editor.value);
 lang = kind === XID ? XID : 'asm';
 store.set('pips.lang', lang);
 if (lang === XID) cName = file.name;
 else { session.files = [{ name: file.name, text }]; cMap = null; renderAsm(null); }
 editor.value = text;
 store.set(sourceKey(), text);
 syncLangControls();
 const first = OWN_PROFILES[0].id;
 if (gccReport && mode === VIEWS[0].id && session.profile !== first) { session.profile = first; isaProfile = first; profileSel.value = first; store.set('pips.profile', first); }
 const dropped = session.breakpoints.size;
 session.breakpoints.clear();
 doAssemble();
 if (dropped) consolePanel.message(STRINGS.breakpointsCleared(dropped));
 if (gccReport) reportImport(file.name, gccReport.report);
 return;
 }
 if (!can('imageImport')) return;
 if (!imageKinds().includes(kind)) { consolePanel.message(STRINGS.imageKindRefused(file.name, imageKinds().map((k) => `.${k}`).join(', ')), 'error'); return; }
 const content = kind === 'hex' ? await file.text() : new Uint8Array(await file.arrayBuffer());
 try {
 session.program = arch.language.loadImage(content, kind, file.name, { profile: session.profile });
 } catch (e) { consolePanel.message(`${file.name}: ${e.message}`, 'error'); return; }
 cancelRun();
 resetEngine();
 if (arch.language.imageKinds) {
 session.imported = { content, kind, name: file.name };
 if (uv() || isCmp()) inst[mode].load(session.program);
 }
 consolePanel.clearMessages();
 consolePanel.message(STRINGS.importedImage(session.program.listing.length), 'ok', null, STRINGS.importedNote);
 for (const d of session.program.diagnostics ?? []) if (d.severity === 'warning') consolePanel.message(d.message, 'warn');
 editor.setErrors([]);
 refresh(true);
 dirty = false;
}
const WS_KEY = 'pips.workspace';
const WS_REPLAY_CAP = 2_000_000;
let restoring = true;
let wsTimer = null;
function textHash(s) {
 let h = 0x811c9dc5;
 for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
 return (h >>> 0).toString(16);
}
const programKey = () => textHash(`${lang}|${session.profile}|${subsetSel.value}|${Object.values(xlValues()).join('|')}|${asmOpts.length ? `${Object.values(buildValues()).join('|')}|` : ''}${
 PROJECTS ? `${project().id}|${project().entry}|${JSON.stringify(project().files)}` : `${editor.value}${comp ? `|${comp.name}|${comp.text}` : ''}`}`);
function toB64(bytes) {
 let s = '';
 for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
 return btoa(s);
}
const fromB64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
function saveWorkspace() {
 if (restoring) return;
 clearTimeout(wsTimer);
 const a = editor.area;
 const st = {
 v: 1, key: programKey(), name: PROJECTS ? editor.active : lang === XID ? cName : session.files[0].name,
 cursor: [a.selectionStart, a.selectionEnd], scroll: [a.scrollTop, a.scrollLeft],
 breakpoints: [...session.breakpoints], watchRegs: [...session.watchRegs], watchWords: [...session.watchWords],
 run: { mode, steps: uv() ? uv().state()?.cycle ?? 0 : engine?.state().steps ?? 0,
 ...(inputEngine()?.inputs?.().length && (!uv() || inputEngine()?.restart) ? { inputs: inputEngine().inputs() } : {}) },
 platform: session.platformConfig,
 };
 if (base.variants) store.set('pips.v9', '1');
 const loads = session.dataLoads.map((l) => ({ label: l.label, name: l.name, b64: toB64(l.bytes) }));
 try {
 localStorage.setItem(scoped(WS_KEY), JSON.stringify({ ...st, dataLoads: loads }));
 } catch {
 try { localStorage.setItem(scoped(WS_KEY), JSON.stringify({ ...st, dataLoads: [], loadsDropped: loads.length })); } catch { }
 }
}
const saveSoon = () => { if (!restoring) { clearTimeout(wsTimer); wsTimer = setTimeout(saveWorkspace, 400); } };
window.addEventListener('pagehide', saveWorkspace);
window.addEventListener('pagehide', () => { if (PROJECTS && proj) proj.saveNow(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveWorkspace(); });
function keptWorkspace() {
 try { const st = JSON.parse(store.get(WS_KEY) ?? 'null'); return st?.v === 1 ? st : null; } catch { return null; }
}
function restoreEditorState(st) {
 if (!st) return;
 if (st.platform) session.platformConfig = normalisePlatform(st.platform);
 if (st.name && !PROJECTS) {
 const cKind = Boolean(XL) && st.name.endsWith(XL.extension);
 if (lang === XID) { if (cKind) cName = st.name; } else if (!cKind) session.files[0].name = st.name;
 }
 try { session.dataLoads = (st.dataLoads ?? []).map((l) => ({ label: l.label, name: l.name, bytes: fromB64(l.b64) })); } catch { session.dataLoads = []; }
 const a = editor.area;
 const n = editor.value.length;
 if (st.cursor) a.setSelectionRange(Math.min(st.cursor[0], n), Math.min(st.cursor[1], n));
 if (st.scroll) { a.scrollTop = st.scroll[0]; a.scrollLeft = st.scroll[1]; editor.syncScroll(); }
 editorStatus();
}
function restoreRunState(st) {
 if (!st || st.key !== programKey() || !session.runnable) return;
 for (const a of st.breakpoints ?? []) session.breakpoints.add(a >>> 0);
 for (const r of st.watchRegs ?? []) {
 const id = typeof r === 'number' ? REG_IDS[r] : r;
 if (!REG_IDS.includes(id)) continue;
 watchReg(id, true);
 regs.setWatch(id, true);
 }
 for (const w of st.watchWords ?? []) session.watchWords.add(w >>> 0);
 showBreakLines();
 const steps = Math.max(0, Number(st.run?.steps) || 0);
 if (st.run?.mode === mode && steps > 0) {
 if (steps > WS_REPLAY_CAP) {
 consolePanel.message(STRINGS.workspace.tooLong(steps));
 if (Array.isArray(st.run.inputs) && st.run.inputs.length && applyInputs(st.run.inputs)) consolePanel.message(STRINGS.realtime.inputsKept(st.run.inputs.length));
 } else if (uv()) {
 const v = uv();
 if (Array.isArray(st.run.inputs) && st.run.inputs.length) applyInputs(st.run.inputs);
 for (let i = 0; i < steps && v.state() && v.step() === STOP.NONE; i++);
 consolePanel.message(STRINGS.workspace.restored(v.state()?.cycle ?? 0, 'cycle'));
 } else {
 if (Array.isArray(st.run.inputs) && st.run.inputs.length && engine.inputs) resetEngine(st.run.inputs);
 engine.run({ chunk: steps, breakpoints: new Set() });
 diag.skip();
 consolePanel.message(STRINGS.workspace.restored(engine.state().steps, 'instruction'));
 }
 }
 if (st.loadsDropped) consolePanel.message(STRINGS.workspace.loadsDropped(st.loadsDropped), 'warn');
 listing.render();
 refresh();
}
function selectFile(name) {
 if (!PROJECTS || !project()?.files.some((f) => f.name === name)) return;
 proj.openTab(name);
 editor.show(name, fileText(project(), name));
 explorer.render(project(), editor.active, proj.status);
 editorStatus();
 saveSoon();
}
function closeFile(name) {
 proj.closeTab(name);
 editor.close(name);
 editor.show(project().active, fileText(project(), project().active));
 explorer.render(project(), editor.active, proj.status);
 editorStatus();
}
function afterFiles(rebuild = false) {
 explorer.render(project(), editor.active, proj.status);
 editorStatus();
 syncBuildLabel();
 if (rebuild) doAssemble();
}
function loadProject() {
 const p = project();
 editor.clearMarks();
 editor.reset(p.open, p.active, (n) => fileText(p, n));
 session.breakpoints.clear();
 markedAt = null;
 store.set('pips.project', p.id);
 if (EDITION?.compiler && p.compiler && p.compiler !== EDITION.compiler && p.files.some((f) => langOfFile(f.name) === XID)) {
 const other = C_LANGS.find((x) => x.id === p.compiler);
 const home = arch.editions.find((e) => e.id !== EDITION.id && (e.languages ?? []).includes(p.compiler));
 if (other) startNotes.push([STRINGS.edition.compilerFixed(cCompiler().label, other.label, home?.label ?? null), 'warn']);
 }
 explorer.render(p, editor.active, proj.status);
 dirty = false;
 editorStatus();
}
function onProjectChange(what) {
 if (!explorer || !project()) return;
 if (what === 'status') explorer.setStatus(proj.status);
 else if (what === 'project') { loadProject(); doAssemble(); }
 else if (what !== 'text') explorer.render(project(), editor.active, proj.status);
}
const defaultProject = () => createProject({ module: arch.id, name: STRINGS.projects.untitled,
 files: [{ name: `main${arch.language.extension}`, text: EXAMPLE }], extensions: projectExtensions(arch) });
async function startProjects() {
 const pstore = await openProjectStore();
 proj = new ProjectSession({ store: pstore, module: arch.id, extensions: projectExtensions(arch), onChange: onProjectChange });
 const r = await proj.start({
 id: store.get('pips.project'), title: STRINGS.projects.myProgram,
 defaults: [{ name: `main${arch.language.extension}`, text: EXAMPLE }],
 migrate: () => {
 const files = [];
 const asm = store.get('pips.source');
 const c = XL ? store.get(`pips.source.${XID}`) : null;
 if (asm !== null) files.push({ name: `main${arch.language.extension}`, text: asm });
 if (c !== null) files.push({ name: `main${XL.extension}`, text: c });
 if (files.length === 2 && store.get('pips.lang') === XID) files.reverse();
 return files;
 },
 });
 loadProject();
 if (plan().lang === 'c' && (await loadExtra())) lang = XID;
 if (r.how === 'migrated') startNotes.push([STRINGS.projects.migrated, 'ok']);
 if (!proj.persistent) startNotes.push([STRINGS.projects.notKept, 'warn']);
}
const startNotes = [];
function flushNotes() { for (const [text, kind] of startNotes.splice(0)) consolePanel.message(text, kind); }
document.addEventListener('keydown', (e) => {
 const k = e.key;
 if (k === 'F5') { e.preventDefault(); running ? pause() : startRun(); }
 else if (k === 'F10' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runToCursor(); }
 else if (k === 'F10' && e.altKey) { e.preventDefault(); if (!lineStepBtn.hidden) lineStep(e.shiftKey ? 'backLine' : 'stepLine'); }
 else if (k === 'F10') { e.preventDefault(); e.shiftKey ? stepBack() : stepOnce(); }
 else if (k === 'F11') { e.preventDefault(); e.shiftKey ? stepOut() : stepOver(); }
 else if (k === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doAssemble({ user: true }); }
 else if (k === 'Escape' && popoverOpen()) { }
 else if (k === 'Escape' && workspace.classList.contains('zoomed') && !e.target.closest?.('details[open]')) setZoom(false);
 else if (k === 'Escape' || k === 'f' || k === 'F') viewKey(e);
});
function popoverOpen() {
 try { return Boolean(document.querySelector(':popover-open')); } catch { return false; }
}
function viewKey(e) {
 if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
 const t = e.target;
 if (t.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], dialog') || document.querySelector('dialog[open]')) return;
 if (document.querySelector('details[open]')) return;
 if (e.key === 'Escape') {
 if (viewModes.fullscreen || viewModes.state.mode !== 'focus') return;
 e.preventDefault();
 viewModes.set('normal');
 } else {
 e.preventDefault();
 viewModes.toggleFocus();
 }
}
document.title = `${STRINGS.appName}: ${STRINGS.appFull}`;
for (const node of document.querySelectorAll('[data-string]')) {
 const text = STRINGS[node.dataset.string];
 if (typeof text === 'string') node.textContent = text;
}
const theme = store.get('pips.theme');
if (theme && THEMES.includes(theme)) document.documentElement.dataset.theme = theme;
const savedProfile = store.get('pips.profile');
const ownProfile = (p) => Boolean(p && profileOf(p) && variantOf(arch, p) === arch.activeVariant);
if (ownProfile(savedProfile)) session.profile = savedProfile;
if (ownProfile(TOOL?.profile)) session.profile = TOOL.profile;
profileSel.value = session.profile;
if (!PROJECTS && XL && store.get('pips.lang') === XID && (await loadExtra())) lang = XID;
const firstVisit = store.get(sourceKey()) === null;
const editionNote = store.get('pips.editionNote');
if (editionNote) store.set('pips.editionNote', '');
if (PROJECTS) await startProjects();
else editor.value = store.get(sourceKey()) ?? (lang === XID ? XL.example : EXAMPLE);
if (COMP) { let c = null; try { c = JSON.parse(store.get('pips.companion') || 'null'); } catch { } setComp(c); }
const kept = isShareFragment(location.hash) ? null : keptWorkspace();
restoreEditorState(kept);
if (PROJECTS) editor.addAreaListener('scroll', () => saveSoon());
else editor.area.addEventListener('scroll', () => saveSoon());
renderAsm(null);
syncLangControls();
const savedSubset = store.get('pips.subset');
if (savedSubset && SUBSETS.some((s) => s.id === savedSubset)) subsetSel.value = savedSubset;
doAssemble();
for (const b of toolbar.querySelectorAll('.dp-only')) b.hidden = true;
if (isShareFragment(location.hash)) await openFragment();
else if (TOOL?.view && viewOf(TOOL.view)) await setMode(TOOL.view);
else if (viewOf(store.get('pips.view')) && store.get('pips.view') !== VIEWS[0].id) await setMode(store.get('pips.view'));
restoreRunState(kept);
restoring = false;
flushNotes();
if (firstVisit && TOOL?.template && !isShareFragment(location.hash)) {
 const t = (await loadTemplates().catch(() => null))?.templates.find((x) => x.id === TOOL.template);
 if (t) await openTemplate(t);
}
{
 const why = store.get('pips.variantNote');
 if (why) {
 store.set('pips.variantNote', '');
 consolePanel.message(why === 'link' ? STRINGS.variant.link(variantLabel(arch.activeVariant)) : STRINGS.variant.loaded(variantLabel(arch.activeVariant)), 'ok');
 }
}
if (editionNote) consolePanel.message(editionNote, 'ok');
{
 let raw = null;
 try { raw = JSON.parse(store.get('pips.exercise') || 'null'); } catch { }
 if (raw) await openExercise(raw, null, true);
}
window.addEventListener('hashchange', () => openFragment());
endBoot(brandReady);
