// lab-compare.js -- the CPU/NPU comparison of the Chapter 11 laboratory (NPU-4; Table 11.5, FIG-0116, WE 11.9): the
// three programs (shift-and-add, mul, NPU) run in MAVILERA on the data sets v1, v4, v16 (content/data/ch11-tables.json)
// at one cycle per instruction (profile ch11, the instruction level of the laboratory; the single-cycle host gives the
// same counts, test/npu-lab.test.mjs), measured as the book measures: the cycles from the first to the last GPIO
// marker. The book's values are returned beside MAVILERA's, never in their place. Pure: no DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { assemble } from '../../asm/assembler.js';
import { Hart } from '../../core/iss.js';
import { Platform } from '../../mem/platform.js';
import { classify, breakdown, traceRun } from './offload.js';

export const LAB_PROGRAMS = Object.freeze(['shiftAdd', 'mul', 'npu']);

/** The 512 bytes of data set vn (NV, W, the first n vectors), little-endian, for RAM address 0. */
export function labDataBytes(tables, n) {
  const d = tables.lab_data;
  if (!d.sets.includes(n)) throw new RangeError(`no data set v${n}`);
  const words = new Uint32Array(d.layout.words);
  words[0] = n;
  d.weights.forEach((w, i) => { words[4 + i] = parseInt(w, 16) >>> 0; });
  d.vectors.slice(0, n).forEach((w, i) => { words[16 + i] = parseInt(w, 16) >>> 0; });
  const bytes = new Uint8Array(words.length * 4);
  const dv = new DataView(bytes.buffer);
  words.forEach((w, i) => dv.setUint32(4 * i, w, true));
  return bytes;
}

/**
 * Assemble `text` for the laboratory (profile ch11), put data set vn at address 0, run it to the halt with the
 * platform devices and return {cycles (first to last marker), spans, markers, npu (the NPU's counters), steps,
 * classes, breakdown}. Throws with the assembler's messages if the source does not assemble.
 */
export function measureLab(text, tables, n, { name = 'prog.s', limit = 200_000 } = {}) {
  const p = assemble([{ name, text }], { profile: 'ch11' });
  if (!p.ok || p.profileErrors.length) throw new Error([...p.errors, ...p.profileErrors].map((e) => e.message).join('; '));
  return measureProgram(p, tables, n, { limit });
}

/**
 * measureLab for an assembled program (the session's): data set vn at address 0 when n is a number, the program's own
 * data when n is null. Runs on profile ch11 (RV32IM, the platform devices, one cycle per instruction).
 */
export function measureProgram(p, tables, n = null, { limit = 200_000 } = {}) {
  const program = n === null ? p : { ...p, segments: [...p.segments, { address: 0, bytes: labDataBytes(tables, n), executable: false }] };
  const platform = new Platform();
  const hart = new Hart(program, { profile: 'ch11', platform });
  const steps = traceRun(hart, limit);
  if (!hart.halted) throw new Error(`no halt within ${limit} instructions`);
  const { markers, spans, npu } = platform.measurement();
  const cycles = markers.length > 1 ? markers[markers.length - 1].cycle - markers[0].cycle : null;
  const classes = classify(steps);
  return { cycles, spans, markers, npu, steps: steps.length, classes, breakdown: breakdown(steps, classes, markers) };
}

/**
 * Table 11.5 twice: for each data set, the book's cycles and MAVILERA's ({shiftAdd, mul, npu} from `sources`, the
 * three programs' texts), with the speed-ups of the NPU over each. A program missing from `sources` gives null.
 */
export function labComparison(sources, tables) {
  return tables.lab_cycles.map((b) => {
    const ours = {};
    for (const k of LAB_PROGRAMS) ours[k] = sources[k] ? measureLab(sources[k], tables, b.vectors).cycles : null;
    const speed = (a) => (a && ours.npu ? a / ours.npu : null);
    return {
      vectors: b.vectors,
      book: { shiftAdd: b.shiftAdd, mul: b.mul, npu: b.npu, speedupShiftAdd: b.speedupShiftAdd, speedupMul: b.speedupMul },
      mavilera: { ...ours, speedupShiftAdd: speed(ours.shiftAdd), speedupMul: speed(ours.mul) },
    };
  });
}

/** Cycles per vector between two data sets (WE 11.9 (a)): (c(nb) - c(na)) / (nb - na). */
export const perVector = (ca, na, cb, nb) => (cb - ca) / (nb - na);
