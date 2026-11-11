// pico2/index.js -- the Raspberry Pi RP2350's Hazard3 core on the contract (spec W-D29), module id `pico2` (research repository
// ADR-0008), milestones P1-M1 and P1-M2 of the research roadmap: the assembler, the disassembler and the instruction-level engine
// of one hart on the Pico 2 machine (address map, the peripherals of P1-M2, event scheduler, high-level boot of SDK images in
// engine.js). Released from 1.5.0 (P1-M9, research D45; docs/ADDING-SIMULATORS.md steps 5-8), Pico Lite only: Pico Full stays on the
// development page (Edition.development). P1-M3 adds the pipeline view
// (ui/pipeline-view.js, loaded on demand), its waveforms and VCD export, and the trace export. P1-C1 adds the import of
// SDK-built programs (UF2, ELF, .bin; firmware/import.js) and the C source view. What later milestones add is disabled with a
// reason. P1-L1 adds the editions Pico Lite and Pico Full (research D34); P1-M4 the real-time run; P1-M5 PWM, DMA and the
// speaker (capability audio, research D39); P1-M9 the exercises (exercise.js) and the guide.
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

/**
 * The module's build option (contract v10 draft Language.options; P1-M4, research D36 Q2): the clk_sys a program of the
 * editor runs at, 1, 4 or 12 MHz from the 12 MHz crystal, default 4 MHz. The assembler predefines its symbols, MAVILERA C's
 * start-up sets it; Pico SDK C programs set their own clocks and ignore it.
 */
const CLOCK_OPTION = Object.freeze({ id: 'clock', label: S.clock.label, title: S.clock.title,
  values: CLOCK_CHOICES.map((id) => ({ id, label: S.clock.value(id) })), default: DEFAULT_CLOCK });
/**
 * P1-M5 (research D39 Q4-Q5; contract v10 draft `apply: 'engine'`, `panel`): the speaker pin (none until chosen) and its converter,
 * engine settings shown in the Pins panel, kept in this browser and carried by links, settings files and templates (`opts`).
 */
const SPEAKER_OPTION = Object.freeze({ id: 'speaker', label: S.audio.speaker, title: S.audio.speakerTitle, apply: 'engine', panel: 'pins',
  values: [{ id: 'none', label: S.audio.none }, ...Array.from({ length: 30 }, (_, n) => ({ id: `gp${n}`, label: `GP${n}` }))], default: 'none' });
const DAC_OPTION = Object.freeze({ id: 'dac', label: S.audio.converter, title: S.audio.converterTitle, apply: 'engine', panel: 'pins',
  values: [{ id: 'pin', label: S.audio.pin }, { id: 'ideal', label: S.audio.ideal }], default: 'pin' });
/** P1-M7 (design Q2): the lab kit on I2C0 and SPI0 (parts/kit.js), an engine setting shown in the Pins panel; templates set it. */
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

/** Research D43: the words the editor of a .pio file highlights and completes (pioasm's language; pio/asm.js). */
const PIO_EDITOR = Object.freeze({
  mnemonics: ['jmp', 'wait', 'in', 'out', 'push', 'pull', 'mov', 'irq', 'set', 'nop'],
  registers: ['pins', 'x', 'y', 'null', 'isr', 'osr', 'pindirs', 'pc', 'exec', 'status', 'gpio', 'jmppin', 'rxfifo', 'side', 'block', 'noblock',
    'iffull', 'ifempty', 'rel', 'prev', 'next', 'clear', 'nowait', 'opt'],
  directives: ['.program', '.wrap_target', '.wrap', '.side_set', '.origin', '.define', '.word', '.pio_version', '.clock_div', '.fifo', '.mov_status',
    '.in', '.out', '.set', '.lang_opt'],
});

/**
 * The C subset on the Pico 2 (P1-C2; design docs/architecture/pico2-p1c2-c-subset.md): the app's compiler (src/cc) with the
 * pico2 target, loaded on first use (WS-N-011); `compile` is synchronous once loaded, as the contract's ExtraLanguage asks.
 */
const cLanguage = {
  id: 'c', label: S.cc.languages.c, extension: '.c', example: S.cc.example,
  options: [{ id: 'mode', label: S.cc.mode, title: S.cc.modeTitle, values: Object.entries(S.cc.modes).map(([id, label]) => ({ id, label })), default: 'plain' }],
  load: async () => {
    const [cc, t, pa] = await Promise.all([import('../../cc/compiler.js'), import('./c/target.js'), import('./pio/asm.js')]);
    const targets = new Map(); // one per clock choice (P1-M4, D36 Q2): the start-up and <rp2350.h> follow it
    const targetFor = (clock) => { const k = String(clock ?? DEFAULT_CLOCK); if (!targets.has(k)) targets.set(k, t.pico2Target({ clock: k })); return targets.get(k); };
    return {
      // options: the compiler's (mode) and the module's build options (clock; contract v10 draft Language.options); companions
      // (contract v10 draft, research D43): the program's .pio file, which the C program includes as "<file>.pio.h" (pioCHeader)
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
        const noPio = (m) => /^#include "([\w.-]+\.pio)\.h"/i.exec(m)?.[1] ?? null; // a header of a .pio file the program does not have
        return { ok: r.ok, text: r.asm, lines: r.map,
          diagnostics: r.errors.map((e) => ({ severity: 'error', line: e.line, column: e.column, message: e.message,
            ...(noPio(e.message) ? { note: S.pioFile.missing(noPio(e.message)) } : e.subset ? { note: S.cc.subsetHint } : {}) })) };
      },
    };
  },
};

/**
 * Pico SDK C (P1-F2, ADR-0012, research D33): the real Pico SDK compiled in the browser by an own clang/lld WebAssembly
 * build in a Worker (full/). An image language (contract v10 draft): `build` gives an ELF that goes through loadImage like an
 * imported one. Its compiler and SDK pack are an optional download (`download`), fetched only after the shell's notice and
 * cached; `load` itself loads only the small client.
 */
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
  id: 'sdk-c', label: S.full.label, extension: '.c', image: true, example: SDK_EXAMPLE, // P1-L1: a new .c file in Full starts with it
  // the built ELF as a UF2 file for the board's BOOTSEL drive (firmware/uf2.js: as picotool writes it)
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
        // P1-M8 (design Q5): each .pio file is assembled (pio/asm.js) into <file>.pio.h for the C files, as pico_generate_pio_header
        if (files.some((x) => /\.pio$/i.test(x.name))) {
          const pr = (await import('./pio/asm.js')).withPioHeaders(files);
          if (!pr.ok) return { ok: false, image: null, times: {}, log: '', diagnostics: pr.diagnostics };
          files = pr.files;
        }
        const r = await fc.build(files);
        // notes only where they point into the project; SDK headers named in the message (the editor cannot open them)
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
  strings: S, // merged over the shell's
  capabilities: {
    ...Object.fromEntries(['assembler', 'backStep', 'breakpoints', 'watchpoints', 'runToCursor', 'share'].map((k) => [k, true])),
    cLanguage: true, // P1-C2 (D18): the app's C subset with the pico2 target (c/target.js)
    exportTrace: true, // P1-M3: per-step trace with the cost model's cycles (exports.js)
    waveform: true,    // P1-M3: the waveform tab and VCD export of the pipeline view (stage model)
    imageImport: true, // P1-C1: UF2, ELF and .bin files built with the Pico SDK
    projects: true,    // P1-F1 (research D31): projects of several files (explorer, tabs, IndexedDB, zip, links v2)
    worker: true,      // P1-M4: long runs in the shell's Worker (the snapshot carries the step-back checkpoints)
    realtime: true,    // P1-M4 (research D36): paced real-time runs in the Worker (Engine.advance, clock, live)
    audio: true,       // P1-M5 (research D39): the speaker pin as sound (Engine.drainAudio, the shell's AudioWorklet)
    exercises: true,   // P1-M9 (research D45 Q4): practice exercises and exercise files (exercise.js)
    ...Object.fromEntries(['stepOver', 'callStack', 'scratch', 'gccImport', 'dataIO', 'uninitCheck',
      'exportGolden', 'exportImage'].map((k) => [k, off('laterMilestone')])),
    ...Object.fromEntries(['memoryModel', 'cache', 'devices', 'traps'].map((k) => [k, off('noDevices')])),
    compare: off('oneProcessor'),
  },
  // P1-C1: SDK-built programs (UF2, ELF, .bin) through the strict validator (firmware/import.js)
  // P1-L1 (research D34, contract v10 draft): with `source` (a MAVILERA C program: its file, text and the compiler's line
  // map) the program gets the `debug` record the C source view reads (debug/cc-lines.js)
  language: { id: 'asm', extension: '.s', comment: '#', defaultSource: DEFAULT_SOURCE, disassemble, editor, loadImage, imageKinds: ['uf2', 'elf', 'bin'],
    extraExtensions: ['.pio'], // P1-M8 (design Q5): PIO programs in Pico Full projects (contract v10 draft Language.extraExtensions)
    // research D43 (P1-M8 Q3 B; contract v10 draft Language.companion): in Lite, a .pio file beside the program, in a second editor
    // tab opened on demand; assembled with an assembly program (language.js), included by a MAVILERA C program as "<file>.pio.h"
    companion: { extension: '.pio', label: S.pioFile.label, add: S.pioFile.add, addTitle: S.pioFile.addTitle, remove: S.pioFile.remove,
      example: S.pioFile.example, comment: ';', editor: PIO_EDITOR },
    options: [CLOCK_OPTION, SPEAKER_OPTION, DAC_OPTION, PARTS_OPTION], // P1-M4 (D36 Q2): the clock, passed to assemble and compile; P1-M5: the speaker; P1-M7: the parts
    // research D38 (contract v10 draft Language.lineStep): Step line and Back line on the editor for a program with a line
    // table (MAVILERA C, Pico SDK C), with the C source view's rules (debug/source-session.js) on the shell's own engine
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
    extraLanguages: [cLanguage, sdkLanguage] }, // P1-C2: MAVILERA C (Lite); P1-F2: Pico SDK C (Full, research D34 Q6)
  // P1-L1 (ADR-0011, research D34): Pico Lite (the default: one file in assembly or MAVILERA C, simulated; one state-aware
  // Build/Run/Pause button) and Pico Full (projects in Pico SDK C and assembly; built and imported programs)
  editions: [
    { id: 'lite', label: S.editions.lite, title: S.editions.liteTitle, languages: ['c'], primary: true,
      capabilities: { projects: off('fullEdition'), imageImport: off('fullEdition') } },
    // P1-M9 (research D45 Q1): Pico Full stays on the development page until its gates pass (the modest-laptop run D29, the
    // compiler's rebuild, the licence review and hosting of its pack, D9/D33): a release page and the offline file offer Lite only
    { id: 'full', label: S.editions.full, title: S.editions.fullTitle, compiler: 'sdk-c', development: true },
  ],
  // P1-M4 (ADR-0005: a floor of 1 MHz in real-time mode; ADR-0007, research D36 Q6: postMessage, a SAB ring when isolated)
  realtime: { floorHz: 1e6, transports: ['sab', 'postMessage'] },
  // P1-M5 (ADR-0005, research D39; contract v10 Descriptor.audio): 48 kHz mono; the shell's AudioWorklet processor (src/worker/)
  audio: { sampleRate: 48000, channels: 1, processor: 'worker/audio-processor.js' },
  // P1-M4 (D36 Q3, Q9): the Pins panel (30 GPIOs as lamps and inputs) and UART typing in the console (contract v10 draft
  // Descriptor.console: the line goes to Engine.input as {kind: 'uart', uart: 0, bytes}, followed by a carriage return)
  panels: [{ id: 'pins', label: S.pins.tab, load: async () => {
    const { PinsPanel } = await import('./ui/pins-panel.js');
    return { create: (ctx) => new PinsPanel(ctx) };
  } },
  // P1-M5 (research D39 Q8): the PWM slices and DMA channels, decoded (Engine.panelState)
  { id: 'pwm', label: S.devices.pwmTab, load: async () => { const { PwmPanel } = await import('./ui/devices-panel.js'); return { create: () => new PwmPanel() }; } },
  { id: 'dma', label: S.devices.dmaTab, load: async () => { const { DmaPanel } = await import('./ui/devices-panel.js'); return { create: () => new DmaPanel() }; } },
  // P1-M7 (design Q3, research D43: three tabs): the ADC, the SPI blocks and the I2C blocks decoded, each bus with its log
  { id: 'adc', label: S.devices.adcTab, load: async () => { const { AdcPanel } = await import('./ui/devices-panel.js'); return { create: () => new AdcPanel() }; } },
  { id: 'spi', label: S.devices.spiTab, load: async () => { const { SpiPanel } = await import('./ui/devices-panel.js'); return { create: () => new SpiPanel() }; } },
  { id: 'i2c', label: S.devices.i2cTab, load: async () => { const { I2cPanel } = await import('./ui/devices-panel.js'); return { create: () => new I2cPanel() }; } },
  // P1-M8 (design Q6): the PIO blocks, their programs and state machines
  { id: 'pio', label: S.pio.tab, load: async () => { const { PioPanel } = await import('./ui/pio-panel.js'); return { create: () => new PioPanel() }; } }],
  console: { input: { kind: 'uart', uart: 0, lineEnd: [13], label: S.uartType.label, placeholder: S.uartType.placeholder, title: S.uartType.title } },
  // P1-F2: the Pico SDK compiler and pack, downloaded on demand and cached; outside the module's 2 MB budget (ADR-0012)
  assets: { optional: [{ id: 'pico-full', label: S.full.assetLabel, base: 'pico-full/' }] },
  registers: {
    groups: [
      { id: 'x', label: S.registerGroup, registers: ABI.map((n, i) => ({ id: `x${i}`, name: n, aliases: [`x${i}`], width: 32, ...(i === 0 ? { zero: true } : {}) })) },
      { id: 'csr', label: S.csrGroup, registers: CSR_VIEW.map(([id]) => ({ id, name: id, width: id === 'priv' ? 2 : 32 })) },
      // P1-M6 (design Q4 A): core 1's registers (zero until it is launched)
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
    // Hazard3's F, X and M cycle by cycle on the stage model (P1-M3; drawing approved by the author 2026-11-06, Q6); loaded
    // with its tab (WS-N-011)
    // layout (contract v10 draft): the drawing gets more height and the editor less width than the shell's defaults, so that
    // the 1240 x 640 drawing is drawn larger (author's request, 2026-11-07)
    { id: 'pipeline', label: S.viewPipeline, icon: 'pipeline', kind: 'datapath', profile: 'hazard3', layout: { drawing: 0.76, editor: 0.19 }, load: async () => {
      const { PipelineView, pipelineInstance } = await import('./ui/pipeline-view.js');
      return { create: (ctx) => pipelineInstance(new PipelineView(), ctx) };
    } },
    // the C lines of an imported ELF program, stepped by line (P1-C1, design §4, decision Q1 A); loaded with its tab
    // research D38: offered only while the program is an image opened from a file (its sources are not in the editor); a
    // program built in the browser steps by C line in the editor (Language.lineStep)
    { id: 'source', label: S.viewSource, icon: 'code', kind: 'datapath', profile: 'hazard3', imageOnly: true, layout: { drawing: 0.72, editor: 0.19 }, load: async () => {
      const { SourceView, sourceInstance } = await import('./ui/source-view.js');
      return { create: (ctx) => sourceInstance(new SourceView(ctx), ctx) };
    } },
  ],
  exports: { trace: (program, { cap }) => trace(program, { cap }), traceJsonLines, traceCsv },
  // exercise files (WS-F-148; P1-M9, research D45 Q4-Q5): the module is loaded with the first exercise (WS-N-011)
  exercises: {
    parse: async (raw) => (await import('./exercise.js')).parseExercise(raw),
    run: async (program, exercise) => (await import('./exercise.js')).runExercise(program, exercise),
  },
  // the header lockup (contract v6; from branch pico2/logo be142f6); P1-L1: the ten templates (research D34 Q8); P1-M9 (research
  // D45): the practice exercises and the guide of the documentation gate
  content: { logo: 'mavilera-logo-pico2.svg', templates: 'content/pico2/templates/index.json', exercises: 'content/pico2/exercises/index.json',
    help: 'content/pico2/help/help.json', docs: 'content/pico2/help/docs/index.html' },
};
