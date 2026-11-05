// riscv/index.js -- the RISC-V architecture on the contract (spec W-D29; docs/architecture/arch-contract.md
// phase 2): a descriptor that wraps the existing modules (assembler, disassembler, encoding tables, Session and
// Hart, the C compiler, the three processor views) without changing them. The shell reads this and nothing else
// about RISC-V once phase 3 is done.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { CONTRACT_VERSION, STOP as CONTRACT_STOP } from '../contract.js';
import { GPU_BASE } from '../../mem/gpu.js'; // the GPU device of the CPU + GPU tool (GPU-7): loading it provides it to the platform
import { assemble as rvAssemble, usage, hexImage } from '../../asm/assembler.js';
import { disassemble, disassembleAlias, readWords } from '../../asm/disassembler.js';
import { ABI_NAMES, INSTRUCTIONS, HALT_WORD, CLASSES, decodeMnemonic, formatOf, fields as rvFields } from '../../isa/encoding.js';
import { Session, STOP } from '../../core/session.js';
import { TRAP } from '../../core/iss.js';
import { causeText, M_MODE } from '../../core/priv.js';
import { PROFILES } from '../../core/profiles.js';
import { applyLoads } from '../../shell/data-io.js';
import { callStack } from '../../core/callstack.js';
import { dataAccessOf } from '../../ui/mem-viewmodel.js';
import { STRINGS } from '../../ui/strings.js';
import { RISCV_STRINGS as RV } from './strings.js';
import { scratch as rvScratch } from '../../asm/scratch.js';
import { goldenText, traceRecords, traceJsonLines, traceCsv } from '../../core/exports.js';
import { DEFAULT_SOURCE } from './default-source.js';
import { immediateSteps } from './immediate.js';
import { editor } from './editor.js';
import { labRows, labDiagnostics } from './lab-rows.js';

/** The application's root, for the views' content files. */
const BASE = new URL('../../../', import.meta.url);

// The session's stop reasons are the contract's (one set, W-D29 decision 3); checked once here.
for (const [k, v] of Object.entries(CONTRACT_STOP)) if (STOP[k] !== v) throw new Error(`STOP.${k} differs from the contract`);

const REG_IDS = ABI_NAMES.map((_, i) => `x${i}`);

/**
 * The assembler's program with the contract's fields added (`diagnostics`, `size` and `text` of each row; v2: `ok`
 * false with a profile error, `data`, `loadReport`; v3: each diagnostic's `length` and `note`, the hint line). The
 * assembler's own `ok` stays as `assembled`.
 */
function assemble(files, { profile = 'iss', subset, data } = {}) {
  const p = rvAssemble(files, { profile, ...(subset ? { subset } : {}) });
  const at = (e) => ({ severity: 'error', file: e.file, line: e.line, column: e.column, ...(e.length !== undefined ? { length: e.length } : {}) });
  const note = (text) => (text ? { note: text } : {});
  p.diagnostics = [
    ...p.errors.map((e) => ({ ...at(e), message: e.message, ...note(RV.hints[e.hint]?.(e, e.mnemonic ? usage(e.mnemonic) : null)) })),
    ...p.profileErrors.map((e) => ({ ...at(e), kind: 'profile', message: e.chapter ? RV.profileError(e.mnemonic, e.chapter) : RV.profileIss(e.mnemonic),
      ...note(RV.profileHint(e.chapter)) })),
  ];
  for (const row of p.listing) { row.size = 4; row.text ??= ''; }
  if (data) p.loadReport = applyLoads(p, data);
  p.data = p.dataListing;
  p.assembled = p.ok;
  p.ok = p.ok && p.profileErrors.length === 0;
  p.symbols = Object.fromEntries(p.symbols); // the contract's symbols are a plain record
  p.files = files; // the comparison assembles them for each processor
  p.subset = subset ?? null; // the single-cycle view shows it
  return p;
}

/** Encoding fields for the inspector (W-D29 decision 1). */
const SHORT = { funct7: 'funct7', rs2: 'rs2', rs1: 'rs1', funct3: 'f3', rd: 'rd', opcode: 'opcode' };
function fields(word) {
  const mn = decodeMnemonic(word);
  const fmt = formatOf(mn);
  if (!fmt) return [];
  const shamt = INSTRUCTIONS[mn].syntax === 'rd,rs1,shamt';
  return rvFields(word, fmt).map((f) => {
    const reg = f.name === 'rd' || f.name === 'rs1' || f.name === 'rs2';
    return { name: f.name, bits: f.hi === f.lo ? `${f.hi}` : `${f.hi}:${f.lo}`, value: f.value, short: SHORT[f.name] ?? 'imm',
      meaning: reg ? (shamt && f.name === 'rs2' ? `shamt = ${f.value}` : `x${f.value} (${ABI_NAMES[f.value]})`) : '' };
  });
}

/** The format name and the immediate of a word, for the listing's word tooltip (contract v2). */
function describe(word) {
  const fmt = formatOf(decodeMnemonic(word));
  if (!fmt) return null;
  return { kind: RV.formatName(fmt), immediate: immediateSteps(word, fmt)?.[1] ?? null };
}

/** The warnings of the uninitialised-value check shown after a reset (WS-F-147); one more says that there are more. */
const UNINIT_SHOWN = 20;

/** Bytes read without side effects, as a little-endian number. */
function peekWord(mem, address, size) {
  let v = 0;
  for (let i = size - 1; i >= 0; i--) v = v * 256 + mem.readByte((address + i) >>> 0);
  return v >>> 0;
}

const hex = (v, n = 8) => `0x${(v >>> 0).toString(16).padStart(n, '0')}`;

/**
 * The processor's privileged state for the board (v5 Engine.platform, profile iss-priv): the table's rows, the mode as
 * the board names it, and the trap check's findings when it is on (null when off).
 */
function privileged(h) {
  const ps = h.priv;
  const C = RV.platform.cpu;
  const mode = ps.mode === M_MODE ? C.modeM : C.modeU;
  const last = h.traps ? `${causeText(ps.mcause)} (${hex(ps.mcause)}) at ${hex(ps.mepc)}` : C.none;
  const rows = [
    [C.mode, mode], [C.cycle, h.cycle], [C.retired, h.instret], [C.traps, h.traps], [C.idle, h.idleCycles],
    [C.mie, ps.mstatus & 8 ? C.on : C.off], [C.mpie, ps.mstatus & 0x80 ? C.on : C.off],
    [C.enabled, hex(ps.mie)], [C.pending, hex(ps.mip())],
    [C.mtvec, `${hex(ps.mtvec)} (${ps.mtvec & 1 ? C.vectored : C.direct})`], [C.mepc, hex(ps.mepc)], [C.mcause, hex(ps.mcause)], [C.mtval, hex(ps.mtval)],
    [C.last, last],
  ].map(([k, v]) => [k, String(v)]);
  return { rows, mode, violations: ps.trapCheck ? [...ps.violations] : null };
}

/** The instruction-level engine: a Session (history, budget, breakpoints) around a Hart, for one program. */
function create(program, { historyLimit, runLimit, platformConfig } = {}) {
  const s = new Session({ ...(historyLimit ? { historyLimit } : {}), ...(runLimit ? { runLimit } : {}) });
  s.profile = program.profile ?? 'iss';
  s.program = program;
  if (platformConfig) s.platformConfig = platformConfig;
  s.reset();
  const regs = () => Object.fromEntries(REG_IDS.map((id, i) => [id, s.hart ? s.hart.x[i] : 0]));
  // in slices: one call with a million arguments exceeds the engine's limit
  const text = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.slice(i, i + 8192));
    return s;
  };
  return {
    reset: () => s.reset(),
    state: () => {
      const h = s.hart;
      // iss-priv and ch11: the console shows what the UART sent
      return { pc: h ? h.pc : program.entry, registers: regs(), halted: s.halted, error: s.error, retired: h ? h.instret : 0,
        exitCode: h ? h.exitCode : null, output: h ? text(h.platform ? h.platform.uart?.tx ?? [] : h.output) : '',
        outputDropped: h && !h.platform ? h.outputDropped : 0,
        historyDropped: s.history.dropped, steps: s.runCount };
    },
    last: () => {
      const t = s.last;
      const h = s.hart;
      if (!t || !h) return null;
      return {
        pc: t.pc, word: peekWord(h.imem ?? h.mem, t.pc, 4), size: 4, nextPc: h.pc,
        registers: t.rd ? [{ id: REG_IDS[t.rd], old: t.regOld, value: h.x[t.rd] }] : [],
        memory: t.memSize ? [{ address: t.memAddr, size: t.memSize, old: t.memOld, value: peekWord(h.mem, t.memAddr, t.memSize) }] : [],
      };
    },
    callDepth: () => s.callDepth(),
    stepOverTarget: () => s.stepOverTarget(),
    stepOutTarget: () => s.stepOutTarget(),
    loopRange: () => s.loopRange(),
    diagnostics: () => {
      const h = s.hart;
      if (!h) return [];
      const uninit = h.uninitSoFar.slice(0, UNINIT_SHOWN + 1).map((u, i) => (i < UNINIT_SHOWN
        ? { kind: 'uninit', message: RV.uninit(u.text), pc: u.pc, at: u.count, ...(i === 0 ? { note: RV.uninitNote } : {}) }
        : { kind: 'uninit', message: RV.uninitMore, at: u.count }));
      return [
        ...h.abiViolations.map((v) => ({ kind: 'abi', message: RV.abiViolation(v) })),
        ...(h.priv ? h.priv.violations.map((v) => ({ kind: 'trap', message: STRINGS.platform.trapViolation(v) })) : []), // rvsim.py --trap-check
        ...labDiagnostics(h.platform), // decision G5: a RESULT read while the NPU is busy
        ...uninit,
      ];
    },
    counters: () => {
      const h = s.hart;
      if (!h) return [];
      const rep = h.report();
      return [[STRINGS.instructions, rep.instructions],
        ...CLASSES.filter((c) => rep.by_class[c] || ['alu', 'load', 'store', 'branch_taken', 'branch_not_taken', 'jump'].includes(c))
          .map((c) => [RV.classes[c], rep.by_class[c]]),
        [RV.stackUse, rep.stack_bytes],
        ...(rep.priv ? [[RV.platform.cpu.cycle, rep.priv.cycles], [RV.platform.cpu.traps, h.traps]] : h.platform ? [[RV.platform.cpu.cycle, h.cycle]] : []),
        ...labRows(h.platform)]; // the Chapter 11 laboratory measurement (NPU-2)
    },
    callStack: () => (s.hart ? callStack(s.hart, program).map((f) => ({ ...f, args: f.args.map((value, k) => ({ name: `a${k}`, value })) })) : []),
    dataAccess: () => {
      const h = s.hart;
      if (!h || h.halted) return null;
      const a = dataAccessOf(h.mem.read(h.pc, 4), h.x);
      return a ? { address: a.addr, size: a.size } : null;
    },
    step: () => {
      if (s.halted) return null;
      const h = s.hart;
      const pc = h.pc;
      const before = s.runCount;
      const stop = s.step();
      if (stop === STOP.ERROR) return null;
      if (s.runCount === before) return { pc, word: HALT_WORD, size: 4, nextPc: pc, registers: [], memory: [], halt: true };
      const rec = {
        pc: h.d_pc, word: h.d_word, size: 4, nextPc: h.d_next,
        registers: h.d_rd ? [{ id: REG_IDS[h.d_rd], old: h.d_regOld, value: h.x[h.d_rd] }] : [],
        memory: h.d_memSize ? [{ address: h.d_memAddr, size: h.d_memSize, old: h.d_memOld, value: h.d_memVal }] : [],
        reads: h.d_ldSize ? [{ address: h.d_ldAddr, size: h.d_ldSize }] : [], // v5
      };
      if (h.d_halt) rec.halt = true;
      if (h.d_outLen) rec.output = text(h.output.slice(h.output.length - h.d_outLen));
      if (h.d_cls === TRAP) rec.trap = { cause: h.d_trap, label: causeText(h.d_trap) };
      return rec;
    },
    // v5: the board's devices, and on iss-priv the privileged state worded for the processor table
    platform: () => {
      const h = s.hart;
      if (!h?.platform) return null;
      return { platform: h.platform, memsys: h.memsys, cycle: h.cycle, retired: h.instret, traps: h.traps, idle: h.idleCycles,
        privileged: h.priv ? privileged(h) : null };
    },
    back: () => s.back(),
    run:({ chunk, breakpoints = new Set(), target = null, depth = null, resumed = false, watch = {} } = {}) => {
      s.breakpoints = breakpoints;
      s.watchRegs = new Set([...(watch.registers ?? [])].map((id) => REG_IDS.indexOf(id)).filter((n) => n > 0));
      s.watchWords = new Set(watch.memory ?? []);
      return s.run({ ...(chunk ? { chunk } : {}), target, depth, resumed });
    },
    peek: (address, length) => {
      const out = new Uint8Array(length);
      const m = s.hart?.mem;
      if (m) for (let i = 0; i < length; i++) out[i] = m.readByte((address + i) >>> 0);
      return out;
    },
    snapshot: () => ({ hart: s.hart.snapshot(), runCount: s.runCount, error: s.error, history: s.history.export() }),
    restore: (snap) => {
      s.hart.restore(structuredClone(snap.hart));
      s.runCount = snap.runCount;
      s.error = snap.error;
      s.history.clear();
      s.history.append(structuredClone(snap.history));
    },
  };
}

/** A program from a .hex or .bin image (v4, capability imageImport): its words from address 0, no source. */
function loadImage(content, kind, name, { profile = 'iss' } = {}) {
  const words = readWords(content, kind);
  const bytes = new Uint8Array(words.length * 4);
  words.forEach((w, i) => { bytes[4 * i] = w; bytes[4 * i + 1] = w >>> 8; bytes[4 * i + 2] = w >>> 16; bytes[4 * i + 3] = w >>> 24; });
  return {
    ok: true, imported: true, diagnostics: [], errors: [], profileErrors: [], profile,
    segments: [{ address: 0, bytes, executable: true }], entry: 0, symbols: {}, symbolTable: [],
    listing: words.map((w, i) => ({ address: 4 * i, word: w, mnemonic: decodeMnemonic(w), source: decodeMnemonic(w),
      file: name, line: i + 1, text: '', size: 4, part: -1, parts: 1, operands: [] })),
    data: [], lines: new Map(),
  };
}

/** GCC -S output (WS-F-085), loaded with the first .s file (WS-N-011); the report as console messages. */
async function importers() {
  const g = await import('../../asm/gcc-import.js');
  const G = RV.gcc;
  return [{
    id: 'gcc', test: (text) => g.looksLikeGcc(text),
    convert: (text, name) => {
      const r = g.importGcc(text);
      const report = [
        { message: G.imported(name, r.report.length), kind: 'ok', note: G.note },
        ...r.report.map((e) => ({ message: G.actions[e.action](e.what), kind: e.action === 'pcrel' || e.action === 'unsupported' ? 'warn' : 'info', line: e.line })),
        { message: G.added(r.added.join(', ')), kind: 'info' },
        ...(r.missing.length ? [{ message: G.missing(r.missing.join(', ')), kind: 'error' }] : []),
      ];
      return { text: r.text, report };
    },
  }];
}

/** The scratch line (WS-F-024, v4 Language.scratch): an error is a diagnostic with its hint as note. */
function scratch(text) {
  const r = rvScratch(text);
  const rows = (r.lines ?? []).map((l) => ({ ...l, size: 4 }));
  if (r.ok || !r.error) return { kind: r.kind, ok: Boolean(r.ok), text: r.text, rows };
  const e = r.error;
  const note = e.hint === 'scratchOne' ? null : RV.hints[e.hint]?.(e, e.mnemonic ? usage(e.mnemonic) : null);
  return { kind: r.kind, ok: false, rows, error: { severity: 'error', message: e.message, ...(note ? { note } : {}) } };
}

const exercises = {
  // core/exercise.js is loaded with the first exercise (WS-N-011); it reads symbols as the assembler's Map
  parse: async (raw) => (await import('../../core/exercise.js')).parseExercise(raw),
  run: async (program, exercise) => (await import('../../core/exercise.js')).runExercise({ ...program, symbols: new Map(Object.entries(program.symbols)) }, exercise),
};

const exports = {
  trace: (program, { profile, platformConfig, cap }) => traceRecords(program, profile, cap, { platformConfig }),
  traceJsonLines, traceCsv,
  golden: (model) => { const words = model.golden(); return { text: goldenText(words), count: words.length }; },
  image: (program) => ({ hex: hexImage(program), bin: program.segments[0].bytes }),
};

/**
 * The C subset (spec §10.1, v5 ExtraLanguage). The compiler is loaded on first use (WS-N-011) by `load()`, which
 * gives a synchronous `compile`, so that assembling stays synchronous once it is in: `text` the assembly, `lines` the
 * C line of each assembly line (0: start-up and library code), errors as diagnostics with the subset hint as note.
 */
const CC = RV.cc;
const c = {
  id: 'c', label: CC.languages.c, extension: '.c', example: CC.example,
  options: [
    { id: 'mode', label: CC.mode, title: CC.modeTitle, values: Object.entries(CC.modes).map(([id, label]) => ({ id, label })), default: 'plain' },
    { id: 'march', label: CC.march, title: CC.marchTitle, values: Object.entries(CC.marches).map(([id, label]) => ({ id, label })), default: 'rv32im',
      profiles: ['iss'] }, // the chapter processors have no M extension
  ],
  load: async () => {
    const cc = await import('../../cc/compiler.js');
    return {
      compile: (text, { name, profile, subset = null, options = {} }) => {
        const r = cc.compile(text, { name, profile, mode: options.mode, march: options.march, lbu: profile === 'ch06' && subset === 'ext' });
        return { ok: r.ok, text: r.asm, lines: r.map,
          diagnostics: r.errors.map((e) => ({ severity: 'error', line: e.line, column: e.column, message: e.message, ...(e.subset ? { note: CC.subsetHint } : {}) })) };
      },
    };
  },
  // a diagnostic of the generated assembly: the processor views' small memories
  asmNote: (d) => (/does not fit/.test(d.message) ? CC.fitHint : null),
};

/**
 * The multicycle view's warning when an example opens in it (v5 View.openNote): a program that uses jalr needs the
 * optional JALR state, which is off unless the user turned it on; without its content file the processor has none.
 */
async function multiNote(entry) {
  if (!entry.jalr) return null;
  const [{ store }, { fetchJalr }] = await Promise.all([import('../../ui/dom.js'), import('../../uarch/ch07-jalr.js')]);
  if (store.get('pips.multi.jalr') === '1') return null;
  return (await fetchJalr(BASE)) ? RV.examples.needsJalr : RV.examples.noJalr;
}

/** The pipelined view's settings (v5 View.settings): in links as `pipe`, in storage as pips.pipe.<setting>. */
const PIPE_SETTINGS = {
  key: 'pipe',
  defaults: { hazard: 'full', predictor: 'none', entries: '8', resolution: 'ex' },
  values: { hazard: ['full', 'stall', 'memwb', 'mem', 'none'], predictor: ['none', '1bit', '2bit'], entries: ['2', '4', '8', '16', '32', '64'], resolution: ['ex', 'id'] },
};

const off = (reason) => ({ enabled: false, reason });

export const descriptor = {
  contract: CONTRACT_VERSION,
  id: 'riscv',
  name: 'RISC-V',
  strings: RV, // merged over the shell's (phase 4)
  capabilities: Object.fromEntries([
    'assembler', 'cLanguage', 'backStep', 'breakpoints', 'watchpoints', 'stepOver', 'callStack', 'runToCursor', 'scratch',
    'imageImport', 'gccImport', 'dataIO', 'uninitCheck', 'memoryModel', 'cache', 'devices', 'compare', 'waveform',
    'exercises', 'share', 'exportTrace', 'exportGolden', 'exportImage', 'worker',
  ].map((k) => [k, true]).concat([['traps', off('trapsNeedPriv')]])),
  language: {
    id: 'asm', extension: '.s', comment: '#', defaultSource: DEFAULT_SOURCE,
    assemble, fields, describe,
    inspector: () => import('./inspector.js'), // loaded on first use
    loadImage, importers, scratch,
    disassemble: (word, address, { aliases = false, names = 'abi' } = {}) => (aliases ? disassembleAlias : disassemble)(word, address, names),
    disassembly: { aliases: true, names: ['abi', 'x'] },
    editor, // v5: help and detail
    extraLanguages: [c],
  },
  registers: {
    groups: [{ id: 'x', label: 'Registers', registers: REG_IDS.map((id, i) => ({
      id, name: id, aliases: i === 8 ? [ABI_NAMES[i], 'fp'] : [ABI_NAMES[i]], width: 32, ...(i === 0 ? { zero: true } : {}),
    })) }],
    pc: 'pc',
    roles: { sp: 'x2', fp: 'x8' },
  },
  addressSpace: {
    addressBits: 32, unitBits: 8, wordBytes: 4, endianness: 'little',
    regions: [
      { name: 'RAM', base: 0x0000_0000, size: 0x4000_0000, kind: 'ram' },
      { name: 'Devices (iss-priv)', base: 0x4000_0000, size: 0x1000_0000, kind: 'device' }, // W-D26: the platform's window (GPIO, timer, UART)
      { name: 'NPU', base: 0x5000_0000, size: 0x1000, kind: 'device' }, // decision G1: the Chapter 11 NPU, outside the window
      { name: 'GPU (CPU + GPU tool)', base: GPU_BASE, size: 0x1000, kind: 'device' }, // decision G30: on the tool's pages only
    ],
  },
  engine: {
    create,
    // every profile of the profile menu (core/profiles.js); iss-priv turns traps on and keeps its devices on the page
    profiles: Object.values(PROFILES).map((p) => ({
      id: p.id, label: RV.profileNames[p.id], memory: p.memory, stackTop: p.stackTop,
      ...(p.subsets ? { subsets: ['full', ...Object.keys(p.subsets)].map((id) => ({ id, label: RV.single.subsets[id] })) } : {}),
      ...(p.priv ? { capabilities: { traps: true, worker: off('privNoWorker') } } : p.devices ? { capabilities: { worker: off('devicesNoWorker') } } : {}),
    })),
  },
  memorySystem: { timing: true, cache: true, devices: true },
  views: [
    { id: 'isa', label: RV.viewIsa, icon: 'chip', kind: 'isa' },
    // each view is loaded with its tab (WS-N-011): its module, its content files, and the wrapper of views.js (v4)
    { id: 'single', label: RV.viewSingle, icon: 'clock', kind: 'datapath', profile: 'ch06', names: 'x', subsets: true, load: async () => {
      const [{ SingleView, loadSingleContent }, w] = await Promise.all([import('./ui/single-view.js'), import('./views.js')]);
      const content = await loadSingleContent(BASE);
      return { create: (ctx) => w.single(new SingleView(content), ctx) };
    } },
    { id: 'multi', label: RV.viewMulti, icon: 'steps', kind: 'datapath', profile: 'ch07', names: 'x', openNote: multiNote, load: async () => {
      const [{ MultiView, loadMultiContent }, w, { STATE_CODE }] = await Promise.all([import('./ui/multi-view.js'), import('./views.js'), import('../../uarch/multi.js')]);
      const content = await loadMultiContent(BASE);
      return { create: (ctx) => w.multi(new MultiView(content, { onGoTo: () => ctx.refresh?.(), onStepInstr: () => ctx.command?.('stepUnit'),
        onBackInstr: () => ctx.command?.('backUnit') }), ctx, STATE_CODE) };
    } },
    { id: 'pipe', label: RV.viewPipe, icon: 'pipeline', kind: 'datapath', profile: 'ch08', names: 'x', settings: PIPE_SETTINGS, load: async () => {
      const [{ PipeView, loadPipeContent }, w] = await Promise.all([import('./ui/pipe-view.js'), import('./views.js')]);
      const content = await loadPipeContent(BASE);
      return { create: (ctx) => w.pipe(new PipeView(content, { onGoTo: () => ctx.refresh?.() }), ctx) };
    } },
    { id: 'compare', label: RV.viewCompare, icon: 'compare', kind: 'compare', profile: 'ch06', load: async () => {
      const [{ CompareView, loadCompareContent }, w] = await Promise.all([import('./ui/compare-view.js'), import('./views.js')]);
      const content = await loadCompareContent(BASE);
      return { create: (ctx) => w.compare(new CompareView(content), ctx) };
    } },
    // the NPU tool (NPU-3; shown only there, src/shell/platform-archs.js): the single-cycle processor with the platform
    // devices and its datapath extended by the NPU on the data bus, and the NPU itself at its four levels
    { id: 'npu-single', label: RV.viewSingle, icon: 'clock', kind: 'datapath', profile: 'ch06', names: 'x', load: async () => {
      const [{ SingleView, loadSingleContent }, w, X] = await Promise.all([import('./ui/single-view.js'), import('./views.js'), import('./npu-datapath.js')]);
      const content = await loadSingleContent(BASE);
      const extend = { geom: X.extendForNpu, info: X.NPU_DP_INFO, values: X.npuDpValues, path: X.npuDpPath };
      return { create: (ctx) => w.npuSingle(new SingleView(content, { extend }), ctx) };
    } },
    { id: 'npu', label: RV.viewNpu, icon: 'npu', kind: 'datapath', profile: 'ch06', names: 'x', load: async () => {
      const [{ SingleView, loadSingleContent }, { NpuView }, w] = await Promise.all([import('./ui/single-view.js'), import('../../ui/npu-view.js'), import('./views.js')]);
      const [content, geom] = await Promise.all([loadSingleContent(BASE), fetch(new URL('content/geometry/ch11-npu.json', BASE)).then((r) => {
        if (!r.ok) throw new Error(`content/geometry/ch11-npu.json: ${r.status}`);
        return r.json();
      })]);
      return { create: (ctx) => w.npu(new SingleView(content), new NpuView(geom), ctx) };
    } },
    // the NPU tool's Analysis (NPU-4): Chapter 11's offload breakdown, CPU/NPU comparison and analytical panels; it
    // measures the program on the laboratory profile (RV32IM with the devices), so `mul` assembles there
    { id: 'npu-analysis', label: RV.viewAnalysis, icon: 'analysis', kind: 'compare', profile: 'ch11', load: async () => {
      const [{ AnalysisView, loadAnalysisContent }, w] = await Promise.all([import('./ui/analysis-view.js'), import('./views.js')]);
      const content = await loadAnalysisContent(BASE);
      return { create: () => w.analysis(new AnalysisView(content)) };
    } },
    // the CPU + GPU tool (GPU-7, decision G30; shown only there, src/shell/platform-archs.js HOSTED_TOOLS): the
    // single-cycle processor with the GPU module's SIMT core on its data bus at 0x5000_1000, and the GPU itself
    { id: 'gpu-single', label: RV.viewSingle, icon: 'clock', kind: 'datapath', profile: 'ch06', names: 'x', load: async () => {
      const [{ SingleView, loadSingleContent }, w, { GPU_DP }] = await Promise.all([import('./ui/single-view.js'), import('./views.js'), import('./gpu-datapath.js')]);
      const content = await loadSingleContent(BASE);
      const extend = { geom: GPU_DP.extend, info: GPU_DP.info, values: GPU_DP.values, path: GPU_DP.path };
      return { create: (ctx) => w.gpuSingle(new SingleView(content, { extend }), ctx) };
    } },
    { id: 'gpu-host', label: RV.viewGpu, icon: 'chip', kind: 'datapath', profile: 'ch06', names: 'x', load: async () => {
      const [{ SingleView, loadSingleContent }, { GpuHostView, loadCoreContent }, w] = await Promise.all([import('./ui/single-view.js'),
        import('./ui/gpu-host-view.js'), import('./views.js')]);
      const [content, core] = await Promise.all([loadSingleContent(BASE), loadCoreContent(BASE)]);
      return { create: (ctx) => w.gpuHost(new SingleView(content), new GpuHostView(core), ctx) };
    } },
  ],
  content: { examples: 'content/examples/index.json', templates: 'content/templates/index.json', help: 'content/help/help.json', exercises: 'content/exercises/index.json',
    docs: 'content/help/docs/index.html', logo: 'mavilera-logo.svg' }, // v6
  exports,
  exercises,
};
