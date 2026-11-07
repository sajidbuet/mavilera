// contract.js -- the architecture contract (spec W-D29; docs/architecture/arch-contract.md §3). The shell reads one
// descriptor per architecture and nothing else about it: the language (assembler, disassembler, editor data), the
// registers, the address space, the instruction-level engine, the views, the capabilities, the strings and the
// content. The engines, assemblers and models stay with the architecture; the shell never imports them.
// Pure JavaScript, no DOM: the descriptor's own modules run under Node.js for the conformance suite
// (test/arch-contract.test.mjs). Contract version 1, approved and frozen by the author on 2026-10-28; version 2
// (optional hooks for what the RISC-V panels show, arch-contract.md §12) approved on 2026-10-28; version 3 (a note and
// a length on assembly diagnostics, a step count in the engine state, §13) approved on 2026-10-28; version 4 (view
// headings, tabs and state, waveforms, view commands, exports, importers, scratch, exercises, §14) approved on
// 2026-10-28; version 5 (editor help, extra-language options, view settings and notes, the engine's platform, data
// reads, `assembled` and the profile kind of a diagnostic, §16) approved on 2026-10-29; version 6 (`content.docs` and
// `content.logo`, §19) approved on 2026-10-29; version 7 (`ViewInstance.diagrams`, pan and zoom, §20) approved on
// 2026-10-29; version 8 (inputs between steps and the architecture's panels, for SAP-2's ports, §25) approved on
// 2026-10-30; version 9 (profile variants with their own language, registers and address space, for the GPU's two
// instruction sets, §26) approved on 2026-11-04; version 10 (a paced real-time Worker, an audio sink, an optional
// SharedArrayBuffer transport and `.wasm` assets, for the `pico2` module, §27) DRAFTED 2026-11-06, the four extensions
// approved in principle by the author on 2026-11-05 (ADR-0008 in the research repository), the field shapes awaiting
// approval. A change raises CONTRACT_VERSION and is recorded in docs/architecture/arch-contract.md.
//
// Decisions of 2026-10-28 that the shell implements on this contract:
// - the fields inspector uses Language.fields(); without it the inspector is disabled with a reason;
// - a register shows ceil(width / 4) hexadecimal digits (RISC-V: 8, unchanged);
// - watched registers are stored by register id; an older stored register number is migrated once on load;
// - share links and settings files carry the architecture id (`arch`); none means 'riscv', so older links open as
//   before, and a link of another architecture is refused with a message naming it.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const CONTRACT_VERSION = 10;

/**
 * The output an engine keeps (author, 2026-10-29): when its output passes twice this many characters, the oldest are
 * dropped down to this many and counted in EngineState.outputDropped, so that a run that never halts cannot fill the
 * browser's memory. Stepping back past what was dropped leaves the output from that point only.
 */
export const OUTPUT_KEEP = 1 << 20;

/**
 * Why a run or a step stopped: shared by every engine and view, so that the shell writes the messages. An engine
 * may return only these values.
 */
export const STOP = Object.freeze({
  NONE: 'none', // the step completed and nothing asks to stop
  HALT: 'halt', // the program ended (the architecture's halting rule)
  ERROR: 'error', // the engine could not continue; Engine.state().error says why
  BREAK: 'break', // a breakpoint address was reached
  WATCH: 'watch', // a watched register or memory word changed
  BUDGET: 'budget', // the run limit was reached
  TARGET: 'target', // the target of run to cursor, step over or step out was reached
  PAUSE: 'pause', // the user paused the run
  CHUNK: 'chunk', // a slice of a run ended; the shell continues it
});

/**
 * Capabilities: what the shell offers. Each is `true`, or `false` with the reason shown on the disabled item
 * (W-D29: unsupported items stay visible, disabled with a stated reason). An absent key is `false`, with the
 * generic reason of the shell's strings.
 */
export const CAPABILITIES = Object.freeze([
  'assembler', // the editor assembles source (otherwise the architecture only loads images)
  'cLanguage', // the C subset compiler (W-D29: RISC-V only)
  'backStep', // step back (WS-F-090)
  'breakpoints', // breakpoints on listing lines
  'watchpoints', // watched registers and memory words
  'stepOver', // step over and step out (needs the architecture's call convention)
  'callStack', // the call-stack panel (WS-F-143)
  'runToCursor',
  'scratch', // the one-line scratch assembler
  'imageImport', // opening .hex and .bin images
  'gccImport', // importing GCC output
  'dataIO', // loading files into data arrays and saving memory ranges (WS-F-145)
  'uninitCheck', // the uninitialised-value check (WS-F-147)
  'memoryModel', // the memory-model dialog: timing and caches (W-D28)
  'cache', // the Cache tab
  'devices', // the Peripherals tab and the platform board (W-D26)
  'traps', // a profile with traps and privileged state
  'compare', // the comparison view
  'waveform', // the waveform tab and VCD export (WS-F-146)
  'exercises', // exercise files and the practice exercises (WS-F-148)
  'share', // share links and settings files (WS-F-122)
  'exportTrace', // trace export, JSON lines and CSV (WS-F-126)
  'exportGolden', // golden-dump export (WS-F-124)
  'exportImage', // .hex and .bin export
  'worker', // long runs in a Worker (the engine's snapshot is structured-clonable)
  'realtime', // v10: a paced real-time run in a Worker with devices present (needs Descriptor.realtime, Engine.advance)
  'audio', // v10: audio output through an AudioWorklet (needs Descriptor.audio, Engine.drainAudio)
]);

/** v10. The transports a real-time run may use between the Worker and the page; the shell picks 'sab' only when the page is crossOriginIsolated. */
export const REALTIME_TRANSPORTS = Object.freeze(['postMessage', 'sab']);

/** The kinds of view the shell can host; the view draws itself inside the pane the shell gives it. */
export const VIEW_KINDS = Object.freeze(['isa', 'datapath', 'bus', 'compare']);

/**
 * @typedef {object} Descriptor
 * @property {number} contract            CONTRACT_VERSION the descriptor was written against
 * @property {string} id                  URL segment and storage prefix ('riscv', 'sap1'); [a-z0-9-]+
 * @property {string} name                display name ('RISC-V', 'SAP-1')
 * @property {Record<string, any>} strings  the architecture's interface strings, merged over the shell's
 * @property {Record<string, true | {enabled: false, reason: string}>} capabilities  keys from CAPABILITIES
 * @property {Language} language
 * @property {Registers} registers
 * @property {AddressSpace} addressSpace
 * @property {{create: (program: Program, options?: object) => Engine, profiles?: Profile[]}} engine
 * @property {View[]} views               the first is the default; its kind is 'isa'
 * @property {{timing?: boolean, cache?: boolean, devices?: boolean}} [memorySystem]  which src/mem features apply
 * @property {{examples?: string, templates?: string, help?: string, exercises?: string, docs?: string, logo?: string}} [content]
 *           URLs, relative to the application; v6: `docs`, the documentation the help dialog links to (none: no link),
 *           `logo`, the header lockup, a file of content/branding/mavilera/ (none: mavilera-logo.svg, RISC-V's)
 * @property {Exports} [exports]         v4: the architecture's export formats
 * @property {{parse: (raw: object) => object, run: (program: Program, exercise: object) => object[]}} [exercises]
 *           v4: exercise files (capability exercises)
 * @property {Panel[]} [panels]           v8: the architecture's own panels, as tabs of the shared memory pane
 * @property {Record<string, {label: string, load: () => Promise<VariantOverrides>, legacy?: boolean}>} [variants]  v9: the profile variants
 *           (GPU: the micro-ISA beside the RISC-V SIMT core); a profile names its variant in `Profile.variant`, profiles
 *           without one belong to the descriptor's own fields. The shell resolves the variant when the page starts
 *           (withVariant) and reloads the page to change it (§26); `legacy` (at most one): the variant that holds the
 *           module's profiles of before v9, to which the shell moves the program and workspace stored then, once
 * @property {string | null} [activeVariant]  v9: set by withVariant on the merged descriptor (null: the descriptor's own)
 * @property {{floorHz: number, transports?: string[]}} [realtime]  v10 (capability realtime): the real-time run. `floorHz`:
 *           the guaranteed floor of simulated instructions or cycles per second in real-time mode (ADR-0005: 1e6); the
 *           shell's Worker paces the engine by calling Engine.advance and reports the achieved rate. `transports`: from
 *           REALTIME_TRANSPORTS, in order of preference (default ['postMessage']); the shell uses 'sab' only when the
 *           page is crossOriginIsolated and falls back to postMessage otherwise
 * @property {{sampleRate: number, channels?: number, processor: string}} [audio]  v10 (capability audio): the audio sink.
 *           `sampleRate` in Hz of the frames Engine.drainAudio returns; `channels` (default 1); `processor`: the
 *           AudioWorklet module, a path relative to the application, loaded by the shell on the first run
 * @property {{wasm?: string[]}} [assets]  v10: files other than JavaScript, CSS and JSON that the module loads; `wasm`:
 *           WebAssembly modules, relative paths ending '.wasm'. They count in the module's 2 MB budget (WS-N-004)
 */

/**
 * v9. What a variant replaces: each key present replaces the descriptor's; `capabilities` and `strings` are merged over
 * the descriptor's, `content` takes only `templates` and `help`. The id, name, logo and engine stay the module's
 * (`engine.create` reads the profile from the program).
 *
 * @typedef {{language?: Language, registers?: Registers, addressSpace?: AddressSpace, views?: View[], panels?: Panel[],
 *   exports?: Exports, exercises?: object, capabilities?: Record<string, any>, strings?: Record<string, any>,
 *   content?: {templates?: string, help?: string}}} VariantOverrides
 */
export const VARIANT_KEYS = Object.freeze(['language', 'registers', 'addressSpace', 'views', 'panels', 'exports', 'exercises',
  'capabilities', 'strings', 'content']);
const VARIANT_CONTENT = ['templates', 'help'];

/** The variant of a profile (v9): its `variant`, or null (the descriptor's own); undefined for an unknown profile. */
export function variantOf(d, profileId) {
  const p = d.engine?.profiles?.find((x) => x.id === profileId);
  return p ? p.variant ?? null : undefined;
}

/** The profiles of a variant (null: the descriptor's own), in the order of engine.profiles. */
export const variantProfiles = (d, variant) => (d.engine?.profiles ?? []).filter((p) => (p.variant ?? null) === variant);

const isPlain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o) && Object.getPrototypeOf(o) === Object.prototype;
/** Strings merged as mergeStrings merges them: nested plain objects key by key, anything else replaced. */
function mergeDeep(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) out[k] = isPlain(v) && isPlain(base?.[k]) ? mergeDeep(base[k], v) : v;
  return out;
}

/**
 * v9. The descriptor as the shell sees it in a variant: the variant's overrides over the descriptor (null or an
 * unknown variant: the descriptor itself, with activeVariant null). Throws if an override has a key VARIANT_KEYS
 * does not list, or content other than templates and help.
 */
export async function withVariant(d, variant) {
  if (!variant || !d.variants?.[variant]) return { ...d, activeVariant: null };
  const o = await d.variants[variant].load();
  const extra = Object.keys(o ?? {}).filter((k) => !VARIANT_KEYS.includes(k));
  if (extra.length) throw new Error(`variant ${variant}: ${extra.join(', ')} cannot be replaced`);
  const extraContent = Object.keys(o.content ?? {}).filter((k) => !VARIANT_CONTENT.includes(k));
  if (extraContent.length) throw new Error(`variant ${variant}: content.${extraContent.join(', content.')} cannot be replaced`);
  const out = { ...d, activeVariant: variant };
  for (const k of VARIANT_KEYS) {
    if (o[k] === undefined) continue;
    if (k === 'capabilities') out.capabilities = { ...d.capabilities, ...o.capabilities };
    else if (k === 'strings') out.strings = mergeDeep(d.strings, o.strings);
    else if (k === 'content') out.content = { ...d.content, ...o.content };
    else out[k] = o[k];
  }
  return out;
}

/**
 * v8 (approved by the author, 2026-10-30). A panel the architecture draws (SAP-2: the ports), shown as a tab of the shared memory pane
 * after the shell's; loaded when the page starts.
 *
 * @typedef {object} Panel
 * @property {string} id
 * @property {string} label                the tab's name
 * @property {() => Promise<{create: (ctx: PanelContext) => PanelInstance}>} load
 *
 * @typedef {object} PanelContext
 * @property {Record<string, any>} strings
 * @property {(input: object) => void} input  an input between steps (Engine.input): the shell gives it to the engine,
 *           to the Worker during a long run, or to the view in use (ViewInstance.input), then redraws
 * @property {(text: string, kind?: string) => void} message   to the console
 *
 * @typedef {object} PanelInstance
 * @property {Element} root
 * @property {(state: {registers: Record<string, number>, steps: number, clock: boolean} | null, o: {accepts: boolean, running: boolean}) => void} update
 *           after every change of the state (`clock`: `steps` counts the clocks of the view in use); `accepts`: whether an input can be given now (a program is loaded and the
 *           engine or the view in use takes inputs)
 */

/**
 * v4. Each export is offered when its capability is on.
 *
 * @typedef {object} Exports
 * @property {(program: Program, options: {profile: string, platformConfig?: object, cap: number, inputs?: object[]}) => {records: object[], error: string | null}} [trace]
 *           capability exportTrace, with traceJsonLines(records) and traceCsv(records); v8: `inputs`, the
 *           engine's input log (Engine.inputs), replayed in the trace
 * @property {(records: object[]) => string} [traceJsonLines]
 * @property {(records: object[]) => string} [traceCsv]
 * @property {(model: object) => {text: string, count: number}} [golden]  capability exportGolden: the golden dump of a
 *           view's export model after its run
 * @property {(program: Program) => {hex: string, bin: Uint8Array}} [image]  capability exportImage
 */

/**
 * @typedef {object} Language
 * @property {string} id                  'asm'
 * @property {string} extension           source file extension ('.s', '.asm')
 * @property {string} comment             line-comment prefix ('#', ';', '@')
 * @property {string} defaultSource       the program shown on a first visit
 * @property {(files: {name: string, text: string}[], options?: {profile?: string, subset?: string,
 *             data?: {label: string, bytes: Uint8Array}[]}) => Program} assemble
 *           v2: `subset` of the profile; `data`, files loaded into data arrays (capability dataIO)
 * @property {(word: number, address: number, options?: {aliases?: boolean, names?: string}) => string} disassemble
 *           v2: `options` as declared by `disassembly`
 * @property {{aliases?: boolean, names?: string[]}} [disassembly]  v2: the disassembly options the listing offers;
 *           `names[0]` is the default register naming
 * @property {{mnemonics: string[], registers: string[], directives: string[],
 *             hover?: (token: string) => string | null,
 *             help?: (word: string) => EditorHelp | null,
 *             detail?: (word: string, kind: 'mnemonic'|'register') => string}} editor  completion and hover data (WS-F-140);
 *           v5: `help`, the hover help of a word, and `detail`, a completion's second column
 * @property {(word: number, address: number) => {name: string, bits: string, value: number, meaning?: string, short?: string}[]} [fields]
 *           the encoding fields of an instruction, for the inspector; `bits` like '31:25' (absent: inspector disabled);
 *           v2: `short`, the label under the field's bits in the listing
 * @property {(word: number, address: number) => {kind?: string, immediate?: number} | null} [describe]
 *           v2: the format name and immediate of a word, for the listing's word tooltip
 * @property {() => Promise<{create: (ctx: {strings: Record<string, any>}) => {root: Element, show: (row: object | null) => void}}>} [inspector]
 *           v2: an inspector owned by the architecture, loaded on first use; without it the shell builds one from `fields`
 * @property {ExtraLanguage[]} [extraLanguages]  other source languages (RISC-V: C, with capability cLanguage)
 * @property {(content: string | Uint8Array, kind: 'hex'|'bin', name: string, options?: {profile?: string}) => Program} [loadImage]
 *           v4: a program from a .hex or .bin image (capability imageImport)
 * @property {() => Promise<{id: string, test: (text: string) => boolean, convert: (text: string, name: string) => {text: string, report: {message: string, kind?: string, line?: number, note?: string}[]}}[]>} [importers]
 *           v4: other assemblers' output turned into this language (RISC-V: GCC; capability gccImport), loaded on first use
 * @property {(text: string) => {kind: 'empty'|'decode'|'encode', ok: boolean, text?: string, rows?: object[], error?: object}} [scratch]
 *           v4: the one-line scratch assembler (capability scratch); `rows` are listing rows for the inspector
 */

/**
 * v5. The hover help of an editor word.
 *
 * @typedef {object} EditorHelp
 * @property {'instruction'|'pseudo'|'register'} kind
 * @property {string} [usage]       the operand syntax ('add rd, rs1, rs2')
 * @property {string} [format]      the encoding format, worded ('R-type')
 * @property {string} [operation]   what it does, in register-transfer notation
 * @property {string} [text]        a register's help
 */

/**
 * A source language compiled to the architecture's assembly language (v5: options, example and the result specified).
 *
 * @typedef {object} ExtraLanguage
 * @property {string} id
 * @property {string} label
 * @property {string} [extension]   v5: '.c'
 * @property {string} [example]     v5: the source shown on a first visit
 * @property {{id: string, label: string, title?: string, values: {id: string, label: string}[], default: string,
 *             profiles?: string[]}[]} [options]  v5: the compiler's options; shown only for the listed profiles (all if absent)
 * @property {() => Promise<{compile: (text: string, options: {name: string, profile: string, subset?: string | null,
 *             options: Record<string, string>}) => {ok: boolean, text: string, lines: number[], diagnostics: Program['diagnostics']}}>} load
 *           v5: loads the compiler on first use; its `compile` is synchronous, so that assembling stays so (made while
 *           implementing §16, which had an asynchronous `compile`). `text` the assembly, `lines` the source line of each
 *           assembly line (0: library code)
 * @property {(d: Program['diagnostics'][number]) => string | null} [asmNote]  v5: a note for a diagnostic of the generated
 *           assembly (RISC-V: the processor views' small memories)
 */

/**
 * @typedef {object} Program            what an assembler returns
 * @property {boolean} ok                no error diagnostic
 * @property {boolean} [assembled]       v5: code was produced although `ok` is false (RISC-V: instructions outside the profile)
 * @property {{severity: 'error'|'warning', file?: string, line?: number, column?: number, length?: number, message: string,
 *             note?: string, kind?: 'profile'}[]} diagnostics  v3: length, characters from column (the editor marks them);
 *           note, a hint line worded by the architecture; v5: kind 'profile', an instruction outside the profile (the
 *           console's error count leaves it out)
 * @property {{address: number, bytes: Uint8Array, executable: boolean}[]} segments
 * @property {number} entry
 * @property {{address: number, size: number, word: number, text: string, file?: string, line?: number,
 *             part?: number, source?: string}[]} listing
 *           one row per instruction or data item; `size` in bytes, `word` its value (up to 32 bits); v2: `part` 0 for
 *           the first row of a source line, more for a later row of its expansion, -1 for a row without source;
 *           `source` the pseudo-instruction the row came from
 * @property {Record<string, number>} symbols
 * @property {{address: number, bytes: Uint8Array, file?: string, line?: number, text?: string}[]} [data]  v2: the data listing
 * @property {{name: string, address: number, section?: string, file?: string, line?: number}[]} [symbolTable]  v2
 * @property {{applied: {label: string, n: number}[], dropped: {label: string, why: string}[]}} [loadReport]  v2: data loads
 */

/**
 * @typedef {object} Registers
 * @property {RegisterGroup[]} groups     shown in this order; each register has a stable `id` across the contract
 * @property {string} pc                  id of the program counter (its own register, or one of a group: ARM r15)
 * @property {{id: string, fields: {name: string, bit: number, width?: number}[]}} [status]  a status register shown
 *           bit by bit (ARM CPSR: N Z C V), whose id is in a group
 * @property {{sp?: string, fp?: string}} [roles]  v2: the stack and frame pointers, for the memory panel's marks
 *
 * @typedef {object} RegisterGroup
 * @property {string} id
 * @property {string} label
 * @property {{id: string, name: string, aliases?: string[], width: number, zero?: boolean, hidden?: boolean}[]} registers
 *           `width` in bits (1 to 32); `zero`: reads as zero, writes ignored; `hidden`: internal, not in the panel
 *           unless the view shows it (SAP-1 MAR, IR)
 */

/**
 * @typedef {object} AddressSpace
 * @property {number} addressBits         4 (SAP-1) to 32
 * @property {number} unitBits            bits per address (8: byte-addressed)
 * @property {number} wordBytes           bytes per memory-panel word (1 for SAP-1, 4 for RISC-V and ARMv7)
 * @property {'little'|'big'} endianness
 * @property {{name: string, base: number, size: number, kind: 'ram'|'rom'|'device'}[]} regions
 */

/**
 * @typedef {object} Profile            an instruction-level machine variant (RISC-V: iss, iss-priv)
 * @property {string} id
 * @property {string} label
 * @property {Record<string, true | {enabled: false, reason: string}>} [capabilities]  overrides of the descriptor's
 * @property {'sparse'|'harvard'|'unified'} [memory]  v2: the memory organisation ('harvard': the data memory holds no code)
 * @property {number | null} [stackTop]   v2: the top of the stack, for the memory panel's stack region
 * @property {{id: string, label: string}[]} [subsets]  v2: instruction subsets of the profile; the first is the
 *           default (RISC-V: the whole Chapter 6 subset)
 * @property {string} [variant]           v9: the id of its variant (Descriptor.variants); absent: the descriptor's own
 *
 * v2: `engine.profiles` lists every profile the profile menu offers; the first is the default.
 */

/**
 * The instruction-level engine. One instance per loaded program; `reset` returns it to the loaded state.
 *
 * @typedef {object} Engine
 * @property {() => void} reset
 * @property {() => StepRecord | null} step   one instruction; null once halted or stopped by an error
 * @property {() => boolean} back             undo the newest step (capability backStep); false if none is left
 * @property {(options: {chunk?: number, breakpoints?: Set<number>, target?: number | null, depth?: number | null,
 *             resumed?: boolean, watch?: {registers?: Set<string>, memory?: Set<number>}}) => string} run
 *           returns a STOP value. v2: `watch` stops with WATCH after a write to a watched register or word;
 *           `depth` with `target`: stop there only at that call depth or shallower; `resumed`: a later slice of
 *           the same run, so a breakpoint or target at its first instruction stops it
 * @property {() => EngineState} state
 * @property {() => StepRecord | null} last  v2, required: the newest step's record; null after a reset or after
 *           stepping back to the start
 * @property {(address: number, length: number) => Uint8Array} peek   memory without side effects (devices too)
 * @property {() => object} snapshot          structured-clonable (capability worker). The Worker loads the
 *           architecture by id, calls engine.create(program, options) and restore(snapshot), runs, and returns
 *           snapshot(); the page restores it
 * @property {(snapshot: object) => void} restore
 * @property {(budget: {cycles: number}) => {cycles: number, stop: string}} [advance]  v10 (capability realtime): run for
 *           about `budget.cycles` of the architecture's clock without recording step-back history, and return the cycles
 *           actually run and a STOP value (CHUNK: the budget is used up). Device events due within the slice happen
 *           in order. Inputs given with Engine.input between slices carry the cycle they arrive at (deterministic replay)
 * @property {(maxFrames: number) => {frames: Float32Array[], atCycle: number} | null} [drainAudio]  v10 (capability audio):
 *           the audio frames produced since the last call, one array per channel, at Descriptor.audio.sampleRate (at
 *           most `maxFrames`), with the cycle of the first frame; null if none
 * @property {() => number} [callDepth]      v2 (capability stepOver needs the three call hooks)
 * @property {() => number | null} [stepOverTarget]  v2: the address after a call at the PC, or null
 * @property {() => number | null} [stepOutTarget]   v2: the return address of the innermost call, or null
 * @property {() => {from: number, to: number} | null} [loopRange]  v2: addresses of the last instructions before
 *           the run limit stopped a run
 * @property {() => {kind: string, message: string, pc?: number, note?: string, at?: number}[]} [diagnostics]  v2: every
 *           warning since the reset, worded by the architecture; the shell shows the new ones. With `at` (the step
 *           count at which it arose) an entry is shown once, even after stepping back over it; without, a kind's
 *           entries are counted, and stepping back takes the count as shown
 * @property {() => [string, number | string][]} [counters]  v2: the counters panel
 * @property {() => {depth: number, name?: string, target: number, call: number, ret: number, site?: string,
 *             sp: number | null, args: {name: string, value: number}[]}[]} [callStack]  v2 (capability callStack)
 * @property {() => {address: number, size: number} | null} [dataAccess]  v2: the next instruction's data access
 * @property {() => {platform: object, memsys: object | null, cycle: number, retired: number, traps: number, idle: number,
 *             privileged: {rows: [string, string][], mode: string, violations: string[] | null} | null} | null} [platform]
 *           v5: the devices of the platform board (src/mem/platform.js) and the processor's privileged state, worded by the
 *           architecture: the table's rows, the mode as the board names it, and the findings of a trap check (null when it
 *           is off); null without devices. (§16 drafted `privileged` as rows only; the board also needs the mode and the
 *           trap check.)
 * @property {(input: object) => void} [input]  v8: an input from the interface between steps (SAP-2: a key on
 *           port 1, the SERIAL IN switch), worded by the architecture. The engine logs it with its step count; stepping
 *           back past that step withdraws it, and reset() returns to the inputs the engine was created with
 * @property {() => object[]} [inputs]        v8: the input log, structured-clonable; `create(program, {inputs})`
 *           replays it at the same step counts (a reload; the snapshot carries it to the Worker)
 *
 * @typedef {object} EngineState
 * @property {number} pc
 * @property {Record<string, number>} registers   by register id, every register of `Registers.groups`
 * @property {boolean} halted
 * @property {string | null} error
 * @property {number} retired                 instructions completed since the reset
 * @property {number | null} [exitCode]
 * @property {string} [output]                console output so far: at most the last OUTPUT_KEEP to 2 × OUTPUT_KEEP characters
 * @property {number} [outputDropped]         v7 (author, 2026-10-29): characters of output no longer kept (the engine cap)
 * @property {number} [historyDropped]        v2: steps no longer kept for step back
 * @property {number} [steps]                 v3: steps since the reset (a trap may be a step that retires nothing); a
 *           reload replays this many
 *
 * @typedef {object} StepRecord             what one step changed (the shell highlights and journals it)
 * @property {number} pc                      address of the instruction
 * @property {number} word                    its encoding
 * @property {number} size                    its length in bytes
 * @property {number} nextPc
 * @property {{id: string, old: number, value: number}[]} registers   every register written (ARM LDM: several)
 * @property {{address: number, size: number, old: number, value: number}[]} memory  every memory write
 * @property {{address: number, size: number}[]} [reads]  v5: every data read (the fetch is `pc` and `size`)
 * @property {boolean} [executed]             false: a condition failed and nothing but the PC changed (ARM)
 * @property {boolean} [halt]
 * @property {string} [output]
 * @property {{cause: number, label: string}} [trap]
 */

/**
 * A view: one tab of the toolbar. The shell gives it a pane and the services it needs; the view draws itself and
 * drives its own model. Views that are not of kind 'isa' load on first use.
 *
 * @typedef {object} View
 * @property {string} id                      stable: share links and storage keep it
 * @property {string} label
 * @property {string} icon                    a name of src/ui/icons.js
 * @property {'isa'|'datapath'|'bus'|'compare'} kind
 * @property {string} [profile]               the engine profile its programs are assembled for
 * @property {() => Promise<{create: (ctx: ViewContext) => ViewInstance}>} [load]  not for kind 'isa'
 * @property {string} [names]                 v2: the register naming of the listing in this view (`disassembly.names`)
 * @property {boolean} [subsets]              v2: the view offers its profile's subsets
 * @property {{key: string, defaults: Record<string, string>, values: Record<string, string[]>}} [settings]  v5: the view's
 *           settings as links, settings files and storage carry them without loading the view (`key`: their name in a link)
 * @property {(entry: object) => Promise<string | null>} [openNote]  v5: a warning when an example or template opens in the view
 *
 * @typedef {object} ViewContext
 * @property {Record<string, any>} strings
 * @property {(text: string, kind?: string) => void} message   to the console
 * @property {object | null} memsys           the shared memory system when the view uses it (memorySystem)
 * @property {(target: {panel?: 'registers'|'memory', tab?: string}) => void} [openPanel]  v2: a drawing element opens
 *           a shell panel or one of the view's tabs
 * @property {() => void} [refresh]           v2
 * @property {(cycle: number) => void} [goToCycle]  v2
 * @property {(name: 'stepUnit'|'backUnit') => void} [command]  v4: the view's own buttons run the shell's command
 * @property {() => object} [memConfig]       v4: the memory setting, for a view that builds its own models
 * @property {(name: string, data: string | Uint8Array, type?: string) => void} [download]  v4
 *
 * @typedef {object} ViewInstance
 * @property {Element} root                   the main pane
 * @property {string} title                   v4, required: the main pane's heading
 * @property {string} infoTitle               v4, required: the heading of the details pane
 * @property {Element} [status]               v4: shown in the heading after the title
 * @property {([string, Element] | [string, Element, () => void])[]} tabs  the view's detail tabs, in order; v4: a
 *           third element is called when the tab is shown. The shell adds the waveform, listing and memory tabs after them
 * @property {string} [memoryTab]             v4: the name of the tab that opens the shared memory panel
 * @property {() => void} [reset]             v4 (default: load the same program again)
 * @property {{defaults: string[], format?: (signal: string, value: number) => string | null, base?: number}} [waveform]  v4
 *           (capability waveform, with exportModel); `base` (optional, default 0; added 2026-11-06 for the 8086, no version
 *           change): the number the panel shows for the first frame
 * @property {() => string} [revision]        v4: changes when a setting of the view changes its model
 * @property {Element} [headerTools]
 * @property {SVGSVGElement[]} [diagrams]    v7: the drawings the shell pans and zooms, fixed for the instance's life.
 *           Each has a viewBox and the default preserveAspectRatio, is the only drawing in its parent (the viewport:
 *           the shell adds a class, focus, a name and a toolbar there, and sets the svg's position and CSS transform),
 *           keeps tooltips outside the svg, and exports from its viewBox without the CSS transform
 * @property {(program: Program | null) => void} load
 * @property {() => string} step              one clock cycle (or one T-state); a STOP value
 * @property {() => boolean} back
 * @property {() => ViewState} state
 * @property {() => void} render              v2, required: draw the current state
 * @property {(stop: string) => string | null} [stopMessage]   the view's own wording of a stop (pipeline: "halt
 *           reached WB at cycle n")
 * @property {() => [string, number][]} [counters]   extra counters (stalls, redirects)
 * @property {() => {address: number, size: number} | null} [dataAccess]   the memory access of this cycle
 * @property {(memsys: object | null) => void} [setMemsys]  v2
 * @property {() => {read: (address: number, size: number) => number, store?: {read: Function}} | null} [memoryPort]
 *           v2: the memory the memory panel shows; v4: `store`, the memory under the caches (shown as RAM)
 * @property {() => number | null} [breakAt]  v2: the address a breakpoint is checked at this cycle, or null
 * @property {() => string | null} [event]    v2: after a cycle, a reason for a run to stop (text), or null
 * @property {{label: string, step: () => string, back: () => boolean}} [unit]  v2: a larger step, used by step over
 * @property {() => {model: object, signals: object[], module: string, label: string}} [exportModel]  v2: a fresh
 *           model of the program for the golden and VCD exports and the waveforms
 * @property {{get: () => object, apply: (o: object) => void}} [options]  v2: the view's settings in share links
 * @property {(input: object) => void} [input]  v8: as Engine.input, for the view's model; without it a panel's
 *           inputs are disabled in the view
 *
 * @typedef {object} ViewState            v4: state() is null while no program is loaded
 * @property {number} pc
 * @property {number} [instruction]           v4: the address the listing and the editor mark (default pc)
 * @property {number} [dropped]               v4: cycles no longer kept for step back
 * @property {number} cycle
 * @property {number} retired
 * @property {boolean} halted
 * @property {string | null} error
 * @property {Record<string, number>} registers   by register id
 * @property {string[]} [changed]             v2: register ids written in this cycle
 * @property {{address: number, size: number} | null} [written]  v2: the memory write of this cycle
 */

/** Optional function hooks (v2): when present they must be functions. */
const LANGUAGE_HOOKS = ['fields', 'describe', 'inspector', 'loadImage', 'importers', 'scratch'];
const EXPORT_HOOKS = ['trace', 'traceJsonLines', 'traceCsv', 'golden', 'image'];
/** The ViewInstance fields every view gives (v4). */
export const VIEW_REQUIRED = Object.freeze(['root', 'title', 'infoTitle', 'tabs', 'load', 'step', 'back', 'state', 'render']);
export const ENGINE_HOOKS = Object.freeze(['callDepth', 'stepOverTarget', 'stepOutTarget', 'loopRange', 'diagnostics', 'counters',
  'callStack', 'dataAccess', 'platform', 'input', 'inputs', 'advance', 'drainAudio']);
/** The engine hooks capability stepOver needs. */
export const STEP_OVER_HOOKS = Object.freeze(['callDepth', 'stepOverTarget', 'stepOutTarget']);

const ID = /^[a-z][a-z0-9-]*$/;
const isFn = (f) => typeof f === 'function';

/**
 * The static part of the conformance suite: every problem of a descriptor's shape, as text; [] if none. The
 * behavioural part (assemble, step, back, run, snapshot) is in test/arch-contract.test.mjs.
 */
export function validateDescriptor(d) {
  const bad = [];
  const need = (cond, msg) => { if (!cond) bad.push(msg); };
  need(d && typeof d === 'object', 'not an object');
  if (bad.length) return bad;
  need(d.contract === CONTRACT_VERSION, `contract ${d.contract}, expected ${CONTRACT_VERSION}`);
  need(ID.test(d.id ?? ''), `id ${JSON.stringify(d.id)}`);
  need(typeof d.name === 'string' && d.name, 'name');
  need(d.strings && typeof d.strings === 'object', 'strings');

  for (const [k, v] of Object.entries(d.capabilities ?? {})) {
    need(CAPABILITIES.includes(k), `capability ${k} is not in CAPABILITIES`);
    need(v === true || (v && v.enabled === false && typeof v.reason === 'string' && v.reason), `capability ${k}: true or {enabled: false, reason}`);
  }

  const L = d.language ?? {};
  need(isFn(L.assemble) && isFn(L.disassemble), 'language.assemble and language.disassemble');
  need(typeof L.extension === 'string' && L.extension.startsWith('.'), 'language.extension');
  need(typeof L.comment === 'string' && L.comment, 'language.comment');
  need(typeof L.defaultSource === 'string', 'language.defaultSource');
  need(Array.isArray(L.editor?.mnemonics) && Array.isArray(L.editor?.registers) && Array.isArray(L.editor?.directives), 'language.editor lists');
  for (const k of LANGUAGE_HOOKS) if (L[k] !== undefined) need(isFn(L[k]), `language.${k} is a function`);
  if (L.disassembly) {
    need(L.disassembly.names === undefined || (Array.isArray(L.disassembly.names) && L.disassembly.names.length > 0),
      'language.disassembly.names: a non-empty list');
  }
  if (L.extraLanguages) need(d.capabilities?.cLanguage === true || L.extraLanguages.every((x) => x.id !== 'c'), 'C without capability cLanguage');
  for (const k of ['help', 'detail']) if (L.editor?.[k] !== undefined) need(isFn(L.editor[k]), `language.editor.${k} is a function`); // v5
  for (const x of L.extraLanguages ?? []) {
    need(ID.test(x.id ?? '') && typeof x.label === 'string' && isFn(x.load), `extra language ${x.id}: id, label, load`);
    for (const o of x.options ?? []) {
      need(Array.isArray(o.values) && o.values.some((v) => v.id === o.default), `extra language ${x.id}: option ${o.id}: default among values`);
    }
  }

  const R = d.registers ?? {};
  const ids = new Set();
  need(Array.isArray(R.groups) && R.groups.length > 0, 'registers.groups');
  for (const g of R.groups ?? []) {
    need(ID.test(g.id ?? ''), `register group id ${g.id}`);
    for (const r of g.registers ?? []) {
      need(!ids.has(r.id), `register id ${r.id} twice`);
      ids.add(r.id);
      need(Number.isInteger(r.width) && r.width >= 1 && r.width <= 32, `register ${r.id}: width ${r.width}`);
    }
  }
  need(typeof R.pc === 'string' && (ids.has(R.pc) || R.pc === 'pc'), `registers.pc ${R.pc} is no register (or 'pc')`);
  if (R.status) need(ids.has(R.status.id) && R.status.fields?.length > 0, 'registers.status');
  for (const [role, id] of Object.entries(R.roles ?? {})) need(ids.has(id), `registers.roles.${role} ${id} is no register`);

  const A = d.addressSpace ?? {};
  need(Number.isInteger(A.addressBits) && A.addressBits >= 1 && A.addressBits <= 32, 'addressSpace.addressBits');
  need([8, 16, 32].includes(A.unitBits), 'addressSpace.unitBits');
  need([1, 2, 4].includes(A.wordBytes), 'addressSpace.wordBytes');
  need(['little', 'big'].includes(A.endianness), 'addressSpace.endianness');
  need(Array.isArray(A.regions) && A.regions.length > 0, 'addressSpace.regions');
  for (const r of A.regions ?? []) {
    need(['ram', 'rom', 'device'].includes(r.kind), `region ${r.name}: kind ${r.kind}`);
    need(r.base >= 0 && r.size > 0 && r.base + r.size <= 2 ** A.addressBits, `region ${r.name} outside the address space`);
  }

  need(isFn(d.engine?.create), 'engine.create');
  for (const k of EXPORT_HOOKS) if (d.exports?.[k] !== undefined) need(isFn(d.exports[k]), `exports.${k} is a function`);
  if (d.exercises) need(isFn(d.exercises.parse) && isFn(d.exercises.run), 'exercises.parse and exercises.run');
  if (d.panels !== undefined) { // v8
    need(Array.isArray(d.panels), 'panels: a list');
    const pids = new Set();
    for (const p of Array.isArray(d.panels) ? d.panels : []) {
      need(ID.test(p.id ?? '') && !pids.has(p.id) && typeof p.label === 'string' && p.label && isFn(p.load), `panel ${p.id}: id, label, load`);
      pids.add(p.id);
    }
  }
  if (d.variants !== undefined) { // v9
    need(d.variants && typeof d.variants === 'object' && !Array.isArray(d.variants), 'variants: an object');
    for (const [id, v] of Object.entries(d.variants ?? {})) {
      need(ID.test(id) && typeof v?.label === 'string' && v.label && isFn(v?.load), `variant ${id}: id, label, load`);
      need((d.engine?.profiles ?? []).some((p) => p.variant === id), `variant ${id}: no profile belongs to it`);
      if (v?.legacy !== undefined) need(typeof v.legacy === 'boolean', `variant ${id}: legacy is a boolean`);
    }
    need(Object.values(d.variants ?? {}).filter((v) => v?.legacy).length <= 1, 'variants: at most one is legacy');
    need((d.engine?.profiles ?? []).some((p) => p.variant === undefined), 'variants: the descriptor\'s own variant has no profile');
  }
  { // v10: realtime, audio, assets
    const relative = (p) => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.includes('..') && !p.includes('\\') && !/^[a-z][a-z0-9+.-]*:/i.test(p);
    if (d.realtime !== undefined) {
      need(d.realtime && typeof d.realtime === 'object', 'realtime: an object');
      need(Number.isFinite(d.realtime?.floorHz) && d.realtime.floorHz > 0, 'realtime.floorHz: a positive number');
      const t = d.realtime?.transports;
      if (t !== undefined) need(Array.isArray(t) && t.length > 0 && t.every((x) => REALTIME_TRANSPORTS.includes(x)) && new Set(t).size === t.length,
        `realtime.transports: a non-empty list without repeats from ${REALTIME_TRANSPORTS.join(', ')}`);
    }
    need((d.capabilities?.realtime === true) === (d.realtime !== undefined), 'capability realtime true needs Descriptor.realtime, and the reverse');
    if (d.audio !== undefined) {
      const a = d.audio;
      need(a && typeof a === 'object', 'audio: an object');
      need(Number.isInteger(a?.sampleRate) && a.sampleRate >= 8000 && a.sampleRate <= 192000, 'audio.sampleRate: an integer from 8000 to 192000');
      if (a?.channels !== undefined) need(Number.isInteger(a.channels) && a.channels >= 1 && a.channels <= 2, 'audio.channels: 1 or 2');
      need(relative(a?.processor) && a.processor.endsWith('.js'), 'audio.processor: a relative path ending .js');
    }
    need((d.capabilities?.audio === true) === (d.audio !== undefined), 'capability audio true needs Descriptor.audio, and the reverse');
    if (d.assets !== undefined) {
      need(d.assets && typeof d.assets === 'object' && !Array.isArray(d.assets), 'assets: an object');
      const w = d.assets?.wasm;
      if (w !== undefined) need(Array.isArray(w) && w.every((p) => relative(p) && p.endsWith('.wasm')) && new Set(w).size === w.length,
        'assets.wasm: relative paths ending .wasm, without repeats');
      const extra = Object.keys(d.assets ?? {}).filter((k) => k !== 'wasm');
      need(!extra.length, `assets.${extra.join(', assets.')} is not in the contract`);
    }
  }
  const active = d.activeVariant ?? null;
  const profiles = new Set();
  for (const p of d.engine?.profiles ?? []) {
    need(ID.test(p.id ?? '') && !profiles.has(p.id), `profile id ${p.id}`);
    profiles.add(p.id);
    if (p.variant !== undefined) need(Object.hasOwn(d.variants ?? {}, p.variant), `profile ${p.id}: variant ${p.variant} is not in variants`);
    if (p.memory !== undefined) need(['sparse', 'harvard', 'unified'].includes(p.memory), `profile ${p.id}: memory ${p.memory}`);
    for (const s of p.subsets ?? []) need(typeof s.id === 'string' && typeof s.label === 'string', `profile ${p.id}: subset`);
  }
  const V = d.views ?? [];
  need(V.length > 0 && V[0].kind === 'isa', 'views: the first is of kind isa');
  const vids = new Set();
  for (const v of V) {
    need(ID.test(v.id ?? '') && !vids.has(v.id), `view id ${v.id}`);
    vids.add(v.id);
    need(VIEW_KINDS.includes(v.kind), `view ${v.id}: kind ${v.kind}`);
    need(typeof v.label === 'string' && typeof v.icon === 'string', `view ${v.id}: label and icon`);
    need(v.kind === 'isa' || isFn(v.load), `view ${v.id}: load()`);
    if (v.kind === 'compare') need(d.capabilities?.compare === true, `view ${v.id}: kind compare without capability compare`);
    if (v.profile !== undefined) need(profiles.has(v.profile), `view ${v.id}: profile ${v.profile} is not in engine.profiles`);
    if (v.profile !== undefined && profiles.has(v.profile)) need(variantOf(d, v.profile) === active, `view ${v.id}: profile ${v.profile} is of another variant`); // v9
    if (v.names !== undefined) need(L.disassembly?.names?.includes(v.names), `view ${v.id}: names ${v.names} not in language.disassembly.names`);
    if (v.settings) { // v5
      const s = v.settings;
      need(ID.test(s.key ?? '') && s.defaults && s.values, `view ${v.id}: settings key, defaults, values`);
      for (const [k, def] of Object.entries(s.defaults ?? {})) need(s.values?.[k]?.includes(def), `view ${v.id}: setting ${k}: default among values`);
    }
    if (v.openNote !== undefined) need(isFn(v.openNote), `view ${v.id}: openNote is a function`);
  }
  return bad;
}

/** A capability's state for the shell: {enabled, reason}. */
export function capability(d, key, profile = null) {
  const v = profile?.capabilities?.[key] ?? d.capabilities?.[key];
  if (v === true) return { enabled: true, reason: null };
  return { enabled: false, reason: v?.reason ?? 'notSupported' };
}
