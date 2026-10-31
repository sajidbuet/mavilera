// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { assemble } from '../asm/assembler.js';
import { Hart, SimError, STEP_HALT_WORD } from './iss.js';
import { History } from './history.js';
import { applyLoads, checkFits } from '../shell/data-io.js';
import { BusError } from '../mem/bus.js';
import { defaultPlatform } from '../shell/share.js';
export const STOP = Object.freeze({
 HALT: 'halt', ERROR: 'error', BREAK: 'break', WATCH: 'watch', BUDGET: 'budget',
 TARGET: 'target', PAUSE: 'pause', CHUNK: 'chunk', NONE: 'none',
});
export class Session {
 constructor({ historyLimit = 1_000_000, runLimit = 10_000_000 } = {}) {
 this.historyLimit = historyLimit;
 this.runLimit = runLimit;
 this.files = [{ name: 'main.s', text: '' }];
 this.profile = 'iss';
 this.subset = null;
 this.program = null;
 this.hart = null;
 this.history = new History(historyLimit);
 this.breakpoints = new Set();
 this.watchRegs = new Set();
 this.watchWords = new Set();
 this.error = null;
 this.runCount = 0;
 this.dataLoads = [];
 this.uninitCheck = true;
 this.loadReport = { applied: [], dropped: [] };
 this.platformConfig = defaultPlatform();
 }
 assemble() {
 this.program = assemble(this.files, { profile: this.profile, subset: this.subset ?? undefined });
 this.loadReport = applyLoads(this.program, this.dataLoads);
 this.reset();
 return this.program;
 }
 loadData(label, bytes, name) {
 checkFits(this.program, label, bytes);
 this.dataLoads = [...this.dataLoads.filter((l) => l.label !== label), { label, bytes, name }];
 }
 clearData() { this.dataLoads = []; }
 get runnable() {
 return Boolean(this.program && this.program.ok && this.program.profileErrors.length === 0);
 }
 reset() {
 this.hart = this.runnable
 ? new Hart(this.program, { profile: this.profile, abiCheck: true, uninitCheck: this.uninitCheck, platformConfig: this.platformConfig })
 : null;
 this.history.clear();
 this.error = null;
 this.runCount = 0;
 }
 get halted() {
 return !this.hart || this.hart.halted || this.error !== null;
 }
 get last() {
 return this.history.top();
 }
 step() {
 if (this.halted) return this.error ? STOP.ERROR : STOP.HALT;
 const h = this.hart;
 try {
 if (h.stepFast() === STEP_HALT_WORD) return STOP.HALT;
 } catch (e) {
 if (!(e instanceof SimError || e instanceof BusError)) throw e;
 this.error = e.message;
 return STOP.ERROR;
 }
 this.history.pushFrom(h);
 this.runCount += 1;
 if (h.halted) return STOP.HALT;
 if (this.watchRegs.size && h.d_rd && this.watchRegs.has(h.d_rd)) return STOP.WATCH;
 if (this.watchWords.size && h.d_memSize) {
 const first = (h.d_memAddr & ~3) >>> 0;
 const lastWord = ((h.d_memAddr + h.d_memSize - 1) & ~3) >>> 0;
 if (this.watchWords.has(first) || this.watchWords.has(lastWord)) return STOP.WATCH;
 }
 return STOP.NONE;
 }
 back() {
 if (!this.hart) return false;
 if (!this.history.undo(this.hart)) {
 if (this.hart.halted) { this.hart.halted = false; return true; }
 return false;
 }
 this.error = null;
 this.runCount -= 1;
 return true;
 }
 run({ chunk = 100_000, target = null, depth = null, resumed = false } = {}) {
 const bps = this.breakpoints;
 for (let i = 0; i < chunk; i++) {
 if (this.halted) return this.error ? STOP.ERROR : STOP.HALT;
 if (this.runCount >= this.runLimit) return STOP.BUDGET;
 if (i > 0 || resumed) {
 const pc = this.hart.pc;
 if (bps.size && bps.has(pc)) return STOP.BREAK;
 if (pc === target && (depth === null || this.hart.callDepth <= depth)) return STOP.TARGET;
 }
 const r = this.step();
 if (r !== STOP.NONE) return r;
 }
 return STOP.CHUNK;
 }
 callDepth() {
 return this.hart ? this.hart.callDepth : 0;
 }
 stepOverTarget() {
 if (this.halted) return null;
 const w = this.hart.imem.read(this.hart.pc, 4);
 const op = w & 0x7f;
 const rd = (w >>> 7) & 31;
 if ((op === 0b1101111 || op === 0b1100111) && rd === 1) return (this.hart.pc + 4) >>> 0;
 return null;
 }
 stepOutTarget() {
 return this.hart?.abiTop ? this.hart.abiTop.ret : null;
 }
 loopRange(n = 64) {
 const h = this.history;
 if (!h.size) return null;
 let lo = 0xffffffff;
 let hi = 0;
 for (let k = 0; k < Math.min(n, h.size); k++) {
 const pc = h.pcAt(k);
 if (pc < lo) lo = pc;
 if (pc > hi) hi = pc;
 }
 return { from: lo, to: hi };
 }
 get workerCapable() { return !this.hart?.priv; }
 workerRequest(opts) {
 return {
 state: this.hart.snapshot(), runCount: this.runCount, runLimit: this.runLimit,
 historyLimit: this.historyLimit, profile: this.profile, opts,
 breakpoints: [...this.breakpoints], watchRegs: [...this.watchRegs], watchWords: [...this.watchWords],
 };
 }
 static fromWorkerRequest(req) {
 const s = new Session({ historyLimit: req.historyLimit, runLimit: req.runLimit });
 s.profile = req.profile;
 s.program = { ok: true, profileErrors: [] };
 s.hart = new Hart({ segments: [], entry: 0 }, { profile: req.profile });
 s.hart.restore(req.state);
 s.runCount = req.runCount;
 s.breakpoints = new Set(req.breakpoints);
 s.watchRegs = new Set(req.watchRegs);
 s.watchWords = new Set(req.watchWords);
 return s;
 }
 workerResult(stop) {
 return { stop, error: this.error, runCount: this.runCount, state: this.hart.snapshot(), history: this.history.export() };
 }
 applyWorkerResult(res) {
 this.hart.restore(res.state);
 this.history.append(res.history);
 this.runCount = res.runCount;
 this.error = res.error;
 }
}
