// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { STRINGS, mergeStrings } from './ui/strings.js';
import { el, hex8, hexAddr, download, store, scoped } from './ui/dom.js';
import { Editor } from './ui/editor.js';
import { ListingPanel, FieldsTable, dataTable, symbolTable } from './ui/listing.js';
import { RegistersPanel, MemoryPanel, CountersPanel, ConsolePanel, CallStackPanel, OUTPUT_LIMIT } from './ui/state-panels.js';
import { STOP, capability } from './arch/contract.js';
import { capabilityStates, gate } from './shell/capabilities.js';
import { checkFits } from './shell/data-io.js';
import { createShare, isShareFragment, LINK_LIMIT, normalisePlatform, defaultPlatform } from './shell/share.js';
import { shareSchema, settingValue } from './shell/share-schema.js';
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
const arch = (await ARCHITECTURES[ARCH_ID]()).descriptor;
mergeStrings(arch.strings);
const TOOL = currentTool(ARCH_ID, location.search);
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
const RUN_LIMIT = 10_000_000;
const HISTORY_LIMIT = 1_000_000;
const session = {
 files: [{ name: `main${arch.language.extension}`, text: '' }],
 profile: arch.engine.profiles[0].id,
 subset: null,
 program: null,
 breakpoints: new Set(),
 watchRegs: new Set(),
 watchWords: new Set(),
 dataLoads: [],
 loadReport: { applied: [], dropped: [] },
 platformConfig: defaultPlatform(),
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
 engine = session.runnable ? arch.engine.create(session.program, { platformConfig: session.platformConfig, runLimit: RUN_LIMIT, historyLimit: HISTORY_LIMIT,
 ...(inputs ? { inputs } : {}) }) : null;
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
 return l ? { file: l.file, line: edLine(l.line) } : null;
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
let cc = null;
let cMap = null;
const sourceKey = () => (lang === 'asm' ? 'pips.source' : `pips.source.${lang}`);
const stem = (name) => (XL && name.endsWith(XL.extension) ? name.slice(0, -XL.extension.length) : name);
const consolePanel = new ConsolePanel({ onGoTo: (loc) => { ws.toggleSheet(false); ws.reveal('code'); editor.selectAt(loc.line, loc.column ?? 1, loc.length ?? 0); } });
const editor = new Editor({
 language: arch.language,
 onChange: (text) => { dirty = true; store.set(sourceKey(), text); editorStatus(); saveSoon(); },
 onCursorLine: () => { editorStatus(); saveSoon(); },
 onHoverLine: (line) => linkFromC(line),
 onGutterClick: (line) => toggleBreakLine(line),
});
const fields = arch.language.inspector ? (await arch.language.inspector()).create({ strings: STRINGS }) : new FieldsTable(arch.language, arch.addressSpace.addressBits);
const listing = new ListingPanel({ language: arch.language, addressBits: arch.addressSpace.addressBits,
 onSelect: (l) => {
 selected = l;
 fields.show(l);
 const line = l?.line && !session.program?.imported ? edLine(l.line) : null;
 if (line) editor.scrollToLine(line, true);
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
function toggleBreakLine(line) {
 const p = session.program;
 const l = p && !p.imported ? p.listing.find((x) => edLine(x.line) === line) : null;
 if (!l) { consolePanel.message(STRINGS.tools.noBreakLine); return; }
 toggleBreak(l.address);
}
function showBreakLines() {
 const p = session.program;
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
 input: (x) => giveInput(x), message: (text, kind) => consolePanel.message(text, kind) }) })));
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
function renderAsm(asm) {
 if (!asm) { asmBox.replaceChildren(el('p.note', { text: STRINGS.cc.asmNone })); return; }
 const pre = el('pre.cc-asm', { onmouseover: (e) => {
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
 if (lang !== XID || !cMap) return;
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
const profileSel = el('select', { 'aria-label': STRINGS.profile, onchange: (e) => { session.profile = e.target.value; store.set('pips.profile', session.profile); syncLangControls(); doAssemble(); } },
 arch.engine.profiles.map((p) => el('option', { value: p.id, text: p.label })));
const speedSel = el('select', { 'aria-label': STRINGS.speed },
 el('option', { value: 'max', text: STRINGS.speedMax }), el('option', { value: 'slow', text: STRINGS.speedSlow }));
const runBtn = tool('play', STRINGS.run, () => (running ? pause() : startRun()), { key: 'F5', cls: '.tool-run' });
const runStatus = el('span.run-status', { role: 'status', 'aria-live': 'polite' });
const fileInput = el('input', { type: 'file', accept: '.s,.asm,.S,.c,.hex,.bin,.json', hidden: true, onchange: (e) => { openFile(e.target.files[0]); e.target.value = ''; } });
const assembleBtn = gate(tool('build', TL.build, () => doAssemble(), { key: 'Control+Enter', cls: '.tool-build' }), CAP.assembler);
const C = STRINGS.cc;
const savedOpt = (k, list, d) => { const v = store.get(k); return list.includes(v) ? v : d; };
const langSel = el('select', { 'aria-label': C.language, onchange: (e) => setLang(e.target.value) },
 el('option', { value: 'asm', text: C.languages.asm }), XL ? gate(el('option', { value: XID, text: XL.label }), CAP.cLanguage) : null);
const xlOpts = (XL?.options ?? []).map((o) => {
 const sel = el('select', { 'aria-label': o.label, onchange: (e) => { store.set(`pips.cc.${o.id}`, e.target.value); doAssemble(); } },
 o.values.map((v) => el('option', { value: v.id, text: v.label })));
 sel.value = savedOpt(`pips.cc.${o.id}`, o.values.map((v) => v.id), o.default);
 return { o, sel, label: el('label', { title: o.title ?? null }, `${o.label} `, sel) };
});
if (xlOpts[0]?.o.title) xlOpts[0].sel.title = xlOpts[0].o.title;
const xlValues = () => Object.fromEntries(xlOpts.map((x) => [x.o.id, x.sel.value]));
const ccOpts = el('span.cc-opts', { hidden: true }, xlOpts.map((x) => x.label));
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
 session.platformConfig = { ...defaultPlatform(), stimulus, rx: (t.rx ?? []).map((e) => ({ ...e })), mtimeDiv: t.mtimeDiv ?? 1 };
 await applyShared({ view: t.view, profile: t.profile ?? arch.engine.profiles[0].id, lang: t.lang, name: t.file, source: await r.text(),
 ...Object.fromEntries(SETTINGS.map((v) => [v.settings.key, t[v.settings.key] ?? null])), mem: t.mem ? readConfig(t.mem) : null },
 STRINGS.templates.opened(t.title));
}
function templateItems(ix, make) {
 return Object.entries(ix.groups).flatMap(([g, title]) => {
 const items = ix.templates.filter((t) => t.group === g);
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
function syncMemButton() {
 if (!CAP.memoryModel.enabled) return;
 const tip = `${STRINGS.mem.buttonTitle}: ${memCfg.mode === 'ideal' && memCfg.words === 256 ? STRINGS.mem.describeIdeal : describeMem(memCfg)}`;
 memBtn.title = tip;
 memBtn.setAttribute('aria-label', tip);
 memBtn.classList.toggle('tool-active', memCfg.mode !== 'ideal' || memCfg.words !== 256);
}
const stepBackBtn = gate(tool('stepBack', STRINGS.stepBack, () => stepBack(), { key: 'Shift+F10', iconOnly: true }), CAP.backStep);
const stepBtn = tool('step', STRINGS.step, () => stepOnce(), { key: 'F10', cls: '.tool-step' });
const stepOverBtn = gate(tool('stepOver', STRINGS.stepOver, () => stepOver(), { key: 'F11' }), CAP.stepOver);
const stepOutBtn = gate(tool('stepOut', STRINGS.stepOut, () => stepOut(), { key: 'Shift+F11' }), CAP.stepOver);
const runToCursorBtn = gate(tool('runToCursor', STRINGS.runToCursor, () => runToCursor(), { key: 'Control+F10', iconOnly: true }), CAP.runToCursor);
const resetBtn = tool('reset', STRINGS.reset, doReset, { iconOnly: true });
const speedField = el('label.tool-field', {}, el('span', { text: STRINGS.speed }), speedSel);
const profileField = el('label.tool-field.arch-field', {}, el('span', { text: STRINGS.profile }), profileSel);
const group = (cls, ...items) => el(`div.tb-group${cls}`, {}, items);
const fileMenuBox = fileMenu(
 btn(STRINGS.open, () => fileInput.click()),
 btn(STRINGS.examples.menu, () => examplesDialog.open()),
 gate(btn(STRINGS.exercise.menu, () => exerciseDialog.open()), CAP.exercises),
 btn(STRINGS.save(arch.language.extension), () => download(sourceName(), editor.value)),
 gate(btn(STRINGS.exportHex, () => session.program && download('prog.hex', arch.exports.image(session.program).hex)), CAP.exportImage),
 gate(btn(STRINGS.exportBin, () => session.program && download('prog.bin', arch.exports.image(session.program).bin, 'application/octet-stream')), CAP.exportImage),
 btn(STRINGS.exportListing, () => session.program && download('prog.lst', listingText(session.program))),
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
 group('.tb-step', stepBackBtn, stepBtn, stepOverBtn, stepOutBtn, runToCursorBtn, resetBtn),
 group('.tb-speed', speedField, archCtx, speedFly, archFly),
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
const themeBtn = el('button.tool.tool-icon', { type: 'button', onclick: () => {
 const cur = document.documentElement.dataset.theme ?? '';
 const next = cur === '' ? 'dark' : cur === 'dark' ? 'light' : '';
 if (next) document.documentElement.dataset.theme = next; else delete document.documentElement.dataset.theme;
 store.set('pips.theme', next);
 showTheme();
} });
function showTheme() {
 const cur = document.documentElement.dataset.theme ?? '';
 themeBtn.replaceChildren(icon(cur === 'dark' ? 'moon' : cur === 'light' ? 'sun' : 'themeAuto'), el('span.tool-label', { text: STRINGS.theme }));
 themeBtn.title = TL.themes[cur];
 themeBtn.setAttribute('aria-label', TL.themes[cur]);
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
 el('span.tool-label', { text: STRINGS.keys })), el('p', { text: STRINGS.shortcuts }));
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
const tabs = (items) => {
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
 }
 bar.append(...buttons);
 select(0);
 const selectTitle = (title) => { const i = items.findIndex(([t]) => t === title); if (i >= 0) select(i); return i >= 0; };
 return { root: el('div.tabbed', {}, bar, host), select, selectTitle };
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
 create: () => arch.engine.create(session.program, { platformConfig: session.platformConfig, historyLimit: 1 }) });
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
 for (const { inst } of archPanels) inst.update(state, { accepts, running });
}
function giveInput(x) {
 const v = uv();
 if (v) { if (v.input) { v.input(x); refresh(); } return; }
 if (!session.runnable || !engine?.input) return;
 if (running && workerRun) { workerInputs.push(x); worker.postMessage({ type: 'input', x }); return; }
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
header.replaceChildren(
 el('div.brand', {}, header.querySelector('.app-logo') ?? el('span.app-logo', { 'aria-hidden': 'true' }),
 el('div.brand-text', {}, header.querySelector('.app-title'), el('span.app-subtitle', { text: STRINGS.appFull }))),
 focusCrumb,
 viewTabs,
 el('div.header-tools', {}, viewMenu, dockMenu, themeBtn, projBtn, fullBtn, keysBox, helpBtn),
 exitBtn,
 headerMore.menu);
showTheme();
for (const [cmd, node] of Object.entries({ assemble: assembleBtn, run: runBtn, stepBack: stepBackBtn, step: stepBtn, stepOver: stepOverBtn,
 stepOut: stepOutBtn, runToCursor: runToCursorBtn, reset: resetBtn, speed: speedSel, memory: memBtn, templates: templatesMenu, exercise: exerciseBtn,
 file: fileMenuBox, profile: profileSel, subset: subsetSel, views: viewTabs, layout: viewMenu, theme: themeBtn, projector: projBtn,
 fullScreen: fullBtn, keys: keysBox, help: helpBtn, moreHeader: headerMore.menu, moreToolbar: toolbarMore.menu,
 dock: dockMenu, speedMenu: speedFly, profileMenu: archFly, viewExit: exitBtn })) node.dataset.cmd = cmd;
headerFit = overflowBar({ bar: header, more: headerMore.menu, sections: headerMore.bodies, steps: [
 { cls: 'hb-tight' }, { cls: 'hb-views-active' },
 { node: projBtn, group: 'workspace' }, { node: dockMenu, group: 'workspace' }, { node: keysBox, group: 'application' }, { node: fullBtn, group: 'application' },
 { node: viewMenu, group: 'workspace' }, { node: themeBtn, group: 'application' }, { cls: 'hb-views-icons' },
 { node: viewTabs, group: 'views' }, { node: helpBtn, group: 'application' },
 { cls: 'hb-mini' }] });
toolbarFit = overflowBar({ bar: toolbar, more: toolbarMore.menu, sections: toolbarMore.bodies, steps: [
 { cls: 'tb-compact' },
 { node: runToCursorBtn, group: 'simulation' }, { node: memBtn, group: 'program' }, { node: templatesMenu, group: 'program' },
 { node: archCtx, group: 'processor' }, { node: speedField, group: 'simulation' },
 { node: exerciseBtn, group: 'program' }, { node: fileMenuBox, group: 'program' },
 { node: resetBtn, group: 'simulation' }, { node: stepOutBtn, group: 'simulation' }, { node: stepOverBtn, group: 'simulation' },
 { node: stepBackBtn, group: 'simulation' },
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
 const switcher = archSwitcher({ logo: full, targets: switchTargets(TOOL?.id ?? ARCH_ID, where), home: homeUrl(where), current: TOOL?.name ?? STRINGS.appFull,
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
const viewForProfile = (profile) => VIEWS.find((v) => !isCmp(v.id) && (v.profile ?? arch.engine.profiles[0].id) === profile)?.id ?? VIEWS[0].id;
const examplesDialog = new ExamplesDialog({ index: contentUrl('examples'), templates: () => loadTemplates(), onTemplate: (t) => openTemplate(t), templateItems, onOpen: async (x, text) => {
 let source = text;
 if (x.gcc) { const imps = await arch.language.importers(); source = (imps.find((i) => i.test(text)) ?? imps[0]).convert(text, x.file).text; }
 await applyShared({ view: viewForProfile(x.profile), profile: x.profile === arch.engine.profiles[0].id ? x.profile : isaProfile,
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
const scratchIn = el('input.mono.scratch-in', { type: 'text', spellcheck: false, autocomplete: 'off', 'aria-label': STRINGS.scratch.label,
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
 up.replaceChildren(icon(aboveFolded ? 'chevronDown' : 'chevronUp'));
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
const memTabs = tabs([[STRINGS.mem.tabMemory, memory.root], [STRINGS.mem.tabCache, cacheView.root, () => updateMemPanels(), CAP.cache],
 [STRINGS.mem.tabPeripherals, periph.root, () => updateMemPanels(), CAP.devices],
 ...archPanels.map(({ p, inst }) => [p.label, inst.root, () => updateArchPanels()])]);
const MEM_PANE = CAP.cache.enabled ? { panel: STRINGS.mem.panel, link: STRINGS.mem.link, bar: STRINGS.layout.dockBarDp }
 : { panel: STRINGS.mem.panelPlain, link: STRINGS.mem.linkPlain, bar: STRINGS.layout.dockBarDpPlain };
const pMemory = panel(MEM_PANE.panel, memTabs.root, '.p-memory', 'memory');
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
const fileName = el('span.ed-tab-name');
const dirtyMark = el('span.ed-dirty', { text: '●', title: TL.modified, hidden: true });
const edPos = el('span.ed-pos');
const edState = el('span.ed-state');
const edProfile = el('span.ed-prof');
const pEditor = el('section.panel.p-editor', { 'aria-label': STRINGS.editor },
 el('h2.ed-head', {}, el('span.ed-tab', {}, icon('file', { size: 14 }), fileName, dirtyMark), el('span.panel-title.ed-title', { text: STRINGS.editor }),
 el('span.panel-head-tools', {}, el('label', {}, el('span.ed-lang-label', { text: `${C.language} ` }), langSel), ccOpts)),
 el('div.col', {}, editor.root),
 el('div.ed-status', { title: STRINGS.storageNote }, edPos, edProfile, edState));
const viewParts = {};
function editorStatus() {
 const a = editor.area;
 const before = a.value.slice(0, a.selectionStart);
 const line = before.split('\n').length;
 const col = a.selectionStart - before.lastIndexOf('\n');
 edPos.textContent = TL.status(line, col, a.value.split('\n').length);
 edProfile.textContent = profileOf(session.profile)?.label ?? session.profile;
 edState.textContent = dirty ? TL.modified : TL.saved;
 edState.classList.toggle('ed-modified', dirty);
 dirtyMark.hidden = !dirty;
 fileName.textContent = sourceName();
}
const midSplit = new Split('column', 'mid');
const rightSplit = new Split('column', 'right');
const workSplit = new Split('row', 'work');
const dockSplit = new Split('row', 'dock');
const rootSplit = new Split('column', 'root');
const dockBarText = el('span', { text: STRINGS.layout.dockBar });
const dockBar = el('div.dock-bar', { onclick: () => rootSplit.setCollapsed('dock', false) }, icon('chevronUp', { size: 14 }), dockBarText);
const dock = el('div.dock', {}, dockBar, dockSplit.root);
const workspace = el('div.workspace', {}, rootSplit.root);
const syncMidControls = [paneControls(pInfo, STRINGS.view.info), paneControls(pFields, STRINGS.layout.panes.inspector)];
midSplit.onApply = () => syncMidControls.forEach((f) => f());
const P = STRINGS.layout.panes;
function configureLayout() {
 const dp = isDp();
 const cmp = isCmp();
 const pj = projector;
 const k = pj ? `${mode}.proj` : mode;
 workspace.classList.toggle('projector', pj);
 workspace.classList.remove('mid-max');
 pInfo.classList.remove('max-pane'); pFields.classList.remove('max-pane');
 midSplit.configure(dp ? [{ node: pDatapath, id: 'datapath', min: 220, size: pj ? 0.74 : 0.64 },
 { node: pInfo, id: 'info', min: 90, size: pj ? 0.26 : 0.36, collapsible: true, collapsed: pj, title: P.info }]
 : cmp ? [{ node: pCompare, id: 'compare', min: 120, size: 1 }]
 : [{ node: pListing, id: 'listing', min: 120, size: 0.6 },
 { node: pFields, id: 'inspector', min: 90, size: 0.4, collapsible: true, collapsed: pj, title: P.inspector }],
 `mid.${k}`);
 rightSplit.configure(dp ? [{ node: pRegs, id: 'registers', min: 140, size: 0.5 },
 { node: pCounters, id: 'counters', min: 70, size: 0.26, collapsible: true, collapsed: pj, title: P.counters },
 { node: pConsole, id: 'console', min: 80, size: 0.24, collapsible: true, collapsed: pj, title: STRINGS.console }]
 : [{ node: pRegs, id: 'registers', min: 140, size: 0.56 },
 { node: pCalls, id: 'calls', min: 64, size: 0.14, collapsible: true, collapsed: pj, title: P.calls },
 { node: pCounters, id: 'counters', min: 70, size: 0.3, collapsible: true, collapsed: pj, title: P.counters }],
 `right.${k}`);
 workSplit.configure([{ node: pEditor, id: 'editor', min: 220, size: dp ? 0.22 : 0.3, collapsible: true, title: P.editor },
 { node: midSplit.root, id: 'mid', min: dp ? 360 : 300, size: dp ? 0.56 : 0.44 },
 { node: rightSplit.root, id: 'right', min: 230, size: dp ? 0.22 : 0.26, foldable: true, title: P.right }], `work.${k}`);
 dockSplit.configure(dp ? [{ node: pMemory, id: 'memory', min: 220, size: 1 }]
 : [{ node: pMemory, id: 'memory', min: 220, size: 0.58, collapsible: true, title: MEM_PANE.panel },
 { node: pConsole, id: 'console', min: 200, size: 0.42, collapsible: true, title: STRINGS.console }], `dock.${k}`);
 dockBarText.textContent = dp ? MEM_PANE.bar : STRINGS.layout.dockBar;
 rootSplit.configure([{ node: workSplit.root, id: 'work', min: 200, size: dp ? 0.6 : 0.7 },
 { node: dock, id: 'dock', min: 90, size: dp ? 0.4 : 0.3, collapsible: true, collapsed: pj || dp, title: dp ? MEM_PANE.panel : P.dock, header: dockBar }], `root.${k}`);
 ws?.afterLayout();
}
function fillViewMenu(list) {
 const dp = isDp();
 const panes = [[workSplit, 'editor', P.editor],
 ...(dp ? [[midSplit, 'info', P.info], [rightSplit, 'counters', P.counters], [rightSplit, 'console', STRINGS.console], [rootSplit, 'dock', MEM_PANE.panel]]
 : [...(isCmp() ? [] : [[midSplit, 'inspector', P.inspector]]), [rightSplit, 'calls', P.calls], [rightSplit, 'counters', P.counters], [rootSplit, 'dock', P.dock]])];
 const now = viewModes.state.mode;
 const modeIcon = { normal: 'normalView', focus: 'focusView', fullscreen: 'fullscreen' };
 const modeItems = MODES.map((m) => {
 const off = m === 'fullscreen' && !viewModes.supported;
 return el('label.menu-check.vm-opt', { title: off ? VM.unavailable : m === 'focus' ? `${VM.focus} (${VM.focusKey})` : null },
 el('input', { type: 'radio', name: 'view-mode', value: m, checked: m === now, disabled: off, 'data-mode': m,
 onchange: () => {
 viewMenu.open = false;
 viewModes.set(m).then(() => viewMenu.querySelector('summary').focus({ preventScroll: true }));
 } }), icon(modeIcon[m], { size: 16 }), el('span', { text: VM[m] }));
 });
 list.replaceChildren(
 el('p.menu-head', { text: VM.group, 'aria-hidden': 'true' }),
 el('div.vm-group', { role: 'radiogroup', 'aria-label': VM.group }, modeItems),
 el('hr.menu-sep'),
 el('label.menu-check', { title: STRINGS.projectorTitle }, el('input', { type: 'checkbox', checked: projector,
 onchange: (e) => setProjector(e.target.checked) }), ` ${STRINGS.projector}`),
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
 waves[id] = new WaveformPanel({ id, signals: v.exportModel().signals, defaults: v.waveform.defaults, format: v.waveform.format ?? null, onGoTo: (k) => goToCycle(k) });
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
 doAssemble();
}
let cName = `main${XL?.extension ?? ''}`;
const sourceName = () => (lang === XID ? cName : session.files[0].name.replace(/\.\w+$/, '') + arch.language.extension);
function syncLangControls() {
 langSel.value = lang;
 ccOpts.hidden = lang !== XID;
 for (const x of xlOpts) x.label.hidden = Boolean(x.o.profiles) && !x.o.profiles.includes(session.profile);
 setToolLabel(assembleBtn, 'build', lang === XID ? TL.buildC : TL.build, 'Control+Enter');
 refit();
 editor.setLanguage(lang);
 editorStatus();
}
async function setLang(next) {
 if (next === lang) return;
 if (next === XID && !(await loadExtra())) { langSel.value = lang; return; }
 store.set(sourceKey(), editor.value);
 lang = next;
 store.set('pips.lang', lang);
 editor.value = store.get(sourceKey()) ?? (lang === XID ? XL.example : EXAMPLE);
 if (lang !== XID) { cMap = null; renderAsm(null); editor.setLinked([]); }
 syncLangControls();
 doAssemble();
}
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
 const r = cc.compile(editor.value, { name: cName, profile: session.profile, subset: session.subset, options: xlValues() });
 if (!r.ok) {
 cMap = null;
 renderAsm(null);
 editor.setErrors(r.diagnostics);
 for (const e of r.diagnostics) consolePanel.message(e.message, 'error', { line: e.line, column: e.column }, e.note ?? null);
 consolePanel.message(C.errors, 'error');
 return false;
 }
 cMap = r.lines;
 session.files = [{ name: stem(cName) + arch.language.extension, text: r.text }];
 renderAsm(r.text);
 return true;
}
function assembleSession() {
 const p = arch.language.assemble(session.files, { profile: session.profile, subset: session.subset ?? undefined, data: session.dataLoads });
 session.program = p;
 session.loadReport = p.loadReport ?? { applied: [], dropped: [] };
 resetEngine();
 return p;
}
function doAssemble() {
 cancelRun();
 if (lang === XID) { doCompile(); return; }
 session.files = [{ name: session.files[0].name, text: editor.value }];
 const p = assembleSession();
 dirty = false;
 consolePanel.clearMessages();
 editor.setErrors(p.diagnostics);
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
 editor.setErrors(p.diagnostics.map((e) => ({ line: at(e), column: 1, message: C.asmError(e.line, e.message) })));
 for (const e of p.diagnostics) consolePanel.message(C.asmError(e.line, e.message), 'error', { line: at(e) }, XL.asmNote?.(e) ?? null);
 if (p.ok) consolePanel.message(C.compiled(cMap.length, p.listing.length), 'ok');
 } else {
 session.files = [{ name: stem(cName) + arch.language.extension, text: '' }];
 p = assembleSession();
 p.ok = false;
 resetEngine();
 }
 afterAssemble(p);
}
function afterAssemble(p) {
 const lr = session.loadReport;
 if (lr.applied.length) consolePanel.message(STRINGS.dataIo.assembledLoads(lr.applied.map((a) => `${a.label} (${a.n} bytes)`).join(', ')));
 for (const d of lr.dropped) consolePanel.message(STRINGS.dataIo.droppedLoad(d.label, d.why), 'warn');
 consolePanel.msgs.scrollTop = 0;
 if (p.segments[1]) memory.base = p.segments[1].address;
 if (uv() || isCmp()) inst[mode].load(session.runnable ? p : null);
 refresh(true);
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
 const l = session.program.listing.find((x) => (lang === XID ? edLine(x.line) === line : x.line === line && x.part === 0));
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
 setToolLabel(runBtn, on ? 'pause' : 'play', on ? STRINGS.pause : STRINGS.run, 'F5');
 runBtn.setAttribute('aria-pressed', String(on));
 runStatus.textContent = on ? STRINGS.runningStatus(engine?.state().retired ?? 0) : '';
 if (on) lastStop = null;
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
function startRun(opts = {}) {
 if (running || !ensureRunnable()) return;
 runId += 1;
 runOpts = opts;
 setRunning(true);
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
 runStatus.textContent = STRINGS.runningStatus(m.retired);
 } else if (m.type === 'done') {
 engine.restore(m.snapshot);
 for (const x of workerInputs.splice(0).slice(m.applied ?? 0)) engine.input?.(x);
 finishRun(m.stop);
 }
}
function pause() {
 if (!running) return;
 if (!uv() && speedSel.value !== 'slow' && worker) { worker.postMessage({ type: 'pause' }); return; }
 runId += 1;
 finishRun(STOP.PAUSE);
}
function cancelRun() {
 if (!running) return;
 runId += 1;
 if (worker) {
 worker.terminate();
 worker = undefined;
 }
 workerRun = false;
 workerInputs = [];
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
function refresh(programChanged = false) {
 saveSoon();
 const p = session.program;
 if (programChanged) {
 listing.setProgram(p, session.breakpoints);
 dataBox.replaceChildren(dataTable(p, arch.addressSpace));
 symBox.replaceChildren(symbolTable(p, (s) => { memory.goTo(s.name); const ln = edLine(s.line); if (ln) editor.goToLine(ln); }, arch.addressSpace.addressBits));
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
 const line = p?.listing.find((l) => l.address === s?.pc)?.line ?? null;
 editor.setCurrentLine(s && !s.halted && !p?.imported && line ? edLine(line) : null);
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
 const line = s ? p?.listing.find((l) => l.address === at)?.line ?? null : null;
 editor.setCurrentLine(s && !s.halted && !p?.imported && line ? edLine(line) : null);
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
 consolePanel.setOutput([]);
 if (drawingHidden()) drawingStale = true;
 else { drawingStale = false; v.render(); refreshWave(); }
 updateWsStatus();
}
function listingText(p) {
 return p.listing.map((l) => `${l.address.toString(16).padStart(8, '0')}  ${l.word.toString(16).padStart(8, '0')}  `
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
 source: editor.value, cc: xlValues(), ...Object.fromEntries(SETTINGS.map((v) => [v.settings.key, viewSettings(v)])),
 ...(memCfg.mode !== 'ideal' || memCfg.words !== 256 || memCfg.devices ? { mem: memCfg } : {}),
 ...(hasTraps(session.profile) || hasTraps(isaProfile) || memCfg.devices ? { platform: session.platformConfig } : {}) };
}
async function copyShareLink() {
 const S = STRINGS.share;
 const frag = await encodeFragment(shareState());
 if (frag.length > LINK_LIMIT) { consolePanel.message(S.tooLong(frag.length, LINK_LIMIT), 'warn'); return; }
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
 cancelRun();
 store.set('pips.source.before', JSON.stringify({ lang, text: editor.value }));
 for (const x of xlOpts) { const v = st.cc?.[x.o.id]; if (v) { x.sel.value = v; store.set(`pips.cc.${x.o.id}`, v); } }
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
 if (st.lang === XID && !(await loadExtra())) return;
 lang = st.lang;
 store.set('pips.lang', lang);
 if (lang === XID) cName = st.name?.endsWith(XL.extension) ? st.name : `main${XL.extension}`;
 else { session.files = [{ name: st.name && !(XL && st.name.endsWith(XL.extension)) ? st.name : `main${arch.language.extension}`, text: st.source }]; cMap = null; renderAsm(null); }
 editor.value = st.source;
 store.set(sourceKey(), st.source);
 syncLangControls();
 if (st.view === mode) {
 if (mode === VIEWS[0].id) { session.profile = st.profile; profileSel.value = st.profile; }
 else if (viewOf(mode).subsets) session.subset = noSubset(subsetSel.value) ? null : subsetSel.value;
 doAssemble();
 } else await setMode(st.view);
 consolePanel.message(message, 'ok', null, STRINGS.share.keptNote);
}
async function openFragment() {
 if (!isShareFragment(location.hash)) return;
 const frag = location.hash;
 history.replaceState(null, '', `${location.pathname}${location.search}`);
 try {
 const st = await decodeFragment(frag);
 await applyShared(st, STRINGS.share.opened(viewName(st.view)));
 } catch (e) {
 consolePanel.message(STRINGS.share.refused(e.message), 'error', null, refusedNote(e));
 }
}
const viewName = (v) => viewOf(v)?.label;
const refusedNote = (e) => (e.code === 'version' ? STRINGS.share.refusedVersion : e.code === 'arch' ? STRINGS.share.refusedArch(e.data.arch) : null);
function restoreBefore() {
 let b = null;
 try { b = JSON.parse(store.get('pips.source.before') ?? 'null'); } catch { }
 if (!b || typeof b.text !== 'string') { consolePanel.message(STRINGS.share.nothingToRestore); return; }
 (async () => {
 if (b.lang !== lang) await setLang(b.lang === XID ? XID : 'asm');
 editor.value = b.text;
 store.set(sourceKey(), b.text);
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
 const c = cc.compile(editor.value, { name: cName, profile: arch.engine.profiles[0].id, options: xlValues() });
 if (!c.ok) { consolePanel.message(STRINGS.cc.errors, 'error'); return null; }
 text = c.text;
 }
 const p = arch.language.assemble([{ name: lang === XID ? stem(cName) + arch.language.extension : session.files[0].name, text }], { profile: exercise.profile ?? arch.engine.profiles[0].id });
 if (!(p.assembled ?? p.ok)) { consolePanel.message(STRINGS.asmErrors(errorCount(p)), 'error'); return null; }
 return arch.exercises.run(p, exercise);
}
const exerciseDialog = new ExerciseDialog({
 onRun: () => runExerciseTests(),
 onStarter: async (source, l) => {
 exerciseDialog.root.close();
 await applyShared({ view: mode, profile: exercise?.profile ?? arch.engine.profiles[0].id, lang: l, name: `exercise${l === XID ? XL.extension : arch.language.extension}`, source }, STRINGS.exercise.starterLoaded);
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
 const kind = low.endsWith('.hex') ? 'hex' : low.endsWith('.bin') ? 'bin' : XL && low.endsWith(XL.extension) ? XID : 's';
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
 const first = arch.engine.profiles[0].id;
 if (gccReport && mode === VIEWS[0].id && session.profile !== first) { session.profile = first; isaProfile = first; profileSel.value = first; store.set('pips.profile', first); }
 doAssemble();
 if (gccReport) reportImport(file.name, gccReport.report);
 return;
 }
 if (!can('imageImport')) return;
 try {
 session.program = arch.language.loadImage(kind === 'hex' ? await file.text() : new Uint8Array(await file.arrayBuffer()), kind, file.name, { profile: session.profile });
 } catch (e) { consolePanel.message(`${file.name}: ${e.message}`, 'error'); return; }
 cancelRun();
 resetEngine();
 consolePanel.clearMessages();
 consolePanel.message(STRINGS.importedImage(session.program.listing.length), 'ok', null, STRINGS.importedNote);
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
const programKey = () => textHash(`${lang}|${session.profile}|${subsetSel.value}|${Object.values(xlValues()).join('|')}|${editor.value}`);
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
 v: 1, key: programKey(), name: lang === XID ? cName : session.files[0].name,
 cursor: [a.selectionStart, a.selectionEnd], scroll: [a.scrollTop, a.scrollLeft],
 breakpoints: [...session.breakpoints], watchRegs: [...session.watchRegs], watchWords: [...session.watchWords],
 run: { mode, steps: uv() ? uv().state()?.cycle ?? 0 : engine?.state().steps ?? 0,
 ...(!uv() && engine?.inputs?.().length ? { inputs: engine.inputs() } : {}) },
 platform: session.platformConfig,
 };
 const loads = session.dataLoads.map((l) => ({ label: l.label, name: l.name, b64: toB64(l.bytes) }));
 try {
 localStorage.setItem(scoped(WS_KEY), JSON.stringify({ ...st, dataLoads: loads }));
 } catch {
 try { localStorage.setItem(scoped(WS_KEY), JSON.stringify({ ...st, dataLoads: [], loadsDropped: loads.length })); } catch { }
 }
}
const saveSoon = () => { if (!restoring) { clearTimeout(wsTimer); wsTimer = setTimeout(saveWorkspace, 400); } };
window.addEventListener('pagehide', saveWorkspace);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveWorkspace(); });
function keptWorkspace() {
 try { const st = JSON.parse(store.get(WS_KEY) ?? 'null'); return st?.v === 1 ? st : null; } catch { return null; }
}
function restoreEditorState(st) {
 if (!st) return;
 if (st.platform) session.platformConfig = normalisePlatform(st.platform);
 if (st.name) { if (lang === XID) cName = st.name; else session.files[0].name = st.name; }
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
 } else if (uv()) {
 const v = uv();
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
document.addEventListener('keydown', (e) => {
 const k = e.key;
 if (k === 'F5') { e.preventDefault(); running ? pause() : startRun(); }
 else if (k === 'F10' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runToCursor(); }
 else if (k === 'F10') { e.preventDefault(); e.shiftKey ? stepBack() : stepOnce(); }
 else if (k === 'F11') { e.preventDefault(); e.shiftKey ? stepOut() : stepOver(); }
 else if (k === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doAssemble(); }
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
if (theme) document.documentElement.dataset.theme = theme;
const savedProfile = store.get('pips.profile');
if (savedProfile && profileOf(savedProfile)) session.profile = savedProfile;
if (TOOL?.profile && profileOf(TOOL.profile)) session.profile = TOOL.profile;
profileSel.value = session.profile;
if (XL && store.get('pips.lang') === XID && (await loadExtra())) lang = XID;
editor.value = store.get(sourceKey()) ?? (lang === XID ? XL.example : EXAMPLE);
const kept = isShareFragment(location.hash) ? null : keptWorkspace();
restoreEditorState(kept);
editor.area.addEventListener('scroll', () => saveSoon());
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
{
 let raw = null;
 try { raw = JSON.parse(store.get('pips.exercise') || 'null'); } catch { }
 if (raw) await openExercise(raw, null, true);
}
window.addEventListener('hashchange', () => openFragment());
endBoot(brandReady);
