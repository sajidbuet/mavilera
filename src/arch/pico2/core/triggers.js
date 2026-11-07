// triggers.js -- the trigger module of the RP2350's Hazard3 (P1-M1): 4 breakpoint triggers (BREAKPOINT_TRIGGERS = 4,
// research repository R-HZ-01 §3.2), exact-address execute matches only, "early" timing (the instruction does not execute).
// Follows hazard3_triggers.v and the TCONTROL logic of hazard3_csr.v (lines 526-543, 1022-1031, 1336) of the pinned
// hazard3-rp2350 tree. The simulator has no debug mode, so tdata1.dmode stays 0 and a trigger with action = 1 (enter debug
// mode) never fires; a trigger with action = 0 raises a breakpoint exception (mcause 3, mepc = the instruction's address)
// when tcontrol.mte is set and the hart's mode is enabled in the trigger (m or u bit).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const TRIGGERS = 4;
// one declaration per export: the offline bundler (tools/site-files.mjs) reads no other form
export const TSELECT = 0x7a0;
export const TDATA1 = 0x7a1;
export const TDATA2 = 0x7a2;
export const TINFO = 0x7a4;
export const TCONTROL = 0x7a5;
const TYPE_MCONTROL = 0x20000000; // tdata1.type = 2 (address/data match), bits 31:28

export class Triggers {
  constructor() { this.reset(); }

  reset() {
    this.ver = (this.ver ?? 0) + 1; // changes of the saved state (the hart reuses its last copy while this is unchanged)
    this.tselect = 0;
    this.action = new Uint8Array(TRIGGERS); this.m = new Uint8Array(TRIGGERS); this.u = new Uint8Array(TRIGGERS);
    this.execute = new Uint8Array(TRIGGERS); this.tdata2 = new Int32Array(TRIGGERS);
    this.mte = 0; this.mpte = 0;
    this.armed = false;
  }

  save() { return { tselect: this.tselect, action: this.action.slice(), m: this.m.slice(), u: this.u.slice(), execute: this.execute.slice(), tdata2: this.tdata2.slice(), mte: this.mte, mpte: this.mpte }; }
  load(s) {
    this.ver++;
    this.tselect = s.tselect; this.action.set(s.action); this.m.set(s.m); this.u.set(s.u); this.execute.set(s.execute); this.tdata2.set(s.tdata2);
    this.mte = s.mte; this.mpte = s.mpte; this._arm();
  }

  /** Can any trigger fire? (kept so that the hart's step tests one flag) */
  _arm() {
    let a = false;
    for (let i = 0; i < TRIGGERS; i++) if (this.execute[i] && !this.action[i] && (this.m[i] || this.u[i])) a = true;
    this.armed = a && this.mte === 1;
  }

  static owns(a) { return a === TSELECT || a === TDATA1 || a === TDATA2 || a === TINFO || a === TCONTROL; }

  csrRead(a) {
    const i = this.tselect;
    switch (a) {
      case TSELECT: return i;
      case TDATA1: return (TYPE_MCONTROL | (this.action[i] << 12) | (this.m[i] << 6) | (this.u[i] << 3) | (this.execute[i] << 2)) | 0;
      case TDATA2: return this.tdata2[i];
      case TINFO: return 4; // type 2 supported (tselect is 2 bits wide, so it always names an existing trigger)
      default: return (this.mpte << 7) | (this.mte << 3); // TCONTROL
    }
  }

  /** Writes; tinfo ignores them without trapping (hazard3_csr.v: "writes don't trap"). */
  csrWrite(a, v) {
    this.ver++;
    const i = this.tselect;
    switch (a) {
      case TSELECT: this.tselect = v & (TRIGGERS - 1); return;
      case TDATA1: this.action[i] = (v >>> 12) & 1; this.m[i] = (v >>> 6) & 1; this.u[i] = (v >>> 3) & 1; this.execute[i] = (v >>> 2) & 1; break;
      case TDATA2: this.tdata2[i] = v | 0; break;
      case TCONTROL: this.mpte = (v >>> 7) & 1; this.mte = (v >>> 3) & 1; break;
      default: return; // TINFO
    }
    this._arm();
  }

  /** Does an armed trigger match the instruction at `pc` in the given mode? */
  matches(pc, mmode) {
    for (let i = 0; i < TRIGGERS; i++) {
      if (this.execute[i] && !this.action[i] && this.tdata2[i] === (pc | 0) && (mmode ? this.m[i] : this.u[i])) return true;
    }
    return false;
  }

  /** Trap entry: tcontrol.mpte <- mte, mte <- 0. Trap exit (mret): mte <- mpte (mpte unchanged). */
  trapEnter() { if (this.mpte !== this.mte || this.mte) this.ver++; this.mpte = this.mte; this.mte = 0; this.armed = false; }
  trapExit() { if (this.mte !== this.mpte) this.ver++; this.mte = this.mpte; this._arm(); }
}
