// pico2/ui/hardware-panel.js -- the left column of the Hardware tab of Pico Full (design pico2-hardware-tab.md §4-§6, 2026-11-15;
// before, the Board (USB) panel of P1-F3 stage F3-2, research D58; design pico2-p1f3-board.md §2.2-§2.5, §2.9-§2.10): three
// sections, each a <section> with its heading.
//   Board:   the state line, Probe board (the preflight's facts, read-only), the badge "board holds build n", Forget this board.
//   Program: what Load would write, Load to Pico, Stop, Check, Download .uf2, Copy to the Pico's drive, the progress ("Sector i of
//            n") and the error ("what happened" + "what to do").
//   Debug:   Run the board's program (REBOOT2 normal), Save the board's flash (READ), the note on a debug probe (later).
// Where the browser has no WebUSB only Download (and the drive copy where the folder picker exists) is offered. It draws the
// hardware session's events and never calls USB itself (research interfaces.md §6). The confirmation (S1, Q5 A) names the board's
// serial number and the build; Enter confirms. Every action is also written to the tab's Log.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from '../../../ui/dom.js';
import { PICO2_STRINGS } from '../strings.js';
import { hardwareSession, canLoad } from '../hw/session.js';
import { icon } from '../../../ui/icons.js';
import { infoButton } from '../../../ui/info-button.js';

const H = PICO2_STRINGS.hw;
const V = H.view;

/** The modal confirmation before the first erase; resolves true for Load, false for Cancel or Esc. */
export class LoadDialog {
  constructor() {
    this.text = el('p', { id: 'hw-confirm-text' });
    this.note = el('p.note', { text: H.confirmNote });
    this.ok = el('button', { type: 'submit', value: 'load', text: H.confirmOk });
    this.root = el('dialog.hw-dialog', { 'aria-labelledby': 'hw-confirm-title', 'aria-describedby': 'hw-confirm-text' },
      el('h2', { id: 'hw-confirm-title', text: H.confirmTitle }), this.text, this.note,
      el('form', { method: 'dialog' }, el('button', { type: 'submit', value: 'cancel', text: H.confirmCancel }), ' ', this.ok));
  }
  ask(summary) {
    if (!this.root.isConnected) document.body.append(this.root);
    this.text.textContent = H.confirmText(summary.serial ?? '?', summary.n, (summary.bytes / 1024).toFixed(0), summary.kind);
    this.root.returnValue = '';
    return new Promise((resolve) => {
      this.root.addEventListener('close', () => resolve(this.root.returnValue === 'load'), { once: true });
      this.root.showModal();
      this.ok.focus(); // Enter confirms (Q5 A: one keystroke)
    });
  }
}

let sharedDialog = null;
/** The page's one confirmation dialog (the toolbar's load and the Hardware tab's share it: one element, unique ids). */
export const loadDialog = () => (sharedDialog ??= new LoadDialog());

/** The badge's text (text first; the colour class only repeats it). */
export function badgeText(b) {
  if (!b || b.state === 'none') return H.badge.none;
  if (b.state === 'same') return H.badge.same(b.serial, b.n, b.checked) + (b.checked === false ? ` ${H.badge.differs}` : '');
  if (b.state === 'other') return H.badge.other(b.serial, b.m, b.n) + (b.checked === false ? ` ${H.badge.differs}` : '');
  return H.badge.foreign(b.serial);
}

/** The Probe board facts as [label, value] rows (design §4). */
export function factRows(f) {
  if (!f) return [];
  const F = H.facts;
  return [[F.chip, F.chipValue], [F.package, F.packageValue(f.chip?.packageSel ?? '?')], [F.rom, F.romValue(f.romVersion, f.known)],
    [F.serial, f.serial ?? '?'], [F.deviceId, f.chip?.deviceId ?? '?'], [F.partition, F.partitionValue(f.partition)], [F.flash, F.flashValue]];
}

/** A card: an icon, a title, a "?" with the long text (2026-11-15: long text behind "?" buttons), then the body. */
let cardSeq = 0;
export function card(cls, iconName, title, help, ...body) {
  const id = `hw-card-${++cardSeq}`;
  return el(`section.hw-card.${cls}`, { 'aria-labelledby': id },
    el('header.hw-card-head', {}, el('span.hw-card-icon', {}, icon(iconName, { size: 18 })), el('h3', { id, text: title }),
      help ? infoButton(help, V.about(title), { glyph: '?' }) : null),
    ...body);
}
/** A button with an icon and a label (`kind`: '.hw-primary' for the card's main action). */
export const iconBtn = (cls, iconName, text, title, onclick, kind = '') => el(`button.hw-btn.${cls}${kind}`, { type: 'button', title, onclick },
  icon(iconName, { size: 16 }), el('span', { text }));
/** A button with only an icon: its name is the title (tooltip and accessible name). */
export const iconOnly = (cls, iconName, title, onclick) => el(`button.hw-ibtn.${cls}`, { type: 'button', title, 'aria-label': title, onclick }, icon(iconName, { size: 16 }));

const LOAD_STEPS = Object.keys(V.steps); // choosing, building, preflight, writing, rebooting

export class HardwareSections {
  /** @param {object} ctx {message(text, kind), log(text)} */
  constructor(ctx) {
    this.ctx = ctx;
    this.s = hardwareSession();
    this.dialog = loadDialog();
    this.s.confirmUi = (summary) => this.dialog.ask(summary);
    const caps = this.s.caps;
    const usb = caps.webusb && caps.secure;

    // Board: a status line, Probe, the facts once probed, what this browser wrote to it
    this.boardDot = el('span.hw-dot', { 'aria-hidden': 'true' });
    this.boardState = el('span.hw-board-state', { role: 'status', 'aria-live': 'polite', text: V.noBoardShort });
    this.hint = el('p.hw-hint', { text: V.noBoardHint });
    this.probeBtn = iconBtn('hw-probe', 'search', H.probe, H.probeTitle, () => this.probe());
    this.forgetBtn = iconOnly('hw-forget', 'trash', H.forget, () => this.forget());
    this.facts = el('dl.hw-facts', { hidden: true });
    this.badgeEl = el('p.hw-badge', { text: H.badge.none });
    // Program: what Load would write, Load (the main action), Stop, and the less used ones as icons
    this.summary = el('p.hw-summary', { text: H.summary.none });
    this.loadBtn = iconBtn('hw-load', 'upload', H.load, H.loadTitle, () => this.load(), '.hw-primary');
    this.stopBtn = iconBtn('hw-stop', 'stop', H.stop, H.stopTitle, () => this.s.stop());
    this.checkBtn = iconOnly('hw-check', 'check', H.checkTitle, () => this.check());
    this.downloadBtn = iconOnly('hw-download', 'download', `${H.download}: ${H.downloadTitle}`, () => this.download());
    this.driveBtn = iconOnly('hw-drive', 'folder', `${H.copyToDrive} ${H.copyTitle}`, () => this.copyToDrive());
    // the load's progress: its steps, a bar (indeterminate until bytes move), the phase and the share done
    this.steps = el('ol.hw-steps', { 'aria-label': V.stepsLabel }, LOAD_STEPS.map((k) => el('li', { 'data-step': k }, el('span.hw-step-dot', { 'aria-hidden': 'true' }), el('span', { text: V.steps[k] }))));
    this.state = el('span.hw-state', { role: 'status', 'aria-live': 'polite', text: H.phase.idle });
    this.barText = el('span.hw-bar-text');
    this.bar = el('progress.hw-bar', { max: '1', value: '0', 'aria-label': H.progressLabel });
    this.progress = el('div.hw-progress', { hidden: true }, this.steps, el('div.hw-prog-line', {}, this.state, this.barText), this.bar);
    this.error = el('div.hw-error', { role: 'alert', hidden: true });
    // Debug: two actions and a tick box; the debug probe note is in the "?"
    this.runBtn = iconBtn('hw-run-board', 'restart', V.runShort, H.runBoardTitle, () => this.runBoard());
    this.saveBtn = iconBtn('hw-save-flash', 'save', V.saveShort, H.saveFlashTitle, () => this.saveFlash());
    this.whole = el('input', { type: 'checkbox' });

    this.stopBtn.hidden = true;
    this.driveBtn.hidden = !caps.folderPicker;
    for (const x of [this.loadBtn, this.checkBtn, this.forgetBtn, this.probeBtn, this.runBtn, this.saveBtn]) x.hidden = !usb;
    if (!usb) this.loadBtn.dataset.off = '1'; // render() keeps it hidden (it hides Load while Stop shows)
    this.fallback = el('p.hw-fallback', { title: H.noWebUsb, hidden: usb }, el('span', { text: H.noWebUsb }));

    this.board = card('hw-board', 'chip', V.boardHead, V.boardHelp,
      el('div.hw-status', {}, this.boardDot, this.boardState), this.hint, this.facts, this.badgeEl,
      el('div.hw-acts', { role: 'group', 'aria-label': V.boardHead }, this.probeBtn, this.forgetBtn));
    this.program = card('hw-program', 'upload', V.programHead, V.programHelp, this.fallback, this.summary,
      el('div.hw-acts', { role: 'group', 'aria-label': V.programHead }, this.loadBtn, this.stopBtn,
        this.checkBtn, this.downloadBtn, this.driveBtn),
      this.progress, this.error);
    this.debug = card('hw-debug', 'bug', V.debugHead, V.debugHelp,
      el('div.hw-acts', { role: 'group', 'aria-label': V.debugHead, hidden: !usb }, this.runBtn, this.saveBtn,
        el('label.hw-toggle', { title: H.saveWholeTitle }, this.whole, el('span', { text: V.wholeShort }))));
    this.root = el('div.hw-panel', {}, this.board, this.program, this.debug);

    this.s.on('state', (st) => this.render(st));
    this.s.on('badge', (bd) => this.showBadge(bd));
    this.s.on('board', (f) => this.showFacts(f));
    this.s.on('device', (d) => this.showDevice(d.connected ? H.connected(d.serial ?? '?') : H.disconnected(d.serial ?? '?'), d.connected ? 'on' : 'off'));
    if (this.s.facts) this.showFacts(this.s.facts);
    this.render(this.s.state); // a load started from the toolbar before this tab was drawn (design §8)
    this.refreshBadge();
    this.update();
  }

  /** The board's status line and its dot ('on' a board, 'off' none or gone). */
  showDevice(text, mode) { this.boardState.textContent = text; this.boardDot.dataset.mode = mode; this.hint.hidden = mode === 'on'; }
  log(text) { this.ctx.log?.(text); }

  async refreshBadge() { try { this.showBadge(await this.s.badge()); } catch { /* no records yet */ } }
  showBadge(bd) {
    this.badgeEl.textContent = badgeText(bd); this.badgeEl.dataset.state = bd.state;
    // the current build's number, once the records know it (the summary's "build n")
    if ((bd.state === 'same' || bd.state === 'other') && bd.n && bd.n !== this.lastN) { this.lastN = bd.n; if (this.lastProgram) this.summary.textContent = this.summaryText(this.lastProgram); }
  }

  showFacts(f) {
    // short tiles (2026-11-15): the label, a short value; the full wording as the tile's tooltip
    const F = H.facts, Q = V.factsShort;
    const tiles = [[F.chip, Q.chip, F.chipValue], [F.rom, Q.rom(f.romVersion, f.known), F.romValue(f.romVersion, f.known)],
      [F.serial, f.serial ?? '?', f.serial ?? '?'], [F.partition, Q.partition(f.partition), F.partitionValue(f.partition)],
      [F.flash, Q.flash, F.flashValue], [F.package, String(f.chip?.packageSel ?? '?'), F.packageValue(f.chip?.packageSel ?? '?')]];
    this.facts.replaceChildren(...tiles.map(([k, v, full]) => el('div.hw-fact', { title: `${k}: ${full}` }, el('dt', { text: k }), el('dd', { text: v }))));
    this.facts.hidden = false;
    this.showDevice(H.connected(f.serial ?? '?'), 'on');
  }

  render(st) {
    const ph = st.phase;
    this.state.textContent = H.phase[ph] ?? '';
    const busy = !['idle', 'done', 'failed', 'cancelled'].includes(ph);
    for (const x of [this.loadBtn, this.checkBtn, this.probeBtn, this.runBtn, this.saveBtn]) x.disabled = busy;
    this.stopBtn.hidden = !busy;
    this.loadBtn.hidden = busy || this.loadBtn.dataset.off === '1';
    // a load shows its steps (from Build on: Choose alone may be a Probe or a Check); the others the bar only
    if (ph === 'idle' || ph === 'choosing') this.loadFlow = false;
    if (['building', 'preflight', 'confirm', 'writing', 'rebooting'].includes(ph)) this.loadFlow = true;
    this.progress.hidden = ph === 'idle';
    this.steps.hidden = !this.loadFlow;
    const at = ph === 'confirm' ? 'preflight' : ph === 'done' ? 'end' : ph;
    const reached = LOAD_STEPS.indexOf(at);
    for (const li of this.steps.children) {
      const i = LOAD_STEPS.indexOf(li.dataset.step);
      li.dataset.state = at === 'end' ? 'done' : reached < 0 ? (ph === 'failed' || ph === 'cancelled' ? li.dataset.state ?? '' : '') : i < reached ? 'done' : i === reached ? 'now' : '';
      if (li.dataset.state === 'now') li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    }
    // the bar: bytes when they move (write, read back, the flash read), full when done, moving stripes while waiting
    const p = st.progress;
    const counted = Boolean(p && p.total && ['writing', 'rebooting', 'done', 'reading'].includes(ph));
    this.progress.dataset.phase = ph;
    if (counted) {
      this.bar.max = String(p.total); this.bar.value = String(p.done);
      const pct = Math.round((100 * p.done) / p.total);
      const text = p.phase === 'read' ? V.percent(pct) : p.count ? `${H.progress(Math.min((p.index ?? 0) + 1, p.count), p.count)} · ${V.percent(pct)}` : V.percent(pct);
      this.bar.setAttribute('aria-valuetext', text);
      this.barText.textContent = text;
    } else if (ph === 'done') {
      this.bar.max = '1'; this.bar.value = '1'; this.barText.textContent = V.percent(100); this.bar.removeAttribute('aria-valuetext');
    } else if (busy) {
      this.bar.removeAttribute('value'); this.barText.textContent = ''; this.bar.removeAttribute('aria-valuetext'); // indeterminate
    } else { this.barText.textContent = ''; }
    if (ph === 'failed' || ph === 'cancelled') this.showError(st.error);
    else this.error.hidden = true;
  }
  showError(err) {
    if (!err) { this.error.hidden = true; return; }
    const [what, next] = H.errors[err.code] ?? H.errors.failed;
    const sector = err.code === 'verify-failed' && err.data?.sector !== undefined ? ` ${H.sector(err.data.sector)}` : '';
    this.error.replaceChildren(el('p', { text: what + sector }), el('p.note', { text: next }));
    this.error.hidden = false;
    this.error.dataset.code = err.code;
  }

  /** Report a session result: the console and the tab's log. */
  report(r, okText) {
    if (r.ok) { if (okText) { this.ctx.message(okText, 'ok'); this.log(okText); } return r; }
    if (r.fallback === 'download') { this.ctx.message(H.noWebUsb, 'warn'); this.log(H.noWebUsb); return r; }
    if (r.error) {
      const [what, next] = H.errors[r.error.code] ?? H.errors.failed;
      this.ctx.message(`${what} ${next}`, r.error.code === 'cancelled' ? 'warn' : 'error');
      this.log(`${what} (${r.error.code}: ${r.error.message ?? ''})`);
    }
    return r;
  }

  /** Load to Pico (also the toolbar button's action, design §8). */
  async load() {
    const r = await this.s.load();
    return this.report(r, r.ok ? H.loaded(r.serial ?? '?', r.n, (r.bytes / 1024).toFixed(0), (r.ms / 1000).toFixed(1)) : null);
  }

  async check() {
    const r = await this.s.check();
    if (r.ok) { this.ctx.message(H.checked(r.same), r.same ? 'ok' : 'warn'); this.log(H.checked(r.same)); return r; }
    return this.report(r);
  }

  async probe() {
    const r = await this.s.probe();
    return this.report(r, r.ok ? factRows(r.facts).map(([k, v]) => `${k}: ${v}`).join('; ') : null);
  }

  async runBoard() { return this.report(await this.s.runBoard(), H.started); }

  async saveFlash() {
    const t0 = performance.now();
    const r = await this.s.readBoardFlash({ whole: this.whole.checked });
    if (r.ok) this.s.ctx.download(r.name, r.bytes, 'application/octet-stream');
    return this.report(r, r.ok ? H.savedFlash(r.name, (r.bytes.length / 1024).toFixed(0), ((performance.now() - t0) / 1000).toFixed(1)) : null);
  }

  async forget() { if (await this.s.forget()) { this.ctx.message(H.forgotten, 'ok'); this.log(H.forgotten); this.facts.hidden = true; this.showDevice(V.noBoardShort, 'off'); } }

  /** The program as a UF2 file: {name, bytes} (an imported UF2 as it is; an ELF converted as picotool; a .bin from its pages). */
  async uf2() {
    const program = this.s.ctx?.program();
    if (!canLoad(program).ok) { this.ctx.message(H.notBootable, 'warn'); return null; }
    const im = this.s.ctx.image?.() ?? null;
    const name = `${(this.s.ctx.project?.()?.name ?? 'program').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'program'}.uf2`;
    const U = await import('../firmware/uf2.js');
    if (im?.kind === 'uf2') return { name, bytes: im.bytes };
    if (im?.kind === 'elf') return { name, bytes: U.elfToUf2(im.bytes) };
    return { name, bytes: U.artifactToUf2(program.debug.artifact) };
  }

  async download() {
    const f = await this.uf2();
    if (f) { this.s.ctx.download(f.name, f.bytes, 'application/octet-stream'); this.log(`${H.download}: ${f.name}`); }
  }

  /** The copy-to-drive helper (D20 Q4; Chromium's folder picker): the file goes to the chosen folder, the RP2350 drive. */
  async copyToDrive() {
    const f = await this.uf2();
    if (!f) return;
    try {
      const dir = await globalThis.showDirectoryPicker({ mode: 'readwrite', id: 'pico2-drive' });
      const fh = await dir.getFileHandle(f.name, { create: true });
      const w = await fh.createWritable();
      await w.write(f.bytes);
      await w.close();
      this.ctx.message(H.copied(f.name), 'ok'); this.log(H.copied(f.name));
    } catch (e) {
      if (e?.name === 'AbortError') return; // the picker was closed
      this.ctx.message(H.copyFailed(e?.message ?? String(e)), 'error');
    }
  }

  /** What Load would write (design §5). */
  summaryText(p) {
    const name = this.s.ctx?.project?.()?.name ?? '';
    if (!p) return H.summary.none;
    const can = canLoad(p);
    if (!can.ok) return can.reason === 'noProgram' ? H.summary.none : V.notBootableShort;
    const kb = ((p.debug.artifact.pages.length * 256) / 1024).toFixed(0);
    const im = this.s.ctx?.image?.() ?? null;
    if (im) return H.summary.image(im.name ?? name, can.kind, kb);
    return H.summary.built(name, this.lastN ?? null, can.kind, kb);
  }

  /** After every change of the simulator's state: the badge and the summary are recomputed only when the program changed. */
  update() {
    const p = this.s.ctx?.program() ?? null;
    if (p === this.lastProgram && this.summary.textContent) return;
    this.lastProgram = p; this.lastN = null;
    this.summary.textContent = p ? this.summaryText(p) : (this.s.ctx?.project?.() ? H.summary.notBuilt(this.s.ctx.project().name) : H.summary.none);
    this.refreshBadge();
  }
}
