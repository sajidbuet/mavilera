// i8086/interrupts.js -- the NMI and INTR inputs and the single-step trap (milestone 8086-B8, roadmap §12 question 9;
// design docs/architecture/i8086-review.md §4, decisions B8-Q4 to Q8 and Q11 of 2026-11-07), shared by the instruction
// engine and the views' models. Rules [INTEL], IFUM chapter 2 (9800722-03):
//   - INTR is level-triggered and not latched: it is taken at an instruction boundary while it is on and IF = 1, with two
//     INTA bus cycles that return the type (p. 2-24, PDF 47). The switch stays on until the student turns it off (B8-Q4).
//   - NMI is edge-triggered and latched, type 2, not maskable, no INTA cycles, before INTR (p. 2-24, PDF 47).
//   - Priority (Table 2-3, p. 2-26, PDF 49): the instruction's own interrupt (INT n, INTO, divide error) first, then NMI,
//     INTR, single-step; each one recognised is entered in turn (Fig 2-31, PDF 50), so the last entered runs first.
//   - No interrupt after MOV or POP to a segment register until after the next instruction; STI and IRET enable INTR only
//     after the next instruction (footnote and text p. 2-24, PDF 47; IRET as IFUM states it, not checked against
//     hardware: B8-Q11).
//   - Single-step: a type 1 interrupt after every instruction that started with TF = 1 (p. 2-25, PDF 48).
//   - A repeated string instruction accepts NMI and INTR between repetitions (footnote p. 2-24), and returns to the
//     prefix just before the string op code (AP-67, p. A-27, PDF 331; cpu.js).
// [EDU] choices of the simulator: an input may arrive after a delay of n instructions, each repetition of a REP string
// counting as one, so that an interrupt can be placed inside a string instruction; the single-step trap is taken at the
// end of a whole instruction only; the segment-register shadow also holds back the single-step trap.
// The simulator's own code (C4). No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { FLAG } from './cpu.js';

export const NMI_TYPE = 2;
export const STEP_TYPE = 1;
export const DEFAULT_INTR_TYPE = 0x08;
const DELAY_MAX = 999;

/** The inputs' state: the NMI latch, the INTR line and its type, inputs still on their way, and the open boundary. */
export function initialInputs() {
  return { nmi: false, intr: false, type: DEFAULT_INTR_TYPE, coming: [], boundary: { nmi: true, intr: true, trap: false } };
}

export const copyInputs = (s) => ({ nmi: s.nmi, intr: s.intr, type: s.type, coming: s.coming.map((x) => ({ ...x })),
  boundary: s.boundary ? { ...s.boundary } : null });

/**
 * Apply an input of the panel (Engine.input): {nmi: true}, or {intr: true | false, type?}; `delay` (0 to 999) instructions
 * before it arrives. Returns false for an input that is not understood.
 */
export function applyInput(s, x) {
  if (!x || typeof x !== 'object') return false;
  const delay = Math.max(0, Math.min(DELAY_MAX, Math.floor(Number(x.delay) || 0)));
  const now = { ...('nmi' in x ? { nmi: Boolean(x.nmi) } : {}), ...('intr' in x ? { intr: Boolean(x.intr) } : {}),
    ...(Number.isInteger(x.type) && x.type >= 0 && x.type <= 255 ? { type: x.type } : {}) };
  if (!('nmi' in now) && !('intr' in now) && !('type' in now)) return false;
  if (delay > 0) s.coming.push({ left: delay, ...now });
  else arrive(s, now);
  return true;
}

function arrive(s, x) {
  if (x.nmi) s.nmi = true; // a rising edge, latched
  if ('intr' in x) s.intr = x.intr;
  if ('type' in x) s.type = x.type;
}

/** One instruction, or one repetition of a string instruction, has passed: inputs on their way come nearer. */
export function tick(s) {
  if (!s.coming.length) return;
  for (const x of s.coming) x.left -= 1;
  for (const x of s.coming.filter((y) => y.left <= 0)) arrive(s, x);
  s.coming = s.coming.filter((x) => x.left > 0);
}

/** Every input still on its way arrives (a halted processor waits for them). */
export function arriveAll(s) {
  for (const x of s.coming) arrive(s, x);
  s.coming = [];
}

/**
 * The boundary after an instruction: which interrupts may be recognised there. `old` is the FLAGS at its start, `mnem`
 * its mnemonic and `segLoad` whether it wrote a segment register by MOV or POP.
 */
export function boundaryAfter(oldFlags, mnem, segLoad) {
  if (segLoad) return { nmi: false, intr: false, trap: false };
  const delayIntr = mnem === 'STI' || mnem === 'IRET';
  return { nmi: true, intr: !delayIntr, trap: Boolean(oldFlags & FLAG.TF) };
}

/** The boundary inside a repeated string instruction stopped for an interrupt. */
export const REP_BOUNDARY = Object.freeze({ nmi: true, intr: true, trap: false });

/** Whether an interrupt waits at the present boundary, given the FLAGS now: 'nmi', 'intr', 'trap' or null. */
export function due(s, flags) {
  const b = s.boundary;
  if (!b) return null;
  if (b.nmi && s.nmi) return 'nmi';
  if (b.intr && s.intr && flags & FLAG.IF) return 'intr';
  if (b.trap) return 'trap';
  return null;
}

/** Whether a string instruction should stop between repetitions: one more instruction-time passes, then NMI or INTR. */
export function repStopper(s, getFlags) {
  return () => { tick(s); return s.nmi || (s.intr && Boolean(getFlags() & FLAG.IF)); };
}

/** Take the interrupt `kind` at the boundary: clears what it consumes and returns its type. */
export function take(s, kind) {
  if (kind === 'nmi') { s.nmi = false; s.boundary.nmi = false; return NMI_TYPE; }
  if (kind === 'intr') { s.boundary.intr = false; return s.type; }
  s.boundary.trap = false;
  return STEP_TYPE;
}

/** Whether an instruction writes a segment register by MOV or POP (the interrupt shadow of p. 2-24). */
export const loadsSegment = (d) => (d.entry?.mnem === 'MOV' || d.entry?.mnem === 'POP') && d.operands?.[0]?.t === 'sreg';
