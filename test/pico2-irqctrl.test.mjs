// The pico2 Xh3irq interrupt controller (P1-M1): 52 lines, 16 priority levels, meiea/meipa/meifa/meipra/meinext/meicontext and the
// preemption stack. Expectations come from hazard3_irq_ctrl.v of the pinned RTL tree, read by hand; not an independent model.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hart, FlatMemory, IRQ } from '../src/arch/pico2/core/hart.js';
import { CSR_WRITE, CSR_SET, CSR_CLEAR } from '../src/arch/pico2/core/irqctrl.js';

const MEIEA = 0xbe0, MEIPA = 0xbe1, MEIFA = 0xbe2, MEIPRA = 0xbe3, MEINEXT = 0xbe4, MEICONTEXT = 0xbe5;
const hart = () => new Hart(new FlatMemory(0x1000));
/** csrw of a window register: window index in the low bits, 16 bits of data in the high half */
const win = (h, csr, w, bits) => h.csrWrite(csr, (bits << 16) | w, (bits << 16) | w, CSR_WRITE);
const winRead = (h, csr, w) => (h.csrRead(csr, w, 0) >>> 16);
const setPriority = (h, line, p) => { const w = line >> 2, k = line & 3; const cur = h.csrRead(MEIPRA, w, 0) >>> 16; win(h, MEIPRA, w, (cur & ~(0xf << (4 * k))) | (p << (4 * k))); };

test('meiea and meifa windows: 16 lines per window, lines above 51 do not exist', () => {
  const h = hart();
  win(h, MEIEA, 0, 0x8001); win(h, MEIEA, 3, 0xffff);
  assert.equal(winRead(h, MEIEA, 0), 0x8001);
  assert.equal(winRead(h, MEIEA, 3), 0x000f, 'window 3 holds lines 48 to 51 only');
  assert.equal(winRead(h, MEIEA, 4), 0);
  win(h, MEIFA, 1, 0x0002);
  assert.equal(winRead(h, MEIFA, 1), 2);
  assert.equal(winRead(h, MEIPA, 1), 2, 'meipa shows an interrupt forced by meifa');
  h.csrWrite(MEIPA, 0xffff0000, 0, CSR_WRITE);
  assert.equal(winRead(h, MEIPA, 1), 2, 'meipa is read only');
});

test('meipra: 4 bits per line, 4 lines per window', () => {
  const h = hart();
  win(h, MEIPRA, 2, 0x4321);
  assert.equal(winRead(h, MEIPRA, 2), 0x4321);
  setPriority(h, 9, 0xf);
  assert.equal((winRead(h, MEIPRA, 2) >> 4) & 0xf, 0xf);
});

test('mip.meip and meinext: the highest priority wins, the lowest number wins a tie, noirq when nothing is pending', () => {
  const h = hart();
  assert.equal(h.csrRead(MEINEXT, 0, 0) >>> 0, 0x80000000, 'noirq');
  assert.equal(h.mip & (1 << IRQ.MEI), 0);
  win(h, MEIEA, 0, 0b101000);              // lines 3 and 5
  setPriority(h, 3, 2); setPriority(h, 5, 7);
  h.setExternalIrqs(0b101000);
  assert.ok(h.mip & (1 << IRQ.MEI));
  assert.equal(h.csrRead(MEINEXT, 0, 0), 5 << 2, 'line 5 has priority 7');
  setPriority(h, 3, 7);
  assert.equal(h.csrRead(MEINEXT, 0, 0), 3 << 2, 'equal priority: the lower line number');
  h.setExternalIrqs(0);
  assert.equal(h.mip & (1 << IRQ.MEI), 0);
});

test('meifa posts an interrupt once: reading meinext clears the force bit of the interrupt it returns', () => {
  const h = hart();
  win(h, MEIEA, 0, 1 << 4); win(h, MEIFA, 0, 1 << 4);
  assert.ok(h.mip & (1 << IRQ.MEI));
  assert.equal(h.csrRead(MEINEXT, 0, 0), 4 << 2);
  assert.equal(h.mip & (1 << IRQ.MEI), 0);
  assert.equal(winRead(h, MEIFA, 0), 0);
});

test('taking the external interrupt pushes the preemption level; a lower priority no longer interrupts; mret pops it', () => {
  const h = hart();
  win(h, MEIEA, 0, (1 << 3) | (1 << 5)); setPriority(h, 3, 2); setPriority(h, 5, 7);
  h.mie = 1 << IRQ.MEI; h.mstatus |= 8; h.mtvec = 0x101; h.pc = 0x20;
  h.setExternalIrqs(1 << 3);
  assert.equal(h.pendingInterrupt(), IRQ.MEI);
  h.step();                                 // takes the interrupt
  assert.equal(h.mcause >>> 0, (0x80000000 | IRQ.MEI) >>> 0);
  assert.equal(h.pc, 0x100 | (IRQ.MEI << 2), 'vectored: the cause is ORed into the base');
  assert.equal(h.irqc.preempt, 3, 'level = priority + 1');
  assert.equal(h.irqc.mreteirq, 1);
  h.mstatus |= 8;                           // handler re-enables interrupts
  h.setExternalIrqs((1 << 3) | (1 << 5));
  assert.equal(h.pendingInterrupt(), IRQ.MEI, 'line 5 (priority 7) preempts');
  h.setExternalIrqs(1 << 3);
  assert.equal(h.pendingInterrupt(), -1, 'the line being served does not');
  h.irqc.trapExit();
  assert.equal(h.irqc.preempt, 0);
  assert.equal(h.irqc.mreteirq, 0);
});

test('meicontext: save and restore the context, and clearts saves then clears mie.mtie and mie.msie', () => {
  const h = hart();
  h.mie = (1 << IRQ.MTI) | (1 << IRQ.MSI);
  // csrrw with clearts (bit 1) set in the operand: the old value shows the saved enables, then they are cleared
  const old = h.csrRead(MEICONTEXT, 2, CSR_WRITE);
  assert.equal(old & 0xc, 0xc);
  h.csrWrite(MEICONTEXT, 2, 2, CSR_WRITE);
  assert.equal(h.mie & ((1 << IRQ.MTI) | (1 << IRQ.MSI)), 0);
  // writing them back through the save bits re-enables them
  h.csrWrite(MEICONTEXT, 0xc, 0xc, CSR_WRITE);
  assert.equal(h.mie & ((1 << IRQ.MTI) | (1 << IRQ.MSI)), (1 << IRQ.MTI) | (1 << IRQ.MSI));
  h.csrWrite(MEICONTEXT, 0x30000000 | 0x0e000000 | (5 << 16) | (1 << 15) | (0x1a << 4) | 1, 0, CSR_WRITE);
  const v = h.csrRead(MEICONTEXT, 0, 0);
  assert.equal(v >>> 28, 3);
  assert.equal((v >>> 24) & 0xf, 0xe);
  assert.equal((v >>> 16) & 0x1f, 5);
  assert.equal((v >>> 4) & 0x1ff, 0x1a);
  assert.equal(v & 1, 1);
});

test('meinext with the update bit sets meicontext to the sampled interrupt', () => {
  const h = hart();
  win(h, MEIEA, 0, 1 << 6); setPriority(h, 6, 9); h.setExternalIrqs(1 << 6);
  h.irqc.dirty = true;
  h._meinextSnap = { ...h.irqc.next };
  const v = h.csrRead(MEINEXT, 1, CSR_SET);
  assert.equal(v, 6 << 2);
  h.csrWrite(MEINEXT, v | 1, 1, CSR_SET);
  assert.equal(h.irqc.irqNum, 6);
  assert.equal(h.irqc.noirq, 0);
  assert.equal(h.irqc.preempt, 10, 'priority 9 + 1');
});

test('csrrs/csrrc forms of the window registers go through the instruction path', () => {
  const m = new FlatMemory(0x100);
  const h = new Hart(m);
  const I = (f3, rd, rs1, csr) => (((csr << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | 0x73) >>> 0);
  const dv = new DataView(m.bytes.buffer);
  [I(1, 0, 5, MEIEA), I(2, 6, 7, MEIEA), I(3, 8, 9, MEIEA)].forEach((w, i) => dv.setUint32(4 * i, w, true));
  h.x[5] = (0x00f0 << 16) | 0;      // csrw meiea: window 0, lines 4 to 7
  h.x[7] = (0x0001 << 16) | 0;      // csrrs: window 0, set line 0
  h.x[9] = (0x0010 << 16) | 0;      // csrrc: window 0, clear line 4
  h.step(); h.step(); h.step();
  assert.equal(h.x[6] >>> 16, 0x00f0, 'csrrs returns the old window');
  assert.equal(h.x[8] >>> 16, 0x00f1, 'csrrc returns the window after the set');
  assert.equal(winRead(h, MEIEA, 0), 0x00e1);
});
