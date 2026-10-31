// sap-1/index.js -- SAP-1, the simple-as-possible computer, on the contract (spec W-D29; arch-contract.md phase 5):
// the second architecture, built to prove the contract. Five instructions (LDA, ADD, SUB, OUT, HLT; author,
// 2026-10-29), sixteen bytes of memory, 4-bit addresses, registers A, B, OUT, PC, IR and MAR. The shell reads this and
// nothing else about SAP-1; what SAP-1 does not have is disabled with a reason.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { CONTRACT_VERSION } from '../contract.js';
import { assembleWithData, disassemble, fields, describe, editor, image, loadImage, scratch } from './language.js';
import { create } from './engine.js';
import { trace, traceJsonLines, traceCsv, golden } from './exports.js';
import { SAP1_STRINGS as S } from './strings.js';

export const DEFAULT_SOURCE = `; SAP-1: add two numbers, subtract a third and show the result
        LDA first     ; A <- M[first]
        ADD second    ; A <- A + M[second]
        SUB third     ; A <- A - M[third]
        OUT           ; OUT <- A
        HLT           ; stop the clock

        ORG 0DH       ; the data at the end of the memory
first:  DB 28
second: DB 17
third:  DB 5
`;

const off = (reason) => ({ enabled: false, reason });

export const descriptor = {
  contract: CONTRACT_VERSION,
  id: 'sap-1',
  name: 'SAP-1',
  strings: S, // merged over the shell's
  capabilities: {
    ...Object.fromEntries(['assembler', 'backStep', 'breakpoints', 'watchpoints', 'runToCursor', 'share', 'worker', 'exportImage', 'imageImport', 'exportTrace', 'waveform',
      'scratch', 'dataIO', 'exportGolden', 'exercises'].map((k) => [k, true])),
    cLanguage: off('cRiscvOnly'),
    stepOver: off('noCalls'),
    callStack: off('noCalls'),
    memoryModel: off('noMemorySystem'),
    cache: off('noMemorySystem'),
    devices: off('noMemorySystem'),
    traps: off('noMemorySystem'),
    compare: off('oneProcessor'),
  },
  language: {
    id: 'asm', extension: '.asm', comment: ';', defaultSource: DEFAULT_SOURCE,
    assemble: assembleWithData, disassemble, fields, describe, editor, loadImage, scratch,
  },
  registers: {
    groups: [{ id: 'cpu', label: S.registerGroup, registers: [
      { id: 'A', name: 'A', width: 8 },
      { id: 'B', name: 'B', width: 8 },
      { id: 'OUT', name: 'OUT', width: 8 },
      { id: 'PC', name: 'PC', width: 4 },
      { id: 'IR', name: 'IR', width: 8, hidden: true },
      { id: 'MAR', name: 'MAR', width: 4, hidden: true },
    ] }],
    pc: 'PC',
  },
  addressSpace: { addressBits: 4, unitBits: 8, wordBytes: 1, endianness: 'little', regions: [{ name: 'RAM', base: 0, size: 16, kind: 'ram' }] },
  engine: {
    create,
    profiles: [{ id: 'sap1', label: S.profileNames.sap1, memory: 'unified', stackTop: null }],
  },
  views: [
    { id: 'isa', label: S.viewIsa, icon: 'chip', kind: 'isa' },
    // one clock per timing state; loaded with its tab (WS-N-011)
    { id: 'bus', label: S.viewBus, icon: 'steps', kind: 'bus', profile: 'sap1', load: async () => {
      const { BusView, busInstance } = await import('./ui/bus-view.js');
      return { create: (ctx) => busInstance(new BusView(), ctx) };
    } },
  ],
  exports: { image, trace: (program, { cap }) => trace(program, { cap }), traceJsonLines, traceCsv, golden },
  // exercise files (WS-F-148): the module is loaded with the first exercise (WS-N-011)
  exercises: {
    parse: async (raw) => (await import('./exercise.js')).parseExercise(raw),
    run: async (program, exercise) => (await import('./exercise.js')).runExercise(program, exercise),
  },
  content: { templates: 'content/sap-1/templates/index.json', exercises: 'content/sap-1/exercises/index.json', logo: 'mavilera-logo-sap-1.svg', // v6
    help: 'content/sap-1/help/help.json', docs: 'content/sap-1/help/docs/index.html' },
};
