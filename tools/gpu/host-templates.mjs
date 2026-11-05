// tools/gpu/host-templates.mjs -- writes the templates of the CPU + GPU tool (GPU-7, decision G30) to content/templates/:
// a RISC-V host program for the single-cycle processor that copies a kernel of the GPU Laboratory into the GPU's
// instruction memory, its data into the GPU's data memory, starts it, polls STATUS and copies the results back. The
// RISC-V assembler has no warp-control mnemonics (decision G18), so the kernel is assembled here with the GPU module's
// assembler and written as words, each with its source line as a comment.
//   node tools/gpu/host-templates.mjs [--check]
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble } from '../../src/arch/gpu/rvsimt/language.js';
import { kernelWords } from '../../src/arch/gpu/rvsimt/host-words.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const check = process.argv.includes('--check');

// the kernel: y[i] = |x[i]| for eight threads (two warps of four lanes); x at GPU data word 0, y at word 8
const KERNEL = `        .include "simt.inc"
_start: li     t0, 2
        la     t1, kernel
        wspawn t0, t1
kernel: csrr   t0, THREAD_INDEX
        slli   t0, t0, 2
        lw     t1, 0(t0)
        slt    t2, t1, zero
        split  t2
        beqz   t2, 1f
        sub    t1, zero, t1
1:      join
        sw     t1, 32(t0)
        tmc    zero
`;
const X = [5, -3, 0, -7, 2, -1, 4, -8];

function template() {
  const p = assemble([{ name: 'kernel.s', text: KERNEL }], { profile: 'lab' });
  if (!p.ok) throw new Error(p.diagnostics.map((d) => d.message).join('; '));
  const k = kernelWords(p);
  const words = k.code;
  const prog = { length: k.count };
  return `# cpu-gpu-abs.s -- CPU + GPU: the host runs a kernel on the GPU, y[i] = |x[i]| for eight threads.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (Apache-2.0). Written by tools/gpu/host-templates.mjs; do not edit by hand.
#
# The GPU is the GPU Laboratory's SIMT core (two warps of four lanes) at 0x5000_1000, with MAVILERA's register map:
# CTRL 0x000 (1 = start), STATUS 0x004 (bit 0 BUSY, bit 1 DONE, bit 2 FAULT), IMEM from 0x400, DMEM from 0x800.
# The host copies the kernel and x into the GPU, starts it, polls STATUS while the GPU issues one warp-instruction
# per clock cycle, and copies y back to its own memory. Step it in the GPU view to see both at work.
        .equ GPU,    0x50001000
        .equ STATUS, 0x004
        .equ IMEM,   0x50001400
        .equ DMEM,   0x50001800
        .equ N,      ${prog.length}           # kernel words
        .text
main:   li   s0, GPU
        la   t0, kernel        # copy the kernel into the GPU's instruction memory
        li   t1, IMEM
        li   t2, N
code:   lw   t3, 0(t0)
        sw   t3, 0(t1)
        addi t0, t0, 4
        addi t1, t1, 4
        addi t2, t2, -1
        bnez t2, code
        la   t0, x             # copy x into GPU data words 0 to 7
        li   t1, DMEM
        li   t2, 8
data:   lw   t3, 0(t0)
        sw   t3, 0(t1)
        addi t0, t0, 4
        addi t1, t1, 4
        addi t2, t2, -1
        bnez t2, data
        li   t3, 1             # CTRL: start
        sw   t3, 0(s0)
poll:   lw   t3, STATUS(s0)    # poll until BUSY is 0
        andi t3, t3, 1
        bnez t3, poll
        la   t0, y             # copy y back from GPU data words 8 to 15
        li   t1, DMEM + 32
        li   t2, 8
back:   lw   t3, 0(t1)
        sw   t3, 0(t0)
        addi t0, t0, 4
        addi t1, t1, 4
        addi t2, t2, -1
        bnez t2, back
        halt
        .data
kernel:                        # the kernel, assembled by the GPU Laboratory (source in the comments)
${words.join('\n')}
x:      .word  ${X.join(', ')}
y:      .space 32
`;
}

const out = join(ROOT, 'content/templates/cpu-gpu-abs.s');
const text = template();
if (check) {
  let old = null;
  try { old = readFileSync(out, 'utf8'); } catch { /* missing */ }
  if (old !== text) { console.error('differs: content/templates/cpu-gpu-abs.s'); process.exit(1); }
  console.log('cpu-gpu templates: up to date');
} else {
  writeFileSync(out, text);
  console.log('cpu-gpu templates: content/templates/cpu-gpu-abs.s written');
}
