// session.js -- Load to Pico (pico2 P1-F3, research D58; design docs/architecture/pico2-p1f3-board.md §2.2-§2.5): the one object
// the toolbar button and the Board panel talk to. It runs the flow
//   chooser (first, while the click's user activation lasts, WEB-024: < 5 s) -> build if the sources changed (the shell's
//   ctx.build) -> the program's validated artifact -> its build number in this project -> open PICOBOOT -> preflight ->
//   confirmation naming the board's serial and the build (S1, Q5 A) -> per-sector write and verify (programmer.js) -> reboot
// and keeps the records the badge reads (records.js; Q6 A, Q7 A). It never touches the simulator (ADR-0010 point 4) and never
// writes on a connect event (S13). One load at a time.
//
// HardwareContext (from the shell, contract v13): {strings, message(text, kind), project() -> {id, name} | null,
// program() -> Program | null, build() -> Promise<Program | null> (builds when the sources changed since the last build),
// image() -> {kind, bytes, name} | null (the current program's file), download(name, bytes, type)}.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { hwCapabilities } from './capabilities.js';
import { HardwareError, toHardwareError } from './errors.js';
import { PicobootTransport, PICO_VID, PID_BOOTSEL, DEFAULT_TIMEOUTS, REBOOT2 } from './transport.js';
import { writeArtifact, readBack, checkArtifact, probeBoard, readFlash, flashRangeOf } from './programmer.js';
import { Records, openStore, badgeOf } from './records.js';

// probing, starting, reading: the Hardware tab's Board and Debug sections (design pico2-hardware-tab.md §4, §6)
export const PHASES = Object.freeze(['idle', 'choosing', 'building', 'preflight', 'confirm', 'writing', 'rebooting', 'done', 'checking', 'probing', 'starting', 'reading', 'failed', 'cancelled']);
const HISTORY_MAX = 30;
const BOOTSEL_FILTER = Object.freeze({ vendorId: PICO_VID, productId: PID_BOOTSEL });

/** What a program offers for loading: {ok, kind?, reason?} (design §2.1; Q9 B: RAM-only images too). */
export function canLoad(program) {
  const a = program?.debug?.artifact;
  if (!program) return { ok: false, reason: 'noProgram' };
  if (!a) return { ok: false, reason: 'notBootable' }; // a MAVILERA program (Lite, assembly-only project): P1-H3
  try { checkArtifact(a); } catch { return { ok: false, reason: 'notBootable' }; }
  return { ok: true, kind: a.kind };
}

export class HardwareSession {
  constructor({ g = globalThis, records = null, timeouts = DEFAULT_TIMEOUTS } = {}) {
    this.g = g;
    this.records = records ?? new Records(openStore({ indexedDB: g.indexedDB }));
    this.timeouts = timeouts;
    this.ctx = null;
    this.listeners = new Map();
    this.state = { phase: 'idle', progress: null, error: null, serial: null, n: null };
    this.busy = false;
    this.history = []; // the last HISTORY_MAX states: {at, phase, code?, during?} (the Hardware tab's Copy report reads it)
    this.abort = null;
    this.confirmUi = async () => true; // replaced by the panel's dialog (ui/hardware-panel.js)
    this.usb = g.navigator?.usb ?? null;
    this.usb?.addEventListener?.('disconnect', (e) => { if (this.device && e.device === this.device) this.emit('device', { connected: false, serial: e.device.serialNumber }); });
    this.usb?.addEventListener?.('connect', (e) => this.emit('device', { connected: true, serial: e.device?.serialNumber ?? null }));
  }

  attach(ctx) { this.ctx = ctx; return this; }
  get caps() { return hwCapabilities(this.g); }
  on(ev, fn) { if (!this.listeners.has(ev)) this.listeners.set(ev, new Set()); this.listeners.get(ev).add(fn); return () => this.listeners.get(ev).delete(fn); }
  emit(ev, data) { for (const fn of this.listeners.get(ev) ?? []) { try { fn(data); } catch { /* a listener's fault is its own */ } } }
  set(patch) {
    const before = this.state;
    this.state = { ...this.state, ...patch };
    if (this.state.phase !== before.phase || this.state.error !== before.error) {
      const e = this.state.error;
      this.history.push({ at: new Date().toISOString().slice(11, 19), phase: this.state.phase, ...(e ? { code: e.code, during: e.data?.during } : {}) });
      if (this.history.length > HISTORY_MAX) this.history.shift();
    }
    this.emit('state', this.state);
  }

  /** The board to use: the one granted BOOTSEL board connected, else the chooser (filtered to 2E8A:000F, S2). */
  async chooseBoard() {
    const granted = (await this.usb.getDevices()).filter((d) => d.vendorId === PICO_VID && d.productId === PID_BOOTSEL);
    if (granted.length === 1) return granted[0];
    try { return await this.usb.requestDevice({ filters: [BOOTSEL_FILTER] }); } catch (e) { throw toHardwareError(e, 'choose'); }
  }

  /** Load the project's program onto a Pico 2. Returns {ok, ...} or {ok: false, error} (the state says the same). */
  async load() {
    if (this.busy) return { ok: false, error: { code: 'busy', message: 'a load is under way' } };
    const caps = this.caps;
    if (!caps.secure) return this.#fail(new HardwareError('insecure', 'not a secure context'));
    if (!caps.webusb) return this.#fail(new HardwareError('unsupported', 'no WebUSB'), { fallback: 'download' });
    this.busy = true;
    this.abort = new AbortController();
    let t = null;
    try {
      this.set({ phase: 'choosing', progress: null, error: null });
      const device = await this.chooseBoard(); // first: the chooser needs the click's activation
      this.device = device;
      const serial = device.serialNumber || null;
      this.set({ serial });
      this.set({ phase: 'building' });
      const program = await this.ctx.build();
      if (!program) throw new HardwareError('failed', 'the build did not give a program', { during: 'build' });
      const can = canLoad(program);
      if (!can.ok) throw new HardwareError('not-bootable', can.reason);
      const artifact = program.debug.artifact;
      const project = this.ctx.project() ?? { id: 'none', name: '' };
      const id = await artifactId(artifact);
      const { n } = await this.records.buildNumber(project.id, id);
      this.set({ n });
      t = new PicobootTransport(device, { timeouts: this.timeouts });
      this.set({ phase: 'preflight' });
      await t.open();
      const r = await writeArtifact(t, artifact, {
        signal: this.abort.signal,
        confirm: async (summary) => { this.set({ phase: 'confirm' }); const ok = await this.confirmUi({ ...summary, serial, n, project: project.name }); if (ok) this.set({ phase: 'writing' }); return ok; },
        onProgress: (p) => { if (p.phase === 'reboot') this.set({ phase: 'rebooting' }); if (p.total) this.set({ progress: p }); this.emit('progress', p); },
      });
      if (serial) {
        await this.records.boardWritten(serial, { buildId: id, n, project: project.id, projectName: project.name, bytes: r.bytes, kind: artifact.kind });
        await this.records.store.put('boards', '_last', { serial });
      }
      this.set({ phase: 'done' });
      this.emit('badge', await this.badge());
      return { ok: true, serial, n, ...r };
    } catch (e) {
      return this.#fail(toHardwareError(e));
    } finally {
      this.busy = false;
      this.abort = null;
      await t?.close();
    }
  }

  /** Stop: before the first erase it cancels; afterwards the sector under way finishes (programmer.js). */
  stop() { this.abort?.abort(); }

  /** Check (Q7 A): read the board's image back in BOOTSEL and compare with the current build; the badge then says so. */
  async check() {
    if (this.busy) return { ok: false };
    const caps = this.caps;
    if (!caps.webusb || !caps.secure) return this.#fail(new HardwareError(caps.secure ? 'unsupported' : 'insecure', 'no WebUSB'));
    this.busy = true;
    let t = null;
    try {
      this.set({ phase: 'choosing', error: null, progress: null });
      const device = await this.chooseBoard();
      const serial = device.serialNumber || null;
      const program = this.ctx.program();
      const can = canLoad(program);
      if (!can.ok) throw new HardwareError('not-bootable', can.reason);
      this.set({ phase: 'checking', serial });
      t = new PicobootTransport(device, { timeouts: this.timeouts });
      await t.open();
      const r = await readBack(t, program.debug.artifact);
      const project = this.ctx.project() ?? { id: 'none', name: '' };
      const id = await artifactId(program.debug.artifact);
      if (serial) {
        if (r.same) { const n = (await this.records.numberOf(project.id, id)) ?? (await this.records.buildNumber(project.id, id)).n; await this.records.boardWritten(serial, { buildId: id, n, project: project.id, projectName: project.name, kind: program.debug.artifact.kind }); }
        await this.records.boardChecked(serial, r.same);
        await this.records.store.put('boards', '_last', { serial });
      }
      this.set({ phase: 'done' });
      this.emit('badge', await this.badge());
      return { ok: true, serial, ...r };
    } catch (e) {
      return this.#fail(toHardwareError(e));
    } finally { this.busy = false; await t?.close(); }
  }

  /**
   * One read-only (or allowed-reboot) action on a board in BOOTSEL, with the chooser first: `work(t, serial)` runs with the
   * transport open; the phase is `phase` while it runs. Returns {ok: true, serial, ...result} or {ok: false, error}.
   */
  async #withBoard(phase, work) {
    if (this.busy) return { ok: false, error: { code: 'busy', message: 'an action is under way' } };
    const caps = this.caps;
    if (!caps.webusb || !caps.secure) return this.#fail(new HardwareError(caps.secure ? 'unsupported' : 'insecure', 'no WebUSB'), { fallback: 'download' });
    this.busy = true;
    this.abort = new AbortController();
    let t = null;
    try {
      this.set({ phase: 'choosing', error: null, progress: null });
      const device = await this.chooseBoard();
      this.device = device;
      const serial = device.serialNumber || null;
      this.set({ phase, serial });
      t = new PicobootTransport(device, { timeouts: this.timeouts });
      await t.open();
      const r = await work(t, serial);
      if (serial) await this.records.store.put('boards', '_last', { serial });
      this.set({ phase: 'done' });
      return { ok: true, serial, ...r };
    } catch (e) {
      return this.#fail(toHardwareError(e));
    } finally { this.busy = false; this.abort = null; await t?.close(); }
  }

  /** Probe board (design §4): chip, package, ROM version, boot partition; read-only. Emits `board` with the facts. */
  async probe() {
    const r = await this.#withBoard('probing', async (t, serial) => ({ facts: { serial, ...(await probeBoard(t)) } }));
    if (r.ok) { this.facts = r.facts; this.emit('board', r.facts); this.emit('badge', await this.badge()); }
    return r;
  }

  /** Run the board's program (design §6): REBOOT2 normal from BOOTSEL; the board leaves BOOTSEL. Nothing is written. */
  async runBoard() {
    return this.#withBoard('starting', async (t) => { await t.interfaceReset(); await t.reboot2(REBOOT2.normal, 0, 0, 500); return {}; });
  }

  /**
   * Save the board's flash (design §6): read the current program's flash sectors (or, `whole`, all 4 MiB) and return the bytes
   * with a file name; read-only. Progress as the load's (`progress` {done, total}).
   */
  async readBoardFlash({ whole = false } = {}) {
    const a = this.ctx?.program()?.debug?.artifact ?? null;
    const range = whole ? flashRangeOf(null) : flashRangeOf(a);
    return this.#withBoard('reading', async (t, serial) => {
      const bytes = await readFlash(t, range.start, range.length, { signal: this.abort?.signal, onProgress: (p) => this.set({ progress: { ...p, phase: 'read' } }) });
      return { bytes, start: range.start, name: `board-flash-${serial ?? 'pico2'}.bin` };
    });
  }

  /** The badge for the current program and the board last used here. */
  async badge() {
    const last = await this.records.store.get('boards', '_last');
    const serial = last?.serial ?? null;
    const board = serial ? await this.records.board(serial) : null;
    const program = this.ctx?.program();
    const project = this.ctx?.project()?.id ?? null;
    let current = null;
    if (canLoad(program).ok && project) {
      const id = await artifactId(program.debug.artifact);
      current = { buildId: id, n: await this.records.numberOf(project, id) };
    }
    return badgeOf({ board, current, project, serial });
  }

  /** Forget this board (S13): its record here, and the browser's permission (USBDevice.forget, where the browser has it). */
  async forget() {
    const last = await this.records.store.get('boards', '_last');
    if (!last?.serial) return false;
    await this.records.forgetBoard(last.serial);
    await this.records.store.delete('boards', '_last');
    const devs = this.usb ? await this.usb.getDevices() : [];
    for (const d of devs) if (d.serialNumber === last.serial) await d.forget?.().catch(() => {});
    this.emit('badge', await this.badge());
    return true;
  }

  #fail(err, extra = {}) {
    const error = { code: err.code, message: err.message, data: err.data ?? {} };
    this.set({ phase: err.code === 'cancelled' ? 'cancelled' : 'failed', error });
    return { ok: false, error, ...extra };
  }
}

/** The build id of an artifact (firmware/validate.js buildId: 16 hex digits of SHA-256 over the pages). */
async function artifactId(a) {
  const { buildId } = await import('../firmware/validate.js');
  return buildId(a);
}

let shared = null;
/** The page's one session (the toolbar button and the panels share it). */
export function hardwareSession(options) { return (shared ??= new HardwareSession(options)); }
/** Tests: forget the shared session. */
export function resetHardwareSession() { shared = null; }
