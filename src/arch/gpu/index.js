// gpu/index.js -- the GPU module on the contract (spec W-D29, contract v8; GPU-1 of docs/research/gpu-npu/roadmaps/
// GPU_DEVELOPMENT_ROADMAP.md; decisions G6, G7, G9): the SIMT core of the Chapter 11 laboratory, a micro-ISA of seven
// instructions on 16-bit words, one program counter, four or eight lanes (the profiles), an active mask and a two-deep
// mask stack. The shell shows the core's scalar registers; the lane registers are hidden there and shown by the module's
// own Lanes panel (contract v8 `panels`). Published as a preview from 1.2.0 (author, 2026-11-04: `available` with
// `preview` in site/architectures.json), before the views of GPU-2 and the release gate of GPU-4.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { CONTRACT_VERSION } from '../contract.js';
import { assemble, disassemble, fields, describe, editor, image, loadImage, scratch, MAX_LANES } from './language.js';
import { create, laneId, LANE_REGISTERS } from './engine.js';
import { trace, traceJsonLines, traceCsv } from './exports.js';
import { GPU_STRINGS as S } from './strings.js';

export const DEFAULT_SOURCE = `; SIMT core, four lanes: the absolute value of each lane's input
; (the first test program of the Chapter 11 laboratory, simt_tests.hex)
        .din  5, -3, 0, -7    ; r1 of lanes 0 to 3 at start (r0 = lane index)
        LDI   r3, 0           ; every lane: r3 <- 0
        IFLT  r1, r3          ; push the mask; lanes with r1 < 0 stay active
        SUB   r2, r3, r1      ;   those lanes: r2 <- 0 - r1
        ELSE                  ; the other lanes of the pushed mask
        ADD   r2, r1, r3      ;   those lanes: r2 <- r1 + 0
        ENDIF                 ; pop: all four lanes active again
        HALT                  ; dout (r2) = 5, 3, 0, 7 after 7 cycles, 4 idle lane-slots
`;

const off = (reason) => ({ enabled: false, reason });
const lane = (l) => ({ id: `lane${l}`, label: S.lanes.lane(l),
  registers: Array.from({ length: LANE_REGISTERS }, (_, k) => ({ id: laneId(l, k), name: `L${l}.r${k}`, width: 32, hidden: true })) });

export const descriptor = {
  contract: CONTRACT_VERSION,
  id: 'gpu',
  name: 'GPU',
  strings: S, // merged over the shell's
  capabilities: {
    ...Object.fromEntries(['assembler', 'backStep', 'breakpoints', 'watchpoints', 'runToCursor', 'share', 'worker', 'exportImage', 'imageImport',
      'exportTrace', 'scratch'].map((k) => [k, true])),
    cLanguage: off('cRiscvOnly'),
    stepOver: off('noCalls'),
    callStack: off('noCalls'),
    dataIO: off('noDataMemory'),
    memoryModel: off('noMemorySystem'),
    cache: off('noMemorySystem'),
    devices: off('noMemorySystem'),
    traps: off('noMemorySystem'),
    compare: off('oneProcessor'),
  },
  language: {
    id: 'asm', extension: '.simt', comment: ';', defaultSource: DEFAULT_SOURCE,
    assemble, disassemble, fields, describe, editor, loadImage, scratch,
  },
  registers: {
    groups: [
      { id: 'core', label: S.registerGroup, registers: [
        { id: 'pc', name: 'PC', width: 4 },
        { id: 'active_mask', name: 'active_mask', width: MAX_LANES },
        { id: 'stack0', name: 'mask stack 0', width: MAX_LANES },
        { id: 'stack1', name: 'mask stack 1', width: MAX_LANES },
        { id: 'cycles', name: 'cycles', width: 16 },
        { id: 'idle_slots', name: 'idle_slots', width: 16 },
        { id: 'busy', name: 'busy', width: 1 },
        { id: 'done', name: 'done', width: 1 },
        { id: 'depth', name: 'stack depth', width: 2, hidden: true }, // MAVILERA's check of decision G7, not a port
        { id: 'lanes', name: 'LANES', width: 4, hidden: true }, // the parameter, for the Lanes panel
      ] },
      ...Array.from({ length: MAX_LANES }, (_, l) => lane(l)),
    ],
    pc: 'pc',
  },
  // the program memory: sixteen 16-bit words, word-addressed (pm_addr is four bits)
  addressSpace: { addressBits: 4, unitBits: 16, wordBytes: 2, endianness: 'little', regions: [{ name: 'Program memory', base: 0, size: 16, kind: 'rom' }] },
  engine: {
    create,
    profiles: [
      { id: 'simt4', label: S.profileNames.simt4, memory: 'unified', stackTop: null },
      { id: 'simt8', label: S.profileNames.simt8, memory: 'unified', stackTop: null },
    ],
  },
  views: [{ id: 'isa', label: S.viewIsa, icon: 'chip', kind: 'isa' }],
  exports: { image, trace: (program, { cap }) => trace(program, { cap }), traceJsonLines, traceCsv },
  panels: [{ id: 'lanes', label: S.lanes.tab, load: async () => {
    const { LanesPanel } = await import('./ui/lanes-panel.js');
    return { create: (ctx) => new LanesPanel(ctx) };
  } }],
  content: { templates: 'content/gpu/templates/index.json', logo: 'mavilera-logo-gpu.svg' }, // v6; lockup of 2026-11-04, for approval
};
