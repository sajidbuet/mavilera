// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { hwCapabilities } from './capabilities.js';
import { HardwareError, toHardwareError } from './errors.js';
import { PicobootTransport, PICO_VID, PID_BOOTSEL, DEFAULT_TIMEOUTS, REBOOT2 } from './transport.js';
import { writeArtifact, readBack, checkArtifact, probeBoard, readFlash, flashRangeOf } from './programmer.js';
import { Records, openStore, badgeOf } from './records.js';
export const PHASES = Object.freeze(['idle', 'choosing', 'building', 'preflight', 'confirm', 'writing', 'rebooting', 'done', 'checking', 'probing', 'starting', 'reading', 'failed', 'cancelled']);
const HISTORY_MAX = 30;
const BOOTSEL_FILTER = Object.freeze({ vendorId: PICO_VID, productId: PID_BOOTSEL });
export function canLoad(program) {
 const a = program?.debug?.artifact;
 if (!program) return { ok: false, reason: 'noProgram' };
 if (!a) return { ok: false, reason: 'notBootable' };
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
 this.history = [];
 this.abort = null;
 this.confirmUi = async () => true;
 this.usb = g.navigator?.usb ?? null;
 this.usb?.addEventListener?.('disconnect', (e) => { if (this.device && e.device === this.device) this.emit('device', { connected: false, serial: e.device.serialNumber }); });
 this.usb?.addEventListener?.('connect', (e) => this.emit('device', { connected: true, serial: e.device?.serialNumber ?? null }));
 }
 attach(ctx) { this.ctx = ctx; return this; }
 get caps() { return hwCapabilities(this.g); }
 on(ev, fn) { if (!this.listeners.has(ev)) this.listeners.set(ev, new Set()); this.listeners.get(ev).add(fn); return () => this.listeners.get(ev).delete(fn); }
 emit(ev, data) { for (const fn of this.listeners.get(ev) ?? []) { try { fn(data); } catch { } } }
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
 async chooseBoard() {
 const granted = (await this.usb.getDevices()).filter((d) => d.vendorId === PICO_VID && d.productId === PID_BOOTSEL);
 if (granted.length === 1) return granted[0];
 try { return await this.usb.requestDevice({ filters: [BOOTSEL_FILTER] }); } catch (e) { throw toHardwareError(e, 'choose'); }
 }
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
 const device = await this.chooseBoard();
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
 stop() { this.abort?.abort(); }
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
 async probe() {
 const r = await this.#withBoard('probing', async (t, serial) => ({ facts: { serial, ...(await probeBoard(t)) } }));
 if (r.ok) { this.facts = r.facts; this.emit('board', r.facts); this.emit('badge', await this.badge()); }
 return r;
 }
 async runBoard() {
 return this.#withBoard('starting', async (t) => { await t.interfaceReset(); await t.reboot2(REBOOT2.normal, 0, 0, 500); return {}; });
 }
 async readBoardFlash({ whole = false } = {}) {
 const a = this.ctx?.program()?.debug?.artifact ?? null;
 const range = whole ? flashRangeOf(null) : flashRangeOf(a);
 return this.#withBoard('reading', async (t, serial) => {
 const bytes = await readFlash(t, range.start, range.length, { signal: this.abort?.signal, onProgress: (p) => this.set({ progress: { ...p, phase: 'read' } }) });
 return { bytes, start: range.start, name: `board-flash-${serial ?? 'pico2'}.bin` };
 });
 }
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
async function artifactId(a) {
 const { buildId } = await import('../firmware/validate.js');
 return buildId(a);
}
let shared = null;
export function hardwareSession(options) { return (shared ??= new HardwareSession(options)); }
export function resetHardwareSession() { shared = null; }
