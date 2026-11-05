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
 strings: S,
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
 exercises: true,
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
 subsets: Object.entries(S.singleView.subsets).map(([id, label]) => ({ id, label })) },
 { id: 'arm-multi', label: S.profileNames['arm-multi'], memory: 'sparse', stackTop: STACK_TOP,
 subsets: Object.entries(S.singleView.subsets).map(([id, label]) => ({ id, label })) },
 { id: 'arm-pipe', label: S.profileNames['arm-pipe'], memory: 'harvard', stackTop: STACK_TOP,
 subsets: Object.entries(S.singleView.subsets).map(([id, label]) => ({ id, label })) }],
 },
 views: [
 { id: 'isa', label: S.viewIsa, icon: 'chip', kind: 'isa' },
 { id: 'single', label: S.viewSingle, icon: 'clock', kind: 'datapath', profile: 'arm-single', subsets: true, load: async () => {
 const { ArmSingleView, armSingleInstance, loadArmSingleContent } = await import('./ui/single-view.js');
 const content = await loadArmSingleContent(new URL('../../../', import.meta.url));
 return { create: (ctx) => armSingleInstance(new ArmSingleView(content), ctx) };
 } },
 { id: 'multi', label: S.viewMulti, icon: 'steps', kind: 'datapath', profile: 'arm-multi', subsets: true, load: async () => {
 const { ArmMultiView, armMultiInstance, loadArmMultiContent } = await import('./ui/multi-view.js');
 const content = await loadArmMultiContent(new URL('../../../', import.meta.url));
 return { create: (ctx) => armMultiInstance(new ArmMultiView(content, { onGoTo: () => ctx.refresh?.(),
 onStepInstr: () => ctx.command?.('stepUnit'), onBackInstr: () => ctx.command?.('backUnit') }), ctx) };
 } },
 { id: 'pipe', label: S.viewPipe, icon: 'pipeline', kind: 'datapath', profile: 'arm-pipe', subsets: true,
 settings: { key: 'armpipe', defaults: { hazard: 'full' }, values: { hazard: ['full', 'forward', 'none'] } }, load: async () => {
 const { ArmPipeView, armPipeInstance, loadArmPipeContent } = await import('./ui/pipe-view.js');
 const content = await loadArmPipeContent(new URL('../../../', import.meta.url));
 return { create: (ctx) => armPipeInstance(new ArmPipeView(content, { onGoTo: () => ctx.refresh?.() }), ctx) };
 } },
 ],
 exports: { image, trace: (program, { cap }) => trace(program, { cap }), traceJsonLines, traceCsv },
 exercises: {
 parse: async (raw) => (await import('./exercise.js')).parseExercise(raw),
 run: async (program, exercise) => (await import('./exercise.js')).runExercise(program, exercise),
 },
 content: { templates: 'content/armv7/templates/index.json', exercises: 'content/armv7/exercises/index.json', logo: 'mavilera-logo-armv7.svg',
 help: 'content/armv7/help/help.json', docs: 'content/armv7/help/docs/index.html' },
};
