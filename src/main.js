// main.js -- entry point of the ISA view (milestone M1): builds the panels,
// connects them to a Session, and provides the execution controls and
// shortcuts (WS-F-090/091, WS-U-030), file open/save/export/import
// (WS-F-025, WS-F-026, WS-F-120) and the work-in-progress store (WS-F-121).
// Runs are executed on the main thread in time slices of at most ~12 ms, so
// the page stays responsive and every step stays in the back-step history.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { STRINGS } from './ui/strings.js';
import { el, hex8, download, store } from './ui/dom.js';
import { Editor } from './ui/editor.js';
import { ListingPanel, FieldsPanel, dataTable, symbolTable } from './ui/listing.js';
import { RegistersPanel, MemoryPanel, CountersPanel, ConsolePanel, CallStackPanel } from './ui/state-panels.js';
import { Session, STOP } from './core/session.js';
import { callStack } from './core/callstack.js';
import { scratch } from './asm/scratch.js';
import { encodeFragment, decodeFragment, isShareFragment, settingsFile, readSettingsFile, LINK_LIMIT } from './core/share.js';
import { DataDialog } from './ui/data-dialog.js';
import { ExamplesDialog } from './ui/examples-dialog.js';
import { HelpDialog } from './ui/help-dialog.js';
import { ExerciseDialog } from './ui/exercise-dialog.js';
import { PROFILES } from './core/profiles.js';
import { assemble, hexImage, usage } from './asm/assembler.js';
import { disassemble, readWords } from './asm/disassembler.js';
import { decodeMnemonic, ABI_NAMES } from './isa/encoding.js';
import { goldenText, traceRecords, traceJsonLines, traceCsv, recordFrames, vcd } from './core/exports.js';
import { Split } from './ui/split.js';
import { icon } from './ui/icons.js';

const EXAMPLE = `# Sum of an array -- an example to start from.
        .data
nums:   .word 3, -1, 4, 1, -5, 9
n:      .word 6
msg:    .asciz "sum computed\\n"

        .text
_start: la    t0, nums        # pointer
        la    t1, n
        lw    t1, 0(t1)       # count
        li    a0, 0           # sum
loop:   beqz  t1, done
        lw    t2, 0(t0)
        add   a0, a0, t2
        addi  t0, t0, 4
        addi  t1, t1, -1
        j     loop
done:   mv    s0, a0
        li    a0, 1           # write(1, msg, 13)
        la    a1, msg
        li    a2, 13
        li    a7, 64
        ecall
        mv    a0, s0
        li    a7, 93          # exit(sum)
        ecall
`;

const session = new Session();
let running = false;
let selected = null;
let dirty = false;
// The language of the editor (spec §10.1): 'asm', or 'c', compiled to the assembly the session runs.
let lang = 'asm';
let cc = null; // the compiler module, loaded with the first use of C (WS-N-011)
let cMap = null; // C line of each line of the generated assembly (WS-F-082), or null
const sourceKey = () => (lang === 'c' ? 'pips.source.c' : 'pips.source');

// --- panels -----------------------------------------------------------------------------
const consolePanel = new ConsolePanel({ onGoTo: (loc) => editor.selectAt(loc.line, loc.column ?? 1, loc.length ?? 0) });
const editor = new Editor({
  onChange: (text) => { dirty = true; store.set(sourceKey(), text); editorStatus(); saveSoon(); },
  onCursorLine: () => { editorStatus(); saveSoon(); },
  onHoverLine: (line) => linkFromC(line),
  onGutterClick: (line) => toggleBreakLine(line),
});
const fields = new FieldsPanel();
const listing = new ListingPanel({
  onSelect: (l) => {
    selected = l;
    fields.show(l);
    const line = l?.line && !session.program?.imported ? edLine(l.line) : null;
    if (line) editor.scrollToLine(line, true);
  },
  onToggleBreak: (addr) => toggleBreak(addr),
});

function toggleBreak(addr) {
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
const regs = new RegistersPanel({ onWatch: (r, on) => { if (on) session.watchRegs.add(r); else session.watchRegs.delete(r); saveSoon(); } });
const memory = new MemoryPanel({
  onWatch: (addr) => {
    if (session.watchWords.has(addr)) session.watchWords.delete(addr);
    else session.watchWords.add(addr);
    consolePanel.message(STRINGS.watchWord(hex8(addr), session.watchWords.has(addr)));
    memory.render();
    saveSoon();
  },
});
const counters = new CountersPanel();
// the call stack (WS-F-103): a frame shows its call site in the listing and the editor
const calls = new CallStackPanel({ onGoTo: (addr) => { if (session.program && !session.program.imported) listing.select(addr); } });
const dataBox = el('div.scroll');
const symBox = el('div.scroll');
const asmBox = el('div.scroll'); // the assembly generated from C (WS-F-082)

/** The editor line of a line of the assembly the session runs: itself, or its C line. */
function edLine(asmLine) {
  if (lang !== 'c') return asmLine;
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
    title: cMap[k] ? `C line ${cMap[k]}` : null }, text || ' ')));
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
  if (lang !== 'c' || !cMap) return;
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
    'aria-keyshortcuts': key, title: tip }, icon(name), el('span.tool-label', { text: label }));
}
function setToolLabel(b, name, label, key) {
  const tip = key ? `${label} (${keyText(key)})` : label;
  b.replaceChildren(icon(name), el('span.tool-label', { text: label }));
  b.setAttribute('aria-label', tip);
  b.title = tip;
}
// An export of a whole run (WS-F-124 to WS-F-126); `.dp-only` items exist only in a datapath view.
const runExport = (label, action, cls = '') => el(`button${cls}`, { type: 'button', onclick: action, title: STRINGS.exportRunTitle, text: label });
const profileSel = el('select', { 'aria-label': STRINGS.profile, onchange: (e) => { session.profile = e.target.value; store.set('pips.profile', session.profile); syncLangControls(); doAssemble(); } },
  Object.keys(PROFILES).map((p) => el('option', { value: p, text: STRINGS.profileNames[p] })));
const speedSel = el('select', { 'aria-label': STRINGS.speed },
  el('option', { value: 'max', text: STRINGS.speedMax }), el('option', { value: 'slow', text: STRINGS.speedSlow }));
const runBtn = tool('play', STRINGS.run, () => (running ? pause() : startRun()), { key: 'F5', cls: '.tool-run' });
const runStatus = el('span.run-status', { role: 'status', 'aria-live': 'polite' });
const fileInput = el('input', { type: 'file', accept: '.s,.asm,.S,.c,.hex,.bin,.json', hidden: true, onchange: (e) => { openFile(e.target.files[0]); e.target.value = ''; } });
const assembleBtn = tool('build', TL.build, () => doAssemble(), { key: 'Control+Enter', cls: '.tool-build' });
// C (spec §10.1): the language of the editor, the translation mode (WS-F-081) and, for the ISA profile, the ISA (WS-F-083)
const C = STRINGS.cc;
const savedOpt = (k, list, d) => { const v = store.get(k); return list.includes(v) ? v : d; };
const langSel = el('select', { 'aria-label': C.language, onchange: (e) => setLang(e.target.value) },
  Object.entries(C.languages).map(([v, t]) => el('option', { value: v, text: t })));
const ccMode = el('select', { 'aria-label': C.mode, title: C.modeTitle, onchange: (e) => { store.set('pips.cc.mode', e.target.value); doAssemble(); } },
  Object.entries(C.modes).map(([v, t]) => el('option', { value: v, text: t })));
const ccMarch = el('select', { 'aria-label': C.march, onchange: (e) => { store.set('pips.cc.march', e.target.value); doAssemble(); } },
  Object.entries(C.marches).map(([v, t]) => el('option', { value: v, text: t })));
ccMode.value = savedOpt('pips.cc.mode', Object.keys(C.modes), 'plain');
ccMarch.value = savedOpt('pips.cc.march', Object.keys(C.marches), 'rv32im');
const ccOpts = el('span.cc-opts', { hidden: true },
  el('label', { title: C.modeTitle }, `${C.mode} `, ccMode), el('label', { title: C.marchTitle }, `${C.march} `, ccMarch));

function doReset() {
  cancelRun();
  session.reset();
  if (uv()) uv().reset();
  report.abiSeen = 0; // a fresh hart: its reports start again
  report.uninitAt = 0;
  report.uninitN = 0;
  consolePanel.message(STRINGS.resetDone);
  refresh();
}

// the teaching templates (the author's list of 2026-10-27, content/templates/): a drop-down in the
// toolbar, grouped by view; each opens in its view with its settings. The index is fetched when the
// menu first opens (WS-N-011); "More examples…" opens the example library.
let templateIndex = null;
async function loadTemplates() {
  if (!templateIndex) {
    const r = await fetch(new URL('../content/templates/index.json', import.meta.url));
    if (!r.ok) throw new Error(`index.json: ${r.status}`);
    templateIndex = await r.json();
  }
  return templateIndex;
}
async function openTemplate(t) {
  const r = await fetch(new URL(`../content/templates/${t.file}`, import.meta.url));
  if (!r.ok) { consolePanel.message(STRINGS.templates.failed(`${t.file}: ${r.status}`), 'error'); return; }
  await applyShared({ view: t.view, profile: 'iss', lang: t.lang, name: t.file, source: await r.text(), pipe: t.pipe ?? null },
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
const sep = () => el('span.tool-sep', { 'aria-hidden': 'true' });
const toolbar = el('div.toolbar', { role: 'toolbar', 'aria-label': TL.group },
  assembleBtn,
  sep(),
  runBtn,
  tool('stepBack', STRINGS.stepBack, () => stepBack(), { key: 'Shift+F10', iconOnly: true }),
  tool('step', STRINGS.step, () => stepOnce(), { key: 'F10' }),
  tool('stepOver', STRINGS.stepOver, () => stepOver(), { key: 'F11' }),
  tool('stepOut', STRINGS.stepOut, () => stepOut(), { key: 'Shift+F11' }),
  tool('runToCursor', STRINGS.runToCursor, () => runToCursor(), { key: 'Control+F10', iconOnly: true }),
  tool('reset', STRINGS.reset, doReset, { iconOnly: true }),
  sep(),
  el('label.tool-field', {}, el('span', { text: STRINGS.speed }), speedSel),
  runStatus,
  el('span.sep'),
  el('label.tool-field', {}, el('span', { text: STRINGS.profile }), profileSel),
  templatesMenu,
  exerciseBtn,
  fileMenu(
    btn(STRINGS.open, () => fileInput.click()),
    btn(STRINGS.examples.menu, () => examplesDialog.open()),
    btn(STRINGS.exercise.menu, () => exerciseDialog.open()),
    btn(STRINGS.save, () => download(sourceName(), editor.value)),
    btn(STRINGS.exportHex, () => session.program && download('prog.hex', hexImage(session.program))),
    btn(STRINGS.exportBin, () => session.program && download('prog.bin', session.program.segments[0].bytes, 'application/octet-stream')),
    btn(STRINGS.exportListing, () => session.program && download('prog.lst', listingText(session.program))),
    runExport(STRINGS.exportTrace, () => exportTrace('jsonl')),
    runExport(STRINGS.exportTraceCsv, () => exportTrace('csv')),
    runExport(STRINGS.exportGolden, () => exportGolden(), '.dp-only'),
    runExport(STRINGS.exportVcd, () => exportVcd(), '.dp-only'),
    el('button', { type: 'button', text: STRINGS.dataIo.menu, title: STRINGS.dataIo.menuTitle, onclick: () => dataDialog.open() }),
    el('hr.menu-sep'),
    el('button', { type: 'button', text: STRINGS.share.copyLink, title: STRINGS.share.copyLinkTitle, onclick: () => copyShareLink() }),
    el('button', { type: 'button', text: STRINGS.share.saveSettings, title: STRINGS.share.saveSettingsTitle, onclick: () => saveSettings() }),
    el('button', { type: 'button', text: STRINGS.share.restore, title: STRINGS.share.restoreTitle, onclick: () => restoreBefore() })),
  fileInput);

/** A drop-down of commands (details/summary); closes after a choice, on Escape or on a click elsewhere. */
function dropMenu(summary, items, { onOpen = null, cls = '' } = {}) {
  const list = el('div.menu-list', { role: 'group' }, items);
  const menu = el(`details.menu${cls}`, {}, summary, list);
  menu.addEventListener('toggle', () => { if (menu.open) onOpen?.(list); });
  menu.addEventListener('click', (e) => { if (e.target.closest('.menu-list button')) menu.open = false; });
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); } });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.open = false; });
  return menu;
}
function fileMenu(...items) {
  return dropMenu(el('summary.tool', { title: STRINGS.file }, icon('folder'), el('span.tool-label', { text: STRINGS.file })), items);
}

// --- header: name, views, View menu, theme, full screen, keys (WS-U-010, WS-U-040) ---------------
const header = document.querySelector('.app-header');
const VIEW_ICON = { isa: 'chip', single: 'clock', multi: 'steps', pipe: 'pipeline', compare: 'compare' };
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
  if (!quiet) configureLayout();
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
  const buttons = items.map(([title, body], i) => el('button', { type: 'button', role: 'tab', text: title,
    'aria-selected': String(i === 0), onclick: () => select(i) }));
  function select(i) {
    buttons.forEach((b, k) => b.setAttribute('aria-selected', String(k === i)));
    host.replaceChildren(items[i][1]);
    items[i][2]?.(); // a tab that draws only while shown
  }
  bar.append(...buttons);
  select(0);
  const selectTitle = (title) => { const i = items.findIndex(([t]) => t === title); if (i >= 0) select(i); return i >= 0; };
  return { root: el('div.tabbed', {}, bar, host), select, selectTitle };
};

// --- views (WS-U-010): ISA, the single-cycle view of Chapter 6 (M2), the multicycle view of Chapter 7 (M4),
// the pipelined view of Chapter 8 (M3), the comparison of the three (M5, WS-F-060)
let mode = 'isa';
const views = { single: null, multi: null, pipe: null }; // SingleView, MultiView, PipeView, each loaded with its tab (WS-N-011)
let compareView = null; // CompareView, loaded with its tab
const VIEW_IDS = ['isa', 'single', 'multi', 'pipe', 'compare'];
const VIEW_PROFILE = { single: 'ch06', multi: 'ch07', pipe: 'ch08' };
// The comparison checks the program against the processors' common subset, the Chapter 6 profile.
const COMPARE_PROFILE = 'ch06';
const uv = () => views[mode] ?? null; // the datapath view in use, or null in the ISA and comparison views
let isaProfile = session.profile;
const viewTabs = el('nav.mode-nav', { role: 'tablist', 'aria-label': STRINGS.views });
const viewButtons = [['isa', STRINGS.viewIsa], ['single', STRINGS.viewSingle], ['multi', STRINGS.viewMulti], ['pipe', STRINGS.viewPipe],
  ['compare', STRINGS.viewCompare]].map(([id, label]) =>
  el('button.mode-btn', { type: 'button', role: 'tab', title: label, 'aria-label': label, 'aria-selected': String(id === 'isa'), onclick: () => setMode(id) },
    icon(VIEW_ICON[id]), el('span', { text: label })));
viewTabs.append(...viewButtons);
const subsetSel = el('select', { 'aria-label': STRINGS.single.subset, hidden: true, onchange: (e) => {
  session.subset = e.target.value === 'full' ? null : e.target.value;
  store.set('pips.subset', e.target.value);
  doAssemble();
} }, Object.entries(STRINGS.single.subsets).map(([v, t]) => el('option', { value: v, text: t })));
profileSel.after(subsetSel);
header.replaceChildren(
  el('div.brand', {}, header.querySelector('.app-logo') ?? el('span.app-logo', { 'aria-hidden': 'true' }),
    el('div.brand-text', {}, header.querySelector('.app-title'), el('span.app-subtitle', { text: STRINGS.appFull }),
      ...(document.querySelector('meta[name="risc-vista-edition"][content="release"]')
        ? [el('a.home-link', { href: location.protocol === 'file:' ? 'https://sajidlab.org/mavilera/' : new URL('../', location.href).href, text: STRINGS.homeLink })] : []))),
  viewTabs,
  el('div.header-tools', {}, viewMenu, themeBtn, projBtn, fullBtn, keysBox,
    tool('help', STRINGS.help.button, () => helpDialog.open(), { iconOnly: true })));
showTheme();

// --- the MAVILERA logo and the About dialog --------------------------------------------------
// The logo files (content/branding/) are inlined, so that their colours follow the theme through the
// --rv-* tokens of theme.css; the header keeps the name as text for screen readers.
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
(async () => {
  try {
    const [full, small] = await Promise.all([brandSvg('mavilera-logo.svg'), brandSvg('mavilera-icon.svg')]);
    full.classList.add('brand-logo', 'brand-full');
    small.classList.add('brand-logo', 'brand-icon');
    header.querySelector('.app-logo')?.replaceChildren(full, small);
    header.classList.add('has-logo');
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
  program: () => session.program,
  memory: () => (uv() ? (uv().loaded ? (uv().model.dmem ?? uv().model.mem) : null) : session.hart?.mem ?? null),
  loads: () => session.dataLoads,
  onLoad: (label, bytes, name) => { session.loadData(label, bytes, name); doAssemble(); },
  onClear: () => { session.clearData(); doAssemble(); },
  onSave: (name, data, type) => download(name, data, type),
});
document.body.append(dataDialog.root);

// the example library (WS-F-123): an example opens like a shared program, in the view of its processor
const EXAMPLE_VIEW = { iss: 'isa', ch06: 'single', ch07: 'multi', ch08: 'pipe' };
const examplesDialog = new ExamplesDialog({ base: new URL('..', import.meta.url), templates: () => loadTemplates(), onTemplate: (t) => openTemplate(t), templateItems, onOpen: async (x, text) => {
  let source = text;
  if (x.gcc) source = (await import('./asm/gcc-import.js')).importGcc(text).text;
  await applyShared({ view: EXAMPLE_VIEW[x.profile], profile: x.profile === 'iss' ? 'iss' : isaProfile, subset: x.profile === 'ch06' ? x.subset ?? 'full' : null,
    lang: x.lang, name: x.file, source }, STRINGS.examples.opened(x.title));
  if (x.jalr && store.get('pips.multi.jalr') !== '1') {
    const { fetchJalr } = await import('./uarch/ch07-jalr.js');
    consolePanel.message((await fetchJalr(new URL('..', import.meta.url))) ? STRINGS.examples.needsJalr : STRINGS.examples.noJalr, 'warn');
  }
  if (x.halts === false) consolePanel.message(STRINGS.examples.noHalt, 'warn');
} });
document.body.append(examplesDialog.root);
// the help (W-D20); the documentation is beside the application in a release (../docs/), on the site for the
// offline file, and in content/help/docs/ of the development tree
const helpDialog = new HelpDialog({ base: new URL('..', import.meta.url), onAbout: () => openAbout(),
  docsUrl: RELEASE === null ? new URL('../content/help/docs/index.html', import.meta.url).href
    : location.protocol === 'file:' ? 'https://sajidlab.org/mavilera/riscv/docs/' : new URL('./docs/', location.href).href });
document.body.append(helpDialog.root);
async function openAbout() {
  if (!aboutLogo.firstChild) aboutLogo.append(await brandSvg('mavilera-logo.svg').catch(() => el('strong', { text: STRINGS.appName })));
  about.showModal();
}

// --- panels -------------------------------------------------------------------------------------
const listingTabs = tabs([[STRINGS.listing, listing.root], [STRINGS.data, dataBox], [STRINGS.symbols, symBox], [C.asmTab, asmBox]]);
const pListing = panel(STRINGS.listing, listingTabs.root, '.p-listing', 'list');
// the encode/decode scratchpad (WS-F-024) above the fields of the instruction inspector
const scratchOut = el('div.scratch-out.mono', { 'aria-live': 'polite' });
const scratchIn = el('input.mono.scratch-in', { type: 'text', spellcheck: false, autocomplete: 'off', 'aria-label': STRINGS.scratch.label,
  placeholder: STRINGS.scratch.placeholder, title: STRINGS.scratch.title, oninput: () => runScratch() });
function runScratch() {
  const X = STRINGS.scratch;
  const r = scratch(scratchIn.value);
  if (r.kind === 'empty') { scratchOut.replaceChildren(); return; }
  if (r.kind === 'decode') {
    scratchOut.replaceChildren(el('div', { text: r.ok ? X.decoded(r.text) : X.notInstr }));
    if (r.ok) fields.show(r.lines[0]);
    return;
  }
  if (!r.ok) {
    const hint = r.error.hint === 'scratchOne' ? X.oneOnly : STRINGS.hints[r.error.hint]?.(r.error, r.error.mnemonic ? usage(r.error.mnemonic) : null);
    scratchOut.replaceChildren(el('div.scratch-err', { text: `✖ ${r.error.message}` }), ...(hint && hint !== X.oneOnly ? [el('div.note', { text: hint })] : []));
    return;
  }
  const bin = (w) => (w >>> 0).toString(2).padStart(32, '0').replace(/(.{4})(?!$)/g, '$1_');
  scratchOut.replaceChildren(...r.lines.map((l) => el('button.link-btn.mono', { type: 'button', title: X.pick, onclick: () => fields.show(l) },
    X.word(hex8(l.word), bin(l.word)))));
  fields.show(r.lines[0]);
}
const pFields = panel(STRINGS.layout.panes.inspector, el('div.col', {},
  el('label.scratch', { title: STRINGS.scratch.title }, el('span', { text: STRINGS.scratch.label }), scratchIn), scratchOut, fields.root), '.p-fields', 'inspect');
const pDatapath = panel(STRINGS.single.panel, el('p.note', { text: STRINGS.loadingView }), '.p-datapath');
const pInfo = panel(STRINGS.single.info, el('div'), '.p-info', 'inspect');
const pCompare = panel(STRINGS.compare.panel, el('p.note', { text: STRINGS.loadingView }), '.p-compare', 'compare');
const pMemory = panel(STRINGS.memory, memory.root, '.p-memory', 'memory');
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
  edProfile.textContent = STRINGS.profileNames[session.profile] ?? session.profile;
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
const dockBar = el('div.dock-bar', { onclick: () => rootSplit.setCollapsed('dock', false) },
  icon('chevronUp', { size: 14 }), el('span', { text: STRINGS.layout.dockBar }));
const dock = el('div.dock', {}, dockBar, dockSplit.root);
const workspace = el('div.workspace', {}, rootSplit.root);
const P = STRINGS.layout.panes;

// Projector mode (WS-U-012) keeps every pane, so that nothing is out of reach, but starts with only the
// editor, the main view (drawing, listing or comparison) and one table, the registers, open; the others
// are folded and open from their heading or View ▸ Show. Its layouts are saved apart (`….proj`).
function configureLayout() {
  const dp = Boolean(VIEW_PROFILE[mode]);
  const cmp = mode === 'compare';
  const pj = projector;
  const k = pj ? `${mode}.proj` : mode;
  workspace.classList.toggle('projector', pj);
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
    { node: rightSplit.root, id: 'right', min: 230, size: dp ? 0.22 : 0.26 }], `work.${k}`);
  if (dp) {
    rootSplit.configure([{ node: workSplit.root, id: 'work', min: 200, size: 1 }], `root.${k}`);
  } else {
    dockSplit.configure([{ node: pMemory, id: 'memory', min: 220, size: 0.58, collapsible: true, title: STRINGS.memory },
      { node: pConsole, id: 'console', min: 200, size: 0.42, collapsible: true, title: STRINGS.console }], `dock.${k}`);
    rootSplit.configure([{ node: workSplit.root, id: 'work', min: 200, size: 0.7 },
      { node: dock, id: 'dock', min: 90, size: 0.3, collapsible: true, collapsed: pj, title: P.dock, header: dockBar }], `root.${k}`);
  }
}

/** View ▸ projector mode, the layout commands and a Show switch for each pane that folds. */
function fillViewMenu(list) {
  const dp = Boolean(VIEW_PROFILE[mode]);
  const panes = [[workSplit, 'editor', P.editor],
    ...(dp ? [[midSplit, 'info', P.info], [rightSplit, 'counters', P.counters], [rightSplit, 'console', STRINGS.console]]
      : [...(mode === 'compare' ? [] : [[midSplit, 'inspector', P.inspector]]), [rightSplit, 'calls', P.calls], [rightSplit, 'counters', P.counters], [rootSplit, 'dock', P.dock]])];
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
  if (t.panel === 'regs') { flashPanel(pRegs); return; }
  setZoom(false);
  if (midSplit.isCollapsed('info')) midSplit.setCollapsed('info', false);
  if (viewParts[mode]?.tabs.selectTitle(t.tab)) flashPanel(pInfo);
}

function flashPanel(p) {
  p.classList.remove('flash');
  void p.offsetWidth; // restart the animation
  p.classList.add('flash');
  setTimeout(() => p.classList.remove('flash'), 1300);
}

const app = document.getElementById('app');
app.replaceChildren(toolbar, workspace);
configureLayout();

/** Load a datapath view and its information tabs. Returns false if it could not be loaded. */
async function loadView(id) {
  if (views[id] || (id === 'compare' && compareView)) return true;
  const base = new URL('..', import.meta.url);
  try {
    if (id === 'compare') {
      const { CompareView, loadCompareContent } = await import('./ui/compare-view.js');
      compareView = new CompareView(await loadCompareContent(base));
      pCompare.replaceChildren(el('h2', { text: STRINGS.compare.panel }), compareView.root);
      return true;
    }
    if (id === 'single') {
      const { SingleView, loadSingleContent } = await import('./ui/single-view.js');
      const v = new SingleView(await loadSingleContent(base));
      views.single = v;
      viewParts.single = {
        header: el('h2.with-status', {}, el('span', { text: STRINGS.single.panel }), v.status, v.headerTools), info: STRINGS.single.info,
        tabs: tabs([[STRINGS.single.tabCycle, v.cycleBox], [STRINGS.single.tabControl, v.controlBox],
          [STRINGS.single.tabTiming, v.timingBox], await waveTab('single', v), [STRINGS.listing, listing.root], // these two move here while selected
          [STRINGS.single.tabMemory, memory.root]]),
      };
    } else if (id === 'multi') {
      const { MultiView, loadMultiContent } = await import('./ui/multi-view.js');
      const v = new MultiView(await loadMultiContent(base), { onGoTo: () => refresh(), onStepInstr: () => stepInstr(), onBackInstr: () => backInstr() });
      views.multi = v;
      const M = STRINGS.multi;
      viewParts.multi = {
        header: el('h2.with-status', {}, el('span', { text: M.panel }), v.status, v.headerTools), info: M.info,
        tabs: tabs([[M.tabFsm, v.fsmBox], [M.tabCycle, v.cycleBox], [M.tabRegisters, v.regsBox], [M.tabStrip, v.stripBox],
          [M.tabTiming, v.timingBox], await waveTab('multi', v), [STRINGS.listing, listing.root], [STRINGS.memory, memory.root]]),
      };
    } else {
      const { PipeView, loadPipeContent } = await import('./ui/pipe-view.js');
      const v = new PipeView(await loadPipeContent(base), { onGoTo: () => refresh() });
      views.pipe = v;
      const P = STRINGS.pipe;
      viewParts.pipe = {
        header: el('h2.with-status', {}, el('span', { text: P.panel }), v.status, v.headerTools), info: P.info,
        tabs: tabs([[P.tabDiagram, v.diagramBox], [P.tabHazards, v.hazardsBox], [P.tabSummary, v.summaryBox], [P.tabRegisters, v.registersBox],
          [P.tabPredictor, v.predictorBox], [P.tabCpi, v.cpiBox], [P.tabSignals, v.signalsBox], await waveTab('pipe', v),
          [STRINGS.listing, listing.root], [STRINGS.single.tabMemory, memory.root]]),
      };
    }
  } catch (e) {
    consolePanel.message(STRINGS.loadFailed(e.message), 'error');
    return false;
  }
  const v = views[id];
  v.dp.setLinks(v.targets, (eid) => openTarget(v.targets[eid]), STRINGS.elementNames[VIEW_PROFILE[id]]);
  v.fsm?.setLink(() => openTarget(v.targets.cu), (s) => STRINGS.openFor(s)); // multicycle: the state-output table
  return true;
}

// --- the waveform panel of each datapath view (WS-F-146) ---------------------------------------------
// The records are those of the VCD export: a fresh model of the same program and options run from
// reset, kept and extended while the view's program and model stay the same, up to the furthest
// cycle reached (so that stepping back keeps the later cycles in view).
const WAVE_DEFAULTS = {
  single: ['pc', 'instr', 'RegWrite', 'ALUSrc', 'MemWrite', 'ResultSel', 'PCSel', 'alu_y', 'result'],
  multi: ['state', 'pc', 'IRWrite', 'PCWrite', 'AddrSel', 'ALUSrcA', 'ALUSrcB', 'RegWrite', 'alu_y'],
  pipe: ['pc_if', 'instr_id', 'instr_ex', 'stall_if', 'flush_ex', 'fwd_sel_a', 'fwd_sel_b', 'PCSel_ex', 'alu_y_ex'],
};
const waves = {};
const waveRec = {};
async function waveTab(id, v) {
  const { WaveformPanel } = await import('./ui/waveform.js');
  let format = null;
  if (id === 'multi') {
    const { STATE_CODE } = await import('./uarch/multi.js');
    const names = Object.fromEntries(Object.entries(STATE_CODE).map(([n, c]) => [c, n]));
    format = (name, val) => (name === 'state' || name === 'next' ? names[val] ?? String(val) : null);
  }
  waves[id] = new WaveformPanel({ id, signals: v.exportModel().signals, defaults: WAVE_DEFAULTS[id], format, onGoTo: (k) => goToCycle(k) });
  return [STRINGS.wave.title, waves[id].root, () => refreshWave(true)];
}
let waveShownAt = 0;
function refreshWave(force = false) {
  const v = uv();
  const w = waves[mode];
  if (!v || !w || !w.root.isConnected) return;
  if (running && !force && performance.now() - waveShownAt < 500) return; // a run in progress: twice a second
  waveShownAt = performance.now();
  if (!v.loaded) { w.update([], 0); return; }
  const opt = `${JSON.stringify(v.options ?? null)}|${v.jalr ?? ''}|${v.early ?? ''}|${session.subset ?? ''}`;
  let rec = waveRec[mode];
  if (!rec || rec.program !== session.program || rec.live !== v.model || rec.opt !== opt) {
    rec = waveRec[mode] = { program: session.program, live: v.model, opt, model: v.exportModel().model, frames: [], done: false, max: 0 };
  }
  const cur = v.model.cycle;
  rec.max = Math.min(Math.max(rec.max, cur), VCD_CAP);
  while (!rec.done && rec.frames.length <= rec.max) {
    rec.frames.push({ ...rec.model.evaluate().signals });
    if (rec.frames.length > rec.max) break;
    if (rec.model.step() !== 'step') rec.done = true;
  }
  w.update(rec.frames.slice(0, rec.max + 1), Math.min(cur, rec.frames.length - 1));
}
/** Go to clock cycle k of the datapath view: back over cycles run, or forwards. */
function goToCycle(k) {
  const v = uv();
  if (!v || running || k < 0) return;
  while (v.model.cycle > k && v.back());
  while (v.model.cycle < k && v.step() === 'step');
  refresh();
}

/** Switch view. A datapath view runs its chapter's profile; the ISA view gets its profile back (WS-F-004). */
async function setMode(next) {
  if (next === mode) return;
  cancelRun();
  if (next !== 'isa' && !(await loadView(next))) return;
  const wasIsa = mode === 'isa';
  mode = next;
  viewButtons.forEach((b, i) => b.setAttribute('aria-selected', String(VIEW_IDS[i] === mode)));
  const sc = Boolean(VIEW_PROFILE[mode]); // a datapath view
  const cmp = mode === 'compare';
  for (const b of toolbar.querySelectorAll('.dp-only')) b.hidden = !sc;
  if (sc) {
    const parts = viewParts[mode];
    parts.header.append(zoomBtn);
    pDatapath.replaceChildren(parts.header, uv().root);
    pInfo.replaceChildren(head(parts.info, 'inspect'), parts.tabs.root);
  } else setZoom(false);
  workspace.classList.toggle('dp-mode', sc);
  // The datapath needs the height: the console joins the right column, the data memory becomes a tab.
  if (!sc) pMemory.append(memory.root);
  configureLayout();
  subsetSel.hidden = mode !== 'single';
  profileSel.disabled = sc || cmp;
  profileSel.parentElement.hidden = sc || cmp; // a datapath view fixes the profile; its panel title names the chapter
  listing.names = sc ? 'x' : 'abi'; // the datapath chapters name registers by number
  if (sc || cmp) {
    if (sc) viewParts[mode].tabs.select(0);
    if (wasIsa) isaProfile = session.profile;
    session.profile = sc ? VIEW_PROFILE[mode] : COMPARE_PROFILE;
    session.subset = mode === 'single' && subsetSel.value !== 'full' ? subsetSel.value : null;
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
let cName = 'main.c';
const sourceName = () => (lang === 'c' ? cName : session.files[0].name.replace(/\.\w+$/, '') + '.s');

/** The toolbar for the language: Compile or Assemble; the C options; the ISA choice only for the ISA profile. */
function syncLangControls() {
  langSel.value = lang;
  ccOpts.hidden = lang !== 'c';
  ccMarch.parentElement.hidden = session.profile !== 'iss';
  setToolLabel(assembleBtn, 'build', lang === 'c' ? TL.buildC : TL.build, 'Control+Enter');
  editor.setLanguage(lang);
  editorStatus();
}

/** Switch the editor between assembly and C; each keeps its own text in the browser. */
async function setLang(next) {
  if (next === lang) return;
  if (next === 'c' && !(await loadCompiler())) { langSel.value = lang; return; }
  store.set(sourceKey(), editor.value);
  lang = next;
  store.set('pips.lang', lang);
  editor.value = store.get(sourceKey()) ?? (lang === 'c' ? C.example : EXAMPLE);
  if (lang !== 'c') { cMap = null; renderAsm(null); editor.setLinked([]); }
  syncLangControls();
  doAssemble();
}

async function loadCompiler() {
  if (cc) return true;
  try {
    cc = await import('./cc/compiler.js');
    return true;
  } catch (e) {
    consolePanel.message(STRINGS.loadFailed(e.message), 'error');
    return false;
  }
}

/** Compile the editor's C into session.files; false (with the errors shown) if it does not compile. */
function compileC() {
  const r = cc.compile(editor.value, { name: cName, profile: session.profile, march: ccMarch.value, mode: ccMode.value,
    lbu: session.profile === 'ch06' && session.subset === 'ext' });
  if (!r.ok) {
    cMap = null;
    renderAsm(null);
    editor.setErrors(r.errors);
    for (const e of r.errors) consolePanel.message(e.message, 'error', { line: e.line, column: e.column }, e.subset ? C.subsetHint : null);
    consolePanel.message(C.errors, 'error');
    return false;
  }
  cMap = r.map;
  session.files = [{ name: cName.replace(/\.c$/, '') + '.s', text: r.asm }];
  renderAsm(r.asm);
  return true;
}

// --- actions --------------------------------------------------------------------------------
function doAssemble() {
  cancelRun();
  if (lang === 'c') { doCompile(); return; }
  session.files = [{ name: session.files[0].name, text: editor.value }];
  const p = session.assemble();
  dirty = false;
  consolePanel.clearMessages();
  editor.setErrors([...p.errors, ...p.profileErrors.map((e) => ({ ...e, message: profileMessage(e) }))]);
  for (const e of p.errors) {
    const hint = STRINGS.hints[e.hint]?.(e, e.mnemonic ? usage(e.mnemonic) : null) ?? null;
    consolePanel.message(e.message, 'error', e, hint);
  }
  for (const e of p.profileErrors) consolePanel.message(profileMessage(e), 'error', e, STRINGS.profileHint(e.chapter));
  if (p.ok) {
    const n = p.listing.length;
    const d = p.segments[1]?.bytes.length ?? 0;
    consolePanel.message(STRINGS.assembled(n, d), p.profileErrors.length ? 'warn' : 'ok');
  } else {
    consolePanel.message(STRINGS.asmErrors(p.errors.length), 'error');
  }
  afterAssemble(p);
}

/** Compile the C program and assemble its assembly; errors of either are shown at C lines. */
function doCompile() {
  dirty = false;
  consolePanel.clearMessages();
  let p;
  if (cc && compileC()) {
    p = session.assemble();
    const at = (e) => edLine(e.line) ?? 1;
    editor.setErrors([...p.errors.map((e) => ({ line: at(e), column: 1, message: C.asmError(e.line, e.message) })),
      ...p.profileErrors.map((e) => ({ line: at(e), column: 1, message: C.asmError(e.line, profileMessage(e)) }))]);
    for (const e of p.errors) consolePanel.message(C.asmError(e.line, e.message), 'error', { line: at(e) }, /does not fit/.test(e.message) ? C.fitHint : null);
    for (const e of p.profileErrors) consolePanel.message(C.asmError(e.line, profileMessage(e)), 'error', { line: at(e) });
    if (p.ok && !p.profileErrors.length) consolePanel.message(C.compiled(cMap.length, p.listing.length), 'ok');
  } else {
    session.files = [{ name: cName.replace(/\.c$/, '') + '.s', text: '' }];
    p = session.assemble();
    p.ok = false; // nothing to run until the C program compiles
    session.reset();
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
  if (mode === 'single') views.single.load(session.runnable ? p : null, session.subset);
  else if (mode === 'multi' || mode === 'pipe') views[mode].load(session.runnable ? p : null);
  else if (mode === 'compare') compareView.load(session.runnable ? session.files : null);
  refresh(true);
}

// --- exports of a whole run (WS-F-124 to WS-F-126) --------------------------------------------
// Each replays the program from reset on a fresh hart or model (core/exports.js), so the session
// and its step-back history are untouched.
const TRACE_CAP = 1_000_000; // instructions in a trace file
const VCD_CAP = 20_000; // cycles in a waveform file

function exportTrace(kind) {
  if (!ensureRunnable()) { consolePanel.message(STRINGS.exportNothing, 'error'); return; }
  const { records, error } = traceRecords(session.program, session.profile, TRACE_CAP);
  if (kind === 'csv') download('trace.csv', traceCsv(records), 'text/csv');
  else download('trace.jsonl', traceJsonLines(records), 'application/x-ndjson');
  consolePanel.message(records.length === TRACE_CAP && !error ? STRINGS.exportedTraceCut(TRACE_CAP) : STRINGS.exportedTrace(records.length, error), 'ok');
}

function exportGolden() {
  if (!uv() || !ensureRunnable()) { consolePanel.message(STRINGS.exportNothing, 'error'); return; }
  const { model, label } = uv().exportModel();
  let stop;
  try { stop = model.run(session.runLimit); } catch (e) { consolePanel.message(STRINGS.exportNoHalt(e.message), 'error'); return; }
  if (stop !== 'halt') { consolePanel.message(STRINGS.exportNoHalt(model.error ?? stop), 'error'); return; }
  const words = model.golden();
  download('golden.hex', goldenText(words));
  consolePanel.message(STRINGS.exportedGolden(label, words.length), 'ok');
}

function exportVcd() {
  if (!uv() || !ensureRunnable()) { consolePanel.message(STRINGS.exportNothing, 'error'); return; }
  const { model, signals, module, label } = uv().exportModel();
  const { frames, stop } = recordFrames(model, VCD_CAP);
  const name = session.files[0].name.replace(/\.\w+$/, '');
  download(`${name}-${VIEW_PROFILE[mode]}.vcd`, vcd(frames, signals, { module, comment: `${name}, ${label}; one cycle = 10 ns of the time axis` }));
  consolePanel.message(STRINGS.exportedVcd(label, frames.length), 'ok');
  if (stop === 'step') consolePanel.message(STRINGS.exportedVcdCut(VCD_CAP + 1), 'warn');
  else if (stop === 'error') consolePanel.message(STRINGS.exportNoHalt(model.error), 'warn');
}

function profileMessage(e) {
  return e.chapter ? STRINGS.profileError(e.mnemonic, e.chapter) : STRINGS.profileIss(e.mnemonic);
}

function ensureRunnable() {
  if (dirty || !session.program) doAssemble();
  if (!session.runnable) { consolePanel.message(STRINGS.notRunnable, 'error'); return false; }
  return true;
}

function report(stop) {
  const h = session.hart;
  switch (stop) {
    case STOP.HALT: consolePanel.message(STRINGS.halted(hex8(h.pc), h.exitCode), 'ok'); break;
    case STOP.ERROR: {
      const loc = session.program.listing.find((l) => l.address === h.pc);
      consolePanel.message(STRINGS.simError(session.error), 'error', loc ? { file: loc.file, line: edLine(loc.line) } : null, STRINGS.simHint(session.error));
      break;
    }
    case STOP.BREAK: consolePanel.message(STRINGS.stoppedBreak(hex8(h.pc))); break;
    case STOP.WATCH: {
      const last = session.last;
      if (last?.rd && session.watchRegs.has(last.rd)) {
        consolePanel.message(STRINGS.stoppedWatchReg(`x${last.rd} (${ABI_NAMES[last.rd]})`, hex8(h.x[last.rd]), hex8(last.pc)));
      } else if (last?.memSize) {
        const a = (last.memAddr & ~3) >>> 0;
        consolePanel.message(STRINGS.stoppedWatchWord(hex8(a), hex8(h.mem.read(a, 4)), hex8(last.pc)));
      }
      break;
    }
    case STOP.BUDGET: {
      const r = session.loopRange();
      consolePanel.message(STRINGS.stoppedBudget(session.runCount, hex8(r.from), hex8(r.to)), 'warn');
      break;
    }
    default: break;
  }
  if (session.history.dropped && !report.droppedShown) {
    report.droppedShown = true;
    consolePanel.message(STRINGS.historyDropped(session.history.dropped), 'warn');
  }
  const seen = report.abiSeen ?? 0;
  for (const v of h.abiViolations.slice(seen)) consolePanel.message(STRINGS.abiViolation(v), 'warn');
  report.abiSeen = h.abiViolations.length;
  reportUninit(h);
}

/** The new warnings of the uninitialised-value check (WS-F-147), each linked to its line; at most UNINIT_SHOWN after a reset. */
const UNINIT_SHOWN = 20;
function reportUninit(h) {
  const after = report.uninitAt ?? 0;
  for (const u of h.uninitSoFar) {
    if (u.count <= after) continue;
    report.uninitN = (report.uninitN ?? 0) + 1;
    if (report.uninitN <= UNINIT_SHOWN) {
      const loc = session.program?.listing.find((l) => l.address === u.pc);
      consolePanel.message(STRINGS.uninit(u.text), 'warn', loc ? { file: loc.file, line: edLine(loc.line) } : null,
        report.uninitN === 1 ? STRINGS.uninitNote : null);
    } else if (report.uninitN === UNINIT_SHOWN + 1) consolePanel.message(STRINGS.uninitMore, 'warn');
    report.uninitAt = u.count;
  }
}

/** Message for the end of a step or run of a datapath view. */
function reportSingle(stop) {
  const m = uv().model;
  if (stop === 'halt' && mode === 'pipe') consolePanel.message(STRINGS.pipe.halted(hex8(m.haltPc ?? 0), m.cycle, m.stats.retired), 'ok');
  else if (stop === 'halt' && mode === 'multi') {
    consolePanel.message(STRINGS.multi.halted(hex8(m.haltPc ?? 0), m.cycle, m.retired, m.retired ? (m.cycle / m.retired).toFixed(3) : '—'), 'ok');
  }
  else if (stop === 'halt') consolePanel.message(STRINGS.single.halted(hex8(m.pc), m.cycle), 'ok');
  else if (stop === 'error') {
    const loc = session.program?.listing.find((l) => l.address === (m.instrAddress ?? m.pc));
    consolePanel.message(STRINGS.single.stopped(m.error), 'error', loc ? { file: loc.file, line: edLine(loc.line) } : null);
  } else if (stop === STOP.BREAK) consolePanel.message(STRINGS.stoppedBreak(hex8(m.pc)));
  else if (stop === STOP.PAUSE) consolePanel.message(STRINGS.paused(hex8(m.pc)));
  else if (stop === 'event') consolePanel.message(reportSingle.event);
  if (m.dropped && !reportSingle.dropped) {
    reportSingle.dropped = true;
    consolePanel.message(STRINGS.single.historyNote(m.dropped), 'warn');
  }
}

function stepOnce() {
  if (running || !ensureRunnable()) return;
  if (uv()) {
    const r = uv().step();
    if (r !== 'step') reportSingle(r);
  } else {
    report(session.step());
  }
  refresh();
}

/** Multicycle view: the rest of this instruction, up to the next FETCH (WS-F-040). */
function stepInstr() {
  if (running || !ensureRunnable() || mode !== 'multi') return;
  const r = uv().stepInstruction();
  if (r !== 'step') reportSingle(r);
  refresh();
}

function backInstr() {
  if (running) { pause(); return; }
  if (mode !== 'multi') return;
  if (!uv().backInstruction()) consolePanel.message(STRINGS.nothingToUndo);
  refresh();
}

function stepBack() {
  if (running) { pause(); return; } // the run stops first; press again to step back
  if (uv()) {
    if (!uv().back()) consolePanel.message(STRINGS.nothingToUndo);
    refresh();
    return;
  }
  if (!session.hart || !session.back()) { consolePanel.message(STRINGS.nothingToUndo); return; }
  report.abiSeen = session.hart.abiViolations.length;
  refresh();
}

function stepOver() {
  if (running || !ensureRunnable()) return;
  if (mode === 'multi') { stepInstr(); return; } // one whole instruction
  const t = uv() ? null : session.stepOverTarget(); // one cycle in the other datapath views
  if (t === null) stepOnce(); else startRun({ target: t, depth: session.callDepth() });
}

function stepOut() {
  if (running || !ensureRunnable()) return;
  if (uv()) { stepOnce(); return; }
  const t = session.stepOutTarget();
  if (t === null) stepOnce(); else startRun({ target: t, depth: session.callDepth() - 1 });
}

function runToCursor() {
  if (running || !ensureRunnable()) return;
  const line = editor.cursorLine();
  const l = session.program.listing.find((x) => (lang === 'c' ? edLine(x.line) === line : x.line === line && x.part === 0));
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
      if (running) runOnMainThread(true);
    };
  } catch {
    worker = null;
  }
  return worker;
}

function setRunning(on) {
  running = on;
  setToolLabel(runBtn, on ? 'pause' : 'play', on ? STRINGS.pause : STRINGS.run, 'F5');
  runBtn.setAttribute('aria-pressed', String(on));
  runStatus.textContent = on ? STRINGS.runningStatus(session.hart?.instret ?? 0) : '';
}

function finishRun(stop) {
  setRunning(false);
  if (uv()) reportSingle(stop);
  else if (stop === STOP.PAUSE) consolePanel.message(STRINGS.paused(hex8(session.hart.pc)));
  else report(stop);
  refresh();
}

/** Run of a datapath view: cycles in ~12 ms slices, or one cycle per 0.4 s when animated. */
function runSingle(id, opts) {
  const v = uv();
  const m = v.model;
  const tick = (first) => {
    if (!running || id !== runId) return;
    const slow = speedSel.value === 'slow';
    const t0 = performance.now();
    let r = 'step';
    let k = 0;
    do {
      if (!first || k > 0) {
        const at = v.breakAt ? v.breakAt() : m.pc; // multicycle: only at a FETCH
        if (at !== null && session.breakpoints.has(at)) { r = STOP.BREAK; break; }
        if (at !== null && opts.target === at) { r = STOP.TARGET; break; }
      }
      if (m.cycle >= session.runLimit) { r = STOP.BUDGET; break; }
      r = v.step();
      k += 1;
      const why = r === 'step' ? v.stopReason?.() : null; // pipelined view: stop on a stall, flush or misprediction (WS-F-091)
      if (why) { reportSingle.event = why; r = 'event'; }
    } while (r === 'step' && !slow && performance.now() - t0 < 12);
    if (r === 'step') {
      runStatus.textContent = `${STRINGS.single.cycles}: ${m.cycle}`;
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
    stop = session.run({ ...opts, chunk: 20_000, resumed });
    resumed = true;
  } while (stop === STOP.CHUNK && performance.now() - t0 < 10);
  if (stop !== STOP.CHUNK) { finishRun(stop); return; }
  const w = getWorker();
  if (w) {
    w.postMessage({ type: 'run', id: runId, request: session.workerRequest({ ...opts, resumed: true }) });
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
      stop = session.run({ ...runOpts, chunk: 20_000, resumed: r });
      r = true;
    } while (stop === STOP.CHUNK && performance.now() - t0 < 12);
    if (stop === STOP.CHUNK) {
      runStatus.textContent = STRINGS.runningStatus(session.hart.instret);
      requestAnimationFrame(() => tick(true));
      return;
    }
    finishRun(stop);
  };
  tick(resumed);
}

function animate(id, resumed) {
  if (!running || id !== runId) return;
  const stop = session.run({ ...runOpts, chunk: 1, resumed });
  if (stop === STOP.CHUNK) { refresh(); setTimeout(() => animate(id, true), 150); return; }
  finishRun(stop);
}

function onWorkerMessage(e) {
  const m = e.data;
  if (!running) return;
  if (m.type === 'progress') {
    runStatus.textContent = STRINGS.runningStatus(m.instret);
  } else if (m.type === 'done') {
    session.applyWorkerResult(m.result);
    finishRun(m.result.stop);
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
  setRunning(false);
}

// Until an instruction is chosen in the listing, the inspector shows the one at the PC, so that it is never empty.
let followed = null;
function followPc(p, h) {
  if (selected) return;
  const l = h && !h.halted ? p?.listing.find((x) => x.address === h.pc) ?? null : null;
  if (l === followed) return;
  followed = l;
  fields.show(l);
  if (l) fields.root.prepend(el('p.note.fields-follow', { text: STRINGS.fieldsFollow }));
}

function refresh(programChanged = false) {
  saveSoon();
  const p = session.program;
  const h = session.hart;
  if (programChanged) {
    listing.setProgram(p, session.breakpoints);
    dataBox.replaceChildren(dataTable(p));
    symBox.replaceChildren(symbolTable(p, (s) => { memory.goTo(s.name); const ln = edLine(s.line); if (ln) editor.goToLine(ln); }));
    selected = null; // the inspector follows the PC again
    followed = null;
    fields.show(null);
    report.abiSeen = 0;
    report.uninitAt = 0;
    report.uninitN = 0;
    report.droppedShown = false;
    reportSingle.dropped = false;
    showBreakLines();
  }
  editorStatus();
  if (uv()) { refreshSingle(p); return; }
  const last = session.last;
  regs.update(h ? { x: h.x, pc: h.pc, changed: last?.rd || null } : null);
  listing.markPc(h?.pc);
  followPc(p, h);
  const line = p?.listing.find((l) => l.address === h?.pc)?.line ?? null;
  editor.setCurrentLine(h && !h.halted && !p?.imported && line ? edLine(line) : null);
  memory.setContext({ mem: h?.mem, program: p, x: h?.x, watched: session.watchWords, written: last?.memSize ? { addr: last.memAddr, size: last.memSize } : null, profile: PROFILES[session.profile] });
  counters.update(h);
  calls.update(h ? callStack(h, p) : null);
  consolePanel.setOutput(h?.output ?? []);
}

/** The shared panels show the datapath processor's state: registers, PC, data memory, cycles. */
function refreshSingle(p) {
  const v = uv();
  const m = v.model;
  const last = m.last;
  const loaded = v.loaded;
  const at = m.instrAddress ?? m.pc; // multicycle: the instruction the cycle works on
  regs.update(loaded ? { x: m.x, pc: m.pc, changed: last?.rd || null } : null);
  listing.markPc(loaded ? at : undefined);
  const line = loaded ? p?.listing.find((l) => l.address === at)?.line ?? null : null;
  editor.setCurrentLine(loaded && !m.halted && !p?.imported && line ? edLine(line) : null);
  memory.setContext({ mem: loaded ? (m.dmem ?? m.mem) : null, program: p, x: m.x, watched: session.watchWords,
    written: last && last.mem >= 0 ? { addr: last.mem & ~3, size: 4 } : null, profile: PROFILES[VIEW_PROFILE[mode]] });
  const R = STRINGS.pipe.cpiRows;
  counters.updateCycles({ cycles: m.cycle, instructions: mode === 'pipe' ? m.stats.retired : mode === 'multi' ? m.retired : m.cycle,
    extra: mode === 'pipe' ? [[R.stalls, m.stats.loadUse], [R.redirects, m.stats.redirects], [R.mispredicts, m.stats.mispredicts]] : [] });
  consolePanel.setOutput([]);
  v.render();
  refreshWave();
}

function listingText(p) {
  return p.listing.map((l) => `${l.address.toString(16).padStart(8, '0')}  ${l.word.toString(16).padStart(8, '0')}  `
    + `${disassemble(l.word, l.address).padEnd(28)}  ${l.part === 0 ? l.text.trim() : ''}`.trimEnd()).join('\n') + '\n';
}

/** The changes of a GCC import, each with a link to its line (WS-F-085). */
function reportGcc(name, r) {
  const G = STRINGS.gcc;
  consolePanel.message(G.imported(name, r.report.length), 'ok', null, G.note);
  for (const e of r.report) consolePanel.message(G.actions[e.action](e.what), e.action === 'pcrel' || e.action === 'unsupported' ? 'warn' : 'info', { file: name, line: e.line });
  consolePanel.message(G.added(r.added.join(', ')));
  if (r.missing.length) consolePanel.message(G.missing(r.missing.join(', ')), 'error');
}

// --- share link and settings file (WS-F-122, WS-F-144, WS-N-013) ---------------------------
const PIPE_OPTIONS = { hazard: ['full', 'stall', 'memwb', 'mem', 'none'], predictor: ['none', '1bit', '2bit'], entries: ['2', '4', '8', '16', '32', '64'], resolution: ['ex', 'id'] };
const PIPE_DEFAULTS = { hazard: 'full', predictor: 'none', entries: '8', resolution: 'ex' };

/** The program with its view and settings, as share.js takes it. */
function shareState() {
  const o = views.pipe?.options;
  const pipe = {};
  for (const [k, list] of Object.entries(PIPE_OPTIONS)) pipe[k] = o ? o[k] : savedOpt(`pips.pipe.${k}`, list, PIPE_DEFAULTS[k]);
  pipe.entries = Number(pipe.entries);
  return { view: mode, profile: mode === 'isa' ? session.profile : isaProfile, subset: subsetSel.value, lang, name: sourceName(),
    source: editor.value, cc: { mode: ccMode.value, march: ccMarch.value }, pipe };
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
  if (st.cc?.mode) { ccMode.value = st.cc.mode; store.set('pips.cc.mode', st.cc.mode); }
  if (st.cc?.march) { ccMarch.value = st.cc.march; store.set('pips.cc.march', st.cc.march); }
  if (st.pipe) {
    for (const k of Object.keys(PIPE_OPTIONS)) if (st.pipe[k] !== null && st.pipe[k] !== undefined) store.set(`pips.pipe.${k}`, String(st.pipe[k]));
    views.pipe?.applyOptions(st.pipe);
  }
  if (st.subset) { subsetSel.value = st.subset; store.set('pips.subset', st.subset); }
  isaProfile = st.profile;
  store.set('pips.profile', st.profile);
  if (st.lang === 'c' && !(await loadCompiler())) return;
  lang = st.lang;
  store.set('pips.lang', lang);
  if (lang === 'c') cName = st.name?.endsWith('.c') ? st.name : 'main.c';
  else { session.files = [{ name: st.name && !st.name.endsWith('.c') ? st.name : 'main.s', text: st.source }]; cMap = null; renderAsm(null); }
  editor.value = st.source;
  store.set(sourceKey(), st.source);
  syncLangControls();
  if (st.view === mode) {
    if (mode === 'isa') { session.profile = st.profile; profileSel.value = st.profile; }
    else if (mode === 'single') session.subset = subsetSel.value === 'full' ? null : subsetSel.value;
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
    consolePanel.message(STRINGS.share.refused(e.message), 'error', null, e.code === 'version' ? STRINGS.share.refusedVersion : null);
  }
}

const viewName = (v) => ({ isa: STRINGS.viewIsa, single: STRINGS.viewSingle, multi: STRINGS.viewMulti, pipe: STRINGS.viewPipe, compare: STRINGS.viewCompare }[v]);

function restoreBefore() {
  let b = null;
  try { b = JSON.parse(store.get('pips.source.before') ?? 'null'); } catch { /* nothing kept */ }
  if (!b || typeof b.text !== 'string') { consolePanel.message(STRINGS.share.nothingToRestore); return; }
  (async () => {
    if (b.lang !== lang) await setLang(b.lang === 'c' ? 'c' : 'asm');
    editor.value = b.text;
    store.set(sourceKey(), b.text);
    store.set('pips.source.before', '');
    doAssemble();
    consolePanel.message(STRINGS.share.restored, 'ok');
  })();
}

// --- the exercise mode (WS-F-148): an instructor's task and tests, opened from the user's computer ---
// The file is kept in this browser (like the program) until the exercise is closed; nothing is uploaded.
let exerciseMod = null; // core/exercise.js, loaded with the first exercise (WS-N-011)
let exercise = null;
async function openExercise(raw, name = null, quiet = false) {
  exerciseMod ??= await import('./core/exercise.js');
  try {
    exercise = exerciseMod.parseExercise(raw);
  } catch (e) {
    consolePanel.message(STRINGS.exercise.refused(e.message), 'error');
    return;
  }
  store.set('pips.exercise', JSON.stringify(raw));
  exerciseDialog.set(exercise);
  exerciseBtn.hidden = false;
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
  if (lang === 'c') {
    if (!(await loadCompiler())) return null;
    const c = cc.compile(editor.value, { name: cName, profile: 'iss', mode: ccMode.value, march: ccMarch.value });
    if (!c.ok) { consolePanel.message(STRINGS.cc.errors, 'error'); return null; }
    text = c.asm;
  }
  const p = assemble([{ name: lang === 'c' ? cName.replace(/\.c$/, '.s') : session.files[0].name, text }], { profile: 'iss' });
  if (!p.ok) { consolePanel.message(STRINGS.asmErrors(p.errors.length), 'error'); return null; }
  return exerciseMod.runExercise(p, exercise);
}
const exerciseDialog = new ExerciseDialog({
  onRun: () => runExerciseTests(),
  onStarter: async (source, l) => {
    exerciseDialog.root.close();
    await applyShared({ view: mode, profile: 'iss', lang: l, name: l === 'c' ? 'exercise.c' : 'exercise.s', source }, STRINGS.exercise.starterLoaded);
  },
  onClose: () => { exercise = null; store.set('pips.exercise', ''); exerciseBtn.hidden = true; },
  onOpenFile: () => { exerciseDialog.root.close(); fileInput.click(); },
  // the practice exercises written for the tool (content/exercises/, W-D24), fetched when the list is first shown
  list: async () => {
    const r = await fetch(new URL('../content/exercises/index.json', import.meta.url));
    if (!r.ok) throw new Error(`index.json: ${r.status}`);
    return r.json();
  },
  onPick: async (e) => {
    const r = await fetch(new URL(`../content/exercises/${e.file}`, import.meta.url));
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
      consolePanel.message(STRINGS.share.refused(e.message), 'error', null, e.code === 'version' ? STRINGS.share.refusedVersion : null);
    }
    return;
  }
  const kind = low.endsWith('.hex') ? 'hex' : low.endsWith('.bin') ? 'bin' : low.endsWith('.c') ? 'c' : 's';
  if (kind === 's' || kind === 'c') {
    let text = await file.text();
    let gccReport = null;
    if (kind === 's') { // GCC -S output (WS-F-085); the importer is loaded with the first .s file (WS-N-011)
      const g = await import('./asm/gcc-import.js');
      if (g.looksLikeGcc(text)) {
        gccReport = g.importGcc(text);
        text = gccReport.text;
      }
    }
    if (kind === 'c' && !(await loadCompiler())) return;
    store.set(sourceKey(), editor.value);
    lang = kind === 'c' ? 'c' : 'asm';
    store.set('pips.lang', lang);
    if (lang === 'c') cName = file.name;
    else { session.files = [{ name: file.name, text }]; cMap = null; renderAsm(null); }
    editor.value = text;
    store.set(sourceKey(), text);
    syncLangControls();
    if (gccReport && mode === 'isa' && session.profile !== 'iss') { session.profile = 'iss'; isaProfile = 'iss'; profileSel.value = 'iss'; store.set('pips.profile', 'iss'); }
    doAssemble();
    if (gccReport) reportGcc(file.name, gccReport);
    return;
  }
  const words = kind === 'hex' ? readWords(await file.text(), 'hex') : readWords(new Uint8Array(await file.arrayBuffer()), 'bin');
  const bytes = new Uint8Array(words.length * 4);
  words.forEach((w, i) => { bytes[4 * i] = w; bytes[4 * i + 1] = w >>> 8; bytes[4 * i + 2] = w >>> 16; bytes[4 * i + 3] = w >>> 24; });
  session.program = {
    ok: true, imported: true, errors: [], profileErrors: [], profile: session.profile,
    segments: [{ address: 0, bytes, executable: true }], entry: 0, symbols: new Map(), symbolTable: [],
    listing: words.map((w, i) => ({ address: 4 * i, word: w, mnemonic: decodeMnemonic(w), source: decodeMnemonic(w),
      file: file.name, line: i + 1, text: '', part: -1, parts: 1, operands: [] })),
    dataListing: [], lines: new Map(),
  };
  cancelRun();
  session.reset();
  consolePanel.clearMessages();
  consolePanel.message(STRINGS.importedImage(words.length), 'ok', null, STRINGS.importedNote);
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
const programKey = () => textHash(`${lang}|${session.profile}|${subsetSel.value}|${ccMode.value}|${ccMarch.value}|${editor.value}`);
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
    v: 1, key: programKey(), name: lang === 'c' ? cName : session.files[0].name,
    cursor: [a.selectionStart, a.selectionEnd], scroll: [a.scrollTop, a.scrollLeft],
    breakpoints: [...session.breakpoints], watchRegs: [...session.watchRegs], watchWords: [...session.watchWords],
    run: { mode, steps: uv() ? (uv().loaded ? uv().model.cycle : 0) : session.runCount },
  };
  const loads = session.dataLoads.map((l) => ({ label: l.label, name: l.name, b64: toB64(l.bytes) }));
  try {
    localStorage.setItem(WS_KEY, JSON.stringify({ ...st, dataLoads: loads }));
  } catch {
    // over the browser's storage quota (large data files): keep the rest
    try { localStorage.setItem(WS_KEY, JSON.stringify({ ...st, dataLoads: [], loadsDropped: loads.length })); } catch { /* storage unavailable */ }
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
  if (st.name) { if (lang === 'c') cName = st.name; else session.files[0].name = st.name; }
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
  for (const r of st.watchRegs ?? []) { session.watchRegs.add(r); if (regs.watches[r]) regs.watches[r].checked = true; }
  for (const w of st.watchWords ?? []) session.watchWords.add(w >>> 0);
  showBreakLines();
  const steps = Math.max(0, Number(st.run?.steps) || 0);
  if (st.run?.mode === mode && steps > 0) {
    if (steps > WS_REPLAY_CAP) {
      consolePanel.message(STRINGS.workspace.tooLong(steps));
    } else if (uv()) {
      const v = uv();
      for (let i = 0; i < steps && v.loaded && v.step() === 'step'; i++);
      consolePanel.message(STRINGS.workspace.restored(v.model.cycle, 'cycle'));
    } else {
      for (let i = 0; i < steps && !session.halted; i++) session.step();
      report.abiSeen = session.hart?.abiViolations.length ?? 0;
      report.uninitAt = session.hart?.instret ?? 0; // the replay does not report again
      consolePanel.message(STRINGS.workspace.restored(session.runCount, 'instruction'));
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
if (savedProfile && PROFILES[savedProfile]) session.profile = savedProfile;
profileSel.value = session.profile;
if (store.get('pips.lang') === 'c' && (await loadCompiler())) lang = 'c';
editor.value = store.get(sourceKey()) ?? (lang === 'c' ? C.example : EXAMPLE);
const kept = isShareFragment(location.hash) ? null : keptWorkspace();
restoreEditorState(kept);
editor.area.addEventListener('scroll', () => saveSoon());
renderAsm(null);
syncLangControls();
const savedSubset = store.get('pips.subset');
if (savedSubset && STRINGS.single.subsets[savedSubset]) subsetSel.value = savedSubset;
doAssemble();
for (const b of toolbar.querySelectorAll('.dp-only')) b.hidden = true;
if (isShareFragment(location.hash)) await openFragment(); // a share link decides the view (WS-F-122)
else if (['single', 'multi', 'pipe', 'compare'].includes(store.get('pips.view'))) await setMode(store.get('pips.view'));
restoreRunState(kept);
restoring = false;
{ // an exercise kept from an earlier visit
  let raw = null;
  try { raw = JSON.parse(store.get('pips.exercise') || 'null'); } catch { /* none */ }
  if (raw) await openExercise(raw, null, true);
}
window.addEventListener('hashchange', () => openFragment());
