// armv7/index.js -- ARMv7 (the A32 subset of Harris and Harris's ARM edition) on the contract (spec W-D29; roadmap
// milestone ARM-A1, decisions W-D32 and W-D33): the instruction-level profile `arm-iss`, which runs tiers H, E and I of
// the reference sheet (docs/architecture/armv7-reference.md §1) with DDI 0406C.d semantics. Registers R0-R15 (R15 the
// PC) and the CPSR flags N, Z, C, V; 32-bit byte-addressed little-endian memory. The processor views and their
// profiles (arm-single, arm-multi, arm-pipe) come with ARM-A2 to ARM-A4. The shell reads this and nothing else about
// ARMv7; what it does not have is disabled with a reason.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { CONTRACT_VERSION } from '../contract.js';
import { assembleWithData, disassemble, fields, describe, editor, image, loadImage, scratch, STACK_TOP } from './language.js';
import { create } from './engine.js';
import { trace, traceJsonLines, traceCsv } from './exports.js';
import { ARMV7_STRINGS as S } from './strings.js';

export const DEFAULT_SOURCE = `; ARMv7: add the numbers 1 to 10 and store the sum in memory
        MOV  R0, #0          ; R0 <- 0, the sum
        MOV  R1, #1          ; R1 <- 1, the next number
loop:   ADD  R0, R0, R1      ; sum <- sum + number
        ADD  R1, R1, #1      ; the next number
        CMP  R1, #10         ; flags of R1 - 10
        BLE  loop            ; again while R1 <= 10 (signed)
        STR  R0, [R2, #100]  ; M[R2 + 100] <- 55 (R2 is 0)
done:   B    done            ; a branch to itself ends the program
`;

const off = (reason) => ({ enabled: false, reason });

export const descriptor = {
  contract: CONTRACT_VERSION,
  id: 'armv7',
  name: 'ARMv7',
  strings: S, // merged over the shell's
  capabilities: {
    ...Object.fromEntries(['assembler', 'backStep', 'breakpoints', 'watchpoints', 'stepOver', 'callStack', 'runToCursor', 'share', 'worker',
      'exportImage', 'imageImport', 'exportTrace', 'scratch', 'dataIO'].map((k) => [k, true])),
    cLanguage: off('cRiscvOnly'),
    gccImport: off('gccRiscvOnly'),
    uninitCheck: off('noUninit'),
    memoryModel: off('noMemorySystem'),
    cache: off('noMemorySystem'),
    devices: off('noMemorySystem'),
    traps: off('noMemorySystem'),
    compare: off('oneProcessor'),
    waveform: true,
    exportGolden: off('noGolden'),
    exercises: true, // practice exercises, run on the instruction-level engine (WS-F-148; roadmap ARM-A6)
  },
  language: {
    id: 'asm', extension: '.s', comment: ';', defaultSource: DEFAULT_SOURCE,
    assemble: assembleWithData, disassemble: (word, address) => disassemble(word, address), fields, describe, editor, loadImage, scratch,
  },
  registers: {
    groups: [
      { id: 'cpu', label: S.registerGroup, registers: Array.from({ length: 16 }, (_, i) => ({
        id: `r${i}`, name: `R${i}`, width: 32, ...(i >= 13 ? { aliases: [['SP', 'LR', 'PC'][i - 13]] } : {}),
      })) },
      { id: 'cpsr', label: S.flagGroup, registers: ['N', 'Z', 'C', 'V'].map((f) => ({ id: f, name: f, width: 1 })) },
    ],
    pc: 'r15',
    roles: { sp: 'r13' },
  },
  addressSpace: { addressBits: 32, unitBits: 8, wordBytes: 4, endianness: 'little', regions: [{ name: 'Memory', base: 0, size: 2 ** 32, kind: 'ram' }] },
  engine: {
    create,
    profiles: [{ id: 'arm-iss', label: S.profileNames['arm-iss'], memory: 'sparse', stackTop: STACK_TOP },
      { id: 'arm-single', label: S.profileNames['arm-single'], memory: 'harvard', stackTop: STACK_TOP,
        // W-D32 C5 ruling: the base design first; the Extended datapath only when chosen (W-D35)
        subsets: Object.entries(S.singleView.subsets).map(([id, label]) => ({ id, label })) },
      // the multicycle processor (roadmap ARM-A3): one memory for instructions and data; the base design first, the
      // Extended datapath only when chosen (W-D32 C5 ruling; A3-Q10)
      { id: 'arm-multi', label: S.profileNames['arm-multi'], memory: 'sparse', stackTop: STACK_TOP,
        subsets: Object.entries(S.singleView.subsets).map(([id, label]) => ({ id, label })) },
      // the pipelined processor (roadmap ARM-A4): instruction and data memories, as the single-cycle processor; the base
      // design first, the Extended datapath only when chosen (W-D32 C5 ruling; A4-Q9)
      { id: 'arm-pipe', label: S.profileNames['arm-pipe'], memory: 'harvard', stackTop: STACK_TOP,
        subsets: Object.entries(S.singleView.subsets).map(([id, label]) => ({ id, label })) }],
  },
  views: [
    { id: 'isa', label: S.viewIsa, icon: 'chip', kind: 'isa' },
    // the single-cycle processor, the base design of Harris and Harris (roadmap ARM-A2); loaded with its tab (WS-N-011)
    { id: 'single', label: S.viewSingle, icon: 'clock', kind: 'datapath', profile: 'arm-single', subsets: true, load: async () => {
      const { ArmSingleView, armSingleInstance, loadArmSingleContent } = await import('./ui/single-view.js');
      const content = await loadArmSingleContent(new URL('../../../', import.meta.url));
      return { create: (ctx) => armSingleInstance(new ArmSingleView(content), ctx) };
    } },
    // the multicycle processor, the base design and the Extended variant (roadmap ARM-A3; drawings approved A3-Q2, A3-Q10);
    // loaded with its tab
    { id: 'multi', label: S.viewMulti, icon: 'steps', kind: 'datapath', profile: 'arm-multi', subsets: true, load: async () => {
      const { ArmMultiView, armMultiInstance, loadArmMultiContent } = await import('./ui/multi-view.js');
      const content = await loadArmMultiContent(new URL('../../../', import.meta.url));
      return { create: (ctx) => armMultiInstance(new ArmMultiView(content, { onGoTo: () => ctx.refresh?.(),
        onStepInstr: () => ctx.command?.('stepUnit'), onBackInstr: () => ctx.command?.('backUnit') }), ctx) };
    } },
    // the pipelined processor with full hazard handling, the base design (roadmap ARM-A4; drawing approved A4-Q4); loaded
    // with its tab
    { id: 'pipe', label: S.viewPipe, icon: 'pipeline', kind: 'datapath', profile: 'arm-pipe', subsets: true,
      settings: { key: 'armpipe', defaults: { hazard: 'full' }, values: { hazard: ['full', 'forward', 'none'] } }, load: async () => {
      const { ArmPipeView, armPipeInstance, loadArmPipeContent } = await import('./ui/pipe-view.js');
      const content = await loadArmPipeContent(new URL('../../../', import.meta.url));
      return { create: (ctx) => armPipeInstance(new ArmPipeView(content, { onGoTo: () => ctx.refresh?.() }), ctx) };
    } },
  ],
  exports: { image, trace: (program, { cap }) => trace(program, { cap }), traceJsonLines, traceCsv },
  // exercise files (WS-F-148; roadmap ARM-A6): the module is loaded with the first exercise (WS-N-011)
  exercises: {
    parse: async (raw) => (await import('./exercise.js')).parseExercise(raw),
    run: async (program, exercise) => (await import('./exercise.js')).runExercise(program, exercise),
  },
  // v6: the header lockup and the in-app help (W-D35)
  content: { templates: 'content/armv7/templates/index.json', exercises: 'content/armv7/exercises/index.json', logo: 'mavilera-logo-armv7.svg',
    help: 'content/armv7/help/help.json', docs: 'content/armv7/help/docs/index.html' }, // docs: ARM-A6
};
