// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { CONTRACT_VERSION } from '../contract.js';
import { ABI } from './core/decode.js';
import { assemble, disassemble, editor, RAM_BASE, RAM_SIZE, STACK_TOP } from './language.js';
import { create, CSR_VIEW, CORE1_VIEW } from './engine.js';
import { PICO2_STRINGS as S } from './strings.js';
import { trace, traceJsonLines, traceCsv } from './exports.js';
import { loadImage } from './firmware/import.js';
import { ccDebug } from './debug/cc-lines.js';
import { CLOCK_CHOICES, DEFAULT_CLOCK } from './clock.js';
const CLOCK_OPTION = Object.freeze({ id: 'clock', label: S.clock.label, title: S.clock.title,
 values: CLOCK_CHOICES.map((id) => ({ id, label: S.clock.value(id) })), default: DEFAULT_CLOCK });
const SPEAKER_OPTION = Object.freeze({ id: 'speaker', label: S.audio.speaker, title: S.audio.speakerTitle, apply: 'engine', panel: 'pins',
 values: [{ id: 'none', label: S.audio.none }, ...Array.from({ length: 30 }, (_, n) => ({ id: `gp${n}`, label: `GP${n}` }))], default: 'none' });
const DAC_OPTION = Object.freeze({ id: 'dac', label: S.audio.converter, title: S.audio.converterTitle, apply: 'engine', panel: 'pins',
 values: [{ id: 'pin', label: S.audio.pin }, { id: 'ideal', label: S.audio.ideal }], default: 'pin' });
const PARTS_OPTION = Object.freeze({ id: 'parts', label: S.parts.label, title: S.parts.title, apply: 'engine', panel: 'pins',
 values: [{ id: 'none', label: S.parts.none }, { id: 'kit', label: S.parts.kit }], default: 'none' });
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
const PIO_EDITOR = Object.freeze({
 mnemonics: ['jmp', 'wait', 'in', 'out', 'push', 'pull', 'mov', 'irq', 'set', 'nop'],
 registers: ['pins', 'x', 'y', 'null', 'isr', 'osr', 'pindirs', 'pc', 'exec', 'status', 'gpio', 'jmppin', 'rxfifo', 'side', 'block', 'noblock',
 'iffull', 'ifempty', 'rel', 'prev', 'next', 'clear', 'nowait', 'opt'],
 directives: ['.program', '.wrap_target', '.wrap', '.side_set', '.origin', '.define', '.word', '.pio_version', '.clock_div', '.fifo', '.mov_status',
 '.in', '.out', '.set', '.lang_opt'],
});
const cLanguage = {
 id: 'c', label: S.cc.languages.c, extension: '.c', example: S.cc.example,
 options: [{ id: 'mode', label: S.cc.mode, title: S.cc.modeTitle, values: Object.entries(S.cc.modes).map(([id, label]) => ({ id, label })), default: 'plain' }],
 load: async () => {
 const [cc, t, pa] = await Promise.all([import('../../cc/compiler.js'), import('./c/target.js'), import('./pio/asm.js')]);
 const targets = new Map();
 const targetFor = (clock) => { const k = String(clock ?? DEFAULT_CLOCK); if (!targets.has(k)) targets.set(k, t.pico2Target({ clock: k })); return targets.get(k); };
 return {
 compile: (text, { name, profile, options = {}, companions = [] }) => {
 let target = targetFor(options.clock);
 const pio = companions.filter((f) => /\.pio$/i.test(f.name));
 if (pio.length) {
 const headers = { ...target.headers }, diagnostics = [];
 for (const f of pio) {
 const r = pa.assemblePio(f.text);
 for (const d of r.diagnostics) diagnostics.push({ severity: d.severity, file: f.name, line: d.line ?? 1, column: d.column ?? 1, message: d.message });
 if (r.ok) headers[`${f.name}.h`] = { text: pa.pioCHeader(r, f.name), stdint: true };
 }
 if (diagnostics.some((d) => d.severity === 'error')) return { ok: false, text: '', lines: [], diagnostics };
 target = { ...target, headers };
 }
 const r = cc.compile(text, { name, profile, mode: options.mode, target });
 const noPio = (m) => /^#include "([\w.-]+\.pio)\.h"/i.exec(m)?.[1] ?? null;
 return { ok: r.ok, text: r.asm, lines: r.map,
 diagnostics: r.errors.map((e) => ({ severity: 'error', line: e.line, column: e.column, message: e.message,
 ...(noPio(e.message) ? { note: S.pioFile.missing(noPio(e.message)) } : e.subset ? { note: S.cc.subsetHint } : {}) })) };
 },
 };
 },
};
const SDK_EXAMPLE = `// Pico SDK C: print over UART0 and blink the Pico 2's LED (GP25) twice a second.
#include <stdio.h>
#include "pico/stdlib.h"

int main(void) {
    stdio_init_all();
    gpio_init(PICO_DEFAULT_LED_PIN);
    gpio_set_dir(PICO_DEFAULT_LED_PIN, GPIO_OUT);
    for (int n = 0; ; n++) {
        printf("Hello from the Pico 2: %d\\n", n);
        gpio_put(PICO_DEFAULT_LED_PIN, n & 1);
        sleep_ms(250);
    }
}
`;
const sdkLanguage = {
 id: 'sdk-c', label: S.full.label, extension: '.c', image: true, example: SDK_EXAMPLE,
 saveAs: [{ extension: '.uf2', convert: async (elf) => (await import('./firmware/uf2.js')).elfToUf2(elf) }],
 load: async () => {
 const { FullCompiler } = await import('./full/client.js');
 const fc = new FullCompiler();
 return {
 download: {
 probe: async () => {
 const m = await fc.probe();
 const size = (e) => e.transferBytes ?? e.bytes;
 return { version: m.version, bytes: m.total, transfer: size(m.compiler) + size(m.pack), toDownload: m.toDownload, cacheAvailable: m.cacheAvailable, licences: m.licencesUrl ?? null,
 files: [{ id: 'compiler', label: S.full.compilerFile, bytes: size(m.compiler), cached: m.compiler.cached },
 { id: 'pack', label: S.full.packFile, bytes: size(m.pack), cached: m.pack.cached }] };
 },
 fetch: (onProgress) => fc.load(onProgress),
 ready: () => Boolean(fc.ready),
 forget: () => fc.forget(),
 persist: () => FullCompiler.persist(),
 },
 build: async (files) => {
 if (files.some((x) => /\.pio$/i.test(x.name))) {
 const pr = (await import('./pio/asm.js')).withPioHeaders(files);
 if (!pr.ok) return { ok: false, image: null, times: {}, log: '', diagnostics: pr.diagnostics };
 files = pr.files;
 }
 const r = await fc.build(files);
 const diagnostics = r.diagnostics.filter((d) => d.severity !== 'note' || d.file).map((d) => ({
 severity: d.severity === 'note' ? 'warning' : d.severity,
 message: d.file || !d.path ? d.message : `${d.path}${d.line ? `:${d.line}` : ''}: ${d.message}`,
 ...(d.file ? { file: d.file, line: d.line ?? 1, column: d.col ?? 1 } : {}) }));
 return { ok: r.ok, image: r.elf ? { kind: 'elf', bytes: r.elf } : null, times: r.times, log: r.log, diagnostics };
 },
 };
 },
};
export const descriptor = {
 contract: CONTRACT_VERSION,
 id: 'pico2',
 name: 'Pico 2',
 strings: S,
 capabilities: {
 ...Object.fromEntries(['assembler', 'backStep', 'breakpoints', 'watchpoints', 'runToCursor', 'share'].map((k) => [k, true])),
 cLanguage: true,
 exportTrace: true,
 waveform: true,
 imageImport: true,
 projects: true,
 worker: true,
 realtime: true,
 audio: true,
 exercises: true,
 ...Object.fromEntries(['stepOver', 'callStack', 'scratch', 'gccImport', 'dataIO', 'uninitCheck',
 'exportGolden', 'exportImage'].map((k) => [k, off('laterMilestone')])),
 ...Object.fromEntries(['memoryModel', 'cache', 'devices', 'traps'].map((k) => [k, off('noDevices')])),
 compare: off('oneProcessor'),
 },
 language: { id: 'asm', extension: '.s', comment: '#', defaultSource: DEFAULT_SOURCE, disassemble, editor, loadImage, imageKinds: ['uf2', 'elf', 'bin'],
 extraExtensions: ['.pio'],
 companion: { extension: '.pio', label: S.pioFile.label, add: S.pioFile.add, addTitle: S.pioFile.addTitle, remove: S.pioFile.remove,
 example: S.pioFile.example, comment: ';', editor: PIO_EDITOR },
 companions: [{ id: 'pio', extension: '.pio', editor: 'text' },
 { id: 'circuit', extension: '.circuit.json', editor: 'view', option: 'circuit', projectFile: 'circuit.json', label: S.circuitFile.label }],
 options: [CLOCK_OPTION, SPEAKER_OPTION, DAC_OPTION, PARTS_OPTION],
 lineStep: { load: async () => {
 const { SourceSession } = await import('./debug/source-session.js');
 return { create: (program, engine) => {
 const s = new SourceSession(program, {}, engine);
 return { stepLine: () => { s.sync(); return s.stepLine(); }, backLine: () => { s.sync(); return s.backLine(); }, message: () => s.message };
 } };
 } },
 assemble: (files, opts = {}) => {
 const p = assemble(files, opts);
 if (opts.source && p.listing.length) p.debug = ccDebug(p, opts.source);
 return p;
 },
 extraLanguages: [cLanguage, sdkLanguage] },
 editions: [
 { id: 'lite', label: S.editions.lite, title: S.editions.liteTitle, languages: ['c'], primary: true,
 capabilities: { projects: off('fullEdition'), imageImport: off('fullEdition') } },
 { id: 'full', label: S.editions.full, title: S.editions.fullTitle, compiler: 'sdk-c', development: true },
 ],
 realtime: { floorHz: 1e6, transports: ['sab', 'postMessage'] },
 audio: { sampleRate: 48000, channels: 1, processor: 'worker/audio-processor.js' },
 panels: [{ id: 'pins', label: S.pins.tab, load: async () => {
 const { PinsPanel } = await import('./ui/pins-panel.js');
 return { create: (ctx) => new PinsPanel(ctx) };
 } },
 { id: 'pwm', label: S.devices.pwmTab, load: async () => { const { PwmPanel } = await import('./ui/devices-panel.js'); return { create: () => new PwmPanel() }; } },
 { id: 'dma', label: S.devices.dmaTab, load: async () => { const { DmaPanel } = await import('./ui/devices-panel.js'); return { create: () => new DmaPanel() }; } },
 { id: 'adc', label: S.devices.adcTab, load: async () => { const { AdcPanel } = await import('./ui/devices-panel.js'); return { create: () => new AdcPanel() }; } },
 { id: 'spi', label: S.devices.spiTab, load: async () => { const { SpiPanel } = await import('./ui/devices-panel.js'); return { create: () => new SpiPanel() }; } },
 { id: 'i2c', label: S.devices.i2cTab, load: async () => { const { I2cPanel } = await import('./ui/devices-panel.js'); return { create: () => new I2cPanel() }; } },
 { id: 'pio', label: S.pio.tab, load: async () => { const { PioPanel } = await import('./ui/pio-panel.js'); return { create: () => new PioPanel() }; } }],
 console: { input: { kind: 'uart', uart: 0, lineEnd: [13], label: S.uartType.label, placeholder: S.uartType.placeholder, title: S.uartType.title } },
 assets: { optional: [{ id: 'pico-full', label: S.full.assetLabel, base: 'pico-full/' }] },
 registers: {
 groups: [
 { id: 'x', label: S.registerGroup, registers: ABI.map((n, i) => ({ id: `x${i}`, name: n, aliases: [`x${i}`], width: 32, ...(i === 0 ? { zero: true } : {}) })) },
 { id: 'csr', label: S.csrGroup, registers: CSR_VIEW.map(([id]) => ({ id, name: id, width: id === 'priv' ? 2 : 32 })) },
 { id: 'core1', label: S.core1.group, registers: [{ id: 'c1pc', name: 'pc', width: 32 },
 ...ABI.map((n, i) => ({ id: `c1x${i}`, name: n, aliases: [`c1x${i}`], width: 32, ...(i === 0 ? { zero: true } : {}) })),
 ...CORE1_VIEW.map(([id]) => ({ id: `c1${id}`, name: id, width: 32 }))] },
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
 { id: 'pipeline', label: S.viewPipeline, icon: 'pipeline', kind: 'datapath', profile: 'hazard3', layout: { drawing: 0.76, editor: 0.19 }, load: async () => {
 const { PipelineView, pipelineInstance } = await import('./ui/pipeline-view.js');
 return { create: (ctx) => pipelineInstance(new PipelineView(), ctx) };
 } },
 { id: 'source', label: S.viewSource, icon: 'code', kind: 'datapath', profile: 'hazard3', imageOnly: true, layout: { drawing: 0.72, editor: 0.19 }, load: async () => {
 const { SourceView, sourceInstance } = await import('./ui/source-view.js');
 return { create: (ctx) => sourceInstance(new SourceView(ctx), ctx) };
 } },
 { id: 'board', label: S.viewBoard, icon: 'board', kind: 'datapath', engine: 'page', profile: 'hazard3', layout: { drawing: 0.72, editor: 0.19 }, load: async () => {
 const { BoardView, boardInstance } = await import('./ui/board-view.js');
 return { create: (ctx) => boardInstance(new BoardView(ctx), ctx) };
 } },
 ],
 exports: { trace: (program, { cap }) => trace(program, { cap }), traceJsonLines, traceCsv },
 exercises: {
 parse: async (raw) => (await import('./exercise.js')).parseExercise(raw),
 run: async (program, exercise) => (await import('./exercise.js')).runExercise(program, exercise),
 },
 content: { logo: 'mavilera-logo-pico2.svg', templates: 'content/pico2/templates/index.json', exercises: 'content/pico2/exercises/index.json',
 help: 'content/pico2/help/help.json', docs: 'content/pico2/help/docs/index.html' },
};
