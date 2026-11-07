// pico2/index.js -- the Raspberry Pi RP2350's Hazard3 core on the contract (spec W-D29), module id `pico2` (research repository
// ADR-0008), milestones P1-M1 and P1-M2 of the research roadmap: the assembler, the disassembler and the instruction-level engine
// of one hart on the Pico 2 machine (address map, the peripherals of P1-M2, event scheduler, high-level boot of SDK images in
// engine.js). Registered for the development page only (`/?arch=pico2`): it has no entry in site/architectures.json, no landing
// tile and no release build until it is released (ADR-0008; docs/ADDING-SIMULATORS.md steps 5-6). P1-M3 adds the pipeline view
// (ui/pipeline-view.js, loaded on demand), its waveforms and VCD export, and the trace export. What later milestones add
// (peripheral views, image import in the interface, the real-time run, audio) is disabled with a reason.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { CONTRACT_VERSION } from '../contract.js';
import { ABI } from './core/decode.js';
import { assemble, disassemble, editor, RAM_BASE, RAM_SIZE, STACK_TOP } from './language.js';
import { create, CSR_VIEW } from './engine.js';
import { PICO2_STRINGS as S } from './strings.js';
import { trace, traceJsonLines, traceCsv } from './exports.js';

export const DEFAULT_SOURCE = `# Hazard3 (RP2350): add a table of words, then a few instructions of the
# RP2350's extensions. An ebreak ends the program while no trap handler is set.
        .text
_start: la      a0, table           # a0 <- the address of the table (auipc + addi)
        li      a1, 5               # five words
        li      a2, 0               # the sum
loop:   lw      t0, 0(a0)
        add     a2, a2, t0
        c.addi  a0, 4               # compressed (Zca): a 16-bit instruction
        addi    a1, a1, -1
        bnez    a1, loop
        la      t1, total
        sw      a2, 0(t1)           # total <- 150
        cpop    a3, a2              # Zbb: the number of one bits of the sum
        sh2add  a4, a1, t1          # Zba: t1 + a1 * 4
        call    square              # a0 <- a2 * a2
        ebreak

square: cm.push   {ra, s0}, -16     # Zcmp: save ra and s0, sp <- sp - 16
        mv        s0, a2
        mul       a0, s0, s0
        cm.popret {ra, s0}, 16      # restore them, sp <- sp + 16, return

        .data
table:  .word   10, 20, 30, 40, 50
total:  .word   0
`;

const off = (reason) => ({ enabled: false, reason });

export const descriptor = {
  contract: CONTRACT_VERSION,
  id: 'pico2',
  name: 'Pico 2',
  strings: S, // merged over the shell's
  capabilities: {
    ...Object.fromEntries(['assembler', 'backStep', 'breakpoints', 'watchpoints', 'runToCursor', 'share'].map((k) => [k, true])),
    cLanguage: off('cRiscvOnly'),
    exportTrace: true, // P1-M3: per-step trace with the cost model's cycles (exports.js)
    waveform: true,    // P1-M3: the waveform tab and VCD export of the pipeline view (stage model)
    ...Object.fromEntries(['stepOver', 'callStack', 'scratch', 'imageImport', 'gccImport', 'dataIO', 'uninitCheck', 'exercises',
      'exportGolden', 'exportImage', 'worker'].map((k) => [k, off('laterMilestone')])),
    ...Object.fromEntries(['memoryModel', 'cache', 'devices', 'traps'].map((k) => [k, off('noDevices')])),
    compare: off('oneProcessor'),
  },
  language: { id: 'asm', extension: '.s', comment: '#', defaultSource: DEFAULT_SOURCE, assemble, disassemble, editor },
  registers: {
    groups: [
      { id: 'x', label: S.registerGroup, registers: ABI.map((n, i) => ({ id: `x${i}`, name: n, aliases: [`x${i}`], width: 32, ...(i === 0 ? { zero: true } : {}) })) },
      { id: 'csr', label: S.csrGroup, registers: CSR_VIEW.map(([id]) => ({ id, name: id, width: id === 'priv' ? 2 : 32 })) },
    ],
    pc: 'pc',
    roles: { sp: 'x2', fp: 'x8' },
  },
  addressSpace: { addressBits: 32, unitBits: 8, wordBytes: 4, endianness: 'little', regions: [
    { name: 'ROM', base: 0, size: 0x8000, kind: 'rom' }, { name: 'XIP flash', base: 0x10000000, size: 0x400000, kind: 'rom' },
    { name: 'SRAM', base: RAM_BASE, size: RAM_SIZE, kind: 'ram' }, { name: 'APB peripherals', base: 0x40000000, size: 0x180000, kind: 'device' },
    { name: 'AHB peripherals', base: 0x50000000, size: 0x700000, kind: 'device' }, { name: 'SIO', base: 0xd0000000, size: 0x40000, kind: 'device' }] },
  engine: {
    create,
    profiles: [{ id: 'hazard3', label: S.profileNames.hazard3, memory: 'unified', stackTop: STACK_TOP }],
  },
  views: [
    { id: 'isa', label: S.viewIsa, icon: 'chip', kind: 'isa' },
    // Hazard3's F, X and M cycle by cycle on the stage model (P1-M3; drawing approved by the author 2026-11-06, Q6); loaded
    // with its tab (WS-N-011)
    { id: 'pipeline', label: S.viewPipeline, icon: 'pipeline', kind: 'datapath', profile: 'hazard3', load: async () => {
      const { PipelineView, pipelineInstance } = await import('./ui/pipeline-view.js');
      return { create: (ctx) => pipelineInstance(new PipelineView(), ctx) };
    } },
  ],
  exports: { trace: (program, { cap }) => trace(program, { cap }), traceJsonLines, traceCsv },
};
