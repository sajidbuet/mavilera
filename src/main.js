// main.js -- entry point of the ISA view (milestone M1): builds the panels,
// connects them to a Session, and provides the execution controls and
// shortcuts (WS-F-090/091, WS-U-030), file open/save/export/import
// (WS-F-025, WS-F-026, WS-F-120) and the work-in-progress store (WS-F-121).
// Runs are executed on the main thread in time slices of at most ~12 ms, so
// the page stays responsive and every step stays in the back-step history.
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
import { PLATFORM_ARCHS, switchTargets, homeUrl } from './shell/platform-archs.js';
import { endBoot } from './ui/boot.js';

// The architecture this application runs (contract W-D29; one per build from phase 6, until then `?arch=<id>`). The
// shell reads it through its descriptor only.
const arch = (await ARCHITECTURES[ARCH_ID]()).descriptor;
mergeStrings(arch.strings); // the architecture's interface text over the shell's (phase 4)
// share links and settings files of this architecture (WS-F-122; what they may hold comes from the descriptor)
const { encodeFragment, decodeFragment, settingsFile, readSettingsFile } = createShare(shareSchema(arch));
const EXAMPLE = arch.language.defaultSource;
/** A content file of the architecture (contract: content, URLs relative to the application), or null without one. */
const contentUrl = (key) => (arch.content?.[key] ? new URL(arch.content[key], new URL('..', import.meta.url)) : null);
/** The register ids in table order; a RISC-V register number is its index here (until the views give state by id). */
const REG_IDS = arch.registers.groups.flatMap((g) => g.registers.map((r) => r.id));
/** Register widths by id, and an address with the architecture's digits (32 bits: as hex8), for messages. */
const REG_WIDTH = Object.fromEntries(arch.registers.groups.flatMap((g) => g.registers.map((r) => [r.id, r.width])));
const hexA = (a) => hexAddr(a, arch.addressSpace.addressBits);
const regsById = (x) => Object.fromEntries(REG_IDS.map((id, i) => [id, x[i]]));
/** A profile of the architecture (contract v2: every profile of the profile menu). */
const profileOf = (id) => arch.engine.profiles.find((p) => p.id === id) ?? null;
// What the shell offers (W-D29): an item whose capability is off stays visible, disabled, with the reason. A profile's
// overrides (RISC-V: traps, worker) are read where they apply.
const CAP = capabilityStates(arch, STRINGS);
/** Whether a capability is on; if not, its reason goes to the console (a shortcut or a click on a disabled item's place). */
const can = (k) => CAP[k].enabled || (consolePanel.message(CAP[k].text, 'warn'), false);

const RUN_LIMIT = 10_000_000; // steps in one run (WS-F-090)
const HISTORY_LIMIT = 1_000_000; // steps kept for step back
// The shell's state: the sources, the program and its settings, the breakpoints and watches (registers by id,
// W-D29 decision 3), the data loads (WS-F-145) and the platform script (W-D26). The program runs on the
// architecture's engine (contract), one per loaded program.
const session = {
  files: [{ name: `main${arch.language.extension}`, text: '' }],
  profile: arch.engine.profiles[0].id,
  subset: null, // an option of the profile (spec §6)
  program: null,
  breakpoints: new Set(),
  watchRegs: new Set(),
  watchWords: new Set(),
  dataLoads: [],
  loadReport: { applied: [], dropped: [] },
  platformConfig: defaultPlatform(),
  get runnable() { return Boolean(this.program?.ok); },
  /** Keep `bytes` for the data array `label` (replacing an earlier load of it); assemble again to apply. */
  loadData(label, bytes, name) {
    checkFits(this.program, label, bytes);
    this.dataLoads = [...this.dataLoads.filter((l) => l.label !== label), { label, bytes, name }];
  },
  clearData() { this.dataLoads = []; },
};
let engine = null; // the engine of the loaded program, or null
let enginePort = null; // its memory as the panels read it

/**
 * A fresh engine for the session's program: after assembling, on reset, with a new platform script; `inputs`, an
 * input log to replay (contract v8: a reload).
 */
function resetEngine(inputs = null) {
  engine = session.runnable ? arch.engine.create(session.program, { platformConfig: session.platformConfig, runLimit: RUN_LIMIT, historyLimit: HISTORY_LIMIT,
    ...(inputs ? { inputs } : {}) }) : null;
  enginePort = engine ? memoryPort(engine) : null;
  lastStop = null;
  diag.reset();
}

/** The engine's memory as {read(address, size)}, read without side effects (Engine.peek). */
function memoryPort(e) {
  const little = arch.addressSpace.endianness === 'little';
  return { read: (a, size) => {
    const b = e.peek(a >>> 0, size);
    let v = 0;
    for (let i = 0; i < size; i++) v = v * 256 + b[little ? size - 1 - i : i];
    return v >>> 0;
  } };
}

/** The source location of an address, for a console message, or null. */
function srcLoc(pc) {
  const l = session.program?.listing.find((x) => x.address === pc);
  return l ? { file: l.file, line: edLine(l.line) } : null;
}

/**
 * The engine's warnings shown so far (contract v2 diagnostics): an entry with `at` is shown once, by step count;
 * a kind without is counted, and a step back takes the count as shown.
 */
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
  /** Taken as shown: after a step back, and after a replay. */
  skip() {
    Object.assign(this.seen, this.counts());
    for (const d of engine?.diagnostics?.() ?? []) if (d.at !== undefined) this.at[d.kind] = Math.max(this.at[d.kind] ?? 0, d.at);
  },
};
let running = false;
let lastStop = null; // how the last run ended: {stop, pc}, for the narrow screen's status
let selected = null;
let dirty = false;
// The language of the editor (spec §10.1): 'asm', or the architecture's other language (contract v5
// Language.extraLanguages; RISC-V: C), compiled to the assembly the session runs.
let lang = 'asm';
const XL = arch.language.extraLanguages?.[0] ?? null;
const XID = XL?.id ?? null;
let cc = null; // XL's compiler, loaded with its first use (XL.load, WS-N-011)
let cMap = null; // source line of each line of the generated assembly (WS-F-082), or null
const sourceKey = () => (lang === 'asm' ? 'pips.source' : `pips.source.${lang}`);
/** A file name without the extra language's extension. */
const stem = (name) => (XL && name.endsWith(XL.extension) ? name.slice(0, -XL.extension.length) : name);

// --- panels -----------------------------------------------------------------------------
const consolePanel = new ConsolePanel({ onGoTo: (loc) => { ws.toggleSheet(false); ws.reveal('code'); editor.selectAt(loc.line, loc.column ?? 1, loc.length ?? 0); } }); // narrow screen: the source line is in the Code workspace
const editor = new Editor({
  language: arch.language,
  onChange: (text) => { dirty = true; store.set(sourceKey(), text); editorStatus(); saveSoon(); },
  onCursorLine: () => { editorStatus(); saveSoon(); },
  onHoverLine: (line) => linkFromC(line),
  onGutterClick: (line) => toggleBreakLine(line),
});
// the instruction inspector: the architecture's own (contract v2), or the plain fields table
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

/** The editor's breakpoint gutter: a click on a line number sets or clears a breakpoint at its first instruction. */
function toggleBreakLine(line) {
  const p = session.program;
  const l = p && !p.imported ? p.listing.find((x) => edLine(x.line) === line) : null;
  if (!l) { consolePanel.message(STRINGS.tools.noBreakLine); return; }
  toggleBreak(l.address);
}

/** Mark in the editor's gutter the lines that hold a breakpoint. */
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
/** Watched registers are kept by id (W-D29 decision 3). */
function watchReg(id, on) {
  if (on && !can('watchpoints')) return;
  if (on) session.watchRegs.add(id); else session.watchRegs.delete(id);
}
/** Whether a step wrote a watched register or word (a single step stops as a run would). */
function watchHit(rec) {
  const word = (a) => session.watchWords.has(memory.wordOf(a));
  return rec.registers.some((w) => session.watchRegs.has(w.id)) || rec.memory.some((m) => word(m.address) || word(m.address + m.size - 1));
}
/** One instruction of the engine, as the stop reason of a run. */
function stepEngine() {
  const rec = engine.step();
  if (!rec) return engine.state().error ? STOP.ERROR : STOP.HALT;
  if (rec.halt) return STOP.HALT;
  return watchHit(rec) ? STOP.WATCH : STOP.NONE;
}
/** The run options the engine takes (contract v2): breakpoints and watches with the run's own. */
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
// the memory model (M7, D7, D8): ideal, main memory with waits, or caches; kept in the browser, applied to the
// processor views and the comparison; an invalid saved setting is not used
let memCfg = readConfig(store.get(CONFIG_KEY));
const memProblems = validateConfig(memCfg);
if (memProblems.length) { memCfg = readConfig(null); consolePanel.message(STRINGS.mem.invalidSaved, 'warn'); }
const cacheView = new CacheView({ resolve: (t) => memory.resolve(t) });
// the platform board (WS-F-111), on the profile iss-priv and, when the Memory setting asks for it, in the processor views:
// its pin events and received bytes join the session's script, so that a reset or a step back replays them
const insertEvent = (list, ev) => { let i = list.length; while (i > 0 && list[i - 1].cycle > ev.cycle) i--; list.splice(i, 0, { ...ev }); };
/** What the board shows and changes now: {platform, privileged, cycle, memsys, config} for the engine (contract v5 Engine.platform) or the datapath model in use, or null. */
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
/** The other views' platforms get the event too, so that they replay it when they are entered. */
function otherPlatforms(except) {
  return Object.values(memsysOf).map((ms) => ms?.platform).filter((p) => p && p !== except);
}
// the board and the Peripherals tab exist only with capability devices (their text is the architecture's)
const platformView = !CAP.devices.enabled ? null : new PlatformView({
  onPin: (mask, value) => {
    const c = platformCtx();
    if (!c) return;
    c.memsys?.detach(); // a pin set from the interface is part of no step
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
    applyMemory(memCfg); // new platforms from the setting, and the program restarts
  },
  onSettings: (change) => {
    session.platformConfig = normalisePlatform({ ...session.platformConfig, ...change });
    applyMemory(memCfg);
  },
});
const periph = platformView ? new PeripheralsView(platformView) : { root: el('div'), update: () => {} }; // the disabled tab's pane
// the architecture's own panels (contract v8; SAP-2: the ports), tabs of the memory pane after the shell's; their
// inputs go to the engine, the Worker or the view in use (giveInput)
const archPanels = await Promise.all((arch.panels ?? []).map(async (p) => ({ p, inst: (await p.load()).create({ strings: STRINGS,
  input: (x) => giveInput(x), message: (text, kind) => consolePanel.message(text, kind) }) })));
const memSettings = new MemSettings({ get: () => memCfg, onApply: (cfg) => applyMemory(cfg) });
const counters = new CountersPanel();
// the call stack (WS-F-103): a frame shows its call site in the listing and the editor
const calls = new CallStackPanel({ onGoTo: (addr) => { if (session.program && !session.program.imported) { ws.reveal('listing'); listing.select(addr); } },
  unavailable: CAP.callStack.enabled ? null : CAP.callStack.text, addressBits: arch.addressSpace.addressBits });
const dataBox = el('div.scroll');
const symBox = el('div.scroll');
const asmBox = el('div.scroll'); // the assembly generated from C (WS-F-082)

/** The editor line of a line of the assembly the session runs: itself, or its C line. */
function edLine(asmLine) {
  if (lang !== XID) return asmLine;
  return cMap?.[asmLine - 1] || null;
}

/** Show the generated assembly; each line knows its C line, and pointing at it marks that line in the editor. */
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

/** Mark the assembly lines of C line `line` (null: none). */
function linkAsm(line) {
  let first = null;
  for (const s of asmBox.querySelectorAll('.cc-line')) {
    const on = line !== null && cMap?.[Number(s.dataset.k)] === line;
    s.classList.toggle('cc-link', on);
    if (on && !first) first = s;
  }
  return first;
}

/** The pointer is over C line `line` in the editor: mark its assembly lines (WS-F-082). */
function linkFromC(line) {
  if (lang !== XID || !cMap) return;
  const first = linkAsm(line);
  if (first) {
    const box = asmBox;
    const top = first.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 20) box.scrollTop = Math.max(0, top - box.clientHeight / 3);
  }
}

// --- toolbar (WS-F-090, WS-F-091, WS-U-030) ----------------------------------------------------
const TL = STRINGS.tools;
const keyText = (k) => k.replace(/Control/g, 'Ctrl');
const btn = (label, action, key) => el('button', { type: 'button', onclick: action, 'aria-keyshortcuts': key ?? null,
  title: key ? `${label} (${keyText(key)})` : label, text: label });
/**
 * A toolbar control: an icon, the action's name as label (shown beside the icon, or for
 * `iconOnly` only on touch screens, which have no hover), and the name with the shortcut as
 * tooltip and accessible name.
 */
function tool(name, label, action, { key = null, cls = '', iconOnly = false } = {}) {
  const tip = key ? `${label} (${keyText(key)})` : label;
  return el(`button.tool${cls}${iconOnly ? '.tool-icon' : ''}`, { type: 'button', onclick: action, 'aria-label': tip,
    'aria-keyshortcuts': key, title: tip, 'data-keys': key ? keyText(key) : null }, icon(name), el('span.tool-label', { text: label }));
}
// the header and the toolbar keep one line each: what does not fit moves into their More menus (overflow.js)
let headerFit = null, toolbarFit = null;
function refit() { headerFit?.fitNow(); toolbarFit?.fitNow(); } // at once, so that no frame shows a row too wide
function setToolLabel(b, name, label, key) {
  const tip = key ? `${label} (${keyText(key)})` : label;
  b.replaceChildren(icon(name), el('span.tool-label', { text: label }));
  b.setAttribute('aria-label', tip);
  b.title = tip;
}
// An export of a whole run (WS-F-124 to WS-F-126); `.dp-only` items exist only in a datapath view.
const runExport = (label, action, cls = '') => el(`button${cls}`, { type: 'button', onclick: action, title: STRINGS.exportRunTitle, text: label });
const profileSel = el('select', { 'aria-label': STRINGS.profile, onchange: (e) => { session.profile = e.target.value; store.set('pips.profile', session.profile); syncLangControls(); doAssemble(); } },
  arch.engine.profiles.map((p) => el('option', { value: p.id, text: p.label })));
const speedSel = el('select', { 'aria-label': STRINGS.speed },
  el('option', { value: 'max', text: STRINGS.speedMax }), el('option', { value: 'slow', text: STRINGS.speedSlow }));
const runBtn = tool('play', STRINGS.run, () => (running ? pause() : startRun()), { key: 'F5', cls: '.tool-run' });
const runStatus = el('span.run-status', { role: 'status', 'aria-live': 'polite' });
const fileInput = el('input', { type: 'file', accept: '.s,.asm,.S,.c,.hex,.bin,.json', hidden: true, onchange: (e) => { openFile(e.target.files[0]); e.target.value = ''; } });
const assembleBtn = gate(tool('build', TL.build, () => doAssemble(), { key: 'Control+Enter', cls: '.tool-build' }), CAP.assembler);
// C (spec §10.1): the language of the editor, the translation mode (WS-F-081) and, for the ISA profile, the ISA (WS-F-083)
const C = STRINGS.cc;
const savedOpt = (k, list, d) => { const v = store.get(k); return list.includes(v) ? v : d; };
const langSel = el('select', { 'aria-label': C.language, onchange: (e) => setLang(e.target.value) },
  el('option', { value: 'asm', text: C.languages.asm }), XL ? gate(el('option', { value: XID, text: XL.label }), CAP.cLanguage) : null);
// the compiler's options (contract v5), kept in the browser as pips.cc.<option>; an option with `profiles` only for those
const xlOpts = (XL?.options ?? []).map((o) => {
  const sel = el('select', { 'aria-label': o.label, onchange: (e) => { store.set(`pips.cc.${o.id}`, e.target.value); doAssemble(); } },
    o.values.map((v) => el('option', { value: v.id, text: v.label })));
  sel.value = savedOpt(`pips.cc.${o.id}`, o.values.map((v) => v.id), o.default);
  return { o, sel, label: el('label', { title: o.title ?? null }, `${o.label} `, sel) };
});
if (xlOpts[0]?.o.title) xlOpts[0].sel.title = xlOpts[0].o.title; // the first select carries its title too, as before
/** The compiler's options as chosen: {id: value}. */
const xlValues = () => Object.fromEntries(xlOpts.map((x) => [x.o.id, x.sel.value]));
const ccOpts = el('span.cc-opts', { hidden: true }, xlOpts.map((x) => x.label));

function doReset() {
  cancelRun();
  resetEngine(); // its warnings start again
  if (uv()) { if (uv().reset) uv().reset(); else uv().load(session.runnable ? session.program : null); }
  consolePanel.message(STRINGS.resetDone);
  refresh();
}

// the teaching templates (the author's list of 2026-10-27, content/templates/): a drop-down in the
// toolbar, grouped by view; each opens in its view with its settings. The index is fetched when the
// menu first opens (WS-N-011); "More examples…" opens the example library.
let templateIndex = null;
async function loadTemplates() {
  if (!templateIndex && !contentUrl('templates')) templateIndex = { groups: {}, templates: [] }; // an architecture without templates
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
  // a template of the group Devices and traps names its profile and may carry a pin script and bytes for the UART
  let stimulus = [];
  try { stimulus = t.stimulus ? parseStimulus(t.stimulus) : []; } catch (e) { consolePanel.message(STRINGS.platform.scriptError(e.message), 'error'); }
  session.platformConfig = { ...defaultPlatform(), stimulus, rx: (t.rx ?? []).map((e) => ({ ...e })), mtimeDiv: t.mtimeDiv ?? 1 };
  await applyShared({ view: t.view, profile: t.profile ?? arch.engine.profiles[0].id, lang: t.lang, name: t.file, source: await r.text(),
    ...Object.fromEntries(SETTINGS.map((v) => [v.settings.key, t[v.settings.key] ?? null])), mem: t.mem ? readConfig(t.mem) : null },
    STRINGS.templates.opened(t.title));
}
/** The templates as menu items: a heading per group, a button per template. */
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
// shown while an exercise is open (WS-F-148)
const exerciseBtn = el('button.tool', { type: 'button', hidden: true, title: STRINGS.exercise.buttonTitle, onclick: () => exerciseDialog.open() },
  icon('list'), el('span.tool-label', { text: STRINGS.exercise.button }));
const memBtn = gate(tool('memory', STRINGS.mem.button, () => memSettings.open()), CAP.memoryModel);
function syncMemButton() {
  if (!CAP.memoryModel.enabled) return; // the reason stays its tooltip
  const tip = `${STRINGS.mem.buttonTitle}: ${memCfg.mode === 'ideal' && memCfg.words === 256 ? STRINGS.mem.describeIdeal : describeMem(memCfg)}`;
  memBtn.title = tip;
  memBtn.setAttribute('aria-label', tip);
  memBtn.classList.toggle('tool-active', memCfg.mode !== 'ideal' || memCfg.words !== 256);
}
// The toolbar: the program's build and run, the steps, the speed; then the program's tools (memory model,
// templates, exercise, file). The Architecture (profile) selector is beside the speed.
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
// the processor context: the Architecture (profile) and, in a view that has them, the subset
const archCtx = el('div.arch-ctx', {}, profileField);
const toolbar = el('div.toolbar', { role: 'toolbar', 'aria-label': TL.group },
  group('.tb-run', assembleBtn, runBtn),
  group('.tb-step', stepBackBtn, stepBtn, stepOverBtn, stepOutBtn, runToCursorBtn, resetBtn),
  group('.tb-speed', speedField, archCtx),
  runStatus,
  el('span.sep'),
  group('.tb-program', memBtn, templatesMenu, exerciseBtn, fileMenuBox),
  toolbarMore.menu,
  fileInput);

/** A drop-down of commands (details/summary); closes after a choice, on Escape or on a click elsewhere. */
function dropMenu(summary, items, { onOpen = null, cls = '' } = {}) {
  const list = el('div.menu-list', { role: 'group' }, items);
  const menu = el(`details.menu${cls}`, {}, summary, list);
  menu.addEventListener('toggle', () => { if (menu.open) onOpen?.(list); });
  menu.addEventListener('click', (e) => { if (e.target.closest('.menu-list button')) menu.open = false; });
  // Escape closes the innermost open menu only (a menu can sit in a More menu)
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.open) { e.stopPropagation(); menu.open = false; menu.querySelector('summary').focus(); } });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.open = false; });
  return menu;
}
function fileMenu(...items) {
  return dropMenu(el('summary.tool', { title: STRINGS.file }, icon('folder'), el('span.tool-label', { text: STRINGS.file })), items);
}
/** A More menu (overflow.js): a section per group, each with its heading, hidden while empty. */
function moreMenu(label, title, groups) {
  const bodies = Object.fromEntries(groups.map((g) => [g, el('div.ovf-body')]));
  const sections = groups.map((g) => el('div.ovf-sec', { role: 'group', 'aria-label': TL.sections[g], hidden: true },
    el('p.menu-head', { text: TL.sections[g], 'aria-hidden': 'true' }), bodies[g]));
  const menu = dropMenu(el('summary.tool.tool-icon.ovf-btn', { title, 'aria-label': title }, icon('more'), el('span.tool-label', { text: label })),
    sections, { cls: '.ovf' });
  menu.hidden = true;
  return { menu, bodies };
}

// --- header: name, views, View menu, theme, full screen, keys (WS-U-010, WS-U-040) ---------------
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
// Full screen: the whole page, for a projector or a small screen; hidden where the browser cannot.
const fullBtn = tool('fullscreen', STRINGS.fullScreen, () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch((e) => consolePanel.message(STRINGS.fullScreenRefused(e.message), 'warn'));
}, { iconOnly: true });
fullBtn.hidden = !document.documentElement.requestFullscreen;
document.addEventListener('fullscreenchange', () => {
  setToolLabel(fullBtn, 'fullscreen', document.fullscreenElement ? STRINGS.exitFullScreen : STRINGS.fullScreen);
  fullBtn.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
});
// Projector mode (WS-U-012): larger type and lines (theme.css), and only the editor, the main view and
// one table (configureLayout); each view keeps a separate projector layout.
let projector = store.get('pips.projector') === '1';
const projBtn = tool('projector', STRINGS.projector, () => setProjector(!projector), { iconOnly: true });
function setProjector(on, quiet = false) {
  projector = on;
  document.documentElement.toggleAttribute('data-projector', on);
  projBtn.title = STRINGS.projectorTitle;
  projBtn.setAttribute('aria-pressed', String(on)); // the name stays; the pressed state tells on or off
  store.set('pips.projector', on ? '1' : '');
  if (!quiet) { configureLayout(); refit(); } // larger type: the bars fit again
}
setProjector(projector, true);
const keysBox = el('details.keys', {}, el('summary.tool.tool-icon', { title: STRINGS.keys, 'aria-label': STRINGS.keys }, icon('keyboard'),
  el('span.tool-label', { text: STRINGS.keys })), el('p', { text: STRINGS.shortcuts }));
const viewMenu = dropMenu(el('summary.tool', { title: STRINGS.layout.view }, icon('layout'), el('span.tool-label', { text: STRINGS.layout.view })),
  [], { onOpen: (list) => fillViewMenu(list), cls: '.view-menu-top' });

const panel = (title, body, cls = '', iconName = null) => el(`section.panel${cls}`, { 'aria-label': title }, head(title, iconName), body);
/** A panel heading: icon, title and any tools (the collapse button joins it). */
function head(title, iconName = null, ...tools) {
  return el('h2', {}, iconName ? icon(iconName, { size: 15 }) : null, el('span.panel-title', { text: title }),
    tools.length ? el('span.panel-head-tools', {}, tools) : null);
}
const tabs = (items) => {
  const bar = el('div.tabs', { role: 'tablist' });
  const host = el('div.tab-body');
  // an item's fourth element is the capability state of the tab, if it has one: off, the tab is disabled (W-D29)
  const buttons = items.map(([title, , , cap], i) => {
    const b = el('button', { type: 'button', role: 'tab', text: title, 'aria-selected': String(i === 0), onclick: () => select(i) });
    return cap ? gate(b, cap) : b;
  });
  function select(i) {
    if (buttons[i].disabled) return;
    buttons.forEach((b, k) => b.setAttribute('aria-selected', String(k === i)));
    host.replaceChildren(items[i][1]);
    items[i][2]?.(); // a tab that draws only while shown
  }
  bar.append(...buttons);
  select(0);
  const selectTitle = (title) => { const i = items.findIndex(([t]) => t === title); if (i >= 0) select(i); return i >= 0; };
  return { root: el('div.tabbed', {}, bar, host), select, selectTitle };
};

// --- views (WS-U-010): the architecture's views (contract: arch.views). The first is the instruction-level view the
// shell draws itself; the others are loaded with their tab (WS-N-011) and give a ViewInstance (RISC-V: the
// single-cycle, multicycle and pipelined views of Chapters 6 to 8, and the comparison of the three, WS-F-060)
let mode = arch.views[0].id;
const viewOf = (id) => arch.views.find((v) => v.id === id) ?? null;
const inst = {}; // view id -> ViewInstance, created on first use
const memsysOf = {}; // view id -> the MemorySystem the view was given (null: ideal memory of the default size)
/** A view with its own model and drawing (kind datapath or bus). */
const isDp = (id = mode) => ['datapath', 'bus'].includes(viewOf(id)?.kind);
const isCmp = (id = mode) => viewOf(id)?.kind === 'compare';
const uv = () => (isDp() ? inst[mode] ?? null : null); // the datapath view in use, or null in the ISA and comparison views

// --- the memory model applied to the views (each gets its own MemorySystem) ------------------------------
const makeMemsys = () => buildMemsys(memCfg, { platform: memCfg.devices ? new Platform(session.platformConfig) : null }).memsys; // null: ideal memory of the default size, the book's processors
document.body.append(memSettings.root);
syncMemButton();
function applyMemory(cfg, { assemble = true } = {}) {
  cancelRun();
  memCfg = cfg;
  store.set(CONFIG_KEY, writeConfig(cfg));
  for (const id of Object.keys(inst)) {
    if (!isDp(id)) continue; // the comparison reads the setting when the program is loaded again (ViewContext.memConfig)
    memsysOf[id] = makeMemsys();
    inst[id].setMemsys?.(memsysOf[id]);
  }
  syncMemButton();
  consolePanel.message(STRINGS.mem.applied(cfg.mode === 'ideal' && cfg.words === 256 ? STRINGS.mem.describeIdeal : describeMem(cfg)), 'ok');
  if (assemble) doAssemble(); // the program restarts on the new memory
}

/** The data access this cycle will make (a datapath view) or the next instruction makes (ISA), or null. */
function dataAccessNow() {
  try {
    const a = (uv() ? uv().dataAccess?.() : engine?.dataAccess?.()) ?? null;
    return a ? { addr: a.address, size: a.size } : null;
  } catch { return null; }
}

/** A fresh engine of the session's program for the trace-driven caches (contract v5: step records with reads), without history. */
const DEVICES = arch.addressSpace.regions.filter((r) => r.kind === 'device');
const traceRun = () => ({ program: session.program, harvard: profileOf(session.profile)?.memory === 'harvard',
  devices: DEVICES,
  create: () => arch.engine.create(session.program, { platformConfig: session.platformConfig, historyLimit: 1 }) });
/** ISA view: the trace-driven cache counts of the whole program, on request. */
let traceResult = null;
function analyseTrace() {
  if (!ensureRunnable()) { consolePanel.message(STRINGS.exportNothing, 'error'); return; }
  const r = traceCacheRun(traceRun(), memCfg);
  traceResult = { caches: r.caches, instructions: r.instructions, stop: r.stop, error: r.error, program: session.program, cfg: memCfg,
    at: engine?.state().retired ?? 0 };
  updateMemPanels();
}
/**
 * The caches at the ISA view's current position, counted on the same engine as the processor views: the program's
 * own run replayed from reset (forward steps continue the same replay, a step back or reset starts it again).
 * Capped, so that a long run does not stall the page; no timing.
 */
const LIVE_CAP = 300_000;
let live = null;
function liveTrace() {
  if (!engine || !session.program || memCfg.mode !== 'cache' || !(memCfg.l1i.on || memCfg.l1d.on)) { live = null; return null; }
  const n = Math.min(engine.state().retired, LIVE_CAP);
  if (!live || live.program !== session.program || live.cfg !== memCfg || live.retired > n) live = new TraceCache(traceRun(), memCfg);
  live.advanceTo(n);
  return { caches: live.caches, instructions: live.instructions, stop: live.stop === 'limit' ? 'here' : live.stop, error: live.error };
}
/** The Cache and Peripherals tabs, for the view in use (drawn only while shown). */
function updateMemPanels() {
  const v = uv();
  const ms = v ? memsysOf[mode] ?? null : null;
  const ctx = { memsys: ms, cfg: memCfg, mode, accessed: dataAccessNow(), fetch: v ? v.state()?.pc ?? null : engine?.state().pc ?? null, words: ms?.memWords, dev: platformCtx(), // the devices on the bus, if any
    // the instruction-level view counts a whole run on demand (no clock, so no timing)
    ...(mode === arch.views[0].id ? { analyse: analyseTrace, trace: traceResult && traceResult.at === (engine?.state().retired ?? 0) ? traceResult : liveTrace(),
      traceStale: traceResult && (traceResult.program !== session.program || traceResult.cfg !== memCfg) } : {}) };
  cacheView.update(ctx);
  periph.update(ctx);
}
/** The architecture's panels (contract v8) show the state of the view in use, or of the engine. */
function updateArchPanels() {
  if (!archPanels.length) return;
  const v = uv();
  const s = v ? v.state() : engine?.state() ?? null;
  const accepts = Boolean(session.runnable && s && (v ? v.input : engine?.input));
  const state = s ? { registers: s.registers, steps: v ? s.cycle : s.steps ?? s.retired, clock: Boolean(v) } : null; // a view counts clocks
  for (const { inst } of archPanels) inst.update(state, { accepts, running });
}
/**
 * An input of an architecture panel (contract v8): to the view in use, to the Worker during a long run (kept
 * until it answers, for an input that arrives after its run ended), or to the engine; then redraw.
 */
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
const viewButtons = arch.views.map((v) =>
  el('button.mode-btn', { type: 'button', role: 'tab', title: v.label, 'aria-label': v.label, 'aria-selected': String(v.id === mode), onclick: () => setMode(v.id) },
    icon(v.icon), el('span', { text: v.label })));
viewTabs.append(...viewButtons);
// the subsets of the profile of a view that offers them (RISC-V: the Chapter 6 laboratory subset and extension); the first is the whole profile
const SUBSETS = profileOf(arch.views.find((v) => v.subsets)?.profile)?.subsets ?? [];
const noSubset = (value) => !SUBSETS.length || value === SUBSETS[0].id;
const subsetSel = el('select', { 'aria-label': STRINGS.view.subset, hidden: true, onchange: (e) => {
  session.subset = noSubset(e.target.value) ? null : e.target.value;
  store.set('pips.subset', e.target.value);
  doAssemble();
} }, SUBSETS.map((s) => el('option', { value: s.id, text: s.label })));
archCtx.append(subsetSel);
const helpBtn = tool('help', STRINGS.help.button, () => helpDialog.open(), { iconOnly: true });
const headerMore = moreMenu(TL.menu, TL.menuTitle, ['views', 'workspace', 'application']);
header.replaceChildren(
  el('div.brand', {}, header.querySelector('.app-logo') ?? el('span.app-logo', { 'aria-hidden': 'true' }),
    el('div.brand-text', {}, header.querySelector('.app-title'), el('span.app-subtitle', { text: STRINGS.appFull }))),
  viewTabs,
  el('div.header-tools', {}, viewMenu, themeBtn, projBtn, fullBtn, keysBox, helpBtn),
  headerMore.menu);
showTheme();
// Each control of the two bars carries its command's id (data-cmd), wherever the overflow puts it.
for (const [cmd, node] of Object.entries({ assemble: assembleBtn, run: runBtn, stepBack: stepBackBtn, step: stepBtn, stepOver: stepOverBtn,
  stepOut: stepOutBtn, runToCursor: runToCursorBtn, reset: resetBtn, speed: speedSel, memory: memBtn, templates: templatesMenu, exercise: exerciseBtn,
  file: fileMenuBox, profile: profileSel, subset: subsetSel, views: viewTabs, layout: viewMenu, theme: themeBtn, projector: projBtn,
  fullScreen: fullBtn, keys: keysBox, help: helpBtn, moreHeader: headerMore.menu, moreToolbar: toolbarMore.menu })) node.dataset.cmd = cmd;
// The order in which each bar gives way, lowest priority first: compact styles, then controls into its More menu.
// Assemble, Run and Step never leave the toolbar; the brand never leaves the header.
headerFit = overflowBar({ bar: header, more: headerMore.menu, sections: headerMore.bodies, steps: [
  { cls: 'hb-tight' }, { cls: 'hb-views-active' }, // the views: only the open one keeps its name
  { node: projBtn, group: 'workspace' }, { node: keysBox, group: 'application' }, { node: fullBtn, group: 'application' },
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

// --- the MAVILERA logo and the About dialog --------------------------------------------------
// The logo files (content/branding/) are inlined, so that their colours follow the theme through the
// --mv-* tokens of theme.css; the header keeps the name as text for screen readers. The header shows the
// lockup MAVILERA, microprocessor, RISC-V (the icon alone on narrow screens); the About dialog the full logo.
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
    const [full, small] = await Promise.all([brandSvg(arch.content?.logo ?? 'mavilera-logo.svg'), brandSvg('mavilera-icon.svg')]); // contract v6
    full.classList.add('brand-logo', 'brand-full');
    small.classList.add('brand-logo', 'brand-icon');
    // MAVILERA goes to the landing page, the architecture part opens the switcher (docs/architecture/arch-switcher.md)
    const where = { protocol: location.protocol, href: location.href, release: !!document.querySelector('meta[name="risc-vista-edition"][content="release"]') };
    const switcher = archSwitcher({ logo: full, targets: switchTargets(ARCH_ID, where), home: homeUrl(where), current: PLATFORM_ARCHS.find((a) => a.id === ARCH_ID)?.name ?? STRINGS.appFull,
      loadLogo: (file) => brandSvg(file), strings: STRINGS.archSwitch });
    header.querySelector('.app-logo')?.replaceChildren(switcher, small);
    header.classList.add('has-logo');
    refit();
  } catch { /* without the files the name stays as text */ }
})();

// a release page (tools/release.mjs) carries its version; the development tree has none
const RELEASE = document.querySelector('meta[name="risc-vista-edition"][content="release"]')
  ? document.querySelector('meta[name="risc-vista-version"]')?.content ?? '' : null;
const aboutLogo = el('div.about-logo');
const about = el('dialog.about', { 'aria-labelledby': 'about-title' },
  aboutLogo,
  el('h2', { id: 'about-title', text: `${STRINGS.appName}: ${STRINGS.appFull}` }),
  el('p.about-tag', { text: STRINGS.tagline }),
  el('p', { text: STRINGS.aboutText }),
  el('p.about-meta', { text: RELEASE ? STRINGS.aboutVersionRelease(RELEASE) : STRINGS.aboutVersion }),
  el('p.about-meta', { text: RELEASE ? STRINGS.aboutRightsRelease : STRINGS.aboutRights }),
  el('form', { method: 'dialog' }, el('button', { type: 'submit', text: STRINGS.aboutClose })));
document.body.append(about);

// data import and export (WS-F-145): the loads are kept by the session and applied at each assembly
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

// the example library (WS-F-123): an example opens like a shared program, in the view of its processor
// the view that runs an example's profile: the first view of that profile that is not the comparison (the ISA view: the first profile)
const viewForProfile = (profile) => arch.views.find((v) => !isCmp(v.id) && (v.profile ?? arch.engine.profiles[0].id) === profile)?.id ?? arch.views[0].id;
const examplesDialog = new ExamplesDialog({ index: contentUrl('examples'), templates: () => loadTemplates(), onTemplate: (t) => openTemplate(t), templateItems, onOpen: async (x, text) => {
  let source = text;
  if (x.gcc) { const imps = await arch.language.importers(); source = (imps.find((i) => i.test(text)) ?? imps[0]).convert(text, x.file).text; }
  await applyShared({ view: viewForProfile(x.profile), profile: x.profile === arch.engine.profiles[0].id ? x.profile : isaProfile,
    subset: profileOf(x.profile)?.subsets ? x.subset ?? profileOf(x.profile).subsets[0].id : null,
    lang: x.lang, name: x.file, source }, STRINGS.examples.opened(x.title));
  // contract v5: the view's warning when an example opens in it (RISC-V: the multicycle JALR state)
  const note = await viewOf(viewForProfile(x.profile))?.openNote?.(x);
  if (note) consolePanel.message(note, 'warn');
  if (x.halts === false) consolePanel.message(STRINGS.examples.noHalt, 'warn');
} });
document.body.append(examplesDialog.root);
// the help (W-D20); the documentation is beside the application in a release (../docs/), on the site for the
// offline file, and in the architecture's content.docs of the development tree (contract v6; none: no link)
const helpDialog = new HelpDialog({ index: contentUrl('help'), onAbout: () => openAbout(), logo: () => brandSvg('mavilera-full.svg'),
  docsUrl: !contentUrl('docs') ? null : RELEASE === null ? contentUrl('docs').href
    : location.protocol === 'file:' ? `https://sajidlab.org/mavilera/${arch.id}/docs/` : new URL('./docs/', location.href).href });
document.body.append(helpDialog.root);
async function openAbout() {
  if (!aboutLogo.firstChild) aboutLogo.append(await brandSvg('mavilera-full.svg').catch(() => el('strong', { text: STRINGS.appName })));
  about.showModal();
}

// --- panels -------------------------------------------------------------------------------------
const listingTabs = tabs([[STRINGS.listing, listing.root], [STRINGS.data, dataBox], [STRINGS.symbols, symBox],
  ...(arch.language.extraLanguages?.length ? [[C.asmTab, asmBox]] : [])]); // the generated assembly only with another language
const pListing = panel(STRINGS.listing, listingTabs.root, '.p-listing', 'list');
// the encode/decode scratchpad (WS-F-024) above the fields of the instruction inspector
const scratchOut = el('div.scratch-out.mono', { 'aria-live': 'polite' });
const scratchIn = el('input.mono.scratch-in', { type: 'text', spellcheck: false, autocomplete: 'off', 'aria-label': STRINGS.scratch.label,
  placeholder: STRINGS.scratch.placeholder, title: STRINGS.scratch.title, oninput: () => runScratch() });
function runScratch() {
  const X = STRINGS.scratch;
  const r = arch.language.scratch(scratchIn.value); // contract v4: rows for the inspector, or an error diagnostic
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
// The lower pane of the middle column (instruction inspector, cycle details, pipeline details) has, besides its
// fold arrow: an up arrow that folds the pane above so that it grows upward (the same place then shows a down arrow
// that opens the pane above again), and Maximise, which gives it the whole workspace (Esc restores).
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
    const h = node.querySelector(':scope > h2'); // a view replaces the heading when it loads: the controls join the new one
    if (h && up.parentNode !== h) h.insertBefore(max, node._toggle?.parentNode === h ? node._toggle : null), h.insertBefore(up, max);
    const aboveFolded = midSplit.collapsed[0];
    up.replaceChildren(icon(aboveFolded ? 'chevronDown' : 'chevronUp'));
    const label = aboveFolded ? L.openAbove : L.enlargeUp(title);
    up.setAttribute('aria-label', label);
    up.setAttribute('aria-pressed', String(aboveFolded));
    up.title = label;
    if (node._toggle) node._toggle.hidden = aboveFolded; // this pane is the only one open: nothing to fold into
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
// the shared memory panel (D7): the same in every view, with the Cache and Peripherals tabs; a view's own
// detail tabs only link to it
const memTabs = tabs([[STRINGS.mem.tabMemory, memory.root], [STRINGS.mem.tabCache, cacheView.root, () => updateMemPanels(), CAP.cache],
  [STRINGS.mem.tabPeripherals, periph.root, () => updateMemPanels(), CAP.devices], ...archPanels.map(({ p, inst }) => [p.label, inst.root, () => updateArchPanels()])]);
// the memory pane's name: without caches (capability cache off) it is the Memory pane
const MEM_PANE = CAP.cache.enabled ? { panel: STRINGS.mem.panel, link: STRINGS.mem.link, bar: STRINGS.layout.dockBarDp }
  : { panel: STRINGS.mem.panelPlain, link: STRINGS.mem.linkPlain, bar: STRINGS.layout.dockBarDpPlain };
const pMemory = panel(MEM_PANE.panel, memTabs.root, '.p-memory', 'memory');
// Maximise: the panel takes the whole workspace (the editor, views and registers step aside); the icon changes from corners out to corners in
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
/** A view's Memory tab: a note and a button that opens the shared panel. */
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
// the editor: its file as a tab, the language and C options, and a status line
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
const viewParts = {}; // per datapath view: {header, info, tabs}

/** The status line of the editor: cursor, size, profile, and whether the text is newer than the program. */
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

// --- the resizable workspace (split.js) -------------------------------------------------------------
// root: the workspace over the dock; workspace: editor | middle | right; middle and right are columns;
// the dock: memory | console. A datapath view gives the middle column the drawing over its details and
// the console to the right column, and has no dock (spec §11.1: the drawing needs the height).
const midSplit = new Split('column', 'mid');
const rightSplit = new Split('column', 'right');
const workSplit = new Split('row', 'work');
const dockSplit = new Split('row', 'dock');
const rootSplit = new Split('column', 'root');
// The folded dock's bar: a click anywhere opens it; the fold button that Split puts in it is the keyboard's way.
const dockBarText = el('span', { text: STRINGS.layout.dockBar });
const dockBar = el('div.dock-bar', { onclick: () => rootSplit.setCollapsed('dock', false) }, icon('chevronUp', { size: 14 }), dockBarText);
const dock = el('div.dock', {}, dockBar, dockSplit.root);
const workspace = el('div.workspace', {}, rootSplit.root);
const syncMidControls = [paneControls(pInfo, STRINGS.view.info), paneControls(pFields, STRINGS.layout.panes.inspector)];
midSplit.onApply = () => syncMidControls.forEach((f) => f());
const P = STRINGS.layout.panes;

// Projector mode (WS-U-012) keeps every pane, so that nothing is out of reach, but starts with only the
// editor, the main view (drawing, listing or comparison) and one table, the registers, open; the others
// are folded and open from their heading or View ▸ Show. Its layouts are saved apart (`….proj`).
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
  // the dock, in every view (D7): the shared memory panel, and in the ISA and comparison views the console;
  // a datapath view needs the height, so there it starts folded
  dockSplit.configure(dp ? [{ node: pMemory, id: 'memory', min: 220, size: 1 }]
    : [{ node: pMemory, id: 'memory', min: 220, size: 0.58, collapsible: true, title: MEM_PANE.panel },
      { node: pConsole, id: 'console', min: 200, size: 0.42, collapsible: true, title: STRINGS.console }], `dock.${k}`);
  dockBarText.textContent = dp ? MEM_PANE.bar : STRINGS.layout.dockBar;
  rootSplit.configure([{ node: workSplit.root, id: 'work', min: 200, size: dp ? 0.6 : 0.7 },
    { node: dock, id: 'dock', min: 90, size: dp ? 0.4 : 0.3, collapsible: true, collapsed: pj || dp, title: dp ? MEM_PANE.panel : P.dock, header: dockBar }], `root.${k}`);
  ws?.afterLayout(); // a narrow screen: the active workspace's panes show
}

/** View ▸ projector mode, the layout commands and a Show switch for each pane that folds. */
function fillViewMenu(list) {
  const dp = isDp();
  const panes = [[workSplit, 'editor', P.editor],
    ...(dp ? [[midSplit, 'info', P.info], [rightSplit, 'counters', P.counters], [rightSplit, 'console', STRINGS.console], [rootSplit, 'dock', MEM_PANE.panel]]
      : [...(isCmp() ? [] : [[midSplit, 'inspector', P.inspector]]), [rightSplit, 'calls', P.calls], [rightSplit, 'counters', P.counters], [rootSplit, 'dock', P.dock]])];
  list.replaceChildren(
    el('label.menu-check', { title: STRINGS.projectorTitle }, el('input', { type: 'checkbox', checked: projector,
      onchange: (e) => setProjector(e.target.checked) }), ` ${STRINGS.projector}`),
    el('hr.menu-sep'),
    btn(STRINGS.layout.reset, () => { Split.resetAll(); consolePanel.message(STRINGS.layout.resetDone, 'ok'); }),
    el('p.menu-head', { text: STRINGS.layout.show }),
    ...panes.map(([s, id, label]) => el('label.menu-check', {}, el('input', { type: 'checkbox', checked: !s.isCollapsed(id),
      onchange: (e) => s.setCollapsed(id, !e.target.checked) }), ` ${label}`)),
    el('p.note.menu-note', { text: STRINGS.layout.note }));
}

// Enlarge: the drawing takes the room of the editor and the details; the tool rows are hidden.
const zoomBtn = el('button.zoom-btn', { type: 'button', text: STRINGS.zoomOn, title: STRINGS.zoomTitle, 'aria-pressed': 'false',
  onclick: () => setZoom(!workspace.classList.contains('zoomed')) });
function setZoom(on) {
  workspace.classList.toggle('zoomed', on);
  zoomBtn.textContent = on ? STRINGS.zoomOff : STRINGS.zoomOn;
  zoomBtn.setAttribute('aria-pressed', String(on));
}

/** Open what an element of the drawing stands for: a shared panel or an information tab, flashed. */
function openTarget(t) {
  if (!t) return;
  if (t.panel === 'registers') { flashPanel(pRegs); return; }
  if (t.panel === 'memory') { setZoom(false); showMemoryPanel(0); return; } // the memory lives in the shared panel
  setZoom(false);
  ws.reveal('datapath'); // a narrow screen: the details are under the drawing there
  if (midSplit.isCollapsed('info')) midSplit.setCollapsed('info', false);
  if (viewParts[mode]?.tabs.selectTitle(t.tab)) flashPanel(pInfo);
}

function flashPanel(p) {
  ws.revealPane(p.dataset.pane); // a narrow screen: the workspace that holds it
  p.classList.remove('flash');
  void p.offsetWidth; // restart the animation
  p.classList.add('flash');
  setTimeout(() => p.classList.remove('flash'), 1300);
}

// --- the workspaces of a narrow screen (ui/workspaces.js) ---------------------------------------------
// Below 900 px one workspace shows at a time, from a tab row under the toolbar; the console is a sheet. The panes are the
// ones above, hidden or shown: nothing is rebuilt or reset by a change of workspace, and the simulator does not know of them.
let drawingStale = false; // the datapath view's drawing was not redrawn while its workspaces were hidden
let listingForced = false; // the Details tabs were put on the listing by the Listing workspace
const seen = { listing: null, line: null }; // the PC row and the editor's current line when their workspace last showed
const ws = new MobileWorkspaces({
  workspace, strings: STRINGS.ws, context: () => ({ dp: isDp() }),
  relayout: () => { setDockMax(false); setZoom(false); configureLayout(); }, // wide again: every pane back in its split
  sheet: { id: 'console', node: pConsole, label: STRINGS.console, icon: 'terminal' },
  onShow: (id) => {
    const parts = viewParts[mode];
    if (isDp() && parts) { // the listing is a tab of the Details pane in a datapath view
      if (id === 'listing') { parts.tabs.selectTitle(STRINGS.listing); listingForced = true; } else if (id === 'datapath' && listingForced) { parts.tabs.select(0); listingForced = false; }
    }
    if (drawingStale) redrawDrawing(); // the panels were kept up to date while hidden; only the drawing was not
    // where the PC moved while a pane was away, bring it into view; otherwise the pane stays as it was left (scroll and all)
    if (id === 'listing' && listing.pc !== seen.listing) listing.markPc(listing.pc);
    if (id === 'code' && editor.current && editor.current !== seen.line) editor.scrollToLine(editor.current, true);
    seen.listing = listing.pc;
    seen.line = editor.current;
  },
});
consolePanel.onNote = (kind) => ws.note(kind);
for (const li of consolePanel.msgs.children) ws.note(li.className === 'msg-error' ? 'error' : li.className === 'msg-warn' ? 'warn' : null); // messages from before
/** Draw the datapath view's drawing and details that were skipped while no workspace showed them. */
function redrawDrawing() {
  const v = uv();
  drawingStale = false;
  if (!v) return;
  v.render();
  refreshWave();
}
/** The datapath view's drawing and details are out of sight: they are drawn again when a workspace shows them. */
const drawingHidden = () => ws.mobile && pDatapath.classList.contains('ws-off') && pInfo.classList.contains('ws-off');
const syncDensity = () => memory.setRowBytes(ws.mobile ? 8 : 16); // a narrow table on a narrow screen: the same memory, fewer bytes a row
ws.mq.addEventListener('change', () => { syncDensity(); syncPanAuto(); });

/** The PC of the processor in use as text (a datapath view: the instruction its cycle works on), or null. */
function currentPc() {
  const v = uv();
  const st = v ? v.state() : engine?.state() ?? null;
  return st ? hexA(v ? st.instruction ?? st.pc : st.pc) : null;
}
/** The strip under the tabs: the PC and the state (Running, Paused, Halted, at a breakpoint), whichever workspace is shown. */
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
refit();
configureLayout();
setDockMax(false);
syncDensity();

const panShared = { pan: false }; // the Pan toggle of the drawings, one for the page
let panAuto = false; // Pan was switched on by the narrow screen
/** On a touch screen in the workspaces the page does not scroll, so a touch on a drawing pans and pinches it (Pan on); the toggle still works. */
function syncPanAuto() {
  const any = panShared.all ? [...panShared.all][0] : null;
  if (!any) return;
  if (ws.mobile && matchMedia('(pointer: coarse)').matches && !panShared.pan) { any.setPan(true); panAuto = true; }
  else if (!ws.mobile && panAuto) { any.setPan(false); panAuto = false; }
}
/** What the shell gives a view (contract ViewContext). */
const viewContext = () => ({
  strings: STRINGS, memsys: null,
  message: (text, kind) => consolePanel.message(text, kind),
  openPanel: (t) => openTarget(t), refresh: () => refresh(), goToCycle: (k) => goToCycle(k),
  command: (name) => (name === 'stepUnit' ? stepUnit() : name === 'backUnit' ? backUnit() : undefined), // the view's own buttons
  memConfig: () => memCfg,
  download: (name, data, type) => download(name, data, type),
});

/** Load a view (its module and content) and build its panes. Returns false if it could not be loaded. */
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
    // after the view's own tabs: the waveforms, the listing and the memory link (the listing moves here while selected)
    // a view that gives waveforms gets the tab; with the capability off it stays, disabled (W-D29)
    const wave = !v.waveform || !v.exportModel ? [] : CAP.waveform.enabled ? [await waveTab(id, v)] : [[STRINGS.wave.title, el('div'), null, CAP.waveform]];
    viewParts[id] = {
      header: el('h2.with-status', {}, el('span', { text: v.title }), v.status ?? null, v.headerTools ?? null), info: v.infoTitle,
      tabs: tabs([...v.tabs, ...wave, [STRINGS.listing, listing.root], [v.memoryTab ?? STRINGS.memory, memLink()]]),
    };
    // pan and zoom of the view's drawings (contract v7), named by the drawing's own title; kept while the page is open
    for (const svg of v.diagrams ?? []) new PanZoom(svg, { name: svg.querySelector(':scope > title')?.textContent || v.title, shared: panShared });
    syncPanAuto();
    inst[id] = v;
  } catch (e) {
    consolePanel.message(STRINGS.loadFailed(e.message), 'error');
    return false;
  }
  const ms = makeMemsys();
  memsysOf[id] = ms;
  if (ms) v.setMemsys?.(ms); // the saved memory model, for a view loaded now
  return true;
}

// --- the waveform panel of each datapath view (WS-F-146) ---------------------------------------------
// The records are those of the VCD export: a fresh model of the same program and options run from
// reset, kept and extended while the view's program, memory and settings stay the same, up to the furthest
// cycle reached (so that stepping back keeps the later cycles in view).
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
  if (running && !force && performance.now() - waveShownAt < 500) return; // a run in progress: twice a second
  waveShownAt = performance.now();
  const s = v.state();
  if (!s) { w.update([], 0); return; }
  const opt = v.revision?.() ?? '';
  let rec = waveRec[mode];
  if (!rec || rec.program !== session.program || rec.memsys !== memsysOf[mode] || rec.opt !== opt) {
    rec = waveRec[mode] = { program: session.program, memsys: memsysOf[mode], opt, model: v.exportModel().model, frames: [], done: false, max: 0 };
  }
  const cur = s.cycle;
  rec.max = Math.min(Math.max(rec.max, cur), VCD_CAP);
  while (!rec.done && rec.frames.length <= rec.max) {
    rec.frames.push({ ...rec.model.evaluate().signals });
    if (rec.frames.length > rec.max) break;
    if (rec.model.step() !== 'step') rec.done = true; // the export model's own protocol, as for the VCD export
  }
  w.update(rec.frames.slice(0, rec.max + 1), Math.min(cur, rec.frames.length - 1));
}
/** Go to clock cycle k of the datapath view: back over cycles run, or forwards. */
function goToCycle(k) {
  const v = uv();
  if (!v || running || k < 0) return;
  const cycle = () => v.state()?.cycle ?? 0;
  while (cycle() > k && v.back());
  while (cycle() < k && v.step() === STOP.NONE);
  refresh();
}

/** Switch view. A view with a profile runs it; the ISA view gets its profile back (WS-F-004). */
async function setMode(next) {
  if (next === mode) return;
  cancelRun();
  const isa = arch.views[0].id;
  if (next !== isa && !(await loadView(next))) return;
  const wasIsa = mode === isa;
  mode = next;
  viewButtons.forEach((b, i) => b.setAttribute('aria-selected', String(arch.views[i].id === mode)));
  const sc = isDp(); // a datapath view
  const cmp = isCmp();
  for (const b of toolbar.querySelectorAll('.dp-only')) b.hidden = !sc;
  if (sc) {
    const parts = viewParts[mode];
    parts.header.append(zoomBtn);
    pDatapath.replaceChildren(parts.header, uv().root);
    pInfo.replaceChildren(head(parts.info, 'inspect'), parts.tabs.root);
  } else setZoom(false);
  workspace.classList.toggle('dp-mode', sc);
  // The datapath needs the height: the console joins the right column and the memory panel starts folded.
  configureLayout();
  subsetSel.hidden = !viewOf(mode).subsets;
  profileSel.disabled = sc || cmp;
  profileField.hidden = sc || cmp; // a datapath view fixes the profile; its panel title names the chapter
  archCtx.hidden = profileField.hidden && subsetSel.hidden;
  refit();
  // the view's register naming (RISC-V: the datapath chapters name registers by number)
  listing.names = viewOf(mode).names ?? arch.language.disassembly?.names?.[0];
  if (sc || cmp) {
    if (sc) viewParts[mode].tabs.select(0);
    if (wasIsa) isaProfile = session.profile;
    session.profile = viewOf(mode).profile; // the comparison: the processors' common subset, the Chapter 6 profile
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

// --- C (spec §10.1) --------------------------------------------------------------------------
let cName = `main${XL?.extension ?? ''}`; // the source file of the extra language
const sourceName = () => (lang === XID ? cName : session.files[0].name.replace(/\.\w+$/, '') + arch.language.extension);

/** The toolbar for the language: Compile or Assemble; the C options; the ISA choice only for the ISA profile. */
function syncLangControls() {
  langSel.value = lang;
  ccOpts.hidden = lang !== XID;
  for (const x of xlOpts) x.label.hidden = Boolean(x.o.profiles) && !x.o.profiles.includes(session.profile);
  setToolLabel(assembleBtn, 'build', lang === XID ? TL.buildC : TL.build, 'Control+Enter');
  refit();
  editor.setLanguage(lang);
  editorStatus();
}

/** Switch the editor between assembly and C; each keeps its own text in the browser. */
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

/** Compile the editor's source into session.files; false (with the errors shown) if it does not compile. */
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

// --- actions --------------------------------------------------------------------------------
/** Assemble the session's files with the architecture's assembler (a contract Program) and load a fresh engine. */
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
  // the diagnostics, each with its location and the architecture's hint line (contract v3)
  editor.setErrors(p.diagnostics);
  for (const d of p.diagnostics) consolePanel.message(d.message, d.severity === 'warning' ? 'warn' : 'error', d, d.note ?? null);
  // contract v5: `assembled`, code produced though instructions are outside the profile; the count leaves those out
  if (p.assembled ?? p.ok) {
    const n = p.listing.length;
    const d = p.segments.filter((s) => !s.executable).reduce((k, s) => k + s.bytes.length, 0); // data bytes: the segments without code
    consolePanel.message(STRINGS.assembled(n, d), p.ok ? 'ok' : 'warn');
  } else {
    consolePanel.message(STRINGS.asmErrors(errorCount(p)), 'error');
  }
  afterAssemble(p);
}

/** Compile the C program and assemble its assembly; errors of either are shown at C lines. */
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
    p.ok = false; // nothing to run until the C program compiles
    resetEngine();
  }
  afterAssemble(p);
}

/** What follows assembling: the memory view, the datapath or comparison view, the panels. */
function afterAssemble(p) {
  const lr = session.loadReport;
  if (lr.applied.length) consolePanel.message(STRINGS.dataIo.assembledLoads(lr.applied.map((a) => `${a.label} (${a.n} bytes)`).join(', ')));
  for (const d of lr.dropped) consolePanel.message(STRINGS.dataIo.droppedLoad(d.label, d.why), 'warn');
  consolePanel.msgs.scrollTop = 0; // the first error first
  if (p.segments[1]) memory.base = p.segments[1].address;
  if (uv() || isCmp()) inst[mode].load(session.runnable ? p : null);
  refresh(true);
}

// --- exports of a whole run (WS-F-124 to WS-F-126) --------------------------------------------
// Each replays the program from reset on a fresh hart or model (core/exports.js), so the session
// and its step-back history are untouched.
const TRACE_CAP = 1_000_000; // instructions in a trace file
const VCD_CAP = 20_000; // cycles in a waveform file

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
  download(`${name}-${viewOf(mode).profile}.vcd`, vcd(frames, signals, { module, comment: `${name}, ${label}; one cycle = 10 ns of the time axis` }));
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
  diag.show(); // the ABI check, the trap check, the uninitialised-value check (WS-F-147): the new warnings
}

/** The errors of a program the console counts: its error diagnostics but those of kind 'profile' (contract v5). */
function errorCount(p) { return p.diagnostics.filter((x) => x.severity === 'error' && x.kind !== 'profile').length; }

/** Message for the end of a step or run of a datapath view. */
function reportSingle(stop) {
  const v = uv();
  const s = v.state() ?? { pc: 0, cycle: 0 };
  const at = s.instruction ?? s.pc; // multicycle: the instruction the cycle works on
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

/** A view's larger step (contract ViewInstance.unit; the multicycle view: the rest of this instruction, up to the next FETCH, WS-F-040). */
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
  if (running) { pause(); return; } // the run stops first; press again to step back
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
  if (uv()?.unit) { stepUnit(); return; } // one larger step (multicycle: one whole instruction)
  const t = uv() ? null : engine.stepOverTarget?.() ?? null; // one cycle in the other datapath views
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

// --- runs (WS-F-090; spec §5.3) ----------------------------------------------------------------
// A run first takes one main-thread slice of about 10 ms, so that short runs
// (step over a small call) finish at once. A longer run continues in the
// Worker (worker/run.js), which sends back the state and every step it made,
// so stepping back works across it. Without a Worker (an old browser, or the
// page opened from file://) the run goes on in main-thread slices. The
// animated speed always steps on the main thread, one instruction per frame
// group, so that every step is drawn.
let worker; // undefined: not tried yet; null: unavailable
let workerRun = false; // the run in progress is the Worker's
let workerInputs = []; // the panel inputs given to the Worker during its run, in order (contract v8)
let runId = 0; // a result of an older run is ignored
let runOpts = null;

function getWorker() {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./worker/run.js', import.meta.url), { type: 'module' });
    worker.onmessage = onWorkerMessage;
    worker.onerror = (e) => {
      e.preventDefault?.();
      worker = null; // module workers unavailable: carry on in main-thread slices
      workerRun = false;
      for (const x of workerInputs.splice(0)) engine?.input?.(x); // what the Worker was given, to the page's engine
      if (running) runOnMainThread(true);
    };
  } catch {
    worker = null;
  }
  return worker;
}

/**
 * Send a run to the Worker: the architecture by id, the program, the engine's options and snapshot (contract:
 * Engine.snapshot). False if the Worker cannot take it (the run goes on in main-thread slices).
 */
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

/** Run of a datapath view: cycles in ~12 ms slices, or one cycle per 0.4 s when animated. */
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
        const at = v.breakAt ? v.breakAt() : v.state().pc; // multicycle: only at a FETCH
        if (at !== null && session.breakpoints.has(at)) { r = STOP.BREAK; break; }
        if (at !== null && opts.target === at) { r = STOP.TARGET; break; }
      }
      if (v.state().cycle >= RUN_LIMIT) { r = STOP.BUDGET; break; }
      r = v.step();
      k += 1;
      const why = r === STOP.NONE ? v.event?.() : null; // pipelined view: stop on a stall, flush or misprediction (WS-F-091)
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
  const w = capability(arch, 'worker', profileOf(session.profile)).enabled ? getWorker() : null; // iss-priv: the devices stay on this page
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
    engine.restore(m.snapshot); // the state, with every step the Worker made (step back works across the run)
    for (const x of workerInputs.splice(0).slice(m.applied ?? 0)) engine.input?.(x); // inputs that came after its run ended
    finishRun(m.stop);
  }
}

/** Pause button and F5 while running: the run stops after its current slice. */
function pause() {
  if (!running) return;
  if (!uv() && speedSel.value !== 'slow' && worker) { worker.postMessage({ type: 'pause' }); return; }
  runId += 1;
  finishRun(STOP.PAUSE);
}

/** Stop a run at once, dropping what a Worker run did (reset, assemble, open). */
function cancelRun() {
  if (!running) return;
  runId += 1;
  if (worker) {
    worker.terminate();
    worker = undefined; // a fresh one next time
  }
  workerRun = false;
  workerInputs = [];
  setRunning(false);
}

// Until an instruction is chosen in the listing, the inspector shows the one at the PC, so that it is never empty.
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
    selected = null; // the inspector follows the PC again
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
  // halted, not stopped by an error: the line of the failing instruction stays marked
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
  // the engine's console (iss-priv: what the UART sent), its last OUTPUT_LIMIT characters
  const output = s?.output ?? '';
  const from = output.length - OUTPUT_LIMIT;
  const nl = from > 0 ? output.indexOf('\n', from) : -1;
  const shown = from > 0 ? output.slice(nl >= 0 && nl < output.length - 1 ? nl + 1 : from) : output; // from a line's start
  consolePanel.setOutput(Array.from(shown, (c) => c.charCodeAt(0)), (s?.outputDropped ?? 0) + output.length - shown.length);
  updateWsStatus();
}

/** The shared panels show the datapath processor's state: registers, PC, data memory, cycles. */
function refreshSingle(p) {
  const v = uv();
  const s = v.state(); // null while no program is loaded
  const at = s ? s.instruction ?? s.pc : undefined; // multicycle: the instruction the cycle works on
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
  const waits = ms?.timed ? ms.stats.waitCycles : 0; // clock edges spent waiting for memory
  counters.updateCycles({ cycles: s?.cycle ?? 0, instructions: s?.retired ?? 0,
    extra: [...(v.counters?.() ?? []), ...(ms?.timed ? [[STRINGS.mem.waitCycles, waits]] : [])] });
  consolePanel.setOutput([]);
  // on a narrow screen, while no workspace shows the drawing or the details they are not redrawn (ws.onShow does it)
  if (drawingHidden()) drawingStale = true;
  else { drawingStale = false; v.render(); refreshWave(); }
  updateWsStatus();
}

function listingText(p) {
  return p.listing.map((l) => `${l.address.toString(16).padStart(8, '0')}  ${l.word.toString(16).padStart(8, '0')}  `
    + `${arch.language.disassemble(l.word, l.address).padEnd(28)}  ${l.part === 0 ? l.text.trim() : ''}`.trimEnd()).join('\n') + '\n';
}

/** The changes of a GCC import, each with a link to its line (WS-F-085). */
function reportImport(name, report) {
  for (const m of report) consolePanel.message(m.message, m.kind ?? 'info', m.line ? { file: name, line: m.line } : null, m.note ?? null);
}

// --- share link and settings file (WS-F-122, WS-F-144, WS-N-013) ---------------------------
/** The views with settings in links (contract v5 View.settings); a setting is kept in storage as pips.<key>.<setting>. */
const SETTINGS = arch.views.filter((v) => v.settings);
/** A view's settings: from the loaded view, else as stored, else the defaults; as a link carries them. */
function viewSettings(v) {
  const { key, defaults, values } = v.settings;
  const o = inst[v.id]?.options?.get();
  return Object.fromEntries(Object.keys(defaults).map((k) => [k, settingValue(o ? o[k] : savedOpt(`pips.${key}.${k}`, values[k], defaults[k]))]));
}

/** Whether a profile has traps and the devices (RISC-V: iss-priv): its platform setting goes into links. */
const hasTraps = (id) => capability(arch, 'traps', profileOf(id)).enabled;

/** The program with its view and settings, as share.js takes it. */
function shareState() {
  return { arch: arch.id, view: mode, profile: mode === arch.views[0].id ? session.profile : isaProfile, subset: subsetSel.value || null, lang, name: sourceName(), // no subset: an empty menu
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

/** Open a shared state: keep the editor's text for File ▸ Restore, then settings, program and view. */
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
  if (st.platform) session.platformConfig = st.platform; // the pin script and the trap settings of the state
  if (st.mem && validateConfig(st.mem).length === 0) applyMemory(st.mem, { assemble: false }); // the program is assembled below
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
    if (mode === arch.views[0].id) { session.profile = st.profile; profileSel.value = st.profile; }
    else if (viewOf(mode).subsets) session.subset = noSubset(subsetSel.value) ? null : subsetSel.value;
    doAssemble();
  } else await setMode(st.view);
  consolePanel.message(message, 'ok', null, STRINGS.share.keptNote);
}

/** A link opened in this page (at start or pasted into the address bar). */
async function openFragment() {
  if (!isShareFragment(location.hash)) return;
  const frag = location.hash;
  history.replaceState(null, '', `${location.pathname}${location.search}`); // a reload does not open it again
  try {
    const st = await decodeFragment(frag);
    await applyShared(st, STRINGS.share.opened(viewName(st.view)));
  } catch (e) {
    consolePanel.message(STRINGS.share.refused(e.message), 'error', null, refusedNote(e));
  }
}

const viewName = (v) => viewOf(v)?.label;
/** The hint under a refused link or file: another version, or another architecture (W-D29 decision 4). */
const refusedNote = (e) => (e.code === 'version' ? STRINGS.share.refusedVersion : e.code === 'arch' ? STRINGS.share.refusedArch(e.data.arch) : null);

function restoreBefore() {
  let b = null;
  try { b = JSON.parse(store.get('pips.source.before') ?? 'null'); } catch { /* nothing kept */ }
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

// --- the exercise mode (WS-F-148): an instructor's task and tests, opened from the user's computer ---
// The file is kept in this browser (like the program) until the exercise is closed; nothing is uploaded.
let exercise = null;
async function openExercise(raw, name = null, quiet = false) {
  if (!can('exercises')) return;
  try {
    exercise = await arch.exercises.parse(raw); // loaded with the first exercise (WS-N-011)
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
/** Assemble (or compile) the editor's program for the ISA profile, without touching the session, and run the tests. */
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
  const p = arch.language.assemble([{ name: lang === XID ? stem(cName) + arch.language.extension : session.files[0].name, text }], { profile: arch.engine.profiles[0].id });
  if (!(p.assembled ?? p.ok)) { consolePanel.message(STRINGS.asmErrors(errorCount(p)), 'error'); return null; }
  return arch.exercises.run(p, exercise);
}
const exerciseDialog = new ExerciseDialog({
  onRun: () => runExerciseTests(),
  onStarter: async (source, l) => {
    exerciseDialog.root.close();
    await applyShared({ view: mode, profile: arch.engine.profiles[0].id, lang: l, name: `exercise${l === XID ? XL.extension : arch.language.extension}`, source }, STRINGS.exercise.starterLoaded);
  },
  onClose: () => { exercise = null; store.set('pips.exercise', ''); exerciseBtn.hidden = true; refit(); },
  onOpenFile: () => { exerciseDialog.root.close(); fileInput.click(); },
  // the practice exercises written for the tool (content/exercises/, W-D24), fetched when the list is first shown
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
    try { parsed = JSON.parse(text); } catch { /* the settings reader names the problem */ }
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
    // another assembler's output (RISC-V: GCC -S, WS-F-085); the importers load with the first .s file (WS-N-011)
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
    const first = arch.engine.profiles[0].id; // imported code is for the whole ISA
    if (gccReport && mode === arch.views[0].id && session.profile !== first) { session.profile = first; isaProfile = first; profileSel.value = first; store.set('pips.profile', first); }
    doAssemble();
    if (gccReport) reportImport(file.name, gccReport.report);
    return;
  }
  if (!can('imageImport')) return;
  try {
    session.program = arch.language.loadImage(kind === 'hex' ? await file.text() : new Uint8Array(await file.arrayBuffer()), kind, file.name, { profile: session.profile });
  } catch (e) { consolePanel.message(`${file.name}: ${e.message}`, 'error'); return; } // not an image of this architecture
  cancelRun();
  resetEngine();
  consolePanel.clearMessages();
  consolePanel.message(STRINGS.importedImage(session.program.listing.length), 'ok', null, STRINGS.importedNote);
  editor.setErrors([]);
  refresh(true);
  dirty = false;
}

// --- the workspace kept across a reload or a closed tab (author request 2026-10-27) ------------
// The program text, language, profile, view and settings are stored as they change (above). This
// adds what a reload would otherwise lose: the file name, the cursor and scroll position, the data
// loads, the breakpoints and watchpoints, and the run position, which is restored by replaying the
// same number of steps from reset (the simulation is deterministic). Positions are restored only
// if the editor text is the one they were saved with. Browser storage only: nothing is sent anywhere.
const WS_KEY = 'pips.workspace';
const WS_REPLAY_CAP = 2_000_000; // steps replayed at most when the page opens
let restoring = true; // no saving until the start has restored what was kept
let wsTimer = null;
/** FNV-1a hash of a text, to recognise the program a saved position belongs to. */
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
      ...(!uv() && engine?.inputs?.().length ? { inputs: engine.inputs() } : {}) }, // the panel inputs to replay (contract v8)
    platform: session.platformConfig, // the pin script and the trap settings: a replay needs them
  };
  const loads = session.dataLoads.map((l) => ({ label: l.label, name: l.name, b64: toB64(l.bytes) }));
  try {
    localStorage.setItem(scoped(WS_KEY), JSON.stringify({ ...st, dataLoads: loads }));
  } catch {
    // over the browser's storage quota (large data files): keep the rest
    try { localStorage.setItem(scoped(WS_KEY), JSON.stringify({ ...st, dataLoads: [], loadsDropped: loads.length })); } catch { /* storage unavailable */ }
  }
}
const saveSoon = () => { if (!restoring) { clearTimeout(wsTimer); wsTimer = setTimeout(saveWorkspace, 400); } };
window.addEventListener('pagehide', saveWorkspace);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveWorkspace(); });

/** The kept workspace, or null. */
function keptWorkspace() {
  try { const st = JSON.parse(store.get(WS_KEY) ?? 'null'); return st?.v === 1 ? st : null; } catch { return null; }
}

/** Before the first assembly: file name, data loads, cursor and scroll. */
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

/** After the first assembly and the view: breakpoints, watchpoints and the run position. */
function restoreRunState(st) {
  if (!st || st.key !== programKey() || !session.runnable) return;
  for (const a of st.breakpoints ?? []) session.breakpoints.add(a >>> 0);
  // by id; a register number kept before W-D29 is migrated to the id at that index, once
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
      if (Array.isArray(st.run.inputs) && st.run.inputs.length && engine.inputs) resetEngine(st.run.inputs); // replayed at their steps
      engine.run({ chunk: steps, breakpoints: new Set() }); // the steps made (contract v3 EngineState.steps); no breakpoint or watch stops it
      diag.skip(); // the replay does not report again
      consolePanel.message(STRINGS.workspace.restored(engine.state().steps, 'instruction'));
    }
  }
  if (st.loadsDropped) consolePanel.message(STRINGS.workspace.loadsDropped(st.loadsDropped), 'warn');
  listing.render();
  refresh();
}

// --- shortcuts (WS-U-030) -------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'F5') { e.preventDefault(); running ? pause() : startRun(); }
  else if (k === 'F10' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runToCursor(); }
  else if (k === 'F10') { e.preventDefault(); e.shiftKey ? stepBack() : stepOnce(); }
  else if (k === 'F11') { e.preventDefault(); e.shiftKey ? stepOut() : stepOver(); }
  else if (k === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doAssemble(); }
  else if (k === 'Escape' && workspace.classList.contains('zoomed') && !e.target.closest?.('details[open]')) setZoom(false);
});

// --- start ----------------------------------------------------------------------------------
document.title = `${STRINGS.appName}: ${STRINGS.appFull}`;
for (const node of document.querySelectorAll('[data-string]')) {
  const text = STRINGS[node.dataset.string];
  if (typeof text === 'string') node.textContent = text;
}
const theme = store.get('pips.theme');
if (theme) document.documentElement.dataset.theme = theme;
const savedProfile = store.get('pips.profile');
if (savedProfile && profileOf(savedProfile)) session.profile = savedProfile;
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
if (isShareFragment(location.hash)) await openFragment(); // a share link decides the view (WS-F-122)
else if (viewOf(store.get('pips.view')) && store.get('pips.view') !== arch.views[0].id) await setMode(store.get('pips.view'));
restoreRunState(kept);
restoring = false;
{ // an exercise kept from an earlier visit
  let raw = null;
  try { raw = JSON.parse(store.get('pips.exercise') || 'null'); } catch { /* none */ }
  if (raw) await openExercise(raw, null, true);
}
window.addEventListener('hashchange', () => openFragment());
endBoot(brandReady); // the loading screen of index.html (docs/architecture/arch-switcher.md, AS-6)
