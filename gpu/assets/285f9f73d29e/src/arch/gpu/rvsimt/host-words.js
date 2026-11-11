// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { loadProgram } from './engine.js';
import { codeText } from './core-model.js';
const hex = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
export function kernelWords(program) {
 const { prog, data } = loadProgram(program);
 let last = data.length - 1;
 while (last >= 0 && !data[last]) last -= 1;
 return { count: prog.length, code: prog.map((w, i) => `        .word  ${hex(w)}   # ${codeText(program, 4 * i, w)}`),
 data: data.slice(0, last + 1).map((w) => w >>> 0) };
}
export function hostText(program, { label = 'kernel', name = 'the kernel' } = {}) {
 const k = kernelWords(program);
 const lines = [`# ${name} for the GPU (profile: two warps of four lanes), written by MAVILERA's GPU Laboratory.`,
 `# Copy the ${k.count} words at ${label} to the GPU's IMEM (0x5000_1400)${k.data.length ? `, and the ${k.data.length} words at ${label}_data to its DMEM (0x5000_1800)` : ''}, then write 1 to CTRL.`,
 `${label}:`, ...k.code];
 if (k.data.length) {
 lines.push(`${label}_data:`);
 for (let i = 0; i < k.data.length; i += 8) lines.push(`        .word  ${k.data.slice(i, i + 8).map(hex).join(', ')}`);
 }
 return `${lines.join('\n')}\n`;
}
