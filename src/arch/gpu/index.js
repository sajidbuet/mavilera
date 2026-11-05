// gpu/index.js -- the GPU module on the contract (spec W-D29, contract v9). Its own instruction set is the RISC-V
// SIMT core of the textbook's GPU laboratory (GPU-2; decisions G14, G16): warps of threads that share one fetch, each
// thread RV32I with 32 registers, an active mask and a four-entry reconvergence stack per warp, the warp-control
// instructions tmc, wspawn, split, join and bar on custom-0, and the identity CSRs. The micro-ISA core of GPU-1
// (seven instructions on 16-bit words, decisions G6, G7) is kept as the variant `microisa` (contract v9, decision G13):
// MAVILERA's introductory core, not a book laboratory; its profiles reload the page in it. Published as a preview from
// 1.2.0 (the micro-ISA then; author, 2026-11-04).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { CONTRACT_VERSION, STOP } from '../contract.js';
import { decodeMnemonic, formatOf, fields as rvFields, INSTRUCTIONS, ABI_NAMES } from '../../isa/encoding.js';
import { assemble, loadImage, image, editor, fieldsWith } from './rvsimt/language.js';
import { disassemble } from './rvsimt/isa.js';
import { create as rvsimtCreate, MACHINES, MAX_LANES, MAX_WARPS, STACK_DEPTH, threadId } from './rvsimt/engine.js';
import { RVSIMT_STRINGS as S } from './rvsimt/strings.js';
import { GPU_STRINGS as M } from './strings.js';
import { create as microCreate } from './engine.js'; // the micro-ISA core (variant microisa): small, so loaded with the module

export const DEFAULT_SOURCE = `# RISC-V SIMT core: two warps of four threads. Each thread writes the absolute value of
# its element: y[i] = |x[i]|. The negative ones take the then-path under split; join reconverges.
        .include "simt.inc"
        .text
_start: li     t0, 2              # two warps
        la     t1, kernel
        wspawn t0, t1             # warp 1 starts at kernel; warp 0 goes on there too
kernel: csrr   t0, THREAD_INDEX   # i, the thread's index in the block (0 to 7)
        slli   t0, t0, 2          # the byte offset of x[i] and y[i]
        lw     t1, x(t0)          # t1 := x[i]
        slt    t2, t1, zero       # p := (x[i] < 0)
        split  t2                 # the threads with p = 1 first
        beqz   t2, 1f             # every active thread agrees here: no divergent branch
        sub    t1, zero, t1       # then: t1 := -x[i]
1:      join                      # first pass: to the other threads; second: reconverge
        sw     t1, y(t0)          # y[i] := |x[i]|
        tmc    zero               # this warp ends
        .data                     # the data memory, from address 0
x:      .word  5, -3, 0, -7, 2, -1, 4, -8
y:      .space 32
`;

const off = (reason) => ({ enabled: false, reason });

/** The encoding fields of a word for the inspector: the warp-control words R-type, the others as RV32I. */
const SHORT = { funct7: 'funct7', rs2: 'rs2', rs1: 'rs1', funct3: 'f3', rd: 'rd', opcode: 'opcode' };
const fields = fieldsWith((word) => {
  const mn = decodeMnemonic(word);
  const fmt = formatOf(mn);
  if (!fmt) return [];
  const shamt = INSTRUCTIONS[mn].syntax === 'rd,rs1,shamt';
  return rvFields(word, fmt).map((f) => {
    const reg = f.name === 'rd' || f.name === 'rs1' || f.name === 'rs2';
    return { name: f.name, bits: f.hi === f.lo ? `${f.hi}` : `${f.hi}:${f.lo}`, value: f.value, short: SHORT[f.name] ?? 'imm',
      meaning: reg ? (shamt && f.name === 'rs2' ? `shamt = ${f.value}` : `x${f.value} (${ABI_NAMES[f.value]})`) : '' };
  });
});

const warpGroup = (w) => ({ id: `warp${w}`, label: S.warpGroup(w), registers: [
  { id: `w${w}_pc`, name: `W${w} PC`, width: 32 },
  { id: `w${w}_mask`, name: `W${w} mask`, width: MAX_LANES },
  { id: `w${w}_state`, name: `W${w} state`, width: 2 },
  { id: `w${w}_depth`, name: `W${w} stack depth`, width: 3 },
  ...Array.from({ length: STACK_DEPTH }, (_, i) => [
    { id: `w${w}_s${i}_kind`, name: `W${w} stack ${i} kind`, width: 2, hidden: true },
    { id: `w${w}_s${i}_mask`, name: `W${w} stack ${i} mask`, width: MAX_LANES, hidden: true },
    { id: `w${w}_s${i}_pc`, name: `W${w} stack ${i} PC`, width: 32, hidden: true },
  ]).flat(),
] });
const threadGroup = (w, l) => ({ id: `w${w}l${l}`, label: S.threadGroup(w, l),
  registers: Array.from({ length: 32 }, (_, k) => ({ id: threadId(w, l, k), name: `W${w}.L${l}.${ABI_NAMES[k]}`, width: 32, hidden: true, zero: k === 0 })) });

/**
 * The analytical models of data-parallel machines (GPU-4): calculators in tabs, independent of the program, so offered
 * with both instruction sets (author, 2026-11-05).
 */
const MODELS_VIEW = { id: 'models', label: S.viewModels, icon: 'analysis', kind: 'compare', load: async () => {
  const { ModelsView, modelsInstance } = await import('./ui/models-view.js');
  return { create: () => modelsInstance(new ModelsView(), STOP) };
} };
/** The way into the CPU + GPU system of the RISC-V Laboratory (GPU-7, decision G30), with both instruction sets. */
const CPU_GPU_VIEW = { id: 'cpu-gpu', label: S.viewCpuGpu, icon: 'chip', kind: 'compare', load: async () => {
  const { CpuGpuLink, cpuGpuInstance } = await import('./ui/cpu-gpu-link.js');
  return { create: () => cpuGpuInstance(new CpuGpuLink(), STOP) };
} };
/** The micro-ISA of GPU-1, as the variant `microisa` (loaded only when one of its profiles is chosen). */
async function microisa() {
  const L = await import('./language.js');
  const { laneId, LANE_REGISTERS } = await import('./engine.js');
  const X = await import('./exports.js');
  const lane = (l) => ({ id: `lane${l}`, label: M.lanes.lane(l),
    registers: Array.from({ length: LANE_REGISTERS }, (_, k) => ({ id: laneId(l, k), name: `L${l}.r${k}`, width: 32, hidden: true })) });
  return {
    strings: M,
    capabilities: {
      ...Object.fromEntries(['exportTrace', 'scratch', 'exportImage', 'imageImport'].map((k) => [k, true])),
      dataIO: off('noDataMemory'),
      exercises: off('noExercises'),
    },
    language: { id: 'asm', extension: '.simt', comment: ';', defaultSource: MICRO_DEFAULT,
      assemble: L.assemble, disassemble: L.disassemble, fields: L.fields, describe: L.describe, editor: L.editor, loadImage: L.loadImage, scratch: L.scratch },
    registers: {
      groups: [
        { id: 'core', label: M.registerGroup, registers: [
          { id: 'pc', name: 'PC', width: 4 },
          { id: 'active_mask', name: 'active_mask', width: L.MAX_LANES },
          { id: 'stack0', name: 'mask stack 0', width: L.MAX_LANES },
          { id: 'stack1', name: 'mask stack 1', width: L.MAX_LANES },
          { id: 'cycles', name: 'cycles', width: 16 },
          { id: 'idle_slots', name: 'idle_slots', width: 16 },
          { id: 'busy', name: 'busy', width: 1 },
          { id: 'done', name: 'done', width: 1 },
          { id: 'depth', name: 'stack depth', width: 2, hidden: true }, // MAVILERA's check of decision G7, not a port
          { id: 'lanes', name: 'LANES', width: 4, hidden: true }, // the parameter, for the Lanes panel
        ] },
        ...Array.from({ length: L.MAX_LANES }, (_, l) => lane(l)),
      ],
      pc: 'pc',
    },
    // the program memory: sixteen 16-bit words, word-addressed (pm_addr is four bits)
    addressSpace: { addressBits: 4, unitBits: 16, wordBytes: 2, endianness: 'little', regions: [{ name: 'Program memory', base: 0, size: 16, kind: 'rom' }] },
    views: [
      { id: 'isa', label: M.viewIsa, icon: 'chip', kind: 'isa' },
      // the mask grid of each machine (GPU-3, decision G23: no core drawing); loaded with its tab
      ...[['masks', 'simt4', 4, M.viewMasks4], ['masks8', 'simt8', 8, M.viewMasks8]].map(([id, profile, lanes, label]) => ({ id, label, icon: 'steps', kind: 'datapath', profile,
        load: async () => {
          const { MaskView, maskInstance } = await import('./ui/mask-view.js');
          return { create: () => maskInstance(new MaskView(lanes)) };
        } })),
      MODELS_VIEW,
      CPU_GPU_VIEW,
    ],
    exports: { image: L.image, trace: (program, { cap }) => X.trace(program, { cap }), traceJsonLines: X.traceJsonLines, traceCsv: X.traceCsv,
      golden: (model) => model.golden() },
    panels: [{ id: 'lanes', label: M.lanes.tab, load: async () => {
      const { LanesPanel } = await import('./ui/lanes-panel.js');
      return { create: (ctx) => new LanesPanel(ctx) };
    } }],
    content: { templates: 'content/gpu/templates/index.json' },
  };
}

const MICRO_DEFAULT = `; SIMT core, four lanes: the absolute value of each lane's input
        .din  5, -3, 0, -7    ; r1 of lanes 0 to 3 at start (r0 = lane index)
        LDI   r3, 0           ; every lane: r3 <- 0
        IFLT  r1, r3          ; push the mask; lanes with r1 < 0 stay active
        SUB   r2, r3, r1      ;   those lanes: r2 <- 0 - r1
        ELSE                  ; the other lanes of the pushed mask
        ADD   r2, r1, r3      ;   those lanes: r2 <- r1 + 0
        ENDIF                 ; pop: all four lanes active again
        HALT                  ; dout (r2) = 5, 3, 0, 7 after 7 cycles, 4 idle lane-slots
`;

export const descriptor = {
  contract: CONTRACT_VERSION,
  id: 'gpu',
  name: 'GPU',
  strings: S, // merged over the shell's
  capabilities: {
    ...Object.fromEntries(['assembler', 'backStep', 'breakpoints', 'watchpoints', 'runToCursor', 'share', 'worker', 'exportImage',
      'imageImport', 'exportGolden', 'waveform', 'exercises'].map((k) => [k, true])),
    cLanguage: off('cRiscvOnly'),
    stepOver: off('noCalls'),
    callStack: off('noCalls'),
    dataIO: off('notYet'),
    exportTrace: off('notYet'),
    scratch: off('notYet'),
    memoryModel: off('noMemorySystem'),
    cache: off('noMemorySystem'),
    devices: off('noMemorySystem'),
    traps: off('noMemorySystem'),
    compare: true, // the Models view (GPU-4) is a full-width view of kind compare: nothing to step, it ignores the program
  },
  language: { id: 'asm', extension: '.s', comment: '#', defaultSource: DEFAULT_SOURCE, assemble, disassemble, fields, editor, loadImage,
    disassembly: { names: ['abi', 'numeric'] } },
  registers: {
    groups: [
      { id: 'core', label: S.registerGroup, registers: [
        { id: 'pc', name: 'PC (next)', width: 32 },
        { id: 'next_warp', name: 'next warp', width: 3 },
        { id: 'cycles', name: 'cycles', width: 32 },
        { id: 'issued', name: 'issued', width: 32 },
        { id: 'active_slots', name: 'active_slots', width: 32 },
        { id: 'done', name: 'done', width: 1 },
        { id: 'fault', name: 'fault', width: 1 },
        { id: 'fault_code', name: 'fault_code', width: 4 },
        { id: 'lanes', name: 'LANES', width: 4, hidden: true },
        { id: 'warps', name: 'WARPS', width: 3, hidden: true },
      ] },
      ...Array.from({ length: MAX_WARPS }, (_, w) => warpGroup(w)),
      ...Array.from({ length: MAX_WARPS }, (_, w) => Array.from({ length: MAX_LANES }, (__, l) => threadGroup(w, l))).flat(),
    ],
    pc: 'pc',
  },
  // the data memory (256 words from address 0); the instruction memory (64 words, also from 0) is the listing's
  addressSpace: { addressBits: 32, unitBits: 8, wordBytes: 4, endianness: 'little', regions: [{ name: 'Data memory', base: 0, size: 1024, kind: 'ram' }] },
  engine: {
    // the RISC-V SIMT core for its profiles (the Program names one), the micro-ISA core for the others
    create: (program, options) => (MACHINES[program.profile] ? rvsimtCreate : microCreate)(program, options),
    profiles: [
      { id: 'lab', label: S.profileNames.lab, memory: 'harvard', stackTop: null },
      { id: 'lab-l8', label: S.profileNames['lab-l8'], memory: 'harvard', stackTop: null },
      { id: 'simt4', label: M.profileNames.simt4, memory: 'unified', stackTop: null, variant: 'microisa' },
      { id: 'simt8', label: M.profileNames.simt8, memory: 'unified', stackTop: null, variant: 'microisa' },
    ],
  },
  variants: { microisa: { label: 'Micro-ISA', legacy: true, load: microisa } },
  views: [
    { id: 'isa', label: S.viewIsa, icon: 'chip', kind: 'isa' },
    // the laboratory core drawn (GPU-3): one view per machine, since a view fixes its profile; loaded with its tab
    ...[['core', 'lab', 4, S.viewCore], ['core8', 'lab-l8', 8, S.viewCore8]].map(([id, profile, lanes, label]) => ({ id, label, icon: 'steps', kind: 'datapath', profile,
      load: async () => {
        const { CoreView, coreInstance, loadCoreContent } = await import('./rvsimt/ui/core-view.js');
        const content = await loadCoreContent(new URL('../../../', import.meta.url));
        return { create: (ctx) => coreInstance(new CoreView(content, lanes), ctx) };
      } })),
    MODELS_VIEW,
    CPU_GPU_VIEW,
  ],
  exports: { image, golden: (model) => model.golden() },
  // practice exercises of the SIMT core (GPU-4; WS-F-148), loaded with the first exercise (WS-N-011)
  exercises: {
    parse: async (raw) => (await import('./rvsimt/exercise.js')).parseExercise(raw),
    run: async (program, exercise) => (await import('./rvsimt/exercise.js')).runExercise(program, exercise),
  },
  panels: [{ id: 'threads', label: S.threads.tab, load: async () => {
    const { ThreadsPanel } = await import('./rvsimt/threads-panel.js');
    return { create: (ctx) => new ThreadsPanel(ctx) };
  } }],
  content: { templates: 'content/gpu/rvsimt/templates/index.json', logo: 'mavilera-logo-gpu.svg', // v6; lockup approved 2026-11-04
    help: 'content/gpu/help/help.json', exercises: 'content/gpu/rvsimt/exercises/index.json',
    docs: 'content/gpu/help/docs/index.html' }, // GPU-5 (decision G31): the full documentation // GPU-4; the documentation page comes with the release (GPU-5)
};
