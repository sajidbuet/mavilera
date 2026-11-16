// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { compile, RAIL_V, ADC_PADS } from '../circuit/netlist.js';
import { IslandSolver, roundV } from '../circuit/solve.js';
import { CapIsland } from '../circuit/transient.js';
import { padCode, schmittOf, inputLevel, DRIVE_MA, V_IL, V_IH, V_RISE, V_FALL, V_MID, V_MAX_FT, V_MAX_STD, I_BANK_MAX, VDD } from '../circuit/pad.js';
import { LED_IMAX, rxValue } from '../circuit/library.js';
import { DEMO_KNOB } from '../circuit/demo.js';
import { effectiveCircuit } from '../circuit/presets.js';
const PAD_IE = 0x40;
class CapPoint {
 constructor(sv, isl, ctrl, codes, states, floating, x, i, w) {
 this.sv = sv; this.isl = isl; this.ctrl = ctrl; this.codes = codes; this.states = states; this.floating = floating;
 this.x = x; this.i = i; this.w = w; this.settled = true; this._c = null; this._p = null; this._v = null;
 }
 get vr() { return this._v ?? (this._v = Float64Array.from(this.x, roundV)); }
 get current() {
 if (!this._c) { this._c = this.sv.currents(this.x, this.states, this.ctrl); this.isl.caps.forEach((pi, k) => { this._c[pi] = this.i[k]; }); }
 return this._c;
 }
 get padI() { return this._p ?? (this._p = this.sv.padCurrents(this.x, this.codes)); }
}
const at = (x, t) => (t >= 0 ? x[t] : RAIL_V[-t - 1]);
export class Circuit {
 constructor(m) {
 this.m = m; this.next = Infinity; this.active = -1;
 this.source = null; this.kit = false; this.speaker = -1;
 this.setCompiled(compile(effectiveCircuit(null)), new Map());
 }
 configure({ circuit, kit, speaker } = {}, { quiet = false } = {}) {
 const src = circuit === undefined ? this.source : circuit, k = kit === undefined ? this.kit : !!kit, sp = speaker === undefined ? this.speaker : speaker;
 if (src === this.source && k === this.kit && sp === this.speaker) return false;
 const next = compile(effectiveCircuit(src, { kit: k, speaker: sp }));
 this.source = src; this.kit = k; this.speaker = sp;
 if (next.hash === this.k.hash) return false;
 this.setCompiled(next, this.ctrl);
 if (this.m.ready && !quiet) this.refresh();
 return true;
 }
 setEnv(env) {
 for (const [id, c] of this.k.controls) if (c.kind === 'env') this.control(id, rxValue(c.prim, env));
 }
 setCompiled(k, keep) {
 const old = this.k ? this.k.mask : 0;
 this.k = k;
 this.solvers = k.islands.map((isl) => new IslandSolver(isl));
 this.caps = k.islands.map((isl) => (isl.caps.length ? new CapIsland(isl) : null));
 this.one = k.islands.map((isl) => isl.pads.length === 1 && !isl.caps.length && !isl.controls.length);
 this.ctrl = new Map([...k.controls].map(([id, c]) => [id, keep?.has(id) ? keep.get(id) : c.default]));
 this.rt = k.islands.map((isl) => this.freshRt(isl));
 this.padIndex = new Int16Array(30).fill(-1);
 for (const isl of k.islands) isl.pads.forEach((g, i) => { this.padIndex[g] = i; });
 this.ledT0 = this.m.ready ? this.m.now : 0;
 this.warn = new Map(); this.gen = (this.gen ?? 0) + 1;
 this.removed = old & ~k.mask;
 this.next = Infinity;
 if (this.m.pins) this.m.pins.cmask = k.mask;
 this.m.setModules?.(k.modules, k.tap);
 }
 freshRt(isl) {
 return { codes: new Int32Array(isl.pads.length).fill(-1), states: new Uint8Array(isl.prims.length), res: null, again: false, t: 0, acc: new Float64Array(isl.leds.length), sync: false,
 w0: new Float64Array(isl.caps.length), t0: 0, af: null, tr: null, next: Infinity };
 }
 reset() {
 this.ctrl = new Map([...this.k.controls].map(([id, c]) => [id, c.default]));
 this.rt = this.k.islands.map((isl) => this.freshRt(isl));
 this.ledT0 = 0; this.warn.clear(); this.gen++; this.next = Infinity;
 }
 refresh() {
 const p = this.m.pins;
 for (let g = 0; g < 30; g++) if ((this.removed >>> g) & 1) p.ext[g] = p.drv[g];
 this.removed = 0;
 for (let g = 0; g < 30; g++) if (((this.k.mask | 0) >>> g) & 1 || p.ext[g] !== p.drv[g]) p.update(g);
 this.k.islands.forEach((isl, i) => { if (!this.rt[i].res) this.solve(i, -1); });
 }
 pad(n) {
 const p = this.m.pins, rail = this.k.padRail[n];
 if (rail >= 0) { p.ext[n] = inputLevel(RAIL_V[rail], p.ext[n], schmittOf(p, n)); return; }
 const ii = this.k.padIsland[n], rt = this.rt[ii], i = this.padIndex[n];
 const c = padCode(p, n);
 if (rt.codes[i] === c) return;
 if (this.caps[ii] && rt.tr && this.active !== ii) this.advanceTo(ii);
 rt.codes[i] = c;
 if (this.active === ii) { rt.again = true; return; }
 if (this.one[ii] && rt.res) this.solveOne(ii, n, rt);
 else this.solve(ii, n);
 }
 solveOne(ii, n, rt) {
 const p = this.m.pins, isl = this.k.islands[ii], now = this.m.now;
 if (now > rt.t) {
 const leds = isl.leds;
 if (leds.length) { const cur = rt.res.current, dt = now - rt.t; for (let j = 0; j < leds.length; j++) rt.acc[j] += Math.max(0, cur[leds[j]]) * dt; }
 rt.t = now;
 }
 const c = rt.codes[0], prev = rt.res;
 let r;
 if (rt.sync && prev._toGen === this.gen && prev._toC === c) r = prev._toR;
 else {
 r = this.solvers[ii].solve(rt.codes, this.ctrl, rt.states);
 if (rt.sync) { prev._toGen = this.gen; prev._toC = c; prev._toR = r; }
 }
 const st = rt.states, rs = r.states;
 for (let k = 0; k < st.length; k++) st[k] = rs[k];
 rt.res = r; rt.sync = true;
 const j = isl.padNodeOf[n], fl = r.floating[j];
 const e = fl ? -1 : inputLevel(r.vr[j], p.ext[n], schmittOf(p, n));
 const ch = ADC_PADS[n];
 if (ch !== undefined && !fl) this.m.adc.volts[ch] = Math.max(0, r.vr[j]);
 if (e !== p.ext[n]) p.ext[n] = e;
 const ie = (p.pad[n] & PAD_IE) ? 1 : 0;
 if (r._ckGen !== this.gen || r._ckIe !== ie) { r._ckGen = this.gen; r._ckIe = ie; this.check(ii); }
 }
 solve(ii, from) {
 const p = this.m.pins, rt = this.rt[ii], isl = this.k.islands[ii], sv = this.solvers[ii], ci = this.caps[ii];
 const prev = this.active; this.active = ii;
 try {
 for (let round = 0; round < 4; round++) {
 rt.again = false;
 for (let i = 0; i < isl.pads.length; i++) if (rt.codes[i] < 0) rt.codes[i] = padCode(p, isl.pads[i]);
 this.integrate(ii);
 let r;
 if (ci) {
 const s = ci.statesAt(rt.codes, this.ctrl, rt.w0, rt.states);
 rt.states = s.st; rt.af = s.af; rt.t0 = this.m.now;
 rt.tr = ci.trajectory(s.af, rt.w0);
 if (rt.tr.kind === 'still') { rt.w0 = Float64Array.from(s.af.A); r = this.capResult(ii, rt.w0); }
 else r = this.capResult(ii, rt.w0, s);
 } else {
 r = sv.solve(rt.codes, this.ctrl, rt.states);
 if (rt.states.length === r.states.length) rt.states.set(r.states); else rt.states = Uint8Array.from(r.states);
 rt.sync = true;
 }
 rt.res = r;
 for (const g of isl.pads) {
 const j = isl.padNodeOf[g], v = ci ? r.x[j] : r.vr[j];
 const e = r.floating[j] ? -1 : inputLevel(v, p.ext[g], schmittOf(p, g));
 const ch = ADC_PADS[g];
 if (ch !== undefined && !r.floating[j]) this.m.adc.volts[ch] = Math.max(0, ci ? roundV(r.x[j]) : r.vr[j]);
 if (e !== p.ext[g]) { p.ext[g] = e; if (g !== from) p.update(g); }
 }
 if (!rt.again) break;
 }
 } finally { this.active = prev; }
 if (ci) this.plan(ii);
 let ie = 0;
 for (let i = 0; i < isl.pads.length; i++) if (p.pad[isl.pads[i]] & PAD_IE) ie |= 1 << i;
 const memo = ci ? rt.af : rt.res;
 if (memo._ckGen !== this.gen || memo._ckIe !== ie) { memo._ckGen = this.gen; memo._ckIe = ie; this.check(ii); }
 }
 secs(a, b) { return (this.m.nsAt(b) - this.m.nsAt(a)) / 1e9; }
 wNow(ii) { const rt = this.rt[ii]; return rt.tr ? CapIsland.wAt(rt.tr, rt.w0, this.secs(rt.t0, this.m.now)) : rt.w0; }
 advanceTo(ii, predict = false) {
 const rt = this.rt[ii];
 if (!rt.tr) return;
 this.integrate(ii);
 rt.w0 = this.wNow(ii); rt.t0 = this.m.now;
 if (predict && rt.tr.kind === 'be') rt.tr = this.caps[ii].trajectory(rt.af, rt.w0);
 }
 capResult(ii, w, at = null) {
 const rt = this.rt[ii], { x, i } = at ?? this.caps[ii].nodes(rt.af, w);
 return new CapPoint(this.solvers[ii], this.k.islands[ii], this.ctrl, rt.codes.slice(), rt.states, rt.af.floating, x, i, w.slice());
 }
 plan(ii) {
 const rt = this.rt[ii], ci = this.caps[ii], isl = this.k.islands[ii], p = this.m.pins;
 const watch = rt.af.bounds.slice();
 for (const g of isl.pads) {
 if (p.padOe[g] || p.ext[g] < 0) continue;
 watch.push({ j: isl.padNodeOf[g], thr: !schmittOf(p, g) ? V_MID : p.ext[g] === 1 ? V_FALL : V_RISE });
 }
 const t = ci.nextTime(rt.tr, rt.af, rt.w0, watch);
 rt.next = Number.isFinite(t) ? rt.t0 + Math.max(1, Math.ceil(t * this.m.freq.sys)) : Infinity;
 this.reschedule();
 }
 reschedule() {
 let n = Infinity;
 for (const r of this.rt) if (r.next < n) n = r.next;
 this.next = n;
 this.m.schedule?.(this);
 }
 event(now) {
 this.rt.forEach((rt, ii) => {
 if (rt.next > now) return;
 this.advanceTo(ii);
 this.solve(ii, -1);
 });
 this.reschedule();
 }
 retime() { this.rt.forEach((rt, ii) => { if (this.caps[ii] && rt.tr && rt.tr.kind !== 'still') { this.advanceTo(ii, true); this.plan(ii); } }); }
 adcNow(ch) {
 const g = 26 + ch, ii = g < 30 ? this.k.padIsland[g] : -1;
 if (ii < 0 || !this.caps[ii]) return undefined;
 const rt = this.rt[ii];
 if (!rt.tr || rt.tr.kind === 'still') return undefined;
 const { x } = this.caps[ii].nodes(rt.af, this.wNow(ii));
 return Math.max(0, roundV(x[this.k.islands[ii].padNodeOf[g]]));
 }
 control(id, value) {
 const c = this.k.controls.get(id);
 if (!c || !Number.isFinite(value)) return;
 const v = c.kind === 'position' ? Math.min(1, Math.max(0, value)) : c.kind === 'env' ? value : value ? 1 : 0;
 if (this.ctrl.get(id) === v) return;
 if (this.caps[c.island]) this.advanceTo(c.island);
 this.ctrl.set(id, v);
 this.solve(c.island, -1);
 }
 adcInput(ch, volts) {
 if (ch === 0 && this.k.controls.has(DEMO_KNOB)) { this.control(DEMO_KNOB, volts / VDD); return; }
 const g = 26 + ch;
 if (ch < 3 && (((this.k.mask >>> g) & 1) !== 0)) return;
 this.m.adc.setVolts(ch, volts);
 }
 integrate(ii) {
 const rt = this.rt[ii], now = this.m.now, isl = this.k.islands[ii];
 if (rt.res && now > rt.t && isl.leds.length) {
 const ci = this.caps[ii];
 if (ci && rt.tr && rt.tr.kind !== 'still') {
 const a = this.secs(rt.t0, rt.t), b = this.secs(rt.t0, now), perSec = (now - rt.t) / Math.max(1e-30, b - a);
 isl.leds.forEach((pi, j) => {
 const q = this.ledQ(isl.prims[pi], rt.states[pi]);
 rt.acc[j] += Math.max(0, ci.integral(rt.tr, rt.af, rt.w0, q, a, b)) * perSec;
 });
 } else {
 const cur = rt.res.current, dt = now - rt.t, leds = isl.leds;
 for (let j = 0; j < leds.length; j++) rt.acc[j] += Math.max(0, cur[leds[j]]) * dt;
 }
 }
 rt.t = Math.max(rt.t, now);
 }
 ledQ(p, on) { return on ? (x) => (at(x, p.a) - at(x, p.k) - p.vf) / p.rs : () => 0; }
 check(ii) {
 const rt = this.rt[ii], r = rt.res, isl = this.k.islands[ii], p = this.m.pins;
 if (!r) return;
 const say = (kind, ...args) => { const key = `${kind}:${args.join(',')}`; if (!this.warn.has(key)) { this.warn.set(key, { kind, args, cycle: this.m.now }); this.m.diag(kind, ...args); } };
 isl.pads.forEach((g, i) => {
 const code = rt.codes[i], j = isl.padNodeOf[g], v = r.vr[j];
 const chip = r.padI[i].find((x) => x[0] === 'chip'), out = r.padI[i].find((x) => x[0] === 'outside');
 if (chip) {
 const mA = Math.abs(chip[1]) * 1000, set = DRIVE_MA[(code >>> 2) & 3];
 if (out && Math.sign(chip[1]) !== Math.sign(out[1]) && Math.abs(out[1]) > 1e-4) say('circuitContention', g, Math.round(mA));
 else if (mA > set + 1e-6) say('circuitOverCurrent', g, Math.round(mA * 10) / 10, set);
 } else if (!this.caps[ii] && (p.pad[g] & PAD_IE) && !r.floating[j] && v > V_IL && v < V_IH) say('circuitUndefined', g, v.toFixed(2));
 if (v > (g >= 26 ? V_MAX_STD : V_MAX_FT) + 1e-6) say('circuitOverVoltage', g, v.toFixed(2));
 if (this.caps[ii] && rt.tr?.kind === 'still' && !chip && (p.pad[g] & PAD_IE) && !r.floating[j] && v > V_IL && v < V_IH) say('circuitUndefined', g, v.toFixed(2));
 });
 isl.prims.forEach((q, i) => {
 if (q.led && r.current[i] > (q.imax ?? LED_IMAX) + 1e-9) say('circuitLedCurrent', q.part, Math.round(r.current[i] * 1000));
 if (q.kind === 'R' && q.power && r.current[i] * r.current[i] * q.r > q.power) say('circuitPower', q.part, (r.current[i] * r.current[i] * q.r).toFixed(2));
 });
 if (!r.settled) say('circuitNoSettle', isl.netNames[0]);
 let src = 0, sink = 0;
 this.rt.forEach((x) => x.res?.padI.forEach((l) => { const c = l.find((y) => y[0] === 'chip'); if (c) { if (c[1] > 0) src += c[1]; else sink -= c[1]; } }));
 if (src > I_BANK_MAX) say('circuitBank', 'sourced', Math.round(src * 1000));
 if (sink > I_BANK_MAX) say('circuitBank', 'sunk', Math.round(sink * 1000));
 }
 viewNow(ii) {
 const rt = this.rt[ii];
 if (!rt.res) return null;
 if (this.caps[ii] && rt.tr && rt.tr.kind !== 'still') return this.capResult(ii, this.wNow(ii));
 return rt.res;
 }
 live() {
 const now = this.m.now, span = Math.max(1, now - this.ledT0);
 const leds = [];
 const views = this.k.islands.map((isl, ii) => this.viewNow(ii));
 this.k.islands.forEach((isl, ii) => {
 this.integrate(ii);
 const rt = this.rt[ii], v = views[ii];
 isl.leds.forEach((pi, j) => { leds.push({ part: isl.prims[pi].part, sub: isl.prims[pi].sub, color: isl.prims[pi].color, mA: (rt.acc[j] / span) * 1000, now: (v ? Math.max(0, v.current[pi]) : 0) * 1000 }); rt.acc[j] = 0; });
 });
 this.ledT0 = now;
 return { user: this.k.user, hash: this.k.hash, leds, controls: Object.fromEntries(this.ctrl),
 nets: this.k.islands.map((isl, ii) => { const v = views[ii]; return { names: isl.netNames, volts: v ? Array.from(v.vr) : [], floating: v ? Array.from(v.floating) : [], current: v ? Array.from(v.current) : [],
 caps: v?.w ? Array.from(v.w) : undefined, settling: Boolean(this.caps[ii] && this.rt[ii].tr && this.rt[ii].tr.kind !== 'still') }; }),
 warnings: [...this.warn.values()].map((w) => ({ kind: w.kind, args: w.args.slice() })) };
 }
 save() {
 return { hash: this.k.hash, ctrl: [...this.ctrl], islands: this.rt.map((r, ii) => ({ codes: Array.from(r.codes), states: Array.from(r.states),
 ...(this.caps[ii] ? { w0: Array.from(r.w0), t0: r.t0, next: r.next, started: Boolean(r.tr) } : {}) })) };
 }
 load(s) {
 if (!s) return;
 if (s.hash !== this.k.hash) throw new Error('pico2: a machine state saved with another circuit');
 this.ctrl = new Map(s.ctrl);
 s.islands.forEach((x, i) => {
 const rt = this.rt[i], ci = this.caps[i];
 rt.codes.set(x.codes); rt.states.set(x.states); rt.sync = false;
 if (ci) {
 rt.w0 = Float64Array.from(x.w0); rt.t0 = x.t0; rt.next = x.next;
 if (x.started && x.codes.every((c) => c >= 0)) { rt.af = ci.affine(rt.codes, this.ctrl, rt.states); rt.tr = ci.trajectory(rt.af, rt.w0); rt.res = this.capResult(i, rt.w0); }
 else { rt.af = null; rt.tr = null; rt.res = null; }
 } else rt.res = x.codes.every((c) => c >= 0) ? this.solvers[i].solve(rt.codes, this.ctrl, rt.states) : null;
 rt.acc.fill(0); rt.t = this.m.now;
 });
 this.ledT0 = this.m.now;
 let n = Infinity; for (const r of this.rt) if (r.next < n) n = r.next; this.next = n;
 }
}
