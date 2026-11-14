// main.js -- entry point of the ISA view (milestone M1): builds the panels,
// connects them to a Session, and provides the execution controls and
// shortcuts (WS-F-090/091, WS-U-030), file open/save/export/import
// (WS-F-025, WS-F-026, WS-F-120) and the work-in-progress store (WS-F-121).
// Runs are executed on the main thread in time slices of at most ~12 ms, so
// the page stays responsive and every step stays in the back-step history.
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

// The architecture this application runs (contract W-D29; one per build from phase 6, until then `?arch=<id>`). The
// shell reads it through its descriptor only.
const base = (await ARCHITECTURES[ARCH_ID]()).descriptor;
// the tool this page shows (src/shell/platform-archs.js): the module, or a tool inside it (`?tool=npu`: the RISC-V
// module opened on the Chapter 11 laboratory profile and the NPU tab, with the NPU lockup)
const TOOL = currentTool(ARCH_ID, location.search);
/** The platform setting this page starts with: the defaults, with the tool's devices (the CPU + GPU tool: the GPU, G30). */
const toolPlatform = () => normalisePlatform({ ...(TOOL?.platform ?? {}) });
// Contract v9 (§26): the variant of the profile this page starts in (a tool's, else the stored one) is resolved
// before anything is built; a module without variants is its descriptor, unchanged. Changing to a profile of another
// variant reloads the page (profile menu, share links).
{ // once: what a module stored before it had variants belongs to its `legacy` variant (GPU: the micro-ISA preview)
  const legacy = Object.entries(base.variants ?? {}).find(([, v]) => v.legacy)?.[0];
  if (legacy && store.get('pips.v9') !== '1') {
    const kept = store.get('pips.profile');
    if (moveToVariant(legacy) && variantOf(base, kept) === undefined) store.set('pips.profile', base.engine.profiles.find((p) => p.variant === legacy).id);
    store.set('pips.v9', '1');
  }
}
const startProfile = [TOOL?.profile, store.get('pips.profile')].find((p) => p && variantOf(base, p) !== undefined) ?? null;
const preEditionAll = await withVariant(base, startProfile ? variantOf(base, startProfile) : null);
// contract v10 (pico2 P1-M9, research D45 Q1): an edition marked `development` is offered on the development page only; a
// release page and the offline file leave it out (pico2: Lite only until Pico Full's gates pass), and one edition left shows no switch
const DEVELOPMENT_PAGE = location.protocol !== 'file:' && !document.querySelector('meta[name="risc-vista-edition"][content="release"]');
const preEdition = !DEVELOPMENT_PAGE && preEditionAll.editions?.some((e) => e.development)
  ? { ...preEditionAll, editions: preEditionAll.editions.filter((e) => !e.development) } : preEditionAll;
// v10 draft (pico2 P1-L1, research D34): the edition this page opens in: `?edition=` in the address, else the one chosen
// before (kept per module), else the module's first; the switch in the header saves and reloads the page in another. A
// module without editions is unchanged.
const arch = withEdition(preEdition, new URLSearchParams(location.search).get('edition') ?? store.get('pips.edition'));
const EDITION = activeEdition(arch);
/** The edition of this module whose descriptor has projects (pico2: Full), or null. */
const PROJECT_EDITION = arch.editions?.find((e) => withEdition(preEdition, e.id).capabilities?.projects === true) ?? null;
// the program, workspace and view are kept per variant (src/ui/dom.js); a hosted tool keeps its own (the CPU + GPU tool,
// author 2026-11-05: its program is not the RISC-V Laboratory's)
setStorageVariant(arch.activeVariant ?? (TOOL?.within ? `tool-${TOOL.id}` : null));
if (EDITION) store.set('pips.edition', EDITION.id);
/** A variant's name for the reload question: the descriptor's own is `strings.variantLabel` (else the name). */
const variantLabel = (v) => (v ? base.variants[v].label : base.strings?.variantLabel ?? base.name);
/** The profiles of this page's variant, in menu order; the first is the default. */
const OWN_PROFILES = arch.engine.profiles.filter((p) => (p.variant ?? null) === arch.activeVariant);
mergeStrings(arch.strings); // the architecture's interface text over the shell's (phase 4)
const VIEWS = toolViews(arch, TOOL); // the views this tool shows (the NPU tool: ISA, its single-cycle view, NPU)
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
// v10 draft (pico2 P1-F1, research D31): programs are projects of several files (explorer, tabs, IndexedDB, zip, links v2);
// without the capability the shell is unchanged (one file, localStorage)
const PROJECTS = CAP.projects.enabled;

let rt = null; // the real-time run in progress (P1-M4): {engine, ring, out, dropped, raf, fraction, last}
let rtNoted = false; // the note that a view runs at full speed instead of real time, shown once
const RUN_LIMIT = 10_000_000; // steps in one run (WS-F-090)
const HISTORY_LIMIT = 1_000_000; // steps kept for step back
// The shell's state: the sources, the program and its settings, the breakpoints and watches (registers by id,
// W-D29 decision 3), the data loads (WS-F-145) and the platform script (W-D26). The program runs on the
// architecture's engine (contract), one per loaded program.
const session = {
  files: [{ name: `main${arch.language.extension}`, text: '' }],
  profile: OWN_PROFILES[0].id,
  subset: null, // an option of the profile (spec §6)
  program: null,
  imported: null, // v10 (draft): {content, kind, name} of an image kept across view changes (architectures with imageKinds)
  cSource: null, // v10 (draft, P1-L1): {file, text, lines} of the C program last compiled (Language.assemble's `source`)
  breakpoints: new Set(),
  watchRegs: new Set(),
  watchWords: new Set(),
  dataLoads: [],
  loadReport: { applied: [], dropped: [] },
  platformConfig: toolPlatform(),
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
  engine = session.runnable ? withEngineOpts(arch.engine.create(session.program, { platformConfig: session.platformConfig, runLimit: RUN_LIMIT, historyLimit: HISTORY_LIMIT,
    ...(inputs ? { inputs } : {}) })) : null;
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
  return l ? { file: PROJECTS ? edLoc(l)?.file : l.file, line: edLine(l.line) } : null;
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
// v12 draft (pico2 P1-B2 stage B2-3, ViewContext.holdRun): a view holds Run and Step while it edits the program's circuit; the
// reason is the Run button's tooltip and the console's answer to Run, Step or F5
let runHold = null;
let runBtnRef = null; // the Run button, once made (syncHold)
let lastStop = null; // how the last run ended: {stop, pc}, for the narrow screen's status
let selected = null;
let dirty = false;
// The language of the editor (spec §10.1): 'asm', or the architecture's other language (contract v5
// Language.extraLanguages; RISC-V: C), compiled to the assembly the session runs.
let lang = 'asm';
const XL = arch.language.extraLanguages?.[0] ?? null;
const XID = XL?.id ?? null;
// contract v10 draft: the C compilers a module offers (pico2 P1-F2: MAVILERA C and Pico SDK C); a project chooses one
// (research D33 Q5), the first by default, unless the edition names its compiler (pico2 Full: Pico SDK C, research D34
// Q6). An image language (`image: true`) builds a whole project into an image.
const C_LANGS = XL ? (arch.language.extraLanguages ?? []).filter((x) => x.extension === XL.extension) : [];
const cCompiler = () => (EDITION?.compiler ? C_LANGS.find((x) => x.id === EDITION.compiler)
  : C_LANGS.find((x) => x.id === project()?.compiler) ?? C_LANGS[0]) ?? null;
let cc = null; // XL's compiler, loaded with its first use (XL.load, WS-N-011)
let cMap = null; // source line of each line of the generated assembly (WS-F-082), or null
const sourceKey = () => (lang === 'asm' ? 'pips.source' : `pips.source.${lang}`);
/** A file name without the extra language's extension. */
// (any last extension: a C program kept under an assembly file's name gave "load-use.s.s"; GUI walkthrough, 2026-11-11)
const stem = (name) => name.replace(/\.\w+$/, '');

// --- panels -----------------------------------------------------------------------------
const consolePanel = new ConsolePanel({ onGoTo: (loc) => {
  ws.toggleSheet(false); ws.reveal('code'); // narrow screen: the source line is in the Code workspace
  if (PROJECTS && loc.file && project()?.files.some((f) => f.name === loc.file)) selectFile(loc.file); // projects: the location's file
  if (COMP) showComp(Boolean(comp && loc.file === comp.name)); // one-file shell: the companion's tab or the program's
  activeEd().selectAt(loc.line, loc.column ?? 1, loc.length ?? 0);
} });
// v10 draft (pico2 P1-M4, research D36 Q3; Descriptor.console.input): a line typed under the console goes to the module's
// input (pico2: UART0 RX, followed by its line end), to the engine, the view in use or the Worker of a run (giveInput)
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
/** The editor language of a project file: the extra language's for its extension (C), else assembly. */
const langOfFile = (name) => (XL && name.toLowerCase().endsWith(XL.extension) ? XID : 'asm');
// projects: one editor per open file behind tabs (src/ui/editor-stack.js), the same interface for the rest of the shell
const editor = PROJECTS ? new EditorStack({
  language: arch.language,
  onChange: (name, text) => { dirty = true; try { proj.setText(name, text); } catch { /* not a file of the project */ } editorStatus(); saveSoon(); },
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
// v10 draft (Language.companion; pico2 Lite, research D43, P1-M8 Q3 B): the language's companion file (pico2: a .pio file) beside the
// one-file shell's program, in a second editor tab opened on demand (File ▸ Add PIO file); without it the shell stays one file. It is
// built with the program (assembly: one more file for Language.assemble; C: `companions` for the compiler), kept in this browser,
// carried by links, settings files and templates (`companion`), saved and opened in the edition with projects with the program.
const COMP = !PROJECTS ? arch.language.companion ?? null : null;
let comp = null;    // {name, text}, or null
let compOn = false; // its tab is the one shown
const compEd = COMP ? new Editor({ language: { editor: COMP.editor ?? arch.language.editor, comment: COMP.comment ?? arch.language.comment },
  listId: 'ed-complete-companion',
  onChange: (text) => { if (!comp) return; comp.text = text; dirty = true; keepComp(); editorStatus(); saveSoon(); syncPrimary(); },
  onCursorLine: () => editorStatus() }) : null;
/** The companion as files for a build (none without one). */
const compFiles = () => (comp ? [{ name: comp.name, text: comp.text }] : []);
/** The editor shown: the program's, or the companion's. */
const activeEd = () => (compOn && comp ? compEd : editor);
// v12 draft (Language.companions; pico2 P1-B2, research D51 Q1 A): a companion a view edits (pico2: the circuit, edited in the Board
// view; no editor tab). One-file shell: kept in this browser, carried by links, settings files and templates (`companions`), saved
// with the program; projects: the project's file of the fixed name (`projectFile`). The engine gets its text as the engine setting
// `option` with the others (withEngineOpts, applyEngineOpts); a changed circuit starts the program again (the engine's rule, D51 Q3 A).
const VCOMP = (arch.language.companions ?? []).find((c) => c.editor === 'view') ?? null;
let vcomp = null; // {name, text}, or null (one-file shell)
/** The view companion's text, or null. */
const vcompText = () => (!VCOMP ? null : PROJECTS ? (project()?.files.find((f) => f.name === VCOMP.projectFile)?.text ?? null) : (vcomp?.text ?? null));
/** Set the view companion (a template, link, file, restore or the view; null: none); `apply`: give it to the engines now. */
function setVcomp(c, { apply = true } = {}) {
  if (!VCOMP) return;
  const text = c && typeof c.text === 'string' ? c.text : null;
  if (PROJECTS) {
    if (!project()) return;
    const has = project().files.some((f) => f.name === VCOMP.projectFile);
    if (text === null) { if (has) proj.deleteFile(VCOMP.projectFile); } else if (has) proj.setText(VCOMP.projectFile, text); else proj.addFile(VCOMP.projectFile, text);
    if (has || text !== null) afterFiles(false);
  } else {
    vcomp = text === null ? null : { name: typeof c.name === 'string' ? c.name : `${stem(sourceName())}${VCOMP.extension}`, text };
    store.set('pips.vcompanion', vcomp ? JSON.stringify(vcomp) : '');
  }
  if (apply) applyEngineOpts();
}
/** The open project (projects only). */
let proj = null;
const project = () => proj?.project ?? null;
// the instruction inspector: the architecture's own (contract v2), or the plain fields table
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

/** The editor's breakpoint gutter: a click on a line number sets or clears a breakpoint at its first instruction. */
function toggleBreakLine(line, file = PROJECTS ? editor.active : null) {
  const p = session.program;
  const l = p && !p.imported ? p.listing.find((x) => atLoc(x, line, file)) : null;
  if (!l) { consolePanel.message(STRINGS.tools.noBreakLine); return; }
  toggleBreak(l.address);
}

/** Mark in the editor's gutter the lines that hold a breakpoint. */
function showBreakLines() {
  const p = session.program;
  if (PROJECTS) { // each file's editor marks its own lines
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
  input: (x) => giveInput(x), message: (text, kind) => consolePanel.message(text, kind),
  // v10 draft (pico2 P1-M4): the Pins panel's Replay and Forget
  command: (c) => (c === 'replay' ? replayInputs() : c === 'forget' ? forgetInputs() : undefined),
  // v10 draft (pico2 P1-M5): the Language options this panel shows (pico2's Pins panel: the speaker and its converter)
  option: (id) => panelOption(id), setOption: (id, value) => setPanelOption(id, value) }) })));
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

/**
 * The editor location {file, line} of a listing row, or null. `file`: projects (P1-F1) the project file (a C entry's
 * rows are its lines; assembly rows carry their file from the assembler); one-file shell, null.
 */
function edLoc(row) {
  if (!row?.line) return null;
  const line = edLine(row.line);
  if (!line) return null;
  return { file: PROJECTS ? (lang === XID ? project()?.entry : row.file) ?? null : null, line };
}

/** Whether a listing row is at editor line `line` of `file` (the file is ignored in the one-file shell). */
function atLoc(row, line, file) {
  const loc = edLoc(row);
  return Boolean(loc) && loc.line === line && (!PROJECTS || loc.file === file);
}

/**
 * The current-line marker at a listing row (null: none). Projects: the marker is in the row's file, and that file's tab
 * comes to the front when the marked location changes (a step into another file), not on every refresh.
 */
let markedAt = null;
function markCurrent(row) {
  if (!PROJECTS) { editor.setCurrentLine(row?.line ? edLine(row.line) : null); return; }
  const loc = edLoc(row);
  const key = loc ? `${loc.file}:${loc.line}` : null;
  editor.setCurrentAt(loc, key !== markedAt);
  markedAt = key;
}

/** Projects: C line links (WS-F-082) belong to the entry file, so they show only while it is the active tab. */
const cLinksHere = () => !PROJECTS || editor.active === project()?.entry;

/** Show the generated assembly; each line knows its C line, and pointing at it marks that line in the editor. */
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
  if (lang !== XID || !cMap || !cLinksHere()) return;
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
  if (b === runBtnRef) syncHold();
}
/** The Run button while a view holds runs (v12 draft holdRun): marked unavailable, its tooltip the reason. */
function syncHold() {
  const b = runBtnRef;
  if (!b) return;
  if (runHold) { b.setAttribute('aria-disabled', 'true'); b.title = runHold; }
  else if (b.hasAttribute('aria-disabled')) { b.removeAttribute('aria-disabled'); b.title = b.getAttribute('aria-label') ?? ''; }
}
// An export of a whole run (WS-F-124 to WS-F-126); `.dp-only` items exist only in a datapath view.
const runExport = (label, action, cls = '') => el(`button${cls}`, { type: 'button', onclick: action, title: STRINGS.exportRunTitle, text: label });
const profileOption = (p) => el('option', { value: p.id, text: p.label });
const profileSel = el('select', { 'aria-label': STRINGS.profile, onchange: (e) => {
  const id = e.target.value;
  if (variantOf(arch, id) !== arch.activeVariant) { e.target.value = session.profile; changeVariant(id); return; } // contract v9
  session.profile = id; store.set('pips.profile', session.profile); syncLangControls(); doAssemble();
} },
  // contract v9: with variants, the profiles are grouped by instruction set
  arch.variants ? [null, ...Object.keys(arch.variants)].map((v) => el('optgroup', { label: variantLabel(v) },
    arch.engine.profiles.filter((p) => (p.variant ?? null) === v).map(profileOption)))
    : arch.engine.profiles.map(profileOption));
const variantDialog = arch.variants ? new VariantDialog() : null;
if (variantDialog) document.body.append(variantDialog.root);
/** Contract v9: reload the page in the variant of profile `id`, if the user agrees; the workspace is saved first. */
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
// v10 (capability realtime; pico2 P1-M4, research D36 Q1, Q10): Real time first and the default, beside Full speed and Animated
const REALTIME = Boolean(CAP.realtime?.enabled && arch.realtime);
const speedSel = el('select', { 'aria-label': STRINGS.speed },
  REALTIME ? el('option', { value: 'rt', text: STRINGS.speedRealtime, title: STRINGS.realtime.title }) : null,
  el('option', { value: 'max', text: STRINGS.speedMax }), el('option', { value: 'slow', text: STRINGS.speedSlow }));
// v10 capability audio (pico2 P1-M5, research D39 Q6-Q7; ADR-0005): the Sound button (off until the student turns it on,
// remembered in this browser; browsers start audio only after a click) and Render and play in the Speed menu (N seconds of
// machine time at full speed, then played: for programs that cannot keep up, SDK programs at 150 MHz)
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
// remembered sound wakes at the first click or key on the page (the browser's rule for starting audio)
if (soundOn) {
  const wake = () => { audioHost.enable(); document.removeEventListener('pointerdown', wake, true); document.removeEventListener('keydown', wake, true); };
  document.addEventListener('pointerdown', wake, true); document.addEventListener('keydown', wake, true);
}
// v10 draft (pico2 Lite, P1-L1, research D34 Q4): an edition with `primary` has one state-aware button (Build, Run, Pause,
// Run again; ui/primary-action.js) in place of Build and Run
const PRIMARY_BTN = Boolean(EDITION?.primary);
const runBtn = tool('play', STRINGS.run, () => (PRIMARY_BTN ? primaryClick() : running ? pause() : startRun()), { key: 'F5', cls: '.tool-run' });
runBtnRef = runBtn;
const runStatus = el('span.run-status', { role: 'status', 'aria-live': 'polite' });
// the image kinds the architecture opens (contract v10 draft, Language.imageKinds; default .hex and .bin); none in an
// edition without image import (pico2 Lite)
const imageKinds = () => arch.language.imageKinds ?? IMAGE_KINDS.slice(0, 2);
const pickImages = !(EDITION && !CAP.imageImport.enabled);
const fileInput = el('input', { type: 'file', accept: ['.s,.asm,.S,.c', ...(PROJECTS ? ['.h', '.zip', ...(arch.language.extraExtensions ?? [])] : []), ...(COMP ? [COMP.extension] : []), ...(pickImages ? imageKinds().map((k) => `.${k}`) : []), '.json'].join(','), hidden: true, onchange: (e) => { openFile(e.target.files[0]); e.target.value = ''; } });
const assembleBtn = gate(tool('build', TL.build, () => doAssemble({ user: true }), { key: 'Control+Enter', cls: '.tool-build' }), CAP.assembler);

/** The primary button's action now (Lite): from the run, the text's changes and the program's state. */
function primaryNow() {
  const st = engine?.state();
  const ended = lastStop?.stop === STOP.HALT || lastStop?.stop === STOP.ERROR || Boolean(st && (st.halted || st.error));
  return primaryAction({ running, changed: dirty || !session.program, runnable: session.runnable, ended });
}
function primaryClick() {
  const a = primaryNow();
  // the author, 2026-11-11 (GUI walkthrough; replaces D34 Q5 A): Build stands beside this button at all times, and Run on a
  // changed text builds first and runs if the build gave a program
  if (a === 'build') { doAssemble({ user: true }); if (!dirty && session.runnable) startRun(); }
  else if (a === 'pause') pause();
  else if (a === 'again') { doReset(); startRun(); }
  else startRun();
}
/** The primary button's icon, label and shortcut for its action now; the label is its accessible name. */
function syncPrimary() {
  if (!PRIMARY_BTN) return;
  const a = primaryNow();
  if (runBtn.dataset.action === a) return;
  runBtn.dataset.action = a; // 'build': the text changed; the button still reads Run (it builds first), Build is beside it
  const shown = a === 'build' ? 'run' : a;
  const label = { run: STRINGS.run, pause: STRINGS.pause, again: STRINGS.runAgain }[shown];
  setToolLabel(runBtn, PRIMARY[shown].icon, label, PRIMARY[shown].key);
  if (PRIMARY[shown].key) runBtn.setAttribute('aria-keyshortcuts', PRIMARY[shown].key); else runBtn.removeAttribute('aria-keyshortcuts');
  runBtn.dataset.keys = PRIMARY[shown].key ? keyText(PRIMARY[shown].key) : '';
}

/** v10 draft (P1-L1, research D34 Q3): reload the page in edition `id` (and with `hash`, a link to open there); saved first. */
async function switchEdition(id, hash = '') {
  saveWorkspace();
  if (proj) await proj.saveNow();
  store.set('pips.edition', id);
  const u = new URL(location.href);
  u.searchParams.delete('edition'); // the choice is kept; the address would otherwise override it
  history.replaceState(null, '', `${u.pathname}${u.search}${hash}`);
  location.reload();
}

/**
 * v10 draft (P1-L1, research D34): "Open in Full": this program as a new project of the edition with projects, which the
 * page then opens. A program in a C language that edition does not build (MAVILERA C; Full builds C with the Pico SDK)
 * stays: Full could not build it.
 */
async function openInEdition(e) {
  const E = STRINGS.edition;
  if (lang === XID && e.compiler && e.compiler !== XID) {
    const thereC = preEdition.language.extraLanguages?.find((x) => x.id === e.compiler)?.label ?? e.compiler; // not offered in this edition
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
// C (spec §10.1): the language of the editor, the translation mode (WS-F-081) and, for the ISA profile, the ISA (WS-F-083)
const C = STRINGS.cc;
const savedOpt = (k, list, d) => { const v = store.get(k); return list.includes(v) ? v : d; };
// (a tooltip on each select: in a narrow editor the visible labels drop, and a first-time user could not tell them apart)
const langSel = el('select', { 'aria-label': C.language, title: C.language, onchange: (e) => setLang(e.target.value, { user: true }) },
  el('option', { value: 'asm', text: C.languages.asm }), XL ? gate(el('option', { value: XID, text: XL.label }), CAP.cLanguage) : null);
// the compiler's options (contract v5), kept in the browser as pips.cc.<option>; an option with `profiles` only for those
const xlOpts = (XL?.options ?? []).map((o) => {
  const sel = el('select', { 'aria-label': o.label, onchange: (e) => { store.set(`pips.cc.${o.id}`, e.target.value); doAssemble(); } },
    o.values.map((v) => el('option', { value: v.id, text: v.label })));
  sel.value = savedOpt(`pips.cc.${o.id}`, o.values.map((v) => v.id), o.default);
  // the visible label drops in a narrow editor (theme.css container query); the select keeps its name (aria-label)
  return { o, sel, label: el('label', { title: o.title ?? null }, el('span.ed-opt-label', { text: `${o.label} ` }), sel) };
});
for (const x of xlOpts) x.sel.title = x.o.title ?? x.o.label; // every select carries a tooltip (its title, else its name)
/** The compiler's options as chosen: {id: value}. */
const xlValues = () => Object.fromEntries(xlOpts.map((x) => [x.o.id, x.sel.value]));
const ccOpts = el('span.cc-opts', { hidden: true }, xlOpts.map((x) => x.label));
// v10 draft (pico2 P1-M4, research D36 Q2): the module's build options (Language.options: pico2's clk_sys), for every language the
// editor builds, kept as pips.<module>.opt.<option>
// P1-M5 (research D39 Q4-Q5, contract v10 draft): an option with `apply: 'engine'` is an engine setting (pico2: the speaker and its
// converter): no rebuild, Engine.configure instead; one with `panel` is shown by that panel (PanelContext.option/setOption)
const asmOpts = (arch.language.options ?? []).map((o) => {
  const key = `pips.${arch.id}.opt.${o.id}`;
  const sel = el('select', { 'aria-label': o.label, title: o.title ?? o.label, onchange: (e) => { store.set(key, e.target.value); if (o.apply === 'engine') applyEngineOpts(); else doAssemble(); } },
    o.values.map((v) => el('option', { value: v.id, text: v.label })));
  sel.value = savedOpt(key, o.values.map((v) => v.id), o.default);
  return { o, key, sel, label: el('label', { title: o.title ?? null }, el('span.ed-opt-label', { text: `${o.label} ` }), sel) };
});
/** The module's options as chosen: {id: value} (all of them: links and settings files carry them). */
const asmValues = () => Object.fromEntries(asmOpts.map((x) => [x.o.id, x.sel.value]));
/** The build options only (assemble, compile, the program's key). */
const buildValues = () => Object.fromEntries(asmOpts.filter((x) => x.o.apply !== 'engine').map((x) => [x.o.id, x.sel.value]));
/** The engine settings (Engine.configure). */
const engineValues = () => ({ ...Object.fromEntries(asmOpts.filter((x) => x.o.apply === 'engine').map((x) => [x.o.id, x.sel.value])),
  ...(VCOMP ? { [VCOMP.option]: vcompText() } : {}) }); // v12 draft: the view companion (pico2: the circuit)
const HAS_ENGINE_OPTS = asmOpts.some((x) => x.o.apply === 'engine') || Boolean(VCOMP);
const shownOpts = asmOpts.filter((x) => !x.o.panel);
const buildOpts = el('span.cc-opts.build-opts', { hidden: shownOpts.length === 0 }, shownOpts.map((x) => x.label));
/** An engine just made gets the engine settings. */
function withEngineOpts(e) { if (HAS_ENGINE_OPTS) e?.configure?.(engineValues()); return e; }
/** The engine settings changed: to the page's engine, the view's own, and the Worker's during a run. */
function applyEngineOpts() {
  if (!HAS_ENGINE_OPTS) return;
  const v = engineValues();
  engine?.configure?.(v);
  const ve = uv()?.realtime?.engine?.();
  if (ve && ve !== engine) ve.configure?.(v);
  if (running && workerRun && worker) worker.postMessage({ type: 'configure', values: v });
  if (running) updateArchPanels(); else refresh();
}
/** PanelContext.option / setOption (contract v10 draft): an option a panel shows. */
const panelOption = (id) => asmOpts.find((x) => x.o.id === id)?.sel.value ?? null;
function setPanelOption(id, value) {
  const x = asmOpts.find((y) => y.o.id === id);
  if (!x || !x.o.values.some((v) => v.id === value)) return;
  x.sel.value = value; store.set(x.key, value);
  if (x.o.apply === 'engine') applyEngineOpts(); else doAssemble();
}

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
  session.platformConfig = { ...toolPlatform(), stimulus, rx: (t.rx ?? []).map((e) => ({ ...e })), mtimeDiv: t.mtimeDiv ?? 1 };
  // P1-M5: a template may choose module options (pico2: the speaker pin and its converter; `opts` as in a link)
  // research D43: a template may come with a companion file (pico2: its .pio file), fetched with it
  let companion = null;
  if (t.companion) {
    const rc = await fetch(new URL(t.companion, contentUrl('templates')));
    if (!rc.ok) { consolePanel.message(STRINGS.templates.failed(`${t.companion}: ${rc.status}`), 'error'); return; }
    companion = { name: t.companion, text: await rc.text() };
  }
  // v12 draft (pico2 P1-B2): a template may come with its circuit file
  let companions = null;
  if (t.circuit && VCOMP) {
    const rc = await fetch(new URL(t.circuit, contentUrl('templates')));
    if (!rc.ok) { consolePanel.message(STRINGS.templates.failed(`${t.circuit}: ${rc.status}`), 'error'); return; }
    companions = [{ name: t.circuit, text: await rc.text() }];
  }
  await applyShared({ view: t.view, profile: t.profile ?? OWN_PROFILES[0].id, lang: t.lang, name: t.file, source: await r.text(), opts: t.opts ?? null, companion, companions,
    ...Object.fromEntries(SETTINGS.map((v) => [v.settings.key, t[v.settings.key] ?? null])), mem: t.mem ? readConfig(t.mem) : null },
    STRINGS.templates.opened(t.title));
}
/** The templates as menu items: a heading per group, a button per template. */
function templateItems(ix, make) {
  return Object.entries(ix.groups).flatMap(([g, title]) => {
    const items = ix.templates.filter((t) => t.group === g && (!t.tool || t.tool === TOOL?.id) // a tool's own templates on its page only (CPU + GPU)
      && (!EDITION?.compiler || !t.lang || t.lang === 'asm' || t.lang === EDITION.compiler)); // pico2 Full: no MAVILERA C templates (P1-L1)
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
// a module without the memory model (no memory simulation: pico2, SAP, ARMv7, 8086, GPU) does not show the button at all
// (author, 2026-11-10); a disabled button there only said that the model is missing
memBtn.hidden = !CAP.memoryModel.enabled;
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
// v10 draft (Language.lineStep; pico2, research D38): one C line at a time on the editor, for a program with a line table;
// shown only then (the C source view's Step line and Back line, folded into the editor)
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
// File ▸ Save: the program, and its companion file with it (two downloads)
const saveBtn = btn(STRINGS.save(arch.language.extension), () => { download(sourceName(), editor.value); if (comp) download(comp.name, comp.text); if (vcomp) download(vcomp.name, vcomp.text, 'application/json'); });
const removeCompBtn = COMP ? el('button', { type: 'button', text: COMP.remove, hidden: true, onclick: () => removeComp() }) : null;
const fileMenuBox = fileMenu(
    btn(STRINGS.open, () => fileInput.click()),
    btn(STRINGS.examples.menu, () => examplesDialog.open()),
    gate(btn(STRINGS.exercise.menu, () => exerciseDialog.open()), CAP.exercises),
    saveBtn,
    // v10 draft (Language.companion, research D43): the second tab of a Lite program
    ...(COMP ? [el('button', { type: 'button', text: COMP.add, title: COMP.addTitle ?? null, onclick: () => addComp() }), removeCompBtn] : []),
    // v10 draft (pico2 Lite, P1-L1): this program as a new project of the edition with projects (Full)
    PROJECT_EDITION && !PROJECTS ? el('button', { type: 'button', text: STRINGS.edition.openIn(PROJECT_EDITION.label),
      title: STRINGS.edition.openInTitle(PROJECT_EDITION.label), onclick: () => openInEdition(PROJECT_EDITION) }) : null,
    gate(btn(STRINGS.exportHex, () => session.program && download('prog.hex', arch.exports.image(session.program).hex)), CAP.exportImage),
    gate(btn(STRINGS.exportBin, () => session.program && download('prog.bin', arch.exports.image(session.program).bin, 'application/octet-stream')), CAP.exportImage),
    btn(STRINGS.exportListing, () => session.program && download('prog.lst', listingText(session.program))),
    // an image language's built program (pico2 P1-F2): the ELF, and the formats the language converts it to (.uf2)
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
// the processor context: the Architecture (profile) and, in a view that has them, the subset
const archCtx = el('div.arch-ctx', {}, profileField);
// The toolbar docked as a column (ui/dock.js): the speed and the processor context, which do not fit as an icon, move
// into these menus (the same nodes); in the row they are hidden and empty. The tooltip tells the value chosen.
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
  group('.tb-run', assembleBtn, runBtn), // Lite too (the author, 2026-11-11): Build beside the state-aware Run
  group('.tb-step', stepBackBtn, stepBtn, lineBackBtn, lineStepBtn, stepOverBtn, stepOutBtn, runToCursorBtn, resetBtn),
  group('.tb-speed', speedField, soundBtn, archCtx, speedFly, archFly),
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
// View ▸ Theme (author, 2026-11-10; it was a header button cycling system, dark, light): as the system ('', no
// data-theme), or one of the token sets of theme.css. The choice is the platform's (pips.theme), kept for every module.
const THEMES = ['', 'light', 'dark', 'dim', 'black', 'sepia', 'hc-light', 'hc-dark'];
function setTheme(t) {
  if (!THEMES.includes(t)) t = '';
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  store.set('pips.theme', t);
}
/** View ▸ Theme: a list that applies a theme as soon as it is chosen (the menu stays open, so that the themes can be compared). */
function themeRow() {
  const cur = document.documentElement.dataset.theme ?? '';
  const sel = el('select.theme-sel', { 'aria-label': TL.themes.group, 'data-cmd': 'theme', onchange: () => setTheme(sel.value) },
    THEMES.map((t) => el('option', { value: t, text: TL.themes.names[t], selected: t === cur })));
  return el('label.menu-check.theme-row', { title: TL.themes.title }, el('span', { text: TL.themes.group }), sel);
}
// The workspace's presentation (ui/view-mode.js): Normal view, Datapath focus, Full screen. One state; the browser's
// full screen is read from the Fullscreen API, never stored; a page opens in Normal view. applyViewMode lays it out.
const VM = STRINGS.viewModes;
const viewModes = new ViewModes({ onChange: (s) => applyViewMode(s),
  onError: (e) => consolePanel.message(e.message === 'unsupported' ? VM.unavailable : STRINGS.fullScreenRefused(e.message), 'warn') });
// Full screen: the page over the whole display in the compact layout (the View menu's Full screen, the same state);
// hidden where the browser cannot.
const fullBtn = tool('fullscreen', STRINGS.fullScreen, () => (viewModes.fullscreen ? viewModes.exit() : viewModes.set('fullscreen')), { iconOnly: true });
fullBtn.hidden = !viewModes.supported;
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
// Keys (GUI walkthrough, 2026-11-11): a list, one key per line, only the commands this laboratory has; Escape and a click
// elsewhere close it, like a menu (it stayed open over the workspace and over the next menu)
const keysBox = el('details.keys', {}, el('summary.tool.tool-icon', { title: STRINGS.keys, 'aria-label': STRINGS.keys }, icon('keyboard'),
  el('span.tool-label', { text: STRINGS.keys })),
el('p', {}, STRINGS.shortcutList
  .filter(([, , needs]) => !needs || (needs === 'stepOver' ? CAP.stepOver.enabled : VIEWS.some((v) => ['datapath', 'bus'].includes(v.kind))))
  .map(([keys, what]) => el('span.key-line', {}, el('kbd.mono', { text: keys }), el('span', { text: what })))));
// (on the document: the list has no control to hold the focus, so Escape must close it from wherever the focus is)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !keysBox.open) return;
  keysBox.open = false;
  if (keysBox.contains(document.activeElement)) { e.stopPropagation(); keysBox.querySelector('summary').focus(); }
}, true);
document.addEventListener('click', (e) => { if (!keysBox.contains(e.target)) keysBox.open = false; });
const viewMenu = dropMenu(el('summary.tool', { title: STRINGS.layout.view }, icon('layout'), el('span.tool-label', { text: STRINGS.layout.view })),
  [], { onOpen: (list) => fillViewMenu(list), cls: '.view-menu-top' });
// Dock: where the execution controls stand, a row on top or a column at the left or right (ui/dock.js); the choice
// applies at once. Its button shows the place chosen; it is hidden on a narrow screen, which keeps the row.
const DOCK_ICON = { top: 'dockTop', left: 'dockLeft', right: 'dockRight' };
let tbDock = null; // the ToolbarDock, made once the workspace is in the page
// In Focus or Full screen the controls are a column: Left or Right chosen there is kept; Top returns to the normal view.
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
/** A panel heading: icon, title and any tools (the collapse button joins it). */
function head(title, iconName = null, ...tools) {
  return el('h2', {}, iconName ? icon(iconName, { size: 15 }) : null, el('span.panel-title', { text: title }),
    tools.length ? el('span.panel-head-tools', {}, tools) : null);
}
const tabs = (items, { onSelect = null } = {}) => {
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
    onSelect?.(i, items[i][0]);
  }
  bar.append(...buttons);
  select(0);
  const selectTitle = (title) => { const i = items.findIndex(([t]) => t === title); if (i >= 0) select(i); return i >= 0; };
  return { root: el('div.tabbed', {}, bar, host), bar, select, selectTitle };
};

// --- views (WS-U-010): the architecture's views (contract: arch.views), those the tool shows (VIEWS). The first is the instruction-level view the
// shell draws itself; the others are loaded with their tab (WS-N-011) and give a ViewInstance (RISC-V: the
// single-cycle, multicycle and pipelined views of Chapters 6 to 8, and the comparison of the three, WS-F-060)
let mode = VIEWS[0].id;
const viewOf = (id) => VIEWS.find((v) => v.id === id) ?? null;
const inst = {}; // view id -> ViewInstance, created on first use
const memsysOf = {}; // view id -> the MemorySystem the view was given (null: ideal memory of the default size)
/** A view with its own model and drawing (kind datapath or bus). */
const isDp = (id = mode) => ['datapath', 'bus'].includes(viewOf(id)?.kind);
const isCmp = (id = mode) => viewOf(id)?.kind === 'compare';
/**
 * v11 (View.engine 'page'; pico2's Board view, P1-B1, research D48 Q2 B): a drawing view without a model of its own, which
 * draws the page's engine. The shell runs the program as in the instruction view (uv() stays null: step, run, the Worker, inputs,
 * registers) and lays the page out as for a drawing view; it calls the view's render() after each refresh and live() with each
 * live state of a real-time run.
 */
const isPageView = (id = mode) => viewOf(id)?.engine === 'page';
const uv = () => (isDp() && !isPageView() ? inst[mode] ?? null : null); // the datapath view in use, or null in the ISA, comparison and page views
const pv = () => (isPageView() ? inst[mode] ?? null : null); // the page-engine view in use, or null

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
  create: () => withEngineOpts(arch.engine.create(session.program, { platformConfig: session.platformConfig, historyLimit: 1 })) });
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
    ...(mode === VIEWS[0].id ? { analyse: analyseTrace, trace: traceResult && traceResult.at === (engine?.state().retired ?? 0) ? traceResult : liveTrace(),
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
  // v10 draft (pico2 P1-M4): the pins of an engine with Engine.live, for the Pins panel (the view's own engine in a view)
  const ie = inputEngine();
  const live = s && !rt ? ie?.live?.({ uartFrom: Infinity }) : null;
  if (state && live) { state.pins = live.pins; state.parts = live.parts; } // pico2 P1-M7: the lab kit (LCD, environment, ADC inputs)
  if (state && ie?.restart) state.inputs = (ie.inputs?.().length ?? 0) + (workerRun ? workerInputs.length : 0); // the Replay's count
  if (state && ie?.audioStatus) state.audio = ie.audioStatus(); // pico2 P1-M5: the speaker and the converter in use
  if (state && !rt && ie?.panelState) state.panel = ie.panelState(); // v10 draft (pico2 P1-M5): the module's own panels' data (PWM, DMA)
  for (const { inst } of archPanels) inst.update(state, { accepts, running });
}
/**
 * An input of an architecture panel (contract v8): to the view in use, to the Worker during a long run (kept
 * until it answers, for an input that arrives after its run ended), or to the engine; then redraw.
 */
/** The engine that takes the inputs now: the view's own (pico2's C source view, contract v10 draft) or the page's. */
const inputEngine = () => (uv() ? uv().realtime?.engine?.() ?? null : engine);
/** v10 draft (pico2 P1-M4, research D36 Q5): back to the start with the inputs given so far (Engine.restart), then run them again. */
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
// the browser smoke's hook (tools/pico2-realtime-smoke.mjs; only with ?selftest in the address): the state hash now, and a
// replay check, a fresh engine created with the run's inputs and run to the same step count (D36 Q5: bit-exact replay)
if (new URLSearchParams(location.search).has('selftest')) {
  globalThis.__mavileraTest = {
    stateHash: () => inputEngine()?.stateHash?.() ?? null,
    registers: () => inputEngine()?.state?.().registers ?? null, // P1-M6: tools/pico2-cores-smoke.mjs
    // P1-M5: the AudioWorklet's counts (frames played, underruns) for tools/pico2-audio-smoke.mjs
    audioStats: () => audioHost?.stats() ?? null,
    audioResetStats: () => audioHost?.resetStats(),
    replayCheck: () => {
      const e = inputEngine();
      if (!e?.stateHash || !session.runnable) return null;
      const s = e.state(), hash = e.stateHash();
      const f = withEngineOpts(arch.engine.create(session.program, { inputs: e.inputs(), runLimit: Infinity })); // the same settings (P1-M5)
      f.run({ chunk: s.steps, breakpoints: new Set() });
      return { steps: s.steps, inputs: e.inputs().length, hash, replay: f.stateHash(), replaySteps: f.state().steps, equal: f.stateHash() === hash && f.state().steps === s.steps };
    },
  };
}
/** Forget the inputs (Engine.restart with none): the program starts again without them. */
function forgetInputs() {
  const e = inputEngine();
  if (running || !e?.restart) return;
  e.restart([]);
  uv()?.realtime?.sync?.();
  consolePanel.message(STRINGS.realtime.forgot);
  refresh();
}
/** The inputs of a link, settings file or workspace, given to the engine in use from the start (Engine.restart). */
function applyInputs(list) {
  const e = inputEngine();
  if (!Array.isArray(list) || !list.length || !e?.restart) return false;
  try { e.restart(list); } catch (err) { consolePanel.message(STRINGS.realtime.badInputs(err.message), 'error'); return false; }
  uv()?.realtime?.sync?.();
  return true;
}
function giveInput(x) {
  // a run in the Worker (full speed or real time, P1-M4) gets the input there, stamped at its present cycle
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
// the subsets of the profile of a view that offers them (RISC-V: the Chapter 6 laboratory subset and extension); the first is the whole profile
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
// The compact header of Focus and Full screen (ui/view-mode.js) keeps the brand (MAVILERA and the architecture) and
// adds the open view's name and the mode, the View and Dock menus, and Exit; the rest of the header waits (theme.css).
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
// v10 draft (pico2 P1-L1, research D34 Q1, Q3): the edition switch beside the brand; another edition reloads the page
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
// Each control of the two bars carries its command's id (data-cmd), wherever the overflow puts it.
for (const [cmd, node] of Object.entries({ assemble: assembleBtn, run: runBtn, stepBack: stepBackBtn, step: stepBtn, lineStep: lineStepBtn, lineBack: lineBackBtn, stepOver: stepOverBtn,
  stepOut: stepOutBtn, runToCursor: runToCursorBtn, reset: resetBtn, speed: speedSel, memory: memBtn, templates: templatesMenu, exercise: exerciseBtn,
  file: fileMenuBox, profile: profileSel, subset: subsetSel, views: viewTabs, layout: viewMenu, projector: projBtn,
  fullScreen: fullBtn, keys: keysBox, help: helpBtn, moreHeader: headerMore.menu, moreToolbar: toolbarMore.menu,
  dock: dockMenu, speedMenu: speedFly, profileMenu: archFly, viewExit: exitBtn, ...(editionSwitch ? { edition: editionSwitch } : {}) })) node.dataset.cmd = cmd;
// The order in which each bar gives way, lowest priority first: compact styles, then controls into its More menu.
// Assemble, Run and Step never leave the toolbar; the brand never leaves the header.
headerFit = overflowBar({ bar: header, more: headerMore.menu, sections: headerMore.bodies, steps: [
  { cls: 'hb-tight' }, { cls: 'hb-views-active' }, // the views: only the open one keeps its name
  { node: projBtn, group: 'workspace' }, { node: dockMenu, group: 'workspace' }, { node: keysBox, group: 'application' }, { node: fullBtn, group: 'application' },
  { node: viewMenu, group: 'workspace' }, { cls: 'hb-views-icons' },
  { node: viewTabs, group: 'views' }, { node: helpBtn, group: 'application' },
  ...(editionSwitch ? [{ node: editionSwitch, group: 'workspace' }] : []), // pico2 P1-L1: the edition switch last of all
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
    // a tool inside this module (the NPU, `?tool=npu`) shows its own lockup
    const [full, small] = await Promise.all([brandSvg(TOOL?.header ?? arch.content?.logo ?? 'mavilera-logo.svg'), brandSvg('mavilera-icon.svg')]); // contract v6
    full.classList.add('brand-logo', 'brand-full');
    small.classList.add('brand-logo', 'brand-icon');
    // MAVILERA goes to the landing page, the architecture part opens the switcher (docs/architecture/arch-switcher.md)
    const where = { protocol: location.protocol, href: location.href, release: !!document.querySelector('meta[name="risc-vista-edition"][content="release"]') };
    const switcher = archSwitcher({ logo: full, targets: switchTargets(TOOL?.within ?? TOOL?.id ?? ARCH_ID, where), home: homeUrl(where), current: TOOL?.name ?? STRINGS.appFull,
      loadLogo: (file) => brandSvg(file), strings: STRINGS.archSwitch, nameAt: NAME_AT });
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
  el('p.about-expansion', { text: `${STRINGS.appName}: ${STRINGS.appExpansion}` }),
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
const viewForProfile = (profile) => VIEWS.find((v) => !isCmp(v.id) && (v.profile ?? OWN_PROFILES[0].id) === profile)?.id ?? VIEWS[0].id;
const examplesDialog = new ExamplesDialog({ index: contentUrl('examples'), templates: () => loadTemplates(), onTemplate: (t) => openTemplate(t), templateItems, onOpen: async (x, text) => {
  let source = text;
  if (x.gcc) { const imps = await arch.language.importers(); source = (imps.find((i) => i.test(text)) ?? imps[0]).convert(text, x.file).text; }
  await applyShared({ view: viewForProfile(x.profile), profile: x.profile === OWN_PROFILES[0].id ? x.profile : isaProfile,
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
const scratchIn = el('input.mono.scratch-in', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': STRINGS.scratch.label,
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
function paneControls(node, title, { side = false } = {}) {
  const L = STRINGS.layout;
  const up = el('button.pane-up', { type: 'button', onclick: () => midSplit.setCollapsed(midSplit.panes[0].id, !midSplit.collapsed[0]) });
  const max = el('button.pane-max', { type: 'button', onclick: () => setMidMax(node, !workspace.classList.contains('mid-max')) });
  // a drawing view's details (author, 2026-11-13, pico2 Board): to the third column in place of the registers, so that the
  // drawing has the whole middle column; and back under the drawing
  const sideBtn = side ? el('button.pane-side', { type: 'button', onclick: () => setInfoSide(!infoSide) }) : null;
  node.querySelector(':scope > h2').append(...[sideBtn, up, max].filter(Boolean));
  node.addEventListener('keydown', (e) => { if (e.key === 'Escape' && workspace.classList.contains('mid-max')) { setMidMax(node, false); max.focus(); } });
  const sync = () => {
    const here = node._split === midSplit && midSplit.panes[1]?.node === node;
    up.hidden = !here;
    max.hidden = !here;
    if (sideBtn) {
      const h = node.querySelector(':scope > h2'), at = node._split === rightSplit;
      sideBtn.hidden = !(here || at) || Boolean(ws?.mobile);
      if (h && sideBtn.parentNode !== h) h.insertBefore(sideBtn, node._toggle?.parentNode === h ? node._toggle : null);
      const shown = h?.querySelector('.panel-title, :scope > span')?.textContent?.trim() || title; // the view's own name ("Board details")
      const label = at ? L.infoUnder(shown) : L.infoSide(shown);
      sideBtn.replaceChildren(icon(at ? 'growBack' : 'dockRight'));
      sideBtn.setAttribute('aria-label', label); sideBtn.title = label;
      sideBtn.setAttribute('aria-pressed', String(at));
    }
    if (!here) return;
    const h = node.querySelector(':scope > h2'); // a view replaces the heading when it loads: the controls join the new one
    if (h && up.parentNode !== h) h.insertBefore(max, node._toggle?.parentNode === h ? node._toggle : null), h.insertBefore(up, max);
    if (sideBtn && h) h.insertBefore(sideBtn, up);
    const aboveFolded = midSplit.collapsed[0];
    up.replaceChildren(icon(aboveFolded ? 'growBack' : 'growUp')); // not a chevron: those are the dividers' (author, 2026-11-10)
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
// the tabs go into the panel's heading, in place of its name (author, 2026-11-10: one line less); folded, the heading names
// the tab shown (Memory, Cache, Peripherals, Pins …), and so does the folded dock's bar
let memHead = null, memTabName = STRINGS.mem.tabMemory, dockDp = false;
function memTabChanged(name) {
  memTabName = name;
  if (!memHead) return; // the first select, while the panel is being made
  memHead.querySelector('.panel-title').textContent = name;
  syncDockBar();
}
const memTabs = tabs([[STRINGS.mem.tabMemory, memory.root], [STRINGS.mem.tabCache, cacheView.root, () => updateMemPanels(), CAP.cache],
  [STRINGS.mem.tabPeripherals, periph.root, () => updateMemPanels(), CAP.devices],
  ...archPanels.map(({ p, inst }) => [p.label, inst.root, () => updateArchPanels()])], { onSelect: (i, name) => memTabChanged(name) });
// the memory pane's name: without caches (capability cache off) it is the Memory pane
const MEM_PANE = CAP.cache.enabled ? { panel: STRINGS.mem.panel, link: STRINGS.mem.link, bar: STRINGS.layout.dockBarDp }
  : { panel: STRINGS.mem.panelPlain, link: STRINGS.mem.linkPlain, bar: STRINGS.layout.dockBarDpPlain };
const pMemory = panel(MEM_PANE.panel, memTabs.root, '.p-memory', 'memory');
memHead = pMemory.querySelector(':scope > h2');
memHead.querySelector('.panel-title').textContent = memTabName; // shown only while folded (theme.css), and read before the tabs
memHead.querySelector('.panel-title').after(memTabs.bar);
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
// projects: the file explorer beside the editor and the Projects dialog (src/ui/project-explorer.js); each action goes
// through the project session, which checks it (a refused name or limit shows its reason under the explorer)
const explorer = PROJECTS ? new ProjectExplorer({
  onOpen: (name) => selectFile(name),
  onNew: (name) => { // the project's first C file starts with the C example (the language menu's role in the one-file shell)
    // (the compiler's own example: pico2 Full's Pico SDK C, P1-L1)
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
  // a new project starts from the architecture's example, as the first project does and as a new .c file starts from its
  // template (GUI walkthrough, 2026-11-11: it started with an empty file)
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
  onCompiler: (id) => { // pico2 P1-F2 (research D33 Q5): the project's C compiler; the module's first is the default
    proj.setCompiler(id === C_LANGS[0]?.id ? null : id);
    doAssemble(); // an image language not yet downloaded only says that Build will offer it
    consolePanel.message(STRINGS.projects.compilerSet(cCompiler().label), 'ok');
  },
}, projectExtensions(arch), EDITION?.compiler ? [] : C_LANGS.map((x) => ({ id: x.id, label: x.label }))) : null; // no choice where the edition names the compiler (D34 Q6)
const projectsDialog = PROJECTS ? new ProjectsDialog({
  list: () => proj.list(),
  onOpen: (id) => proj.openProject(id).catch((e) => consolePanel.message(STRINGS.projects.refused(e.message), 'error')),
  onDelete: (id) => proj.deleteProject(id, defaultProject),
}) : null;
if (projectsDialog) document.body.append(projectsDialog.root);
// the editor: its file as a tab, the language and C options, and a status line
const fileName = el('span.ed-tab-name');
const dirtyMark = el('span.ed-dirty', { text: '●', title: TL.modified, hidden: true });
const edPos = el('span.ed-pos');
const edState = el('span.ed-state');
const edProfile = el('span.ed-prof');
// one-file shell: the program's name as a tab; with a companion file (v10 draft Language.companion), two tabs (WAI-ARIA tabs)
const progTab = PROJECTS ? null : el('span.ed-tab', {}, icon('file', { size: 14 }), fileName, dirtyMark);
const compTabs = COMP ? el('div.ed-tabs', { role: 'tablist', 'aria-label': STRINGS.companion.tabs, onkeydown: (e) => compTabKey(e) }) : null;
const compTabsBox = COMP ? el('span.ed-tabs-box.ed-comp', { hidden: true }, compTabs) : null;
const mainPanel = COMP ? el('div.ed-panel', { id: 'ed-cpanel-0' }, editor.root) : null;
const compPanel = COMP ? el('div.ed-panel', { id: 'ed-cpanel-1', hidden: true }, compEd.root) : null;
/** The editor's tabs and panels for the companion's state: one tab without it, two with it. */
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
/** WAI-ARIA tabs: Left/Right/Home/End choose; Delete on the companion's tab removes it. */
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
/** Show the companion's tab (`on`) or the program's. */
function showComp(on) {
  compOn = on && Boolean(comp);
  renderCompTabs();
  editorStatus();
}
/** Keep the companion in this browser (with the program's text, pips.source). */
function keepComp() { if (COMP) store.set('pips.companion', comp ? JSON.stringify(comp) : ''); }
/** Set the companion (a template, link, file or restore; null: none), its tab behind the program's. */
function setComp(c) {
  if (!COMP) return;
  comp = c && typeof c.name === 'string' && typeof c.text === 'string' ? { name: c.name, text: c.text } : null;
  compEd.value = comp ? comp.text : '';
  compEd.setErrors([]);
  compOn = false;
  keepComp();
  renderCompTabs();
}
/** File ▸ Add PIO file: the companion opens (the one removed last, else the language's example), to be built with the program. */
function addComp() {
  if (comp) { showComp(true); return; }
  let kept = null;
  try { kept = JSON.parse(store.get('pips.companion.removed') ?? 'null'); } catch { /* none kept */ }
  const name = kept?.name ?? `${sourceName().replace(/\.\w+$/, '')}${COMP.extension}`;
  setComp({ name, text: typeof kept?.text === 'string' ? kept.text : typeof COMP.example === 'function' ? COMP.example(name) : COMP.example ?? '' });
  store.set('pips.companion.removed', '');
  showComp(true);
  dirty = true; editorStatus(); syncPrimary(); saveSoon();
  consolePanel.message(STRINGS.companion.added(name), 'ok');
}
/** File ▸ Remove PIO file (or the tab's ×): its text is kept for the next Add, the program is built without it. */
function removeComp() {
  if (!comp) return;
  const name = comp.name;
  store.set('pips.companion.removed', JSON.stringify(comp));
  setComp(null);
  dirty = true; editorStatus(); syncPrimary(); saveSoon();
  consolePanel.message(STRINGS.companion.removed(name, COMP.add), 'ok');
}
/** One-file shell: diagnostics in the companion's file to its editor, the others to the program's; the companion's tab is shown when only it has errors. */
function setLiteErrors(diags) {
  if (!COMP) { editor.setErrors(diags); return; }
  const inComp = diags.filter((d) => comp && d.file === comp.name);
  editor.setErrors(diags.filter((d) => !inComp.includes(d)));
  compEd.setErrors(inComp);
  if (inComp.some((d) => d.severity !== 'warning') && inComp.length === diags.length) showComp(true);
}
const pEditor = el('section.panel.p-editor', { 'aria-label': STRINGS.editor },
  el('h2.ed-head', {}, PROJECTS ? el('span.ed-tabs-box', {}, editor.tabs, dirtyMark) : progTab, COMP ? compTabsBox : null, el('span.panel-title.ed-title', { text: STRINGS.editor }),
    // projects: the language follows each file's extension and Build the entry file, so there is no language menu
    el('span.panel-head-tools', {}, PROJECTS ? null : el('label', {}, el('span.ed-lang-label', { text: `${C.language} ` }), langSel), ccOpts, buildOpts)),
  el('div.col', {}, COMP ? [mainPanel, compPanel] : editor.root),
  el('div.ed-status', { title: STRINGS.storageNote }, edPos, edProfile, edState));
// projects: the file explorer as its own pane left of the editor, folding like the others (author, 2026-11-09, D32)
// Widen (author, 2026-11-10): the editor takes the width of the middle column (listing, inspector or the view's drawing) and
// of the registers column, which step aside without being folded (their sizes and folds come back as they were); the dock
// and the Files pane stay
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
  head(STRINGS.projects.files, 'folder', explorer.menu), explorer.root) : null; // the Project menu in the pane's header
const viewParts = {}; // per datapath view: {header, info, tabs}

/** The status line of the editor: cursor, size, profile, and whether the text is newer than the program. */
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

// --- the resizable workspace (split.js) -------------------------------------------------------------
// root: the workspace over the dock; workspace: editor | middle | right; middle and right are columns;
// the dock: memory | console. A datapath view gives the middle column the drawing over its details and
// the console to the right column, and has no dock (spec §11.1: the drawing needs the height).
const midSplit = new Split('column', 'mid');
const rightSplit = new Split('column', 'right');
// a pane of the middle or right column may fill its column, the others hidden with their headings (the author, 2026-11-13)
midSplit.fillable = true;
rightSplit.fillable = true;
const workSplit = new Split('row', 'work');
const dockSplit = new Split('row', 'dock');
const rootSplit = new Split('column', 'root');
// The folded dock's bar: a click anywhere opens it; the fold button that Split puts in it is the keyboard's way.
const dockBarText = el('span', { text: STRINGS.layout.dockBar });
const dockBar = el('div.dock-bar', { onclick: () => rootSplit.setCollapsed('dock', false) }, icon('unfold', { size: 14 }), dockBarText);
const dock = el('div.dock', {}, dockBar, dockSplit.root);
const workspace = el('div.workspace', {}, rootSplit.root);
// a drawing view's details pane in the third column in place of the registers (author, 2026-11-13); kept in this browser
let infoSide = store.get('pips.infoSide') === '1';
function setInfoSide(on) {
  infoSide = on;
  store.set('pips.infoSide', on ? '1' : '');
  const had = pInfo.contains(document.activeElement);
  configureLayout();
  syncMidControls.forEach((f) => f());
  if (had) pInfo.querySelector('.pane-side')?.focus(); // the keyboard stays on the button that moved the pane
}
const syncMidControls = [paneControls(pInfo, STRINGS.view.info, { side: true }), paneControls(pFields, STRINGS.layout.panes.inspector)];
midSplit.onApply = () => syncMidControls.forEach((f) => f());
rightSplit.onApply = () => syncMidControls[0]();
// Folding the widened editor (its heading, View ▸ Show) also ends Widen: the columns that stepped aside come back, where
// before only the folded editor's strip was left on an empty workspace (author, 2026-11-10)
workSplit.onApply = () => { if (workspace.classList.contains('ed-wide') && workSplit.isCollapsed('editor')) setEditorWide(false); };
const P = STRINGS.layout.panes;

// Projector mode (WS-U-012) keeps every pane, so that nothing is out of reach, but starts with only the
// editor, the main view (drawing, listing or comparison) and one table, the registers, open; the others
// are folded and open from their heading or View ▸ Show. Its layouts are saved apart (`….proj`).
const LOW_WINDOW = 650; // px of page height (at the page's own zoom) under which the listing view folds its secondary panes
function configureLayout() {
  const dp = isDp();
  const cmp = isCmp();
  const pj = projector;
  const k = pj ? `${mode}.proj` : mode;
  // A low window (GUI walkthrough, 2026-11-11: a laptop at 110 % zoom leaves 575 px, where the listing showed two rows and
  // the registers one): the listing view starts with its secondary panes folded (inspector, call stack, counters, the
  // dock to its bar), as projector mode does; they open from their headings. A saved layout still wins.
  // (not on a narrow screen: there the workspaces show one pane at a time)
  const low = !dp && window.innerHeight / pageZoom < LOW_WINDOW && window.innerWidth / pageZoom >= 900;
  const sec = pj || low;
  // v10 (draft): a datapath view's own default sizes (View.layout); saved sizes of the user still win
  const vl = dp ? viewOf(mode)?.layout ?? {} : {};
  const drawingSize = vl.drawing ?? (pj ? 0.74 : 0.64);
  const editorSize = vl.editor ?? 0.22;
  workspace.classList.toggle('projector', pj);
  workspace.classList.remove('mid-max');
  setEditorWide(false, { quiet: true }); // a new view starts with every column in place
  pInfo.classList.remove('max-pane'); pFields.classList.remove('max-pane');
  // the details pane in the third column (setInfoSide): the drawing has the middle column to itself; the registers, counters
  // and console stay in the third column, folded at first under the details (their headings open them); own saved sizes
  const side = dp && infoSide && !ws?.mobile;
  const sk = side ? '.side' : '';
  midSplit.configure(side ? [{ node: pDatapath, id: 'datapath', min: 220, size: 1, title: STRINGS.view.panel }]
    : dp ? [{ node: pDatapath, id: 'datapath', min: 220, size: drawingSize, title: STRINGS.view.panel },
      { node: pInfo, id: 'info', min: 90, size: 1 - drawingSize, collapsible: true, collapsed: pj, title: P.info }]
      : cmp ? [{ node: pCompare, id: 'compare', min: 120, size: 1, title: STRINGS.view.comparison }]
        : [{ node: pListing, id: 'listing', min: 120, size: 0.6, title: STRINGS.listing },
          { node: pFields, id: 'inspector', min: 90, size: 0.4, collapsible: true, collapsed: sec, title: P.inspector }],
  `mid.${k}${sk}`);
  rightSplit.configure(side ? [{ node: pInfo, id: 'info', min: 140, size: 0.7, collapsible: true, title: P.info },
    { node: pRegs, id: 'registers', min: 140, size: 0.1, collapsible: true, collapsed: true, title: STRINGS.registers },
    { node: pCounters, id: 'counters', min: 70, size: 0.1, collapsible: true, collapsed: true, title: P.counters },
    { node: pConsole, id: 'console', min: 80, size: 0.1, collapsible: true, collapsed: true, title: STRINGS.console }]
    : dp ? [{ node: pRegs, id: 'registers', min: 140, size: 0.5, title: STRINGS.registers },
    { node: pCounters, id: 'counters', min: 70, size: 0.26, collapsible: true, collapsed: pj, title: P.counters },
    { node: pConsole, id: 'console', min: 80, size: 0.24, collapsible: true, collapsed: pj, title: STRINGS.console }]
    : [{ node: pRegs, id: 'registers', min: 140, size: 0.56, title: STRINGS.registers },
      // folded at first where the module has no call stack yet (it would only say so; GUI pass, 2026-11-10)
      { node: pCalls, id: 'calls', min: 64, size: 0.14, collapsible: true, collapsed: sec || !CAP.callStack.enabled, title: P.calls },
      { node: pCounters, id: 'counters', min: 70, size: 0.3, collapsible: true, collapsed: sec, title: P.counters }],
  `right.${k}${sk}`);
  // projects: the Files pane first (its share taken from the editor and the middle column); its own saved sizes
  const ex = PROJECTS ? 0.14 : 0;
  // (projector mode folds it like the other secondary panes: editor, main view and registers stay open)
  workSplit.configure([...(PROJECTS ? [{ node: pExplorer, id: 'explorer', min: 185, size: ex, collapsible: true, collapsed: pj, title: STRINGS.projects.files }] : []),
    { node: pEditor, id: 'editor', min: 220, size: dp ? editorSize : 0.3 - ex / 2, collapsible: true, title: P.editor },
    { node: midSplit.root, id: 'mid', min: dp ? 360 : 300, size: side ? 0.66 - editorSize - ex : dp ? 0.78 - editorSize - ex : 0.44 - ex / 2 },
    // folded, the column is a strip named after its panes (author, 2026-11-10)
    { node: rightSplit.root, id: 'right', min: 230, size: side ? 0.34 : dp ? 0.22 : 0.26, foldable: true,
      title: (side ? [P.info, STRINGS.registers, P.counters, STRINGS.console] : dp ? [STRINGS.registers, P.counters, STRINGS.console] : [STRINGS.registers, P.calls, P.counters]).join(' · ') }], `work.${k}${PROJECTS ? '.files' : ''}${sk}`);
  // the dock, in every view (D7): the shared memory panel, and in the ISA and comparison views the console;
  // a datapath view needs the height, so there it starts folded
  dockSplit.configure(dp ? [{ node: pMemory, id: 'memory', min: 220, size: 1 }]
    : [{ node: pMemory, id: 'memory', min: 220, size: 0.58, collapsible: true, title: MEM_PANE.panel },
      { node: pConsole, id: 'console', min: 200, size: 0.42, collapsible: true, title: STRINGS.console }], `dock.${k}`);
  dockDp = dp;
  syncDockBar();
  rootSplit.configure([{ node: workSplit.root, id: 'work', min: 200, size: dp ? 0.6 : 0.7 },
    { node: dock, id: 'dock', min: 90, size: dp ? 0.4 : 0.3, collapsible: true, collapsed: sec || dp, title: dp ? MEM_PANE.panel : P.dock, header: dockBar }], `root.${k}`);
  ws?.afterLayout(); // a narrow screen: the active workspace's panes show
}

// Page zoom (author, 2026-11-10): View ▸ Zoom out, Zoom in, Original size scale the whole page (CSS zoom on the root, which
// Chrome, Edge and Firefox apply to layout and pointer coordinates alike), kept in this browser; the browser's own zoom
// (Ctrl + / Ctrl -) still works on top of it.
const PAGE_ZOOMS = Object.freeze([0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]);
let pageZoom = (() => { const z = Number(store.get('pips.pageZoom')); return PAGE_ZOOMS.includes(z) ? z : 1; })();
function applyPageZoom() {
  document.documentElement.style.zoom = pageZoom === 1 ? '' : String(pageZoom);
  window.dispatchEvent(new Event('resize')); // the splits, the More menus and a fitted drawing measure again
}
function setPageZoom(z) {
  pageZoom = PAGE_ZOOMS.includes(z) ? z : 1;
  store.set('pips.pageZoom', String(pageZoom));
  applyPageZoom();
}
const zoomStep = (dir) => setPageZoom(PAGE_ZOOMS[Math.min(PAGE_ZOOMS.length - 1, Math.max(0, PAGE_ZOOMS.indexOf(pageZoom) + dir))]);
if (pageZoom !== 1) applyPageZoom();
/** View ▸ Zoom: out, the present size (a button back to 100 %), in. The menu stays open, so that a size can be tried. */
function pageZoomRow() {
  const Z = STRINGS.pageZoom;
  const now = el('button.pz-now', { type: 'button', title: Z.reset }); // its text and name come from sync()
  const out = el('button.pz-out', { type: 'button', title: Z.out, 'aria-label': Z.out }, icon('zoomOut', { size: 16 }));
  const inn = el('button.pz-in', { type: 'button', title: Z.in, 'aria-label': Z.in }, icon('zoomIn', { size: 16 }));
  const sync = () => {
    now.textContent = `${Math.round(pageZoom * 100)} %`;
    now.setAttribute('aria-label', `${Math.round(pageZoom * 100)} %: ${Z.reset}`); // the visible text first (WCAG 2.5.3)
    out.disabled = pageZoom === PAGE_ZOOMS[0];
    inn.disabled = pageZoom === PAGE_ZOOMS[PAGE_ZOOMS.length - 1];
  };
  const act = (f) => (e) => { e.stopPropagation(); f(); sync(); };
  out.onclick = act(() => zoomStep(-1)); inn.onclick = act(() => zoomStep(1)); now.onclick = act(() => setPageZoom(1));
  sync();
  return [el('p.menu-head', { text: Z.group, 'aria-hidden': 'true' }), el('div.pz-row', { role: 'group', 'aria-label': Z.group }, out, now, inn)];
}

/** The folded dock's bar: the memory panel's tab now shown (and the console, where the dock holds it). */
function syncDockBar() {
  try { dockBarText.textContent = dockDp ? STRINGS.layout.dockBarOne(memTabName) : STRINGS.layout.dockBarWith(memTabName); } catch { /* not made yet */ }
}

/** View ▸ projector mode, the layout commands and a Show switch for each pane that folds. */
function fillViewMenu(list) {
  const dp = isDp();
  const panes = [...(PROJECTS ? [[workSplit, 'explorer', STRINGS.projects.files]] : []), [workSplit, 'editor', P.editor],
    ...(dp ? [[pInfo._split ?? midSplit, 'info', P.info], ...(pInfo._split === rightSplit ? [[rightSplit, 'registers', STRINGS.registers]] : []),
      [rightSplit, 'counters', P.counters], [rightSplit, 'console', STRINGS.console], [rootSplit, 'dock', MEM_PANE.panel]]
      : [...(isCmp() ? [] : [[midSplit, 'inspector', P.inspector]]), [rightSplit, 'calls', P.calls], [rightSplit, 'counters', P.counters], [rootSplit, 'dock', P.dock]])];
  // the third column as a whole, before its own panes (GUI walkthrough, 2026-11-11: it folds to a strip, and View had no entry for it)
  panes.splice(panes.findIndex(([s]) => s === rightSplit), 0, [workSplit, 'right', P.right]);
  // the workspace's presentation (ui/view-mode.js): one choice of three, the one shown checked
  const now = viewModes.state.mode;
  const modeIcon = { normal: 'normalView', focus: 'focusView', fullscreen: 'fullscreen' };
  const modeItems = MODES.map((m) => {
    const off = m === 'fullscreen' && !viewModes.supported;
    // "Datapath focus" where the main pane is a drawing; in a listing or comparison view it is the "Focus" on that pane
    const name = m === 'focus' && !dp ? VM.focusPlain : VM[m];
    return el('label.menu-check.vm-opt', { title: off ? VM.unavailable : m === 'focus' ? `${name} (${VM.focusKey})` : null },
      el('input', { type: 'radio', name: 'view-mode', value: m, checked: m === now, disabled: off, 'data-mode': m,
        // a choice closes the menu, which would otherwise cover the drawing in its new layout; the focus returns to View
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
  if (t.panel === 'registers') { if (rightSplit.isCollapsed('registers')) rightSplit.setCollapsed('registers', false); flashPanel(pRegs); return; }
  if (t.panel === 'memory') { setZoom(false); showMemoryPanel(0); return; } // the memory lives in the shared panel
  setZoom(false);
  ws.reveal('datapath'); // a narrow screen: the details are under the drawing there
  const infoAt = pInfo._split ?? midSplit; // under the drawing, or in the third column (setInfoSide)
  if (infoAt === rightSplit && workSplit.isCollapsed('right')) workSplit.setCollapsed('right', false);
  if (infoAt.isCollapsed('info')) infoAt.setCollapsed('info', false);
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
  if (pv()) { pv().render(); return; } // v11: a page view
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
// The execution controls at the place chosen (ui/dock.js): the same toolbar as a row on top or a column at a side;
// the workspace and the drawings take the room that is left (their ResizeObservers), nothing is rebuilt.
tbDock = new ToolbarDock({ main: app, toolbar, fit: toolbarFit, narrow: ws.mq,
  flyouts: [{ menu: speedFly, body: speedFly.querySelector('.menu-list'), nodes: [speedField] },
    { menu: archFly, body: archFly.querySelector('.menu-list'), nodes: [archCtx] }],
  onChange: (place, chosen) => {
    const shown = ws.mobile ? chosen : place; // in Focus a chosen Top shows as Left: the menu tells what shows
    dockRadios.forEach((r) => { r.checked = r.value === shown; });
    dockMenu.querySelector('summary > .icon').replaceWith(icon(DOCK_ICON[shown]));
    dockMenu.hidden = ws.mobile; // a narrow screen keeps the row (the choice is kept for a wide one)
    refit();
  } });
tbDock.apply(true);

// --- the workspace's presentation (ui/view-mode.js) ---------------------------------------------------------------
// Focus and Full screen are a layout over the same panes (theme.css .workspace.focus): the middle column's main pane
// (the drawing with its stage strip, the listing or the comparison) takes the workspace, the editor, the details, the
// registers, the console and the memory dock step aside without being folded, so that the splits' saved sizes and
// folds are untouched and come back as they were. The page-session states that would cover the drawing (Enlarge,
// a maximised pane) are put aside on entry and back on exit. On a narrow screen the workspaces stay; the Datapath
// workspace is shown while focused (not stored), and the one shown before comes back.
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
  headerFit.pause(c); // the compact header holds what it shows; the rest is hidden, not moved
  tbDock.setCompact(c);
  if (!c && was && preFocus) {
    if (preFocus.zoomed && isDp()) setZoom(true);
    if (preFocus.dockMax) setDockMax(true);
    if (preFocus.midMax && preFocus.midMax._split === midSplit) setMidMax(preFocus.midMax, true);
    if (ws.mobile && preFocus.wsTab && ws.active === 'datapath') ws.reveal(preFocus.wsTab, false); // unless another was chosen meanwhile
    preFocus = null;
  }
  const menuList = viewMenu.querySelector('.menu-list');
  if (viewMenu.open) fillViewMenu(menuList);
  refit();
  // the focus never stays on a control that went away
  if (focusLost() && c !== was) (c ? exitBtn : viewMenu.querySelector('summary')).focus({ preventScroll: true });
}
viewModes.notify(true); // Normal view (a page always opens in it)

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
  // the view's own buttons; `view:<id>` opens another view the tool shows (the NPU tool's NPU block, NPU-3)
  command: (name) => (name === 'stepUnit' ? stepUnit() : name === 'backUnit' ? backUnit() : name.startsWith('view:') ? setMode(name.slice(5)) : undefined),
  memConfig: () => memCfg,
  download: (name, data, type) => download(name, data, type),
  // v11 (pico2's Board view, research D48): the page's engine, an input by the shell's own path (the Pins panel's: to the
  // Worker during a run, else the engine; logged for Replay), and the value of a Language option (engine settings included)
  engine: () => engine ?? null,
  input: (x) => giveInput(x),
  option: (id) => asmOpts.find((x) => x.o.id === id)?.sel.value ?? null,
  // v12 draft (pico2 P1-B2): the view companion's text (pico2: the circuit), and a new text from the view (the Board's editor)
  companion: (id) => (VCOMP && VCOMP.id === id ? vcompText() : null),
  setCompanion: (id, text) => { if (VCOMP && VCOMP.id === id) { cancelRun(); setVcomp(text === null ? null : { name: vcomp?.name, text }); dirty = true; editorStatus(); saveSoon(); } },
  // v12 draft (pico2 P1-B2 stage B2-3): hold Run and Step with a reason (null: release); a run under way pauses
  holdRun: (reason) => { runHold = reason || null; if (runHold && running) pause(); syncHold(); },
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
  waves[id] = new WaveformPanel({ id, signals: v.exportModel().signals, defaults: v.waveform.defaults, format: v.waveform.format ?? null, base: v.waveform.base ?? 0, onGoTo: (k) => goToCycle(k) });
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
  const pc = session.platformConfig;
  const script = memCfg.devices ? `${pc.stimulus.length}|${pc.rx.length}` : ''; // a pin event or a received byte: the platform's replay changes
  let rec = waveRec[mode];
  if (!rec || rec.program !== session.program || rec.memsys !== memsysOf[mode] || rec.opt !== opt || rec.script !== script) {
    const x = v.exportModel(); // with the platform devices on: the NPU's signals too (NPU-3)
    rec = waveRec[mode] = { program: session.program, memsys: memsysOf[mode], opt, script, model: x.model, frames: [], done: false, max: 0 };
    w.setSignals(x.signals);
  }
  const cur = s.cycle;
  rec.max = Math.min(Math.max(rec.max, cur), VCD_CAP);
  // the model stands at the last frame's cycle: step it before each new frame (the frames of recordFrames, also when
  // the record grows by one cycle per refresh while the tab is open)
  while (!rec.done && rec.frames.length <= rec.max) {
    if (rec.frames.length && rec.model.step() !== 'step') { rec.done = true; break; } // the export model's own protocol, as for the VCD export
    rec.frames.push({ ...rec.model.evaluate().signals });
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
  if (next === mode || !viewOf(next)) return; // a view this tool does not show (a share link of another tool) is not opened
  cancelRun();
  const isa = VIEWS[0].id;
  if (next !== isa && !(await loadView(next))) return;
  const wasIsa = mode === isa;
  const wasEngineView = wasIsa || isPageView(mode); // v11: the instruction view and page views share the page's engine
  const profileBefore = session.profile;
  mode = next;
  viewButtons.forEach((b, i) => b.setAttribute('aria-selected', String(VIEWS[i].id === mode)));
  const sc = isDp(); // a datapath view
  const cmp = isCmp();
  for (const b of toolbar.querySelectorAll('.dp-only')) b.hidden = !sc || isPageView(); // v11: a page view has no model to export
  if (sc) {
    const parts = viewParts[mode];
    parts.header.append(zoomBtn);
    pDatapath.replaceChildren(parts.header, inst[mode].root);
    pInfo.replaceChildren(head(parts.info, 'inspect'), parts.tabs.root);
  } else setZoom(false);
  workspace.classList.toggle('dp-mode', sc);
  // The datapath needs the height: the console joins the right column and the memory panel starts folded.
  configureLayout();
  subsetSel.hidden = !viewOf(mode).subsets;
  profileSel.disabled = sc || cmp;
  profileField.hidden = sc || cmp; // a datapath view fixes the profile; its panel title names the chapter
  archCtx.hidden = profileField.hidden && subsetSel.hidden;
  tbDock?.sync(); // a docked column offers the Architecture menu only while it holds something
  syncCrumb(); // the compact header names the open view
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
  // v11 (research D48 Q2 B): between the instruction view and a page view of the same profile the program and the
  // engine's state stay as they are (the Board shows the run the instruction view made, and the reverse)
  if (wasEngineView && (mode === isa || isPageView()) && session.profile === profileBefore && session.program) { refresh(true); return; }
  if (session.imported) reimport(); else doAssemble();
}

/** v10 (draft): the kept image loaded again for the present profile (after a change of view); assembles the editor if it fails. */
function reimport() {
  const { content, kind, name, built } = session.imported;
  if (built) { // an image built from the project (P1-F2): loaded again with its rows in the project's files
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

// --- C (spec §10.1) --------------------------------------------------------------------------
let cName = `main${XL?.extension ?? ''}`; // the source file of the extra language
const sourceName = () => (PROJECTS ? editor.active ?? project()?.entry ?? `main${arch.language.extension}`
  : lang === XID ? cName : session.files[0].name.replace(/\.\w+$/, '') + arch.language.extension);
/** v10 draft (Language.companion): the companion's extension, also for a project's files of that kind (pico2: .pio). */
const COMPX = arch.language.companion?.extension?.toLowerCase() ?? null;
/** Projects: the build plan of the open project (project.js buildPlan, Q3 of D31). */
const plan = () => buildPlan(project(), { cExtension: XL?.extension ?? '\0' });

/** The toolbar for the language: Compile or Assemble; the C options; the ISA choice only for the ISA profile. */
function syncLangControls() {
  langSel.value = lang;
  ccOpts.hidden = lang !== XID;
  for (const x of xlOpts) x.label.hidden = Boolean(x.o.profiles) && !x.o.profiles.includes(session.profile);
  syncBuildLabel();
  refit();
  editor.setLanguage(lang);
  editorStatus();
}
/**
 * Build's label: Compile when the program is C, else Assemble. Projects: by the build plan (a C entry), not by the editor's
 * language, which an image build sets to assembly for its rows (author, 2026-11-10: Full showed Assemble for a C project).
 * An image language (pico2 Full: Pico SDK C) compiles every .c and .S file of the project and links them: its tooltip says so.
 */
function syncBuildLabel() {
  let c = lang === XID, image = false;
  if (PROJECTS) { try { c = plan().lang === 'c'; image = Boolean(cCompiler()?.image) && usesImageLanguage(); } catch { /* no project yet */ } }
  setToolLabel(assembleBtn, 'build', c || image ? TL.buildC : TL.build, 'Control+Enter');
  if (image) { const tip = `${TL.buildProject} (${keyText('Control+Enter')})`; assembleBtn.title = tip; assembleBtn.setAttribute('aria-label', tip); }
}

/** Switch the editor between assembly and C; each keeps its own text in the browser. */
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
  // the text in the editor changed: say that the other one is kept (it read as if the program had been replaced)
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

/** Compile the editor's source into session.files; false (with the errors shown) if it does not compile. */
function compileExtra() {
  // projects: the entry file is compiled (the C subset is one unit, D27); its errors are located in that file
  const src = PROJECTS ? plan().file : { name: cName, text: editor.value };
  // v10 draft (Language.companion, research D43): the program's companion files (pico2: .pio, included as "<file>.pio.h")
  const companions = PROJECTS ? project().files.filter((f) => COMPX && f.name.toLowerCase().endsWith(COMPX)) : compFiles();
  const r = cc.compile(src.text, { name: src.name, profile: session.profile, subset: session.subset, options: { ...buildValues(), ...xlValues() }, companions });
  if (!r.ok) {
    cMap = null;
    renderAsm(null);
    if (PROJECTS) editor.setErrorsByFile(r.diagnostics.map((e) => ({ ...e, file: e.file ?? src.name })), src.name);
    else setLiteErrors(r.diagnostics);
    for (const e of r.diagnostics) consolePanel.message(e.message, 'error', { file: e.file ?? src.name, line: e.line, column: e.column }, e.note ?? null); // the file always (Lite showed "undefined:")
    consolePanel.message(C.errors, 'error');
    return false;
  }
  cMap = r.lines;
  session.cSource = { file: src.name, text: src.text, lines: r.lines }; // v10 draft (P1-L1): for the C source view
  session.files = [{ name: stem(src.name) + arch.language.extension, text: r.text }];
  renderAsm(r.text);
  return true;
}

// --- actions --------------------------------------------------------------------------------
/** Assemble the session's files with the architecture's assembler (a contract Program) and load a fresh engine. */
function assembleSession() {
  // v10 draft (pico2 P1-L1, research D34 Q7): a C program's file, text and line map go with it (the C source view)
  const source = lang === XID && cMap && session.cSource ? { source: session.cSource } : {};
  const p = arch.language.assemble(session.files, { profile: session.profile, subset: session.subset ?? undefined, data: session.dataLoads, options: buildValues(), ...source });
  session.program = p;
  session.loadReport = p.loadReport ?? { applied: [], dropped: [] };
  resetEngine();
  return p;
}

function doAssemble({ user = false } = {}) {
  // a project whose C compiler is an image language (pico2 P1-F2: Pico SDK C) builds in its Worker
  syncBuildLabel(); // Compile or Assemble, by what is built now
  // (the module's build options do not apply to an image language: Pico SDK programs set their own clocks)
  if (PROJECTS && cCompiler()?.image && usesImageLanguage()) { buildOpts.hidden = true; imageBuildRun(cCompiler(), user); return; }
  buildOpts.hidden = shownOpts.length === 0;
  cancelRun();
  session.imported = null; // the editor's program replaces an imported image
  if (PROJECTS) { // Q3 of D31: a C entry is compiled; otherwise every assembly file, the entry first
    const pl = plan();
    const next = pl.lang === 'c' ? XID : 'asm';
    if (next === XID && !cc) { loadExtra().then((ok) => { if (ok) doAssemble(); }); return; } // the compiler loads on first use
    if (next !== lang) { lang = next; if (lang !== XID) { cMap = null; renderAsm(null); editor.setLinked([]); } syncLangControls(); }
    if (lang === XID) { doCompile(); return; }
    session.files = pl.files.length ? pl.files : [{ name: project().entry, text: '' }];
    if (COMPX) session.files = [...session.files, ...project().files.filter((f) => f.name.toLowerCase().endsWith(COMPX))]; // research D43
  } else {
    if (lang === XID) { doCompile(); return; }
    session.files = [{ name: session.files[0].name, text: editor.value }, ...compFiles()];
  }
  const p = assembleSession();
  dirty = false;
  consolePanel.clearMessages();
  // the diagnostics, each with its location and the architecture's hint line (contract v3); projects: in their files
  if (PROJECTS) editor.setErrorsByFile(p.diagnostics, project().entry);
  else setLiteErrors(p.diagnostics);
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
    const inFile = { file: PROJECTS ? project().entry : cName }; // the C file's lines (Lite too: its location named no file)
    const errs = p.diagnostics.map((e) => ({ line: at(e), column: 1, message: C.asmError(e.line, e.message), ...inFile }));
    if (PROJECTS) editor.setErrorsByFile(errs, project().entry); else setLiteErrors(errs);
    for (const e of p.diagnostics) consolePanel.message(C.asmError(e.line, e.message), 'error', { line: at(e), ...inFile }, XL.asmNote?.(e) ?? null);
    if (p.ok) consolePanel.message(C.compiled(cMap.length, p.listing.length), 'ok');
  } else {
    session.files = [{ name: stem(PROJECTS ? project().entry : cName) + arch.language.extension, text: '' }];
    p = assembleSession();
    p.ok = false; // nothing to run until the C program compiles
    resetEngine();
  }
  afterAssemble(p);
}

// --- image languages (contract v10 draft; pico2 P1-F2: Pico SDK C, ADR-0012, research D33) -----------------------------
// The project is built as a whole in the language's Worker; the image goes through loadImage as a file import does, and
// its listing rows get the {file, line} of the project's C lines from the DWARF line table, so that the editor tabs show
// the running line, take breakpoints and run to the cursor as for assembly (P1-F1). The compiler and its files are an
// optional download: asked for only when the student builds (Build, Ctrl+Enter, Run), never at page load.
const imageBuild = { busy: false, langs: new Map(), dialog: null };

/** Whether the open project has a file of the C compilers' extension (else its assembly is assembled as before). */
const usesImageLanguage = () => project().files.some((f) => f.name.toLowerCase().endsWith(XL.extension));

/** The loaded image language (its `load()` result), loaded on first use. */
async function imageLanguage(x) {
  if (!imageBuild.langs.has(x.id)) imageBuild.langs.set(x.id, await x.load());
  return imageBuild.langs.get(x.id);
}

/** Make the language's download ready: silently when cached; otherwise only for a build the student asked for. */
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

/** Build the project with an image language; diagnostics in their files; a built image becomes the program. */
async function imageBuildRun(x, user) {
  if (imageBuild.busy) { if (user) imageBuild.again = true; return; } // a Build pressed meanwhile runs after this one
  imageBuild.busy = true;
  const D = STRINGS.download;
  try {
    cancelRun();
    if (lang === XID) { lang = 'asm'; cMap = null; renderAsm(null); editor.setLinked([]); syncLangControls(); } // rows carry C lines
    let b;
    try { b = await imageLanguage(x); } catch (e) { consolePanel.message(STRINGS.loadFailed(e.message), 'error'); return; }
    let ok = false;
    // a 404 for the compiler's files: they are not on this site; plain words first, the address as the note (GUI walkthrough, 2026-11-11)
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
    const image = session.program.segments.reduce((n, s) => n + s.bytes.length, 0); // what goes onto the chip, not the ELF
    consolePanel.message(D.built(x.label, (image / 1024).toFixed(1), Math.round(performance.now() - t0)), 'ok');
    flushNotes();
  } finally {
    imageBuild.busy = false;
    if (imageBuild.again) { imageBuild.again = false; imageBuildRun(cCompiler(), true); }
  }
}

/** Save the built image (P1-F2) in a format of the image language: {extension, convert(bytes) -> bytes | Promise}. */
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

/** No program to run until the project builds (as a C program that does not compile). */
function imageBuildFailed() {
  session.imported = null;
  session.files = [{ name: `main${arch.language.extension}`, text: '' }];
  const p = assembleSession();
  p.ok = false;
  resetEngine();
  afterAssemble(p);
  dirty = false;
}

/** The built image as the program: validated and loaded as an imported ELF, its rows located in the project's files. */
function loadBuiltImage(bytes) {
  const p = arch.language.loadImage(bytes, 'elf', 'program.elf', { profile: session.profile });
  const lt = p.debug?.lineTable;
  const names = new Set(project().files.map((f) => f.name));
  if (lt) {
    // `part` 0 marks the first instruction of a run of one C line (as the first word of an assembly line), so that run to
    // cursor and line lookups take the line's start
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
  p.imported = false; // the editor's program: its rows are in the project's files
  p.built = true;
  // the C source view (P1-C1) reads the project's files as the program's sources
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

/** What follows assembling: the memory view, the datapath or comparison view, the panels. */
function afterAssemble(p) {
  const lr = session.loadReport;
  if (lr.applied.length) consolePanel.message(STRINGS.dataIo.assembledLoads(lr.applied.map((a) => `${a.label} (${a.n} bytes)`).join(', ')));
  for (const d of lr.dropped) consolePanel.message(STRINGS.dataIo.droppedLoad(d.label, d.why), 'warn');
  consolePanel.msgs.scrollTop = 0; // the first error first
  if (p.segments[1]) memory.base = p.segments[1].address;
  if (uv() || isCmp()) inst[mode].load(session.runnable ? p : null);
  refresh(true);
  flushNotes();
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
  const npu = signals.some((s) => s.kind === 'npu') ? '; scope npu: the simulator\'s NPU model (FIG-0114 names), not an RTL net' : '';
  download(`${name}-${viewOf(mode).profile}.vcd`, vcd(frames, signals, { module, comment: `${name}, ${label}; one cycle = 10 ns of the time axis${npu}` }));
  consolePanel.message(STRINGS.exportedVcd(label, frames.length), 'ok');
  if (stop === 'step') consolePanel.message(STRINGS.exportedVcdCut(VCD_CAP + 1), 'warn');
  else if (stop === 'error') consolePanel.message(STRINGS.exportNoHalt(model.error), 'warn');
}

function ensureRunnable() {
  if (runHold) { consolePanel.message(runHold, 'warn'); return false; } // a view edits the circuit (v12 draft holdRun)
  // an image language builds asynchronously (in its Worker): Run or Step starts the build; the console says when it is done
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

// --- Step line and Back line on the editor (v10 draft Language.lineStep; pico2, research D38) -------------------------------
let lineStepMod = null; // the loaded module: {create(program, engine)}
let lineStepper = null; // {engine, program, s}: the stepper of the present engine and program
/** Whether Step line is offered now: the module has it, the instruction view is open and the program has a line table. */
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
  const here = PROJECTS ? editor.active : null; // projects: the line of the active file
  const l = session.program.listing.find((x) => (lang === XID ? atLoc(x, line, here) : x.line === line && x.part === 0 && (!PROJECTS || x.file === here)));
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
      endRealtime(); // (a real-time run goes on at full speed on this page)
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
  if (on) lastStop = null;
  if (PRIMARY_BTN) syncPrimary(); // Lite: the one button's state (P1-L1)
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

// --- the real-time run (v10 capability realtime; pico2 P1-M4, research D36; ADR-0005, ADR-0007) ---------------------------
// The engine (the page's, or the view's own: pico2's C source view) goes to the Worker, which paces it against the wall clock
// (worker/realtime.js) and sends the live state about 30 times a second (Q4) by postMessage or, where the page is
// crossOriginIsolated and the module lists 'sab', through a SharedArrayBuffer ring (Q6). At the end its snapshot comes back.
// (rt and rtNoted are declared near the top: updateArchPanels reads rt during the start-up)
/** The engine a real-time run takes here: the page's in the ISA view, the view's own if it offers one, else null. */
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
  const { debug, ...program } = session.program; // the line table stays on the page (the engine does not use it)
  // P1-M5: with Sound on, the Worker sends the engine's frames to the AudioWorklet (a port, or a ring where isolated)
  const link = AUDIO && soundOn && audioHost.on && eng.drainAudio ? audioHost.connect({ shared: arch.realtime?.transports?.includes('sab') }) : null;
  try {
    w.postMessage({ type: 'run', id: runId, arch: arch.id, program,
      options: { platformConfig: session.platformConfig, runLimit: Infinity, historyLimit: HISTORY_LIMIT },
      snapshot: eng.snapshot(), run: { breakpoints: bps, resumed: Boolean(opts.resumed) },
      realtime: { ring: sab, uartFrom: now.uart.total, audio: link ? { port: link.port ?? null, sab: link.sab ?? null, rate: arch.audio.sampleRate } : null } },
    link?.port ? [link.port] : []);
  } catch { audioHost?.disconnect(); return false; }
  if (link) runStatus.dataset.audio = link.transport; // for the smoke test
  const out = Array.from(shown.output ?? '', (c) => c.charCodeAt(0));
  rt = { engine: eng, ring: sab ? new LiveRing(sab) : null, out, dropped: (shown.outputDropped ?? 0), raf: 0, fraction: null, last: null };
  workerRun = true;
  workerInputs = [];
  runStatus.textContent = STRINGS.realtime.starting;
  runStatus.dataset.transport = sab ? 'sab' : 'postMessage'; // for the smoke test (tools/pico2-realtime-smoke.mjs)
  if (rt.ring) { const poll = () => { if (!rt?.ring) return; const r = rt.ring.read(); if (r.live || r.bytes.length) { rtLive(r.live, r.bytes); rtDraw(); } rt.raf = requestAnimationFrame(poll); }; rt.raf = requestAnimationFrame(poll); }
  return true;
}

/**
 * A live state from the Worker: kept (the newest only; UART bytes appended) and drawn at the next animation frame, so that a
 * page slower than the Worker's 30 states a second (a modest laptop, CPU throttling) draws fewer frames instead of falling
 * behind with a queue of messages, and a pause is still answered at once.
 */
function rtLive(msg, bytes) {
  if (!rt) return;
  if (bytes?.length) {
    for (const b of bytes) rt.out.push(b);
    if (rt.out.length > OUTPUT_LIMIT * 2) { const k = rt.out.length - OUTPUT_LIMIT; rt.out.splice(0, k); rt.dropped += k; }
    rt.outDirty = true;
  }
  // v11 (research D48 Q12): a live state not drawn yet is replaced by the newer one; its pins' change counts (pico2's
  // `pins.busy`, the Board's purple) are carried into the newer state, so that a slow page does not lose them
  const was = rt.pending?.state?.pins?.busy, now = msg?.state?.pins?.busy;
  if (was && now && was.length === now.length) for (let i = 0; i < now.length; i++) now[i] = Math.min(2, now[i] + was[i]);
  if (msg) rt.pending = msg;
  if (!rt.ring && !rt.drawQueued) { rt.drawQueued = true; requestAnimationFrame(rtDraw); } // the ring's poll draws itself
}

/** Draw the newest live state: the status (machine time, clk_sys, the fraction), registers, PC, console, pins. */
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
  for (const { inst } of archPanels) inst.live?.(s.pins, s); // the Pins panel (contract v10 draft PanelInstance.live; the whole live state second)
  pv()?.live?.(s); // v11: a page view (pico2's Board), at most once per frame
}

function endRealtime() {
  if (!rt) return null;
  if (rt.raf) cancelAnimationFrame(rt.raf);
  audioHost?.disconnect(); // the sink fades out what it still holds
  delete runStatus.dataset.audio;
  const r = rt; rt = null;
  return r;
}

/**
 * Render and play (P1-M5, research D39 Q7): the engine (the page's, or the view's own) goes to the Worker with `render`; it runs
 * the chosen seconds of machine time at full speed and returns the speaker's frames with the snapshot (onWorkerMessage plays
 * them). False if there is no Worker or engine for it.
 */
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
  if (soundOn) audioHost.enable(); // this click starts the context, ready for the playback
  runStatus.textContent = STRINGS.audio.rendering(0, seconds);
  return true;
}
/** Play the frames a Render and play run returned (or say why not). */
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
  // Render and play (P1-M5, Q7): N seconds of machine time at full speed in the Worker, then the frames are played
  if (AUDIO && speedSel.value === 'render' && !opts.target) {
    if (startRender(opts)) return;
  }
  // Real time (P1-M4): straight to the Worker, without the page's first slice (it would run ahead of the wall clock)
  if (REALTIME && (speedSel.value === 'rt' || speedSel.value === 'render') && !opts.target) {
    // remembered sound starts with this click: the run waits for the audio context (P1-M5)
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
    runStatus.textContent = m.render !== undefined && renderRun ? STRINGS.audio.rendering(m.render, renderRun.seconds) : STRINGS.runningStatus(m.retired);
  } else if (m.type === 'live') {
    rtLive(m, m.state.uart?.bytes);
  } else if (m.type === 'done') {
    if (rt?.ring) { const last = rt.ring.read(); if (last.live || last.bytes.length) rtLive(last.live, last.bytes); } // the ring's last state
    const r = endRealtime();
    const rr = m.rendered ? renderRun : null; renderRun = null;
    const eng = r ? r.engine : rr ? rr.engine : engine;
    eng.restore(m.snapshot); // the state, with every step the Worker made (step back works across the run)
    if (rr) { for (const x of workerInputs.splice(0).slice(m.applied ?? 0)) eng.input?.(x); if (uv()) uv().realtime?.sync?.(); finishRun(m.stop); playRendered(m.audio, rr.seconds); return; }
    if (r && uv()) uv().realtime?.sync?.(); // the view's own model follows its engine (pico2's C source view)
    for (const x of workerInputs.splice(0).slice(m.applied ?? 0)) eng.input?.(x); // inputs that came after its run ended
    // a view's own stop (pico2's C source view: a line breakpoint) is reported as the view words it, as after runSingle
    if (r && uv() && m.stop === STOP.BREAK && !session.breakpoints.has(uv().breakAt?.() ?? -1)) {
      const why = uv().event?.();
      if (why) { reportSingle.event = why; finishRun('event'); return; }
    }
    finishRun(m.stop);
  }
}

/** Pause button and F5 while running: the run stops after its current slice. */
function pause() {
  if (!running) return;
  if ((rt || (!uv() && speedSel.value !== 'slow')) && worker) { worker.postMessage({ type: 'pause' }); return; }
  runId += 1;
  finishRun(STOP.PAUSE);
}

/** Stop a run at once, dropping what a Worker run did (reset, assemble, open). */
function cancelRun() {
  if (!running) return;
  runId += 1;
  renderRun = null;
  if (worker) {
    worker.terminate();
    worker = undefined; // a fresh one next time
  }
  workerRun = false;
  workerInputs = [];
  endRealtime();
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

/**
 * v10 draft (View.imageOnly; pico2's C source view, research D38): a view offered only while the program is an image opened from
 * a file, whose sources are not in the editor; otherwise its tab is hidden and, if it was open, the instruction view opens.
 */
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
  const row = p?.listing.find((l) => l.address === s?.pc) ?? null;
  markCurrent(s && !s.halted && !p?.imported ? row : null);
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
  // v11: a page view draws the page's engine (pico2's Board), unless no workspace shows it (a narrow screen)
  if (pv()) { if (drawingHidden()) drawingStale = true; else { drawingStale = false; pv().render(); } }
  updateWsStatus();
}

/** The shared panels show the datapath processor's state: registers, PC, data memory, cycles. */
function refreshSingle(p) {
  const v = uv();
  const s = v.state(); // null while no program is loaded
  const at = s ? s.instruction ?? s.pc : undefined; // multicycle: the instruction the cycle works on
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
  const waits = ms?.timed ? ms.stats.waitCycles : 0; // clock edges spent waiting for memory
  counters.updateCycles({ cycles: s?.cycle ?? 0, instructions: s?.retired ?? 0,
    extra: [...(v.counters?.() ?? []), ...(ms?.timed ? [[STRINGS.mem.waitCycles, waits]] : [])] });
  // a view that runs the module's own machine may give its console text (pico2's C source view: UART0, P1-L1); others none
  consolePanel.setOutput(typeof s?.output === 'string' ? Array.from(s.output.slice(-OUTPUT_LIMIT), (c) => c.charCodeAt(0)) : []);
  // on a narrow screen, while no workspace shows the drawing or the details they are not redrawn (ws.onShow does it)
  if (drawingHidden()) drawingStale = true;
  else { drawingStale = false; v.render(); refreshWave(); }
  updateWsStatus();
}

function listingText(p) {
  return p.listing.map((l) => `${l.address.toString(16).padStart(8, '0')}  ${(l.word >>> 0).toString(16).padStart(8, '0')}  `
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
  return { arch: arch.id, view: mode, profile: mode === VIEWS[0].id ? session.profile : isaProfile, subset: subsetSel.value || null, lang, name: sourceName(), // no subset: an empty menu
    source: editor.value, cc: xlValues(), ...(asmOpts.length ? { opts: asmValues() } : {}), ...(comp ? { companion: { ...comp } } : {}), ...(vcomp && !PROJECTS ? { companions: [{ ...vcomp }] } : {}),
    ...(inputEngine()?.restart && inputEngine().inputs?.().length ? { inputs: inputEngine().inputs() } : {}), // v10 draft (P1-M4, D36 Q5)
    ...Object.fromEntries(SETTINGS.map((v) => [v.settings.key, viewSettings(v)])),
    ...(memCfg.mode !== 'ideal' || memCfg.words !== 256 || memCfg.devices ? { mem: memCfg } : {}),
    ...(hasTraps(session.profile) || hasTraps(isaProfile) || memCfg.devices ? { platform: session.platformConfig } : {}),
    // projects (links v2, Q5 of D31): the whole project
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

/** Open a shared state: keep the editor's text for File ▸ Restore, then settings, program and view. */
async function applyShared(st, message) {
  // contract v9: a state of another instruction set (an exercise's profile) is not applied here
  if (variantOf(arch, st.profile) !== arch.activeVariant) { consolePanel.message(STRINGS.share.refusedVariant(profileOf(st.profile)?.label ?? st.profile), 'error'); return; }
  cancelRun();
  // another program: the breakpoints of the one before were addresses in it (a template's run stopped at one of them;
  // GUI walkthrough, 2026-11-11). Said in the console, after the build's messages (below)
  const dropped = session.breakpoints.size;
  session.breakpoints.clear();
  // File ▸ Restore: the text before (one-file shell), or the project open before (projects: the state becomes a new project)
  store.set('pips.source.before', JSON.stringify(PROJECTS ? { project: project().id } : { lang, text: editor.value, companion: comp, vcompanion: vcomp }));
  for (const x of xlOpts) { const v = st.cc?.[x.o.id]; if (v) { x.sel.value = v; store.set(`pips.cc.${x.o.id}`, v); } }
  for (const x of asmOpts) { const v = st.opts?.[x.o.id]; if (v && x.o.values.some((o) => o.id === v)) { x.sel.value = v; store.set(x.key, v); } } // v10 draft
  queueMicrotask(() => applyEngineOpts()); // P1-M5: a link's or template's speaker and converter (after the engine is made)
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
  if (PROJECTS) {
    // a link v2 carries the project; a single program (link v1, template, settings file) becomes a one-file project
    const one = singleName(st);
    const files = st.files ?? [{ name: one, text: st.source }, ...(st.companion && st.companion.name !== one ? [st.companion] : []), // research D43: the pair
      ...(VCOMP && st.companions?.length ? [{ name: VCOMP.projectFile, text: st.companions[0].text }] : [])]; // v12 draft: the circuit
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
    setComp(st.companion ?? null); // a state without one has none: its program would not be built with another's
    setVcomp(st.companions?.[0] ?? null, { apply: false }); // v12 draft: nor run with another's circuit (applied with the options below)
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
  // v10 draft (pico2 P1-M4, D36 Q5): the inputs of the link or file, replayed from the start at their cycles
  if (st.inputs?.length && applyInputs(st.inputs)) { consolePanel.message(STRINGS.realtime.inputsKept(st.inputs.length)); refresh(); }
}

/** Projects: the file name of a single shared program: its own if a project may hold it, else main + the language's extension. */
function singleName(st) {
  const exts = projectExtensions(arch);
  const ok = st.name && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(st.name) && exts.includes(st.name.slice(st.name.lastIndexOf('.')).toLowerCase());
  if (ok && (st.lang === XID) === (langOfFile(st.name) === XID)) return st.name;
  return `main${st.lang === XID ? XL.extension : arch.language.extension}`;
}

/** A link opened in this page (at start or pasted into the address bar). */
async function openFragment() {
  if (!isShareFragment(location.hash)) return;
  const frag = location.hash;
  history.replaceState(null, '', `${location.pathname}${location.search}`); // a reload does not open it again
  try {
    const st = await decodeFragment(frag);
    // v10 draft (P1-L1, research D34): a link to one program opens in the edition without projects that has its language
    // (pico2: Lite); a project's link in the edition with projects (below)
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
    if (e.code === 'variant') { // contract v9: the link's profile is of another instruction set; open it there
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
/** The hint under a refused link or file: another version, architecture (W-D29 decision 4) or instruction set (v9). */
const refusedNote = (e) => (e.code === 'version' ? STRINGS.share.refusedVersion : e.code === 'arch' ? STRINGS.share.refusedArch(e.data.arch)
  : e.code === 'field' && e.data?.field === 'files' && !PROJECTS && PROJECT_EDITION ? CAP.projects.text // a project in pico2 Lite (P1-L1)
  : e.code === 'variant' ? STRINGS.share.refusedVariant(profileOf(e.data.profile)?.label ?? e.data.profile) : null);

function restoreBefore() {
  let b = null;
  try { b = JSON.parse(store.get('pips.source.before') ?? 'null'); } catch { /* nothing kept */ }
  if (PROJECTS && b?.project) { // projects: back to the project that was open before
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
    setVcomp(b.vcompanion ?? null);
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
    const c = cc.compile(editor.value, { name: cName, profile: OWN_PROFILES[0].id, options: { ...buildValues(), ...xlValues() }, ...(COMP ? { companions: compFiles() } : {}) });
    if (!c.ok) { consolePanel.message(STRINGS.cc.errors, 'error'); return null; }
    text = c.text;
  }
  // an exercise of the laboratory profile (NPU-4) is assembled for it: its data lie in the laboratory RAM; a program with a
  // companion file (pico2 Lite: its .pio file, P1-M9) is built with it, as Build does
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
  const ext = low.slice(low.lastIndexOf('.') + 1);
  if (!PROJECTS && ext === 'zip' && PROJECT_EDITION) { can('projects'); return; } // a project in pico2 Lite: the reason (P1-L1)
  if (PROJECTS && ext === 'zip') { // projects: a .zip becomes a new project (Q7 of D31)
    try {
      await proj.importZip(new Uint8Array(await file.arrayBuffer()), file.name);
      consolePanel.message(STRINGS.projects.imported(file.name, project().files.length), 'ok');
    } catch (e) { consolePanel.message(STRINGS.projects.importRefused(e.message), 'error'); }
    return;
  }
  if (PROJECTS && projectExtensions(arch).includes(`.${ext}`)) { // projects: a source file joins the open project
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
  if (VCOMP && low.endsWith(VCOMP.extension.toLowerCase())) { // v12 draft (pico2 P1-B2): a circuit file becomes the program's circuit
    setVcomp({ name: file.name, text: await file.text() });
    dirty = true; editorStatus(); saveSoon();
    consolePanel.message(STRINGS.companion.opened(file.name), 'ok');
    return;
  }
  if (COMP && low.endsWith(COMP.extension.toLowerCase())) { // research D43: a .pio file becomes the program's companion
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
    const first = OWN_PROFILES[0].id; // imported code is for the whole ISA
    if (gccReport && mode === VIEWS[0].id && session.profile !== first) { session.profile = first; isaProfile = first; profileSel.value = first; store.set('pips.profile', first); }
    const dropped = session.breakpoints.size; // another program: its breakpoints would be the old one's addresses
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
  } catch (e) { consolePanel.message(`${file.name}: ${e.message}`, 'error'); return; } // not an image of this architecture
  cancelRun();
  resetEngine();
  // v10 (draft): an architecture that declares its image kinds keeps the image as the program when the view changes
  // (setMode loads it again for the view's profile) and the open datapath view runs it at once
  if (arch.language.imageKinds) {
    session.imported = { content, kind, name: file.name };
    if (uv() || isCmp()) inst[mode].load(session.program);
  }
  consolePanel.clearMessages();
  consolePanel.message(STRINGS.importedImage(session.program.listing.length), 'ok', null, STRINGS.importedNote);
  // v10 (draft): what the architecture noted about the image (pico2: the validator's notes)
  for (const d of session.program.diagnostics ?? []) if (d.severity === 'warning') consolePanel.message(d.message, 'warn');
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
const programKey = () => textHash(`${lang}|${session.profile}|${subsetSel.value}|${Object.values(xlValues()).join('|')}|${asmOpts.length ? `${Object.values(buildValues()).join('|')}|` : ''}${
  PROJECTS ? `${project().id}|${project().entry}|${JSON.stringify(project().files)}` : `${editor.value}${comp ? `|${comp.name}|${comp.text}` : ''}`}`); // projects: every file
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
      // the panel inputs to replay (contract v8); a view's own engine's too (pico2's C source view, P1-M4)
      ...(inputEngine()?.inputs?.().length && (!uv() || inputEngine()?.restart) ? { inputs: inputEngine().inputs() } : {}) },
    platform: session.platformConfig, // the pin script and the trap settings: a replay needs them
  };
  // contract v9: what this page stores is never storage of before v9 (cleared storage written again at pagehide)
  if (base.variants) store.set('pips.v9', '1');
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
window.addEventListener('pagehide', () => { if (PROJECTS && proj) proj.saveNow(); }); // projects: a pending auto-save at once
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveWorkspace(); });

/** The kept workspace, or null. */
function keptWorkspace() {
  try { const st = JSON.parse(store.get(WS_KEY) ?? 'null'); return st?.v === 1 ? st : null; } catch { return null; }
}

/** Before the first assembly: file name, data loads, cursor and scroll. */
function restoreEditorState(st) {
  if (!st) return;
  if (st.platform) session.platformConfig = normalisePlatform(st.platform);
  // projects: names are the project's. A kept name of the other language's kind is not taken (as applyShared)
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
      // P1-M4: the inputs are kept from the start, so that Replay (the Pins panel) runs them again
      if (Array.isArray(st.run.inputs) && st.run.inputs.length && applyInputs(st.run.inputs)) consolePanel.message(STRINGS.realtime.inputsKept(st.run.inputs.length));
    } else if (uv()) {
      const v = uv();
      if (Array.isArray(st.run.inputs) && st.run.inputs.length) applyInputs(st.run.inputs); // a view's own engine (P1-M4)
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

// --- projects (contract v10 draft capability `projects`; pico2 P1-F1, research D31) ---------------
/** Bring a file of the project to the front (opening its tab). */
function selectFile(name) {
  if (!PROJECTS || !project()?.files.some((f) => f.name === name)) return;
  proj.openTab(name);
  editor.show(name, fileText(project(), name));
  explorer.render(project(), editor.active, proj.status);
  editorStatus();
  saveSoon();
}

/** Close a file's tab (the project keeps the file). */
function closeFile(name) {
  proj.closeTab(name);
  editor.close(name);
  editor.show(project().active, fileText(project(), project().active));
  explorer.render(project(), editor.active, proj.status);
  editorStatus();
}

/** After a change of the files: the explorer and status again; `rebuild` when the program changed (rename, delete, entry). */
function afterFiles(rebuild = false) {
  explorer.render(project(), editor.active, proj.status);
  editorStatus();
  syncBuildLabel(); // a new or deleted C file, or another entry, can change Assemble into Compile
  if (rebuild) doAssemble();
}

/** Show the open project: its tabs, the explorer; breakpoints and markers start afresh. */
function loadProject() {
  const p = project();
  editor.clearMarks();
  editor.reset(p.open, p.active, (n) => fileText(p, n));
  session.breakpoints.clear();
  markedAt = null;
  store.set('pips.project', p.id); // the project this page opens next time
  // P1-L1 (research D34 Q6): a project that chose another C compiler (P1-F2's temporary choice) is built with the edition's
  if (EDITION?.compiler && p.compiler && p.compiler !== EDITION.compiler && p.files.some((f) => langOfFile(f.name) === XID)) {
    const other = C_LANGS.find((x) => x.id === p.compiler);
    const home = arch.editions.find((e) => e.id !== EDITION.id && (e.languages ?? []).includes(p.compiler));
    if (other) startNotes.push([STRINGS.edition.compilerFixed(cCompiler().label, other.label, home?.label ?? null), 'warn']);
  }
  explorer.render(p, editor.active, proj.status);
  dirty = false;
  editorStatus();
}

/** What the project session reports: the save status, another project, changed files or tabs. */
function onProjectChange(what) {
  if (!explorer || !project()) return;
  if (what === 'status') explorer.setStatus(proj.status);
  else if (what === 'project') { loadProject(); doAssemble(); }
  else if (what !== 'text') explorer.render(project(), editor.active, proj.status);
}

/** A new project with the architecture's example, for when none is left. */
const defaultProject = () => createProject({ module: arch.id, name: STRINGS.projects.untitled,
  files: [{ name: `main${arch.language.extension}`, text: EXAMPLE }], extensions: projectExtensions(arch) });

/**
 * At start: open the store (IndexedDB, else memory with a warning) and the project used last; on the first start the
 * program kept in this browser (localStorage, one file per language) becomes the project "My program" (its keys stay).
 */
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
      if (files.length === 2 && store.get('pips.lang') === XID) files.reverse(); // the language in use is the entry
      return files;
    },
  });
  loadProject();
  if (plan().lang === 'c' && (await loadExtra())) lang = XID; // a C entry: the compiler before the first build
  // shown after the first build, which clears the console
  if (r.how === 'migrated') startNotes.push([STRINGS.projects.migrated, 'ok']);
  if (!proj.persistent) startNotes.push([STRINGS.projects.notKept, 'warn']);
}
const startNotes = []; // [text, kind] for the console once the page has started
/** The notes kept for the console, after the build that clears it (each shown once). */
function flushNotes() { for (const [text, kind] of startNotes.splice(0)) consolePanel.message(text, kind); }

// --- shortcuts (WS-U-030) -------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'F5') { e.preventDefault(); running ? pause() : startRun(); }
  else if (k === 'F10' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runToCursor(); }
  else if (k === 'F10' && e.altKey) { e.preventDefault(); if (!lineStepBtn.hidden) lineStep(e.shiftKey ? 'backLine' : 'stepLine'); } // D38
  else if (k === 'F10') { e.preventDefault(); e.shiftKey ? stepBack() : stepOnce(); }
  else if (k === 'F11') { e.preventDefault(); e.shiftKey ? stepOut() : stepOver(); }
  else if (k === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doAssemble({ user: true }); }
  else if (k === 'Escape' && popoverOpen()) { /* Esc closes the pop-up only (an i button's, src/ui/info-button.js) */ }
  else if (k === 'Escape' && workspace.classList.contains('zoomed') && !e.target.closest?.('details[open]')) setZoom(false);
  else if (k === 'Escape' || k === 'f' || k === 'F') viewKey(e);
});
/** An open pop-up (the HTML popover; false in a browser without it): the browser closes it on Esc, after the keydown. */
function popoverOpen() {
  try { return Boolean(document.querySelector(':popover-open')); } catch { return false; }
}
/**
 * F turns the Datapath focus on or off; Esc leaves the focus. Not while the user types (editor, a field, a list), with
 * a modifier, in a dialog, or while a menu is open (Esc closes that first); Esc in full screen is the browser's.
 */
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

// --- start ----------------------------------------------------------------------------------
document.title = `${STRINGS.appName}: ${STRINGS.appFull}`;
for (const node of document.querySelectorAll('[data-string]')) {
  const text = STRINGS[node.dataset.string];
  if (typeof text === 'string') node.textContent = text;
}
const theme = store.get('pips.theme');
if (theme && THEMES.includes(theme)) document.documentElement.dataset.theme = theme; // a name this version does not know: the system's
const savedProfile = store.get('pips.profile');
const ownProfile = (p) => Boolean(p && profileOf(p) && variantOf(arch, p) === arch.activeVariant); // contract v9
if (ownProfile(savedProfile)) session.profile = savedProfile;
if (ownProfile(TOOL?.profile)) session.profile = TOOL.profile; // a tool's profile, not kept as the user's choice
profileSel.value = session.profile;
if (!PROJECTS && XL && store.get('pips.lang') === XID && (await loadExtra())) lang = XID;
const firstVisit = store.get(sourceKey()) === null; // nothing stored yet: a tool with a template opens it (below)
// v10 draft (P1-L1): after a switch of edition, what came with it (Open in Full: the new project; a link), shown once at the
// end of the start, after the builds that clear the console
const editionNote = store.get('pips.editionNote');
if (editionNote) store.set('pips.editionNote', '');
if (PROJECTS) await startProjects(); // projects: the open project's files (src/shell/project-session.js)
else editor.value = store.get(sourceKey()) ?? (lang === XID ? XL.example : EXAMPLE);
if (COMP) { let c = null; try { c = JSON.parse(store.get('pips.companion') || 'null'); } catch { /* none kept */ } setComp(c); }
if (VCOMP && !PROJECTS) { let c = null; try { c = JSON.parse(store.get('pips.vcompanion') || 'null'); } catch { /* none kept */ } setVcomp(c, { apply: false }); }
const kept = isShareFragment(location.hash) ? null : keptWorkspace();
restoreEditorState(kept);
if (PROJECTS) editor.addAreaListener('scroll', () => saveSoon()); // every file's editor, also those opened later
else editor.area.addEventListener('scroll', () => saveSoon());
renderAsm(null);
syncLangControls();
const savedSubset = store.get('pips.subset');
if (savedSubset && SUBSETS.some((s) => s.id === savedSubset)) subsetSel.value = savedSubset;
doAssemble();
for (const b of toolbar.querySelectorAll('.dp-only')) b.hidden = true;
if (isShareFragment(location.hash)) await openFragment(); // a share link decides the view (WS-F-122)
else if (TOOL?.view && viewOf(TOOL.view)) await setMode(TOOL.view); // a tool inside the module opens on its view (the NPU)
else if (viewOf(store.get('pips.view')) && store.get('pips.view') !== VIEWS[0].id) await setMode(store.get('pips.view'));
restoreRunState(kept);
restoring = false;
flushNotes(); // projects: migration, storage refused; editions: the note after a switch
// a tool's first visit opens with its template (the CPU + GPU tool: the host and its kernel), not the module's example
if (firstVisit && TOOL?.template && !isShareFragment(location.hash)) {
  const t = (await loadTemplates().catch(() => null))?.templates.find((x) => x.id === TOOL.template);
  if (t) await openTemplate(t);
}
{ // contract v9: after a reload in another instruction set, say so once
  const why = store.get('pips.variantNote');
  if (why) {
    store.set('pips.variantNote', '');
    consolePanel.message(why === 'link' ? STRINGS.variant.link(variantLabel(arch.activeVariant)) : STRINGS.variant.loaded(variantLabel(arch.activeVariant)), 'ok');
  }
}
if (editionNote) consolePanel.message(editionNote, 'ok'); // v10 draft (P1-L1)
{ // an exercise kept from an earlier visit
  let raw = null;
  try { raw = JSON.parse(store.get('pips.exercise') || 'null'); } catch { /* none */ }
  if (raw) await openExercise(raw, null, true);
}
window.addEventListener('hashchange', () => openFragment());
endBoot(brandReady); // the loading screen of index.html (docs/architecture/arch-switcher.md, AS-6)
