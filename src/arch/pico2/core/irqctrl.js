// irqctrl.js -- Hazard3's Xh3irq external interrupt controller as the RP2350 configures it (52 interrupt lines, 16 priority
// levels, no input registers): the CSRs meiea, meipa, meifa, meipra, meinext and meicontext, the preemption level stack, and the
// level of mip.meip. Follows hazard3_irq_ctrl.v of the pinned hazard3-rp2350 tree (research repository, R-HZ-01 §3.2).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const NUM_IRQS = 52;
const PRIO_MASK = 0xf;         // IRQ_PRIORITY_BITS = 4
// one declaration per export: the offline bundler (tools/site-files.mjs) reads no other form
export const MEIEA = 0xbe0;
export const MEIPA = 0xbe1;
export const MEIFA = 0xbe2;
export const MEIPRA = 0xbe3;
export const MEINEXT = 0xbe4;
export const MEICONTEXT = 0xbe5;
// write types of the CSR instruction (CSR_WTYPE_C is 3)
export const CSR_WRITE = 1;
export const CSR_SET = 2;
export const CSR_CLEAR = 3;

export class IrqCtrl {
  /** xh3: false models Hazard3 built without Xh3irq: no controller CSRs, and mip.meip is simply the OR of the input lines (hazard3_csr.v 
o_irq_ctrl). */
  constructor(xh3 = true) { this.xh3 = xh3; this.reset(); }

  reset() {
    this.ver = (this.ver ?? 0) + 1; // changes of the saved state (not the input lines): the hart reuses its last copy while unchanged
    this.irq = new Uint8Array(NUM_IRQS);   // the input lines
    this.ea = new Uint8Array(NUM_IRQS);    // meiea: enable
    this.fa = new Uint8Array(NUM_IRQS);    // meifa: force
    this.pra = new Uint8Array(NUM_IRQS);   // meipra: priority
    this.pppreempt = 0; this.ppreempt = 0; this.preempt = 0; // meicontext: preemption levels
    this.noirq = 1; this.irqNum = 0; this.mreteirq = 0;
    this.dirty = true;
    this._pending = false;
    this._next = { noirq: true, irq: 0, pri: 0 };
  }

  save() { return { ea: this.ea.slice(), fa: this.fa.slice(), pra: this.pra.slice(), pppreempt: this.pppreempt, ppreempt: this.ppreempt, preempt: this.preempt, noirq: this.noirq, irqNum: this.irqNum, mreteirq: this.mreteirq }; }
  load(s) {
    this.ver++;
    this.ea.set(s.ea); this.fa.set(s.fa); this.pra.set(s.pra);
    this.pppreempt = s.pppreempt; this.ppreempt = s.ppreempt; this.preempt = s.preempt; this.noirq = s.noirq; this.irqNum = s.irqNum; this.mreteirq = s.mreteirq;
    this.dirty = true; // the input lines are not state of the hart: they stay as they are
  }

  /** Drive the interrupt input lines from two words: lines 0 to 31 and 32 to 51. */
  setLines(lo, hi) {
    for (let i = 0; i < NUM_IRQS; i++) this.irq[i] = i < 32 ? (lo >>> i) & 1 : (hi >>> (i - 32)) & 1;
    this.dirty = true;
  }
  setLine(i, v) { this.irq[i] = v ? 1 : 0; this.dirty = true; }

  _recompute() {
    if (!this.xh3) { this._pending = this.irq.some((v) => v === 1); this._next = { noirq: true, irq: 0, pri: 0 }; this.dirty = false; return; }
    let pending = false, bestPri = -1, best = 0;
    for (let i = 0; i < NUM_IRQS; i++) {
      if (!(this.ea[i] && (this.irq[i] || this.fa[i]))) continue;
      const p = this.pra[i];
      if (p >= this.preempt) pending = true;            // {0, pri} >= preempt (a 5-bit level; 16 means nothing can preempt)
      if (p >= this.ppreempt && p > bestPri) { bestPri = p; best = i; } // above the previous level; the lowest number wins a tie
    }
    this._pending = pending;
    this._next = bestPri < 0 ? { noirq: true, irq: 0, pri: 0 } : { noirq: false, irq: best, pri: bestPri };
    this.dirty = false;
  }

  /** mip.meip */
  get pending() { if (this.dirty) this._recompute(); return this._pending; }
  get next() { if (this.dirty) this._recompute(); return this._next; }

  /** The state change of a trap entry (`isEirq`: the trap is the external interrupt) */
  trapEnter(isEirq) {
    if (isEirq || this.mreteirq) this.ver++;
    if (isEirq) {
      const n = this.next;
      const level = n.noirq ? 16 : 1 + n.pri; // (1 << (4 - IRQ_PRIORITY_BITS)) + highest priority
      this.pppreempt = this.ppreempt & PRIO_MASK;
      this.ppreempt = this.preempt & PRIO_MASK & 0xf;
      this.preempt = level & (0x10 | PRIO_MASK);
      this.mreteirq = 1;
      this.dirty = true;
    } else this.mreteirq = 0;
  }

  /** The state change of MRET */
  trapExit() {
    if (this.mreteirq) this.ver++;
    if (this.mreteirq) { // priority restore
      const pp = this.pppreempt, p = this.ppreempt;
      this.pppreempt = 0; this.ppreempt = pp & PRIO_MASK; this.preempt = p & PRIO_MASK;
      this.dirty = true;
    }
    this.mreteirq = 0;
  }
  isCsr(a) { return a >= MEIEA && a <= MEICONTEXT; }

  /**
   * Read value of one of the CSRs. `raw` is the instruction's operand (the window index of the array CSRs); `mieMtie` and `mieMsie`
   * are those bits of mie, which meicontext returns when the instruction also asks to clear them. The read of meinext clears the
   * force bit of the interrupt it returns.
   */
  read(a, raw, wtype, mieMtie = 0, mieMsie = 0) {
    switch (a) {
      case MEIEA: return this._window(this.ea, raw & 31);
      case MEIPA: { const w = raw & 31; let v = 0; for (let k = 0; k < 16; k++) { const i = w * 16 + k; if (i < NUM_IRQS && (this.irq[i] || this.fa[i])) v |= 1 << k; } return (v << 16) | 0; }
      case MEIFA: return this._window(this.fa, raw & 31);
      case MEIPRA: { const w = raw & 127; let v = 0; for (let k = 0; k < 4; k++) { const i = w * 4 + k; if (i < NUM_IRQS) v |= this.pra[i] << (4 * k); } return (v << 16) | 0; }
      case MEINEXT: {
        const n = this.next;
        const v = ((n.noirq ? 1 << 31 : 0) | (n.irq << 2)) | 0;
        if (!n.noirq && this.fa[n.irq]) { this.fa[n.irq] = 0; this.dirty = true; this.ver++; } // a posted interrupt is cleared when it is sampled
        return v;
      }
      default: { // MEICONTEXT
        const clearts = wtype !== undefined && wtype !== 0 && wtype !== CSR_CLEAR && ((raw >>> 1) & 1);
        return ((this.pppreempt << 28) | (this.ppreempt << 24) | (this.preempt << 16) | (this.noirq << 15) | (this.irqNum << 4)
          | ((mieMtie && clearts ? 1 : 0) << 3) | ((mieMsie && clearts ? 1 : 0) << 2) | this.mreteirq) | 0;
      }
    }
  }

  _window(arr, w) { let v = 0; for (let k = 0; k < 16; k++) { const i = w * 16 + k; if (i < NUM_IRQS && arr[i]) v |= 1 << k; } return (v << 16) | 0; }

  /**
   * Write one of the CSRs with the value the instruction produces (`v`) and its operand (`raw`). Returns the bits for mie when
   * meicontext asks for them: {clearts, mtiesave, msiesave}, else null.
   */
  write(a, v, raw, wtype, meinextNext) {
    this.ver++;
    switch (a) {
      case MEIEA: this._setWindow(this.ea, raw & 31, v); break;
      case MEIFA: this._setWindow(this.fa, raw & 31, v); break;
      case MEIPRA: { const w = raw & 127; for (let k = 0; k < 4; k++) { const i = w * 4 + k; if (i < NUM_IRQS) this.pra[i] = (v >>> (16 + 4 * k)) & PRIO_MASK; } this.dirty = true; break; }
      case MEIPA: break; // read-only
      case MEINEXT:
        if (v & 1) { // update request: take the context of the interrupt that was sampled
          this.preempt = (meinextNext.noirq ? 16 : 1 + meinextNext.pri) & (0x10 | PRIO_MASK);
          this.noirq = meinextNext.noirq ? 1 : 0; this.irqNum = meinextNext.irq; this.dirty = true;
        }
        break;
      default: // MEICONTEXT
        this.pppreempt = (v >>> 28) & PRIO_MASK; this.ppreempt = (v >>> 24) & PRIO_MASK;
        this.preempt = (v >>> 16) & (0x10 | PRIO_MASK); this.noirq = (v >>> 15) & 1; this.irqNum = (v >>> 4) & 0x1ff; this.mreteirq = v & 1;
        this.dirty = true;
        return { clearts: wtype !== CSR_CLEAR && ((raw >>> 1) & 1) === 1, mtiesave: (v >>> 3) & 1, msiesave: (v >>> 2) & 1 };
    }
    return null;
  }

  _setWindow(arr, w, v) {
    for (let k = 0; k < 16; k++) { const i = w * 16 + k; if (i < NUM_IRQS) arr[i] = (v >>> (16 + k)) & 1; }
    this.dirty = true;
  }
}
