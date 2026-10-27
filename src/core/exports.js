// exports.js -- file exports of a simulation (spec §13): the golden dump of a
// datapath processor (WS-F-124), the trace of retired instructions as JSON
// lines in the format of WS-V-010 and as CSV (WS-F-126), and a VCD waveform
// of the microarchitecture signals under the RTL's names (WS-F-125). Each
// export replays the program from reset on a fresh hart or model, so it does
// not disturb the session and does not depend on its history. Pure
// JavaScript, no DOM: the page and the headless runner (tools/risc-vista-run.mjs,
// WS-F-127) use the same functions.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Hart, SimError } from './iss.js';
import { disassemble } from '../asm/disassembler.js';

const hex = (v) => (v >>> 0).toString(16).padStart(8, '0');
const h8 = (v) => `0x${hex(v)}`;

/** A golden dump as the chapters' reference models write it: one 8-digit hex word per line. */
export function goldenText(words) {
  return words.map((w) => `${hex(w)}\n`).join('');
}

/**
 * Change records of the first `count` retired instructions of `program` on
 * the instruction-level simulator (iss.js Hart.step()), from reset. Returns
 * {records, error}: error is the SimError message if the program stopped on
 * one before `count` instructions.
 */
export function traceRecords(program, profile, count) {
  const hart = new Hart(program, { profile });
  const records = [];
  let error = null;
  try {
    while (records.length < count && !hart.halted) {
      const rec = hart.step();
      if (rec && rec.cls) records.push(rec);
    }
  } catch (e) {
    if (!(e instanceof SimError)) throw e;
    error = e.message;
  }
  return { records, error };
}

/** JSON-lines trace of WS-V-010, one line per retired instruction (as rvsim.py --trace-json). */
export function traceJsonLines(records) {
  return records.map((r) => {
    const o = { pc: r.pc, word: r.word };
    if (r.reg) { o.rd = r.reg.rd; o.rd_value = r.reg.value; }
    if (r.mem) { o.mem_addr = r.mem.addr; o.mem_size = r.mem.size; o.mem_value = r.mem.value; }
    return `${JSON.stringify(o)}\n`;
  }).join('');
}

/** The same trace as CSV, with hexadecimal values and the disassembly (rvdis.py style). */
export function traceCsv(records) {
  const rows = ['step,pc,word,instruction,rd,rd_value,mem_addr,mem_size,mem_value'];
  records.forEach((r, i) => {
    rows.push([
      i + 1, h8(r.pc), h8(r.word), `"${disassemble(r.word, r.pc).replace(/"/g, '""')}"`,
      r.reg ? `x${r.reg.rd}` : '', r.reg ? h8(r.reg.value) : '',
      r.mem ? h8(r.mem.addr) : '', r.mem ? r.mem.size : '', r.mem ? h8(r.mem.value) : '',
    ].join(','));
  });
  return `${rows.join('\n')}\n`;
}

/**
 * Signal records of a datapath model, one per clock cycle from reset: the
 * values of evaluate() before each edge, for `cycles` edges or up to and
 * including the halt cycle (the cycles the RTL lock-step compares). The model
 * must be freshly loaded. Returns {frames, stop}: stop is the model's step
 * result that ended the record ('step' when `cycles` was reached).
 */
export function recordFrames(model, cycles) {
  const frames = [];
  let stop = 'step';
  while (frames.length <= cycles) {
    frames.push({ ...model.evaluate().signals });
    if (frames.length > cycles) break;
    stop = model.step();
    if (stop !== 'step') break;
  }
  return { frames, stop };
}

// VCD identifier codes: printable ASCII 33-126, shortest first.
function vcdId(n) {
  let s = '';
  do { s += String.fromCharCode(33 + (n % 94)); n = Math.floor(n / 94); } while (n > 0);
  return s;
}

const vcdValue = (v, width) => (width === 1 ? `${v & 1}` : `b${(v >>> 0).toString(2)} `);

/**
 * VCD waveform of `frames` (recordFrames) for the signals of a dictionary of
 * uarch/signals.js. Each signal sits at its RTL path below `module` (u_ctrl.Branch
 * in scope u_ctrl); a signal without an RTL name goes into the scope `model`,
 * since the RTL has no net of that name. One clock cycle is 10 ns, as in the
 * book's testbenches (`always #5 clk = ~clk`); the values of cycle k change at
 * the rising edge that starts it, t = 10k ns. The time axis orders the cycles;
 * it is not a hardware timing.
 */
export function vcd(frames, signals, { module, comment = '' }) {
  const tree = { scopes: new Map(), vars: [] };
  const vars = [{ name: 'clk', width: 1, id: vcdId(0), get: null }];
  tree.vars.push(vars[0]);
  signals.forEach((s, i) => {
    const path = s.rtl ? s.rtl.split('.') : ['model', s.name];
    let node = tree;
    for (const part of path.slice(0, -1)) {
      if (!node.scopes.has(part)) node.scopes.set(part, { scopes: new Map(), vars: [] });
      node = node.scopes.get(part);
    }
    const v = { name: path[path.length - 1], width: s.width, id: vcdId(i + 1), key: s.name };
    node.vars.push(v);
    vars.push(v);
  });
  const out = ['$version MAVILERA $end'];
  if (comment) out.push(`$comment ${comment} $end`);
  out.push('$timescale 1ns $end');
  const emit = (name, node) => {
    out.push(`$scope module ${name} $end`);
    for (const v of node.vars) out.push(`$var wire ${v.width} ${v.id} ${v.name}${v.width > 1 ? ` [${v.width - 1}:0]` : ''} $end`);
    for (const [n, child] of node.scopes) emit(n, child);
    out.push('$upscope $end');
  };
  emit(module, tree);
  out.push('$enddefinitions $end');
  let prev = null;
  frames.forEach((f, k) => {
    out.push(`#${10 * k}`);
    if (k === 0) out.push('$dumpvars');
    out.push(`1${vars[0].id}`);
    for (const v of vars.slice(1)) {
      const val = f[v.key] ?? 0;
      if (!prev || (prev[v.key] ?? 0) !== val) out.push(`${vcdValue(val, v.width)}${v.id}`);
    }
    if (k === 0) out.push('$end');
    out.push(`#${10 * k + 5}`, `0${vars[0].id}`);
    prev = f;
  });
  out.push(`#${10 * frames.length}`);
  return `${out.join('\n')}\n`;
}
