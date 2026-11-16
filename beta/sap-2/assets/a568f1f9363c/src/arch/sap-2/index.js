// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { CONTRACT_VERSION } from '../contract.js';
import { assembleWithData, disassemble, fields, describe, editor, image, loadImage, scratch } from './language.js';
import { create, ROM_BYTES } from './engine.js';
import { trace, traceJsonLines, traceCsv, golden } from './exports.js';
import { SAP2_STRINGS as S } from './strings.js';
export const DEFAULT_SOURCE = `; SAP-2: count down from 5 on the hexadecimal display (output port 3)
        MVI C,05H     ; C <- 5, the count
loop:   MOV A,C       ; A <- C
        OUT 03H       ; port 3 <- A: the display, and a console line
        DCR C         ; C <- C - 1; Z = 1 when it reaches 0
        JNZ loop      ; again until C is 0
        HLT           ; stop
`;
const off = (reason) => ({ enabled: false, reason });
export const descriptor = {
 contract: CONTRACT_VERSION,
 id: 'sap-2',
 name: 'SAP-2',
 strings: S,
 capabilities: {
 ...Object.fromEntries(['assembler', 'backStep', 'breakpoints', 'watchpoints', 'stepOver', 'callStack', 'runToCursor', 'share', 'worker',
 'exportImage', 'imageImport', 'exportTrace', 'scratch', 'dataIO', 'exercises', 'waveform', 'exportGolden'].map((k) => [k, true])),
 cLanguage: off('cRiscvOnly'),
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
 groups: [
 { id: 'cpu', label: S.registerGroup, registers: [
 { id: 'A', name: 'A', width: 8 },
 { id: 'B', name: 'B', width: 8 },
 { id: 'C', name: 'C', width: 8 },
 { id: 'PC', name: 'PC', width: 16 },
 { id: 'IR', name: 'IR', width: 8, hidden: true },
 ] },
 { id: 'flags', label: S.flagGroup, registers: [
 { id: 'S', name: 'S', width: 1 },
 { id: 'Z', name: 'Z', width: 1 },
 ] },
 { id: 'ports', label: S.portGroup, registers: [
 { id: 'IN1', name: 'IN1', width: 8 },
 { id: 'IN2', name: 'IN2', width: 8 },
 { id: 'OUT3', name: 'OUT3', width: 8 },
 { id: 'OUT4', name: 'OUT4', width: 8 },
 ] },
 ],
 pc: 'PC',
 },
 addressSpace: { addressBits: 16, unitBits: 8, wordBytes: 1, endianness: 'little', regions: [
 { name: 'ROM', base: 0, size: ROM_BYTES, kind: 'rom' },
 { name: 'RAM', base: ROM_BYTES, size: 0x10000 - ROM_BYTES, kind: 'ram' },
 ] },
 engine: {
 create,
 profiles: [{ id: 'sap2', label: S.profileNames.sap2, memory: 'unified', stackTop: null }],
 },
 views: [
 { id: 'isa', label: S.viewIsa, icon: 'chip', kind: 'isa' },
 { id: 'bus', label: S.viewBus, icon: 'steps', kind: 'bus', profile: 'sap2', load: async () => {
 const { BusView, busInstance } = await import('./ui/bus-view.js');
 return { create: (ctx) => busInstance(new BusView(), ctx) };
 } },
 ],
 exports: { image, trace: (program, { cap, inputs }) => trace(program, { cap, inputs }), traceJsonLines, traceCsv, golden },
 exercises: {
 parse: async (raw) => (await import('./exercise.js')).parseExercise(raw),
 run: async (program, exercise) => (await import('./exercise.js')).runExercise(program, exercise),
 },
 panels: [{ id: 'ports', label: S.ports.tab, load: async () => {
 const { PortsPanel } = await import('./ui/ports-panel.js');
 return { create: (ctx) => new PortsPanel(ctx) };
 } }],
 content: { templates: 'content/sap-2/templates/index.json', exercises: 'content/sap-2/exercises/index.json', logo: 'mavilera-logo-sap-2.svg',
 help: 'content/sap-2/help/help.json', docs: 'content/sap-2/help/docs/index.html' },
};
