// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { CONTRACT_VERSION, STOP as CONTRACT_STOP } from '../contract.js';
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
const BASE = new URL('../../../', import.meta.url);
for (const [k, v] of Object.entries(CONTRACT_STOP)) if (STOP[k] !== v) throw new Error(`STOP.${k} differs from the contract`);
const REG_IDS = ABI_NAMES.map((_, i) => `x${i}`);
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
 p.symbols = Object.fromEntries(p.symbols);
 p.files = files;
 p.subset = subset ?? null;
 return p;
}
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
function describe(word) {
 const fmt = formatOf(decodeMnemonic(word));
 if (!fmt) return null;
 return { kind: RV.formatName(fmt), immediate: immediateSteps(word, fmt)?.[1] ?? null };
}
const UNINIT_SHOWN = 20;
function peekWord(mem, address, size) {
 let v = 0;
 for (let i = size - 1; i >= 0; i--) v = v * 256 + mem.readByte((address + i) >>> 0);
 return v >>> 0;
}
const hex = (v, n = 8) => `0x${(v >>> 0).toString(16).padStart(n, '0')}`;
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
function create(program, { historyLimit, runLimit, platformConfig } = {}) {
 const s = new Session({ ...(historyLimit ? { historyLimit } : {}), ...(runLimit ? { runLimit } : {}) });
 s.profile = program.profile ?? 'iss';
 s.program = program;
 if (platformConfig) s.platformConfig = platformConfig;
 s.reset();
 const regs = () => Object.fromEntries(REG_IDS.map((id, i) => [id, s.hart ? s.hart.x[i] : 0]));
 const text = (bytes) => {
 let s = '';
 for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.slice(i, i + 8192));
 return s;
 };
 return {
 reset: () => s.reset(),
 state: () => {
 const h = s.hart;
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
 ...(h.priv ? h.priv.violations.map((v) => ({ kind: 'trap', message: STRINGS.platform.trapViolation(v) })) : []),
 ...labDiagnostics(h.platform),
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
 ...labRows(h.platform)];
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
 reads: h.d_ldSize ? [{ address: h.d_ldAddr, size: h.d_ldSize }] : [],
 };
 if (h.d_halt) rec.halt = true;
 if (h.d_outLen) rec.output = text(h.output.slice(h.output.length - h.d_outLen));
 if (h.d_cls === TRAP) rec.trap = { cause: h.d_trap, label: causeText(h.d_trap) };
 return rec;
 },
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
function scratch(text) {
 const r = rvScratch(text);
 const rows = (r.lines ?? []).map((l) => ({ ...l, size: 4 }));
 if (r.ok || !r.error) return { kind: r.kind, ok: Boolean(r.ok), text: r.text, rows };
 const e = r.error;
 const note = e.hint === 'scratchOne' ? null : RV.hints[e.hint]?.(e, e.mnemonic ? usage(e.mnemonic) : null);
 return { kind: r.kind, ok: false, rows, error: { severity: 'error', message: e.message, ...(note ? { note } : {}) } };
}
const exercises = {
 parse: async (raw) => (await import('../../core/exercise.js')).parseExercise(raw),
 run: async (program, exercise) => (await import('../../core/exercise.js')).runExercise({ ...program, symbols: new Map(Object.entries(program.symbols)) }, exercise),
};
const exports = {
 trace: (program, { profile, platformConfig, cap }) => traceRecords(program, profile, cap, { platformConfig }),
 traceJsonLines, traceCsv,
 golden: (model) => { const words = model.golden(); return { text: goldenText(words), count: words.length }; },
 image: (program) => ({ hex: hexImage(program), bin: program.segments[0].bytes }),
};
const CC = RV.cc;
const c = {
 id: 'c', label: CC.languages.c, extension: '.c', example: CC.example,
 options: [
 { id: 'mode', label: CC.mode, title: CC.modeTitle, values: Object.entries(CC.modes).map(([id, label]) => ({ id, label })), default: 'plain' },
 { id: 'march', label: CC.march, title: CC.marchTitle, values: Object.entries(CC.marches).map(([id, label]) => ({ id, label })), default: 'rv32im',
 profiles: ['iss'] },
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
 asmNote: (d) => (/does not fit/.test(d.message) ? CC.fitHint : null),
};
async function multiNote(entry) {
 if (!entry.jalr) return null;
 const [{ store }, { fetchJalr }] = await Promise.all([import('../../ui/dom.js'), import('../../uarch/ch07-jalr.js')]);
 if (store.get('pips.multi.jalr') === '1') return null;
 return (await fetchJalr(BASE)) ? RV.examples.needsJalr : RV.examples.noJalr;
}
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
 strings: RV,
 capabilities: Object.fromEntries([
 'assembler', 'cLanguage', 'backStep', 'breakpoints', 'watchpoints', 'stepOver', 'callStack', 'runToCursor', 'scratch',
 'imageImport', 'gccImport', 'dataIO', 'uninitCheck', 'memoryModel', 'cache', 'devices', 'compare', 'waveform',
 'exercises', 'share', 'exportTrace', 'exportGolden', 'exportImage', 'worker',
 ].map((k) => [k, true]).concat([['traps', off('trapsNeedPriv')]])),
 language: {
 id: 'asm', extension: '.s', comment: '#', defaultSource: DEFAULT_SOURCE,
 assemble, fields, describe,
 inspector: () => import('./inspector.js'),
 loadImage, importers, scratch,
 disassemble: (word, address, { aliases = false, names = 'abi' } = {}) => (aliases ? disassembleAlias : disassemble)(word, address, names),
 disassembly: { aliases: true, names: ['abi', 'x'] },
 editor,
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
 { name: 'Devices (iss-priv)', base: 0x4000_0000, size: 0x1000_0000, kind: 'device' },
 { name: 'NPU', base: 0x5000_0000, size: 0x1000, kind: 'device' },
 ],
 },
 engine: {
 create,
 profiles: Object.values(PROFILES).map((p) => ({
 id: p.id, label: RV.profileNames[p.id], memory: p.memory, stackTop: p.stackTop,
 ...(p.subsets ? { subsets: ['full', ...Object.keys(p.subsets)].map((id) => ({ id, label: RV.single.subsets[id] })) } : {}),
 ...(p.priv ? { capabilities: { traps: true, worker: off('privNoWorker') } } : p.devices ? { capabilities: { worker: off('devicesNoWorker') } } : {}),
 })),
 },
 memorySystem: { timing: true, cache: true, devices: true },
 views: [
 { id: 'isa', label: RV.viewIsa, icon: 'chip', kind: 'isa' },
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
 { id: 'npu-analysis', label: RV.viewAnalysis, icon: 'analysis', kind: 'compare', profile: 'ch11', load: async () => {
 const [{ AnalysisView, loadAnalysisContent }, w] = await Promise.all([import('./ui/analysis-view.js'), import('./views.js')]);
 const content = await loadAnalysisContent(BASE);
 return { create: () => w.analysis(new AnalysisView(content)) };
 } },
 ],
 content: { examples: 'content/examples/index.json', templates: 'content/templates/index.json', help: 'content/help/help.json', exercises: 'content/exercises/index.json',
 docs: 'content/help/docs/index.html', logo: 'mavilera-logo.svg' },
 exports,
 exercises,
};
