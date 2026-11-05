// i8086/index.js -- the Intel 8086 on the contract (spec W-D29; roadmap docs/roadmaps/INTEL-8086-DEVELOPMENT-ROADMAP.md,
// milestones 8086-B0 to B2, the beta of 2026-11-05): the assembler in Intel's ASM-86 style, the disassembler and the
// instruction-level engine (accuracy level L1: architectural state, no clocks), with 1 MiB of segmented memory and the
// I/O ports. Module id `i8086` (author, 2026-11-05: no contract change; the descriptor id rule needs a leading letter);
// its name is "8086". The BIU and EU view (8086-B4) steps each instruction through the simulator's teaching model of
// micro-operations (B3), or clock by clock with the BIU and its prefetch queue (B5, L2: Intel's documented queue and
// bus-cycle rules, the simulator's EU timing); waveforms (B6) and instruction timing (B7) are not in the beta; the
// capabilities they need are disabled with a reason.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { CONTRACT_VERSION } from '../contract.js';
import { assemble, disassemble, fields, describe, editor, image, loadImage, scratch } from './language.js';
import { create } from './engine.js';
import { trace, traceJsonLines, traceCsv } from './exports.js';
import { I8086_STRINGS as S } from './strings.js';

export const DEFAULT_SOURCE = `; 8086: add the numbers of a table and print "Sum OK" when the total is right
; One segment: CS = DS = ES = SS = 1000H; OUT 0E9H, AL writes a character to the console.
        MOV  SI, OFFSET table   ; SI <- the table's offset
        MOV  CX, 5              ; five words
        XOR  AX, AX             ; AX <- 0 (and CF <- 0)
next:   ADD  AX, [SI]           ; AX <- AX + the word at DS:SI
        ADD  SI, 2              ; the next word
        LOOP next               ; CX <- CX - 1; again while CX is not 0
        MOV  total, AX          ; store the sum
        CMP  AX, 150            ; 10 + 20 + 30 + 40 + 50
        JNE  done
        MOV  SI, OFFSET msg
print:  LODSB                   ; AL <- the byte at DS:SI; SI <- SI + 1
        CMP  AL, 0
        JE   done
        OUT  0E9H, AL           ; the console
        JMP  print
done:   HLT

table   DW   10, 20, 30, 40, 50
total   DW   ?
msg     DB   'Sum OK', 13, 10, 0
`;

const off = (reason) => ({ enabled: false, reason });

export const descriptor = {
  contract: CONTRACT_VERSION,
  id: 'i8086',
  name: '8086',
  strings: S, // merged over the shell's
  capabilities: {
    ...Object.fromEntries(['assembler', 'backStep', 'breakpoints', 'watchpoints', 'stepOver', 'callStack', 'runToCursor', 'share', 'worker',
      'exportImage', 'imageImport', 'exportTrace', 'scratch'].map((k) => [k, true])),
    cLanguage: off('cRiscvOnly'),
    memoryModel: off('noMemorySystem'),
    cache: off('noMemorySystem'),
    devices: off('noMemorySystem'),
    traps: off('beta'),
    compare: off('oneProcessor'),
    waveform: off('beta'),
    exercises: off('beta'),
    dataIO: off('beta'),
    gccImport: off('cRiscvOnly'),
    exportGolden: off('beta'),
    uninitCheck: off('beta'),
  },
  language: {
    id: 'asm', extension: '.asm', comment: ';', defaultSource: DEFAULT_SOURCE,
    assemble, disassemble, fields, describe, editor, loadImage, scratch,
  },
  registers: {
    groups: [
      { id: 'general', label: S.registerGroup, registers: ['AX', 'BX', 'CX', 'DX'].map((r) => ({ id: r, name: r, width: 16 })) },
      { id: 'pointer', label: S.pointerGroup, registers: ['SP', 'BP', 'SI', 'DI'].map((r) => ({ id: r, name: r, width: 16 })) },
      { id: 'segment', label: S.segmentGroup, registers: ['CS', 'DS', 'ES', 'SS'].map((r) => ({ id: r, name: r, width: 16 })) },
      { id: 'control', label: S.controlGroup, registers: [{ id: 'IP', name: 'IP', width: 16 }, { id: 'FLAGS', name: 'FLAGS', width: 16 }] },
    ],
    pc: 'pc', // the physical address CS × 16 + IP (EngineState.pc)
    status: { id: 'FLAGS', fields: [
      { name: 'OF', bit: 11 }, { name: 'DF', bit: 10 }, { name: 'IF', bit: 9 }, { name: 'TF', bit: 8 }, { name: 'SF', bit: 7 },
      { name: 'ZF', bit: 6 }, { name: 'AF', bit: 4 }, { name: 'PF', bit: 2 }, { name: 'CF', bit: 0 },
    ] },
  },
  addressSpace: { addressBits: 20, unitBits: 8, wordBytes: 2, endianness: 'little', regions: [
    { name: 'Interrupt vectors', base: 0, size: 0x400, kind: 'ram' },
    { name: 'RAM', base: 0x400, size: 0x100000 - 0x400, kind: 'ram' },
  ] },
  engine: {
    create,
    profiles: [
      { id: 'flat', label: S.profileNames.flat, memory: 'unified', stackTop: 0x20000 },
      { id: 'segmented', label: S.profileNames.segmented, memory: 'unified', stackTop: null },
    ],
  },
  views: [
    { id: 'isa', label: S.viewIsa, icon: 'chip', kind: 'isa' },
    // the BIU and EU drawn from IFUM Fig 4-3's partition, one teaching-model step per click (8086-B4; drawing approved
    // by the author 2026-11-05), or one clock of the BIU and queue model in clock mode (8086-B5, L2, with 0 to 3 wait
    // states; B5-Q3 to Q6 approved 2026-11-05); loaded with its tab (WS-N-011)
    { id: 'biu-eu', label: S.datapath.tab, icon: 'steps', kind: 'bus',
      settings: { key: 'i8biu', defaults: { mode: 'step', wait: '0' }, values: { mode: ['step', 'clock'], wait: ['0', '1', '2', '3'] } },
      load: async () => {
      const { BiuEuView, biuEuInstance } = await import('./ui/biu-eu-view.js');
      return { create: (ctx) => biuEuInstance(new BiuEuView(), ctx) };
    } },
  ],
  exports: { image, trace: (program, { cap }) => trace(program, { cap }), traceJsonLines, traceCsv },
  content: { templates: 'content/i8086/templates/index.json', logo: 'mavilera-logo-8086.svg' },
};
