// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
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
function vcdId(n) {
 let s = '';
 do { s += String.fromCharCode(33 + (n % 94)); n = Math.floor(n / 94); } while (n > 0);
 return s;
}
const vcdValue = (v, width) => (width === 1 ? `${v & 1}` : `b${(v >>> 0).toString(2)} `);
export function vcd(frames, signals, { module, comment = '' }) {
 const tree = { scopes: new Map(), vars: [] };
 const vars = [{ name: 'clk', width: 1, id: vcdId(0), get: null }];
 tree.vars.push(vars[0]);
 signals.forEach((s, i) => {
 const path = s.rtl ? s.rtl.split('.') : s.vcd ? s.vcd.split('.') : ['model', s.name];
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
