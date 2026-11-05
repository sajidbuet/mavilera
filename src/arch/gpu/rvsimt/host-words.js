// rvsimt/host-words.js -- a kernel of the RISC-V SIMT core written for a host program (GPU-7, decision G30; author,
// 2026-11-05: "Export kernel for a host"): the RISC-V assembler has no warp-control mnemonics (decision G18), so the
// host carries the kernel as words. The kernel's instruction words become `.word` lines, each with its source line as a
// comment, under a label; its data section (the GPU's data memory from address 0) the same, as words to copy to DMEM.
// Used by the GPU Laboratory's CPU + GPU view and by tools/gpu/host-templates.mjs.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { loadProgram } from './engine.js';
import { codeText } from './core-model.js';

const hex = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;

/**
 * The host's view of an assembled kernel (a Program of profile lab): {code: ['.word 0x… # source', …], data: [words],
 * count} where `data` ends at its last non-zero word (none: an empty list).
 */
export function kernelWords(program) {
  const { prog, data } = loadProgram(program);
  let last = data.length - 1;
  while (last >= 0 && !data[last]) last -= 1;
  return { count: prog.length, code: prog.map((w, i) => `        .word  ${hex(w)}   # ${codeText(program, 4 * i, w)}`),
    data: data.slice(0, last + 1).map((w) => w >>> 0) };
}

/** The lines to paste into a host program's data section: the kernel under `label`, its data under `${label}_data`. */
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
