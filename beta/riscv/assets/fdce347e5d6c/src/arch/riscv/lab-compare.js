// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { assemble } from '../../asm/assembler.js';
import { Hart } from '../../core/iss.js';
import { Platform } from '../../mem/platform.js';
import { classify, breakdown, traceRun } from './offload.js';
export const LAB_PROGRAMS = Object.freeze(['shiftAdd', 'mul', 'npu']);
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
export function measureLab(text, tables, n, { name = 'prog.s', limit = 200_000 } = {}) {
 const p = assemble([{ name, text }], { profile: 'ch11' });
 if (!p.ok || p.profileErrors.length) throw new Error([...p.errors, ...p.profileErrors].map((e) => e.message).join('; '));
 return measureProgram(p, tables, n, { limit });
}
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
export const perVector = (ca, na, cb, nb) => (cb - ca) / (nb - na);
