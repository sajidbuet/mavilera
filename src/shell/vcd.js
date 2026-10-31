// vcd.js -- the waveform recording and VCD writer of the shell (WS-F-125, WS-F-146; architecture contract v4: it
// needs only a view's export model and its signal list, so it is shared by every architecture). Moved from
// core/exports.js in phase 3 of docs/architecture/arch-contract.md; core/exports.js still exports both names for the
// headless runner. Pure JavaScript, no DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

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
