// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { OP } from '../core/decode.js';
import { K, KIND, USE, CAUSE_BIT as CB } from '../core/timing.js';
export const XS = Object.freeze({ EMPTY: 0, EXEC: 1, STALL: 2, SQUASH: 3, SLEEP: 4, UOP: 5 });
export const WHY = Object.freeze({
 NONE: 0, RAW: 1, EXCL: 2, MULDIV: 3, AMO: 4, UOP: 5, FETCH: 6, JUMP: 7, MISPREDICT: 8, TRAP: 9, IRQ: 10, SLEEP: 11, WFI: 12,
 BLOCK: 13, CANCEL: 14, ROM: 15,
});
export const FS = Object.freeze({ NONE: 0, NEXT: 1, WRONG: 2, TARGET: 3 });
export const MS = Object.freeze({ EMPTY: 0, INSTR: 1, TRAP: 2, IRQ: 3 });
export const BYP = Object.freeze({ NONE: 0, REGS: 1, XM: 2, MW: 3, ZERO: 4 });
export const SIG = Object.freeze({
 X_STALL: 1, X_STALL_ON_RAW: 2, X_STALL_ON_EXCLUSIVE_OVERLAP: 4, X_STALL_MULDIV: 8, X_STALL_ON_AMO: 16, X_JUMP_REQ: 32,
 X_BRANCH_WAS_PREDICTED: 64, X_BTB_SET: 128, BTB_VALID: 256, M_REG_WEN: 512, M_TRAP_ENTER_VLD: 1024, M_TRAP_IS_IRQ: 2048,
});
export const SIGNALS = Object.freeze([
 { name: 'btb_src_addr', stage: 'F', width: 32 }, { name: 'btb_valid', stage: 'F', width: 1 },
 { name: 'd_pc', stage: 'X', width: 32 }, { name: 'd_rs1', stage: 'X', width: 5 }, { name: 'd_rs2', stage: 'X', width: 5 },
 { name: 'd_rd', stage: 'X', width: 5 }, { name: 'x_rs1_bypass', stage: 'X', width: 3, enum: true }, { name: 'x_rs2_bypass', stage: 'X', width: 3, enum: true },
 { name: 'x_stall', stage: 'X', width: 1 }, { name: 'x_stall_on_raw', stage: 'X', width: 1 }, { name: 'x_stall_on_exclusive_overlap', stage: 'X', width: 1 },
 { name: 'x_stall_muldiv', stage: 'X', width: 1 }, { name: 'x_stall_on_amo', stage: 'X', width: 1 }, { name: 'x_jump_req', stage: 'X', width: 1 },
 { name: 'x_branch_was_predicted', stage: 'X', width: 1 }, { name: 'x_btb_set', stage: 'X', width: 1 },
 { name: 'xm_rd', stage: 'M', width: 5 }, { name: 'm_reg_wen', stage: 'M', width: 1 }, { name: 'm_result', stage: 'M', width: 32 },
 { name: 'm_trap_enter_vld', stage: 'M', width: 1 }, { name: 'm_trap_is_irq', stage: 'M', width: 1 },
 { name: 'mw_rd', stage: 'post-M', width: 5 }, { name: 'mw_result', stage: 'post-M', width: 32 },
]);
const BIT_OF = { x_stall: SIG.X_STALL, x_stall_on_raw: SIG.X_STALL_ON_RAW, x_stall_on_exclusive_overlap: SIG.X_STALL_ON_EXCLUSIVE_OVERLAP,
 x_stall_muldiv: SIG.X_STALL_MULDIV, x_stall_on_amo: SIG.X_STALL_ON_AMO, x_jump_req: SIG.X_JUMP_REQ, x_branch_was_predicted: SIG.X_BRANCH_WAS_PREDICTED,
 x_btb_set: SIG.X_BTB_SET, btb_valid: SIG.BTB_VALID, m_reg_wen: SIG.M_REG_WEN, m_trap_enter_vld: SIG.M_TRAP_ENTER_VLD, m_trap_is_irq: SIG.M_TRAP_IS_IRQ };
export const SK = Object.freeze({ INSTR: 0, IRQ: 1, SLEEP: 2, ROM: 3, FAULT: 4, CANCEL: 5 });
const NO_RD = new Set([K.STORE, K.BRANCH, K.MRET, K.WFI, K.FENCE_I, K.PUSHPOP, K.POPRET, K.POPRETZ, K.MV]);
const writesRd = (d) => d.rd !== 0 && !NO_RD.has(KIND[d.op]);
const rs1Of = (d) => ((USE[d.op] & 1) ? d.rs1 : 0);
const usesRs2 = (d) => (USE[d.op] & 2) !== 0 || KIND[d.op] === K.STORE || d.op === OP.SC_W || KIND[d.op] === K.AMO;
const rs2Of = (d) => (usesRs2(d) ? d.rs2 : 0);
export class StageModel {
 constructor(cycles = 8192, steps = 4096) {
 const n = cycles, s = steps;
 this.cap = n; this.scap = s;
 this.cyc = new Float64Array(n); this.rep = new Uint32Array(n); this.sig = new Uint16Array(n);
 this.xState = new Uint8Array(n); this.why = new Uint8Array(n); this.xStep = new Float64Array(n); this.xPc = new Int32Array(n); this.uop = new Uint8Array(n);
 this.fState = new Uint8Array(n); this.fStep = new Float64Array(n); this.fPc = new Int32Array(n); this.fNext = new Uint8Array(n);
 this.mState = new Uint8Array(n); this.mStep = new Float64Array(n); this.mPc = new Int32Array(n);
 this.dRs1 = new Uint8Array(n); this.dRs2 = new Uint8Array(n); this.dRd = new Uint8Array(n); this.byp1 = new Uint8Array(n); this.byp2 = new Uint8Array(n);
 this.xmRd = new Uint8Array(n); this.mResult = new Int32Array(n); this.mwRd = new Uint8Array(n); this.mwResult = new Int32Array(n); this.btb = new Int32Array(n);
 this.sPc = new Int32Array(s); this.sWord = new Int32Array(s); this.sLen = new Uint8Array(s); this.sKind = new Uint8Array(s);
 this.sCost = new Uint32Array(s); this.sPre = new Uint8Array(s); this.sCause = new Uint16Array(s); this.sRec = new Float64Array(s); this.sCycle = new Float64Array(s);
 this.cs = { mStep: new Float64Array(s), mPc: new Int32Array(s), mRd: new Uint8Array(s), mWen: new Uint8Array(s), mRes: new Int32Array(s), mTrap: new Uint8Array(s),
 mwRd: new Uint8Array(s), mwRes: new Int32Array(s), btb: new Int32Array(s) };
 this.reset();
 }
 reset() {
 this.n = 0; this.lo = 0;
 this.ns = 0; this.slo = 0;
 this.cycles = 0;
 this.t = 0;
 this.started = false;
 this.cmStep = -1; this.cmPc = 0; this.cmRd = 0; this.cmWen = 0; this.cmRes = 0; this.cmTrap = 0;
 this.cwRd = 0; this.cwRes = 0; this.cwWen = false; this.cBtb = -1;
 this.pendingF = [];
 }
 record(h, pc, t0) {
 if (!this.started) { this.started = true; this.t = t0; }
 if (t0 !== this.t) { this.t = t0; }
 const total = h.ticks - t0, cost = h.lastCost, pre = h.lastPre, cause = h.lastCause;
 const d = h.lastInstr(pc), slot = (pc >>> 1) & (h.cacheTag.length - 1);
 const kind = cause & CB.IRQ ? SK.IRQ : cause & CB.SLEEP ? SK.SLEEP : cause & CB.DIV_CANCEL ? SK.CANCEL
 : d === null ? ((cause & CB.TRAP) ? SK.FAULT : SK.ROM) : SK.INSTR;
 const s = this.ns++;
 if (this.ns - this.slo > this.scap) this.slo++;
 const si = s % this.scap;
 this.sPc[si] = pc; this.sWord[si] = d && h.cacheWord[slot] !== undefined ? h.cacheWord[slot] : 0; this.sLen[si] = d ? d.len : 0; this.sKind[si] = kind;
 this.sCost[si] = total; this.sPre[si] = pre; this.sCause[si] = cause; this.sRec[si] = this.n; this.sCycle[si] = t0;
 const c = this.cs;
 c.mStep[si] = this.cmStep; c.mPc[si] = this.cmPc; c.mRd[si] = this.cmRd; c.mWen[si] = this.cmWen; c.mRes[si] = this.cmRes; c.mTrap[si] = this.cmTrap;
 c.mwRd[si] = this.cwRd; c.mwRes[si] = this.cwRes; c.btb[si] = this.cBtb;
 for (const r of this.pendingF) if (r >= this.lo) { const i = r % this.cap; this.fStep[i] = s; this.fPc[i] = pc; this.fState[i] = this.fState[i] || FS.NEXT; }
 this.pendingF.length = 0;
 const extra = total - cost;
 if (extra > 0) this.cycle(XS.SLEEP, WHY.SLEEP, -1, pc, 0, extra);
 if (kind === SK.SLEEP) { this.cycle(XS.SLEEP, WHY.SLEEP, -1, pc, 0, cost); this.cBtb = h.btb; return; }
 let left = cost;
 if (cause & CB.UNALIGNED) { const r = this.cycle(XS.EMPTY, WHY.FETCH, -1, 0, 0, 1); this.setF(r, s, pc, FS.TARGET); left--; }
 if (cause & (CB.LOAD_USE | CB.EXCL)) {
 const raw = (cause & CB.LOAD_USE) !== 0;
 this.cycle(XS.STALL, raw ? WHY.RAW : WHY.EXCL, s, pc, SIG.X_STALL | (raw ? SIG.X_STALL_ON_RAW : SIG.X_STALL_ON_EXCLUSIVE_OVERLAP), 1, d);
 this.pendingF.push(this.n - 1); left--;
 }
 if (kind === SK.IRQ) {
 const r = this.cycle(XS.SQUASH, WHY.IRQ, s, pc, SIG.M_TRAP_ENTER_VLD | SIG.M_TRAP_IS_IRQ, 1);
 this.mState[r % this.cap] = this.mState[r % this.cap] === MS.EMPTY ? MS.IRQ : this.mState[r % this.cap];
 left--;
 while (left-- > 0) this.bubble(WHY.IRQ);
 this.cBtb = h.btb; return;
 }
 if (kind === SK.CANCEL) {
 while (left-- > 0) this.cycle(XS.STALL, WHY.CANCEL, s, pc, SIG.X_STALL | SIG.X_STALL_MULDIV, 1, d);
 this.cBtb = h.btb; return;
 }
 if (kind === SK.FAULT) {
 while (left-- > 0) this.bubble(WHY.TRAP);
 this.cBtb = h.btb; return;
 }
 if (kind === SK.ROM) {
 while (left-- > 0) this.pendingF.push(this.cycle(XS.EXEC, WHY.ROM, s, pc, 0, 1));
 this.cBtb = h.btb; return;
 }
 const k = KIND[d.op];
 if (cause & CB.TRAP) {
 this.cycle(XS.EXEC, WHY.NONE, s, pc, 0, 1, d, false, true); left--;
 while (left-- > 0) this.bubble(WHY.TRAP);
 this.cBtb = h.btb; return;
 }
 const flush = (cause & (CB.JUMP | CB.MISPREDICT)) !== 0 ? 1 : 0;
 const why = k === K.DIV || k === K.DIVU ? WHY.MULDIV : k === K.AMO ? WHY.AMO : k === K.WFI ? WHY.WFI : k === K.SLT ? WHY.BLOCK : WHY.UOP;
 const zc = k >= K.PUSHPOP && k <= K.MV;
 let u = 0;
 while (left > 1 + flush) {
 const stallSig = why === WHY.MULDIV ? SIG.X_STALL | SIG.X_STALL_MULDIV : why === WHY.AMO ? SIG.X_STALL | SIG.X_STALL_ON_AMO : zc ? 0 : SIG.X_STALL;
 const r = this.cycle(zc ? XS.UOP : XS.STALL, why, s, pc, stallSig, 1, zc ? null : d);
 this.uop[r % this.cap] = ++u;
 this.pendingF.push(r); left--;
 }
 let sg = 0;
 if (flush) sg |= SIG.X_JUMP_REQ;
 if (cause & CB.PREDICTED) sg |= SIG.X_BRANCH_WAS_PREDICTED;
 if ((cause & CB.MISPREDICT) && k === K.BRANCH && h.btb !== this.cBtb && h.btb !== -1) sg |= SIG.X_BTB_SET;
 const value = writesRd(d) ? h.x[d.rd] : 0;
 const r = this.cycle(XS.EXEC, WHY.NONE, s, pc, sg, 1, zc ? null : d, true, false, value);
 if (zc) this.uop[r % this.cap] = ++u;
 if (flush) {
 this.setF(r, s, (pc + d.len) | 0, FS.WRONG);
 left--;
 this.bubble(cause & CB.MISPREDICT ? WHY.MISPREDICT : WHY.JUMP);
 } else this.pendingF.push(r);
 this.cBtb = h.btb;
 }
 bubble(why) { const r = this.cycle(XS.EMPTY, why, -1, 0, 0, 1); this.fState[r % this.cap] = FS.TARGET; this.pendingF.push(r); return r; }
 setF(r, s, pc, state) { const i = r % this.cap; this.fStep[i] = s; this.fPc[i] = pc; this.fState[i] = state; }
 cycle(xs, why, step, pc, sig, rep, d = null, completes = false, trap = false, value = 0) {
 const r = this.n++;
 if (this.n - this.lo > this.cap) this.lo++;
 const i = r % this.cap;
 this.cyc[i] = this.t; this.rep[i] = rep; this.t += rep; this.cycles += rep;
 this.xState[i] = xs; this.why[i] = why; this.xStep[i] = step; this.xPc[i] = pc; this.uop[i] = 0;
 this.fState[i] = FS.NONE; this.fStep[i] = -1; this.fPc[i] = 0;
 this.mStep[i] = this.cmStep; this.mPc[i] = this.cmPc;
 this.mState[i] = this.cmStep < 0 ? MS.EMPTY : this.cmTrap ? MS.TRAP : MS.INSTR;
 this.xmRd[i] = this.cmRd; this.mResult[i] = this.cmRes; this.mwRd[i] = this.cwRd; this.mwResult[i] = this.cwRes; this.btb[i] = this.cBtb;
 if (this.cmWen) sig |= SIG.M_REG_WEN;
 if (this.cmTrap) sig |= SIG.M_TRAP_ENTER_VLD;
 if (this.cBtb !== -1) sig |= SIG.BTB_VALID;
 let r1 = 0, r2 = 0, rd = 0;
 if (d) { r1 = rs1Of(d); r2 = rs2Of(d); rd = d.rd; }
 this.dRs1[i] = r1; this.dRs2[i] = r2; this.dRd[i] = rd;
 const src = (x, used) => (!used ? BYP.NONE : x === 0 ? BYP.ZERO : this.cmWen && x === this.cmRd ? BYP.XM : x === this.cwRd && this.cwRd !== 0 && this.cwWen ? BYP.MW : BYP.REGS);
 this.byp1[i] = src(r1, d !== null && (USE[d.op] & 1) !== 0);
 this.byp2[i] = src(r2, d !== null && usesRs2(d));
 this.sig[i] = sig;
 this.cwRd = rep === 1 && this.cmWen ? this.cmRd : 0; this.cwRes = rep === 1 && this.cmWen ? this.cmRes : 0; this.cwWen = this.cwRd !== 0;
 if (completes || trap) {
 this.cmStep = step; this.cmPc = pc; this.cmTrap = trap ? 1 : 0;
 const w = !trap && d !== null && writesRd(d);
 this.cmRd = w ? d.rd : 0; this.cmWen = w ? 1 : 0; this.cmRes = w ? value : 0;
 } else { this.cmStep = -1; this.cmPc = 0; this.cmRd = 0; this.cmWen = 0; this.cmRes = 0; this.cmTrap = 0; }
 return r;
 }
 rewindTo(t) {
 while (this.ns > this.slo) {
 const si = (this.ns - 1) % this.scap;
 if (this.sCycle[si] < t) break;
 this.ns--;
 const firstRec = this.sRec[si];
 for (let r = this.n - 1; r >= firstRec && r >= this.lo; r--) this.cycles -= this.rep[r % this.cap];
 this.n = Math.max(this.lo, firstRec);
 const c = this.cs;
 this.cmStep = c.mStep[si]; this.cmPc = c.mPc[si]; this.cmRd = c.mRd[si]; this.cmWen = c.mWen[si]; this.cmRes = c.mRes[si]; this.cmTrap = c.mTrap[si];
 this.cwRd = c.mwRd[si]; this.cwRes = c.mwRes[si]; this.cwWen = this.cwRd !== 0; this.cBtb = c.btb[si];
 this.t = this.sCycle[si];
 }
 this.pendingF.length = 0;
 if (this.ns > this.slo) {
 const si = (this.ns - 1) % this.scap;
 for (let r = this.sRec[si]; r < this.n; r++) {
 if (r < this.lo) continue;
 const i = r % this.cap;
 if (this.fState[i] === FS.NEXT || (this.fState[i] === FS.TARGET && this.xState[i] === XS.EMPTY && this.why[i] !== WHY.FETCH)) {
 this.fStep[i] = -1; this.fPc[i] = 0; this.pendingF.push(r);
 }
 }
 }
 if (this.ns === this.slo) this.started = false;
 }
 get records() { return this.n - this.lo; }
 get steps() { return this.ns - this.slo; }
 at(r) { return r % this.cap; }
 stepAt(s) { return s % this.scap; }
 signal(name, r) {
 const i = r % this.cap;
 switch (name) {
 case 'btb_src_addr': return this.btb[i] === -1 ? 0 : this.btb[i] >>> 0;
 case 'd_pc': return this.xStep[i] >= 0 ? this.xPc[i] >>> 0 : 0;
 case 'd_rs1': return this.dRs1[i]; case 'd_rs2': return this.dRs2[i]; case 'd_rd': return this.dRd[i];
 case 'x_rs1_bypass': return this.byp1[i]; case 'x_rs2_bypass': return this.byp2[i];
 case 'xm_rd': return this.xmRd[i]; case 'm_result': return this.mResult[i] >>> 0;
 case 'mw_rd': return this.mwRd[i]; case 'mw_result': return this.mwResult[i] >>> 0;
 default: return (this.sig[i] & BIT_OF[name]) ? 1 : 0;
 }
 }
}
