// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
const hex = (v, d = 1) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(d, '0')}`;
const signed = (v) => String(v | 0);
export const GPU_STRINGS = Object.freeze({
 appFull: 'GPU Laboratory',
 aboutText: 'MAVILERA is an educational platform for exploring microprocessor architecture. This module, the GPU Laboratory, '
 + 'shows a SIMT core: one program counter issues each instruction to four or eight lanes at once, and an active mask with '
 + 'a two-deep mask stack decides which lanes execute it, so that divergence and its cost in idle lane-slots can be seen.',
 viewIsa: 'Instructions',
 profileNames: Object.freeze({ simt4: 'SIMT core · 4 lanes', simt8: 'SIMT core · 8 lanes' }),
 registerGroup: 'Core',
 laneGroup: 'Lanes',
 asm: Object.freeze({
 unknown: (m) => `'${m}' is not a micro-ISA instruction or directive.`,
 unknownNote: 'The micro-ISA has seven instructions: HALT, LDI, ADD, SUB, IFLT, ELSE and ENDIF; directives .din and .word.',
 operands: (m, n, usage) => `${m} takes ${n === 0 ? 'no operand' : n === 1 ? 'one operand' : `${n} operands`}: ${usage}.`,
 badRegister: (t) => `'${t}' is not a lane register: each lane has r0, r1, r2 and r3.`,
 badNumber: (t) => `'${t}' is not a number.`,
 immRange: (v) => `The immediate ${v} does not fit in eight bits (-128 to 255; LDI sign-extends it).`,
 wordRange: (v) => `The word ${v} does not fit in sixteen bits (0 to 0xFFFF).`,
 dinRange: (v) => `The input ${v} does not fit in 32 bits (-2147483648 to 4294967295).`,
 dinCount: (n, lanes) => `.din gives ${n} inputs, but the core has ${lanes} lanes (one input per lane; missing ones are 0).`,
 dinTwice: 'The lane inputs are given twice; keep one .din line.',
 needsValue: (d) => `${d} needs a value.`,
 noLabels: (t) => `'${t}:' is a label, but the micro-ISA has no branches, so a program has no use for labels.`,
 full: 'The program memory has sixteen words (0 to 15); this instruction would go past the end.',
 badImageWord: (t) => `'${t}' is not a 16-bit word in hexadecimal (one word per line, 0000 to FFFF).`,
 imageTooLong: (n) => `The image has ${n} words; the program memory has sixteen.`,
 binOdd: (n) => `A .bin image holds 16-bit words, two bytes each; this one has ${n} bytes.`,
 }),
 engine: Object.freeze({
 stackFull: (pc) => `IFLT at ${hex(pc)}: the mask stack is two deep, so a third nested IFLT has nowhere to push the mask. `
 + 'The micro-ISA does not define this case; MAVILERA stops here.',
 stackEmpty: (m, pc) => `${m} at ${hex(pc)} has no IFLT to match: the mask stack is empty. The micro-ISA does not define this case; MAVILERA stops here.`,
 busyWrite: 'The core is busy: its program memory is written only while it is idle.',
 busyStart: 'The core is busy: start is taken only while it is idle.',
 halted: (cycles, idle, dout) => `HALT: ${cycles} cycles, ${idle} idle lane-slots; dout (r2 of each lane) = ${dout.map(signed).join(', ')}\n`,
 }),
 scratchOne: 'One instruction only: no directive.',
 scratch: Object.freeze({
 title: 'Type one instruction (ADD r2, r1, r3) to see its word, or a word (0x5380 or 0b0101001110000000) to see its instruction. '
 + 'Nothing is assembled into the program.',
 word: (h, bin) => `0x${h.slice(-4)} = ${bin}`,
 }),
 counterNames: Object.freeze({
 instructions: 'Instructions (cycles)',
 work: 'Lane instructions (LDI, ADD, SUB)',
 maskOps: 'Mask instructions (IFLT, ELSE, ENDIF)',
 idle: 'Idle lane-slots',
 busy: 'Busy lane-slots',
 utilisation: 'Lane utilisation',
 percent: (busy, all) => (all ? `${Math.round((100 * busy) / all)} %` : '–'),
 }),
 lanes: Object.freeze({
 tab: 'Lanes',
 caption: (n) => `The ${n} lanes: registers r0 to r3, active-mask bit and the two mask-stack bits of each`,
 lane: (l) => `Lane ${l}`,
 rowMask: 'active',
 rowStack0: 'stack 0',
 rowStack1: 'stack 1',
 on: 'on', off: 'off',
 changed: 'changed by the last step',
 value: (v) => `${signed(v)} (${hex(v, 8)})`,
 noProgram: 'Assemble a program to see its lanes.',
 note: 'r0 starts as the lane index and r1 as the lane input (din, from .din); r2 is the lane output (dout) at HALT. '
 + 'An inactive lane keeps its registers; its column is marked “off”. Values in signed decimal; hexadecimal in the tooltip.',
 }),
 capability: Object.freeze({
 cRiscvOnly: 'The C compiler targets RISC-V only; the SIMT core is programmed in its micro-ISA.',
 noCalls: 'The micro-ISA has no branch, jump or call instructions.',
 noMemorySystem: 'The SIMT core has only its sixteen-word program memory: no data memory, timing model, caches or devices.',
 noDataMemory: 'The SIMT core has no data memory; give the lane inputs with .din.',
 oneProcessor: 'The GPU module has one core; there is nothing to compare.',
 }),
 editorHelp: Object.freeze({
 HALT: { usage: 'HALT', operation: 'stop; done ← 1; dout ← r2 of every lane' },
 LDI: { usage: 'LDI rd, imm', operation: 'each active lane: rd ← sign-extend(imm[7:0])' },
 ADD: { usage: 'ADD rd, rs, rt', operation: 'each active lane: rd ← rs + rt' },
 SUB: { usage: 'SUB rd, rs, rt', operation: 'each active lane: rd ← rs − rt' },
 IFLT: { usage: 'IFLT rs, rt', operation: 'push the mask; active ← active ∧ (rs < rt, signed)' },
 ELSE: { usage: 'ELSE', operation: 'active ← (mask before IFLT) ∧ ¬active' },
 ENDIF: { usage: 'ENDIF', operation: 'pop the mask' },
 }),
 directiveHelp: Object.freeze({
 '.din': '.din v0, v1, …: the lane inputs (r1 of lane 0, 1, …) at start; missing ones are 0',
 '.word': '.word v: one 16-bit word placed as it is (op 7, reserved, runs as no operation)',
 }),
 format: 'op (3 bits) · rd · rs · rt (2 bits each) · imm (8 bits, LDI only)',
 registerHelp: Object.freeze({
 r0: 'r0: the lane index at start', r1: 'r1: the lane input (din) at start', r2: 'r2: the lane output (dout) at HALT', r3: 'r3: a working register',
 }),
 fieldMeaning: Object.freeze({
 op: (m) => (m ? `operation ${m}` : 'op 7, reserved: no operation'),
 rd: 'destination register',
 rs: 'first source register',
 rt: 'second source register',
 imm: 'immediate, sign-extended to 32 bits',
 unused: 'not used by this operation',
 }),
 reserved: 'reserved (no operation)',
});
