// strings.js -- every interface string, in British English, in one place so
// that a translation can be added later (WS-N-007, W-D12).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const orList = (xs) => {
  const q = xs.map((x) => `'${x}'`);
  return q.length > 1 ? `${q.slice(0, -1).join(', ')} or ${q[q.length - 1]}` : q[0];
};

// The processor of a datapath profile, by its number (profiles.js `chapter`), for messages.
const PROCESSOR = Object.freeze({ 6: 'single-cycle', 7: 'multicycle', 8: 'pipelined' });

export const STRINGS = Object.freeze({
  appName: 'MAVILERA',
  appFull: 'RISC-V Laboratory',
  appDescriptor: 'Interactive Microprocessor Architecture Laboratory',
  homeLink: 'MAVILERA Home',
  tagline: 'Visualize. Execute. Understand.',
  about: 'About',
  aboutTitle: 'About MAVILERA',
  aboutText: 'MAVILERA is an educational platform for exploring microprocessor architecture. This module, the RISC-V Laboratory, is an interactive, browser-based environment for exploring RISC-V instruction execution, processor architecture, '
    + 'and microarchitectural behavior through assembly programming, simulation, debugging, and visualization.',
  aboutVersion: 'Development version, not yet released. Everything runs in this browser; nothing is uploaded.',
  aboutRights: '© 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.',
  // the release edition (tools/release.mjs marks its pages)
  aboutVersionRelease: (v) => `Version ${v}. Everything runs in this browser; nothing is uploaded.`,
  aboutRightsRelease: '© 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. '
    + 'The name and logo are not licensed as trademarks.',
  aboutClose: 'Close',
  // teaching templates (content/templates/)
  templates: Object.freeze({
    menu: 'Templates',
    menuTitle: 'Teaching templates: short programs that each show one idea, grouped by view; each opens in its view with its settings',
    loading: 'Loading the templates…',
    failed: (why) => `The templates could not be loaded: ${why}`,
    opened: (title) => `Opened the template "${title}". Its first lines say what to try.`,
    more: 'More examples…',
    heading: 'Templates',
    note: 'Short programs that each show one idea; the first lines of each say what to try.',
  }),
  // the workspace kept across a reload or a closed tab
  workspace: Object.freeze({
    restored: (n, unit) => `Back where you were: ${n.toLocaleString('en-GB')} ${unit}${n === 1 ? '' : 's'} from reset, replayed. Breakpoints and watchpoints are kept too.`,
    tooLong: (n) => `The run was ${n.toLocaleString('en-GB')} steps long, too long to replay when the page opens; it starts again from reset.`,
    loadsDropped: (n) => `${n} data file(s) loaded before were too large for the browser's storage and were not kept; load them again.`,
  }),
  // in-app help (W-D20)
  help: Object.freeze({
    button: 'Help',
    title: 'Help',
    sections: 'Help topics',
    loading: 'Loading the help…',
    failed: (why) => `The help could not be loaded: ${why}`,
    docs: 'Full documentation',
    docsTitle: 'The detailed documentation, in a new tab',
  }),
  status: 'Under development (milestone M5: C compiler, comparison, exports).',

  // controls (WS-F-090)
  assemble: 'Assemble',
  reset: 'Reset',
  step: 'Step',
  stepBack: 'Step back',
  stepOver: 'Step over',
  stepOut: 'Step out',
  run: 'Run',
  pause: 'Pause',
  runToCursor: 'Run to cursor',
  speed: 'Speed',
  speedMax: 'Full speed',
  speedSlow: 'Animated',
  profile: 'Profile',
  profileNames: { iss: 'ISA (RV32I + M)', ch06: 'Single-cycle processor', ch07: 'Multicycle processor', ch08: 'Pipelined processor' },
  file: 'File',
  open: 'Open…',
  save: 'Save .s',
  exportHex: 'Export .hex',
  exportBin: 'Export .bin',
  exportListing: 'Export listing',
  // exports of a whole run (WS-F-124 to WS-F-126); each replays the program from reset to its halt
  exportTrace: 'Export trace (JSON lines)',
  exportTraceCsv: 'Export trace (CSV)',
  exportGolden: 'Export golden dump',
  exportVcd: 'Export waveform (VCD)',
  exportRunTitle: 'Runs the program again from reset to its halt and saves the file; the session is not changed.',
  exportedTrace: (n, error) => `Trace saved: ${n.toLocaleString('en-GB')} instruction(s) from reset${error ? `, up to the error: ${error}` : ' to the halt'}.`,
  exportedTraceCut: (n) => `Trace saved: the first ${n.toLocaleString('en-GB')} instructions only; the program did not halt within them.`,
  exportedGolden: (what, words) => `Golden dump saved for ${what}: ${words} words, one per line, as the reference testbenches read them.`,
  exportedVcd: (what, cycles) => `Waveform saved for ${what}: cycles 0 to ${(cycles - 1).toLocaleString('en-GB')} from reset, signals under the reference RTL's names. One cycle is 10 ns on its time axis, as in the reference testbenches; this is not hardware timing.`,
  exportedVcdCut: (n) => `Only the first ${n.toLocaleString('en-GB')} cycles are in the file.`,
  exportNoHalt: (why) => `Nothing saved: the program does not reach its halt (${why}).`,
  exportNothing: 'Nothing saved: assemble a program that runs in this view first.',
  importImage: 'Import .hex/.bin…',
  theme: 'Theme',
  keys: 'Keys',
  shortcuts: 'Keys: F5 run/pause · F10 step · Shift+F10 step back · F11 step over · Shift+F11 step out · Ctrl+F10 run to cursor · '
    + 'Ctrl+Enter assemble · Ctrl+F find · in the editor, Esc then Tab leaves it · in the listing, ↑/↓ move, Enter shows the fields, B sets a breakpoint · in the registers, ↑/↓ move, W watches · '
    + 'in a datapath view, F10 is one clock cycle (F11 one instruction in the multicycle view), Enter on an element of the drawing opens its details, ↑/↓ on the divider share the height, Esc leaves the enlarged drawing.',

  // panels
  editor: 'Editor',
  listing: 'Listing',
  fields: 'Instruction fields',
  data: 'Data',
  symbols: 'Symbols',
  registers: 'Registers',
  memory: 'Memory',
  console: 'Console',
  messages: 'Messages',
  counters: 'Counters',
  showHex: 'Hex',
  showBinary: 'Binary',
  aliases: 'Pseudo-instructions',
  find: 'Find',
  findNext: 'Next',
  storageNote: 'Your program is kept in this browser only; nothing is uploaded.',

  // column heads
  colAddress: 'Address',
  colWord: 'Word',
  colBinary: 'Binary (by field)',
  colInstruction: 'Instruction',
  colSource: 'Source',
  colBytes: 'Bytes (address order)',
  colValue: 'Word value',
  colLabel: 'Label',
  colSection: 'Section',
  colLine: 'Line',
  colRegister: 'Register',

  // registers and memory (WS-F-100, WS-F-101)
  formatHex: 'Hex',
  formatSigned: 'Signed',
  formatUnsigned: 'Unsigned',
  formatBinary: 'Binary',
  changed: 'changed by the last step',
  byWord: 'Words',
  byByte: 'Bytes',
  goTo: 'Go to address or label',
  memWordsNote: 'Little-endian words; double-click one to watch it.',
  memBytesNote: 'Bytes in address order.',
  memGoSp: 'Show the memory at the stack pointer (sp = x2)',
  memGoReg: 'Go to register…',
  memGoRegTitle: 'Show the memory at the address a register holds now',
  watchButton: 'Watch',
  watchButtonTitle: 'Watch (or stop watching) the word at the address or label typed on the left',
  previous: 'Previous',
  next: 'Next',
  regionText: 'text',
  regionData: 'data',
  regionStack: 'stack',
  watch: 'Watch (stop when written)',
  breakpointHint: 'Click an address (or press B on a row) to set or clear a breakpoint; point at a word to see its bits.',
  breakpointAt: (a) => `Breakpoint at ${a}`,
  breakpointGutter: 'Click a line number to set or clear a breakpoint at its first instruction',
  binaryShow: 'binary ▸',
  binaryHide: '◂',
  binaryShowTitle: 'Show the binary column, grouped by instruction field',
  binaryHideTitle: 'Hide the binary column',
  formatName: (f) => `${f}-type`,

  // field panel (WS-F-022)
  fieldsNone: 'Select an instruction in the listing.',
  fieldsFollow: 'The instruction at the PC; it follows each step until you select one in the listing.',
  fieldValue: 'value',
  fieldBits: 'bits',
  immediate: 'Immediate',
  immGather: 'gathered bits',
  immSigned: 'sign-extended',
  pseudoOf: (src) => `from pseudo-instruction ${src}`,

  // counters (WS-F-092)
  instructions: 'Instructions retired',
  classes: { alu: 'ALU', load: 'Load', store: 'Store', branch_taken: 'Branch taken', branch_not_taken: 'Branch not taken',
    jump: 'Jump', mul: 'Multiply', div: 'Divide', system: 'System' },
  stackUse: 'Deepest stack use (bytes)',

  // call stack (WS-F-103, WS-F-143)
  calls: Object.freeze({
    title: 'Call stack',
    none: 'Assemble a program to see its calls.',
    empty: 'No call in progress. A call is a jal or jalr that writes ra; it ends when a jalr returns to the address after it.',
    innermost: '(running)',
    goTo: 'Show the call site in the listing and the editor',
    site: (where, call, ret, sp) => `called at ${where} (${call}) · returns to ${ret}${sp ? ` · sp ${sp}` : ''}`,
    args: 'a0–a7 at the call',
    argsLabel: (d) => `Argument registers at call ${d}`,
    note: 'The simulator does not know how many arguments a procedure takes: all of a0–a7 are shown as they were at the call, in signed decimal (point at one for hex).',
  }),

  // messages
  assembled: (n, d) => `Assembled: ${n} instruction word(s), ${d} data byte(s).`,
  asmErrors: (n) => `${n} error(s); fix them and assemble again.`,
  profileError: (mn, ch) => `${mn} is not implemented by the ${PROCESSOR[ch]} processor.`,
  profileIss: (mn) => `${mn} needs the privileged profile (milestone M7).`,
  profileHint: (ch) => `Choose the profile "ISA (RV32I + M)" to run it, or rewrite it with the instructions of the ${PROCESSOR[ch]} processor.`,
  notRunnable: 'The program cannot run until it assembles without errors in this profile.',
  runningStatus: (n) => `Running… ${n.toLocaleString('en-GB')} instructions`,
  paused: (pc) => `Paused at pc = ${pc}.`,
  resetDone: 'Reset: registers, memory and counters are back at their initial values.',
  watchWord: (a, on) => (on ? `Watching the word at ${a}: a run stops when it is written.` : `No longer watching the word at ${a}.`),
  halted: (pc, code) => `Halted at pc = ${pc}${code === null ? '' : `; exit code ${code}`}.`,
  simError: (msg) => `SIM ERROR: ${msg}`,
  simHint: (msg) => {
    if (/misaligned 4-byte/.test(msg)) return 'lw and sw need an address that is a multiple of 4. Check the base register and offset, and put ".align 2" before word data.';
    if (/misaligned 2-byte/.test(msg)) return 'lh, lhu and sh need an even address.';
    if (/misaligned instruction fetch/.test(msg)) return 'A jump went to an address that is not a multiple of 4; check the register used by jalr.';
    if (/unsupported ecall/.test(msg)) return 'Set a7 before ecall: 64 = write(a0 = 1, a1 = buffer, a2 = length), 93 = exit(a0 = code).';
    if (/file descriptor/.test(msg)) return 'write needs a0 = 1 (standard output) or 2 (standard error).';
    if (/unsupported instruction 0x00000000/.test(msg)) return 'The program ran into a zero word: probably past its end, or into data. End it with "li a7, 93" + "ecall", or with "halt".';
    if (/unsupported instruction/.test(msg)) return 'This word is not an RV32I/M instruction the ISA profile runs (CSR instructions need the privileged profile). Did execution run into data?';
    return null;
  },
  stoppedBreak: (pc) => `Breakpoint at ${pc}.`,
  stoppedWatchReg: (r, v, pc) => `Watchpoint: ${r} was written with ${v} by the instruction at ${pc}.`,
  stoppedWatchWord: (a, v, pc) => `Watchpoint: the word at ${a} was written (now ${v}) by the instruction at ${pc}.`,
  watchedMark: 'watched',
  stoppedBudget: (n, from, to) => `Stopped after ${n} instructions without halting; the program is looping between ${from} and ${to}.`,
  historyDropped: (n) => `Step-back history is full; the oldest ${n} step(s) were dropped.`,
  nothingToUndo: 'Nothing to step back.',
  abiViolation: (v) => `ABI: ${v}`,
  // the waveform panel of the datapath views (WS-F-146)
  wave: Object.freeze({
    title: 'Waveforms',
    signals: 'Signals…',
    control: 'Control signals',
    data: 'Data signals',
    note: 'The signals of each clock cycle run so far, from reset; the same records as the VCD export. The axis orders the cycles; it is not hardware timing. Select a cycle to go to it.',
    plotLabel: 'Waveforms; select a cycle to go to it',
    cyclesLabel: 'Cycles of the waveforms',
    empty: 'Assemble a program for this processor, then step: each clock cycle adds a column.',
    none: 'Choose signals with "Signals…".',
    summary: (n, a, b) => `Waveforms of ${n} signal(s) over cycles ${a} to ${b}`,
    cycleRange: (a, b) => (a === b ? `cycle ${a}` : `cycles ${a}–${b}`),
    cycle: 'cycle',
    earlier: '◀ cycle',
    later: 'cycle ▶',
    at: (k, max) => `Cycle ${k} of 0–${max}`,
    tableCaption: (a, b) => `Values of the chosen signals, cycles ${a} to ${b}`,
    signal: 'Signal',
  }),
  // the exercise mode (WS-F-148)
  exercise: Object.freeze({
    menu: 'Exercise…',
    button: 'Exercise',
    buttonTitle: 'The open exercise: its task, and its tests run on your program',
    title: 'Exercise',
    none: 'Choose a practice exercise below, or open an exercise file from your teacher. An exercise gives a task and tests; the tests run on the program in the editor and show expected against actual.',
    loading: 'Loading the exercises…',
    listFailed: (why) => `The practice exercises could not be loaded: ${why}`,
    practice: 'Practice exercises',
    practiceNote: 'Written for MAVILERA. Each opens with a starter program; no solutions are included.',
    unloadTitle: 'Close this exercise and return to the list',
    privacy: 'The file is read in this browser and kept here until you close the exercise; nothing is uploaded.',
    open: 'Open an exercise file…',
    noTask: '(The exercise file gives no task text.)',
    about: (n, lang, entry) => `${n} test(s), run on your ${lang === 'c' ? 'C' : 'assembly'} program in the ISA profile`
      + `${entry ? `; each calls your procedure ${entry} with the test's registers` : '; each runs it from the start'}.`,
    run: 'Run the tests',
    starter: 'Load the starter program',
    starterTitle: 'Put the exercise\'s starting program in the editor; your text is kept (File ▸ Restore text before the link)',
    starterLoaded: 'Loaded the starter program of the exercise.',
    unload: 'Close the exercise',
    running: 'Running…',
    cannotRun: 'The tests did not run: the program must assemble (or compile) without errors; see the console.',
    summary: (p, n) => (p === n ? `All ${n} test(s) pass.` : `${p} of ${n} test(s) pass.`),
    pass: 'passes',
    fail: 'fails',
    error: (e) => `Stopped: ${e}`,
    colWhat: 'Checked',
    colExpected: 'Expected',
    colActual: 'Your program',
    instructions: (n) => `${n.toLocaleString('en-GB')} instruction(s) executed.`,
    refused: (why) => `The exercise file was not opened: ${why}.`,
    opened: (title, name) => `Opened the exercise "${title}"${name ? ` (${name})` : ''}.`,
    wrongLang: (l) => `This exercise expects a program in ${l === 'c' ? 'C' : 'assembly'}: choose that language in the editor.`,
  }),
  // the uninitialised-value check (WS-F-147)
  uninit: (v) => `Uninitialised: ${v}`,
  uninitNote: 'A simulator check: the value is whatever the register or memory happened to hold (here 0). Write it before reading it. '
    + 'Saving ra or s0–s11 on the stack in a prologue is not reported.',
  uninitMore: 'More uninitialised reads follow; only the first 20 after a reset are listed.',
  importedImage: (n) => `Imported ${n} word(s) as a program without source.`,
  importedNote: 'The listing is now the program; the editor keeps your source, which runs again when you assemble it.',
  noLine: 'No instruction on that line.',

  // Assembler hints (WS-F-012), by hint code. Each takes the diagnostic e
  // ({token, mnemonic, data}) and u, the operand syntax of e.mnemonic
  // ("add rd, rs1, rs2") or null.
  hints: {
    mnemonic: (e) => (e.data.missingColon
      ? `'${e.token}' looks like a label: write it with a colon, '${e.token}:'.`
      : e.data.suggest?.length
        ? `Did you mean ${orList(e.data.suggest)}?`
        : 'This is not an RV32I or M instruction, nor a supported pseudo-instruction (nop, li, la, mv, j, call, ret, beqz, …).'),
    register: (e, u) => (e.data.xRange
      ? 'There are 32 registers, x0 to x31.'
      : e.data.number
        ? `A register is needed here, not a number.${u ? ` The form is: ${u}.` : ''}`
        : e.data.suggest?.length
          ? `Did you mean ${orList(e.data.suggest)}?`
          : 'Registers are x0–x31 or their ABI names: zero, ra, sp, gp, tp, t0–t6, s0–s11 (s0 = fp), a0–a7.'),
    operands: (e) => (e.data.usage !== undefined && e.data.usage !== null
      ? `The form is: ${e.data.usage || e.mnemonic} (you gave ${e.data.got} operand${e.data.got === 1 ? '' : 's'}). Operands are separated by commas.`
      : 'Check the number of operands and the commas between them.'),
    range: (e) => {
      const r = `It must lie between ${e.data.lo} and ${e.data.hi}.`;
      const what = e.data.what ?? '';
      if (what.startsWith('branch')) {
        return `${r} The target is too far for a branch (±4 KiB). Invert the condition and jump instead, e.g. "bne a0, a1, skip" + "j far" + "skip:".`;
      }
      if (what.startsWith('jump')) return `${r} A jal reaches ±1 MiB; load the address with la and use jalr.`;
      if (['lb', 'lh', 'lw', 'lbu', 'lhu', 'sb', 'sh', 'sw'].includes(e.mnemonic)) {
        return `${r} For a far address, load it into a register first (la t0, label) and use a small offset, e.g. 0(t0).`;
      }
      if (e.mnemonic === 'jalr') return r;
      if (/^\.(word|half|short|byte)$/.test(e.mnemonic ?? '')) return `${r} Use a wider directive (.half or .word) for larger values.`;
      return `${r} For a larger constant, write "li ${e.operands?.[0] ?? 'rd'}, ${e.token ?? e.data.value}"; the assembler splits it into lui and addi.`;
    },
    shamt: () => 'Shift amounts are 0 to 31 (a 32-bit register has 32 bit positions).',
    uimm: (e) => `lui and auipc take a 20-bit value, 0 to 0xFFFFF (the upper 20 bits of the result). For a full 32-bit constant write "li ${e.operands?.[0] ?? 'rd'}, ${e.token ?? e.data.value}"; for an address, "la ${e.operands?.[0] ?? 'rd'}, label".`,
    uimm5: () => 'The CSR immediate is 0 to 31.',
    align: () => 'A numeric branch or jump operand is a byte offset from this instruction and must be even. Using a label is safer: the assembler computes the offset.',
    undefined: (e) => (e.data.suggest?.length
      ? `Did you mean ${orList(e.data.suggest)}? (Labels are case-sensitive.)`
      : `Define it with "${e.token}:" at the start of a line, or check the spelling (labels are case-sensitive).`),
    forward: () => '.equ and .space need their value on an earlier line; move the definition up.',
    duplicate: (e) => `Each label may be defined once in the whole program${e.data.first ? `; "${e.token}" is already defined on line ${e.data.first}` : ''}. Rename one of them.`,
    memory: () => 'A memory operand is written offset(register), for example 8(sp) or 0(t0). To use a label, first "la t0, label".',
    directive: (e) => (e.data.suggest?.length ? `Did you mean ${orList(e.data.suggest)}? ` : '')
      + 'Supported: .text .data .rodata .bss .word .half .byte .ascii .asciz .string .space .align .balign .equ .set.',
    section: () => 'Instructions go in the .text section; write .text before them (data directives go in .data).',
    escape: () => 'The escapes are \\n \\t \\r \\0 \\\\ \\" and \\\'.',
    expression: () => 'An expression uses numbers, labels, + and -, parentheses, %hi() and %lo().',
    number: () => 'Write decimal numbers without leading zeros, or use 0x… for hexadecimal and 0b… for binary.',
    string: () => 'Strings are written in double quotes: .asciz "text".',
    fence: () => 'The fence sets are made of the letters i, o, r and w, e.g. "fence rw, rw".',
    csr: () => 'Name a machine-mode CSR (mstatus, mtvec, mepc, …) or give its number, 0 to 0xFFF.',
  },
  // views (WS-U-010)
  views: 'Views',
  viewIsa: 'ISA',
  viewSingle: 'Single-cycle',
  viewMulti: 'Multicycle',
  viewPipe: 'Pipelined',
  viewCompare: 'Compare',
  flow: 'Signal flow',
  flowSpeeds: { off: 'Off', slow: 'Slow', normal: 'Normal', fast: 'Fast' },
  flowReduced: 'Off: the system asks for reduced motion.',
  flowTitle: 'After each clock edge, the signals run along the active paths in the order of the drawing.',
  wireColours: 'Colour nearby wires',
  wireColoursTitle: 'Highlighted data connections that run close together get different colours, so that each can be followed; '
    + 'a connection with no close neighbour keeps the standard highlight colour. Control signals keep their dashed style.',
  march: 'Moving arrows',
  marchTitle: 'Dashes move along the highlighted connections in the direction the data go.',
  elementKinds: { mux2: 'multiplexer', mux3: 'multiplexer', mux4: 'multiplexer', alu: 'ALU', block: 'block', comb: 'logic', reg: 'register', mem: 'memory' },
  openFor: (name) => `${name}: show its details`,
  // accessible names of the drawn parts that carry no text in the drawing (WS-U-031), by profile and element id;
  // a multiplexer is named after its select or output signal
  elementNames: Object.freeze({
    ch06: { pcm: 'PCSel multiplexer', tm: 'TargetSrc multiplexer', rf: 'register file', bm: 'ALUSrc multiplexer', alu: 'ALU',
      dm: 'data memory', rm: 'ResultSel multiplexer' },
    ch07: { am: 'AddrSel multiplexer', mem: 'memory', rf: 'register file', sa: 'ALUSrcA multiplexer', sb: 'ALUSrcB multiplexer',
      alu: 'ALU', rm: 'ResultSel multiplexer' },
    ch08: { r1: 'IF/ID pipeline register', r2: 'ID/EX pipeline register', r3: 'EX/MEM pipeline register', r4: 'MEM/WB pipeline register',
      pcm: 'PCSel multiplexer', rf: 'register file', bm: 'ALUSrc multiplexer', alu: 'ALU', tm: 'TargetSrc multiplexer',
      xm: 'exres multiplexer', dm: 'data memory', rm: 'result multiplexer (WB)', fa: 'forwarding multiplexer fwd_sel_a',
      fb: 'forwarding multiplexer fwd_sel_b', pm: 'pc_seq multiplexer (prediction)' },
  }),
  // layout (WS-U-010)
  splitter: 'Drag to share the height between the drawing and the details (arrow keys work too)',
  zoomOn: '⤢ Enlarge',
  zoomOff: '⤡ Restore',
  zoomTitle: 'Give the drawing the whole window: the editor, the details and the tool rows are hidden (Escape restores)',
  fullScreen: 'Full screen',
  exitFullScreen: 'Exit full screen',
  fullScreenRefused: (why) => `The browser refused full screen (${why}). Use the browser's own full-screen command from its menu instead (F11 steps over in this page).`,
  // projector mode (WS-U-012)
  projector: 'Projector mode',
  projectorTitle: 'Projector mode: larger type and lines, and only the editor, the main view and one table',
  loadingView: 'Loading the view…',
  loadFailed: (e) => `The view could not be loaded: ${e}`,

  // single-cycle view (milestone M2; spec §8.1)
  single: Object.freeze({
    panel: 'Single-cycle datapath',
    info: 'Cycle details',
    tabCycle: 'Cycle',
    tabControl: 'Control',
    tabTiming: 'Timing',
    tabMemory: 'Data memory',
    subset: 'Instruction set',
    subsets: { full: 'Base subset', lab: 'Laboratory subset', ext: 'Extension: xori and lbu' },
    diagramTitle: 'Single-cycle RV32I datapath',
    thisCycle: 'This cycle',
    showAll: 'All values',
    decimal: 'Decimal',
    criticalMode: 'Critical path',
    figure: 'Preset',
    figureNone: '— current cycle —',
    exportSvg: 'SVG',
    exportPng: 'PNG',
    fixedNote: 'One step is one clock cycle and one instruction. Paths the instruction uses are highlighted; '
      + 'the rest of the datapath stays visible, muted. Hover over a connection or a control line for its value.',
    status: (cycle, pc, text, halted, error) => `Cycle ${cycle} · PC ${pc} · ${text}${halted ? ' · halted' : ''}${error ? ' · stopped' : ''}`,
    noProgram: 'No program loaded: assemble a program for the single-cycle processor.',
    cycleLabel: 'Cycle',
    signalsCaption: 'Every signal of this cycle',
    colSignal: 'Signal',
    colKind: 'Kind',
    colCode: 'Value (hex or binary)',
    colDecimal: 'Decimal',
    colMeaning: 'Selects',
    kindControl: 'control',
    kindData: 'data',
    mainCaption: 'Main decoder; x: don\'t-care',
    aluCaption: 'ALU decoder',
    branchCaption: 'Branch condition',
    usedBy: 'Used by',
    instruction: 'Instruction',
    mainActive: (cls, op) => `▶ marks the column in use: ${cls} (op = 0x${op}). The ALU-decoder row and, for a branch, the condition row are marked the same way.`,
    mainDefault: 'This opcode has no column: every main-decoder output is 0.',
    dontCareNote: 'The reference RTL sets every don\'t-care to 0; the signal table shows the values it drives.',
    illustrative: 'Illustrative values for teaching, not measurements of any technology. '
      + 'Change a delay to see how the critical paths and the clock period move.',
    currentPath: (ps, end) => `Critical path of this instruction: ${ps} ps, ending at the ${end}.`,
    ends: { RF: 'register-file setup', DM: 'data-memory setup', PC: 'PC setup' },
    noPath: 'No critical path: this cycle does not execute an instruction of the subset.',
    classCaption: 'Critical path of each instruction class (▲ sets the clock period, ▶ this cycle)',
    colClass: 'Class',
    colPath: 'Critical path',
    colDelay: 'Delay',
    tc: (tc, classes, ghz) => `Minimum clock period T_c = ${tc} ps, set by ${classes}; at most ${ghz} GHz. Every instruction takes one cycle of this length.`,
    delayCaption: 'Delays (ps)',
    changedFrom: (v) => `default: ${v}`,
    resetDelays: 'Default values',
    nodes: {
      pc: 'PC', instr: 'IM', dec: 'decoder', ALUCtrl: 'ALU decoder', rs1_val: 'RF', rs2_val: 'RF', imm: 'imm. gen.',
      pc_plus4: '+4 adder', src_b: 'ALUSrc mux', alu_y: 'ALU', target_base: 'target mux', pc_target: 'target adder',
      PCSel: 'branch logic', pc_next: 'PC mux', rdata: 'data memory', result: 'result mux',
      RF: 'RF setup', DM: 'data-memory setup', PC: 'PC setup',
    },
    caption: (profile, cycle) => `MAVILERA RISC-V, ${profile}, cycle ${cycle}`,
    halted: (pc, cycles) => `Halted at ${pc} (jal x0, 0) after ${cycles} cycles; CPI = 1.`,
    stopped: (msg) => `SIM ERROR: ${msg}`,
    cycles: 'Cycles',
    instructions: 'Instructions',
    cpi: 'CPI',
    historyNote: (n) => `History limit reached: the oldest ${n} cycles can no longer be stepped back.`,
  }),

  // multicycle view (milestone M4; spec §8.2)
  multi: Object.freeze({
    panel: 'Multicycle datapath',
    info: 'Cycle details',
    diagramTitle: 'Multicycle RV32I datapath',
    tabFsm: 'Controller',
    tabCycle: 'Cycle',
    tabRegisters: 'Registers between steps',
    tabStrip: 'States over time',
    tabTiming: 'Step timing',
    stepInstr: 'Instruction ▶',
    stepInstrTitle: 'Run the clock cycles of this instruction, up to the next FETCH (F11)',
    backInstr: '◀ Instruction',
    backInstrTitle: 'Step back to the FETCH of this instruction, or of the one before',
    jalr: 'Reference JALR state',
    jalrTitle: 'The JALR state is an optional extension of the controller, off by default. '
      + 'Turn it on to run jalr; the program restarts.',
    jalrOn: 'The optional JALR state is on.',
    figure: 'Preset',
    figureNone: '— current state —',
    status: (cycle, state, next, pc, text, halted, error) => `Cycle ${cycle} · ${state}${next ? ` → ${next}` : ''} · ${pc} ${text}${halted ? ' · halted' : ''}${error ? ' · stopped' : ''}`,
    noProgram: 'No program loaded: assemble a program for the multicycle processor.',
    fixedNote: 'One step is one clock cycle. The connections that the current state uses are highlighted and boxed with its name; '
      + 'the rest of the datapath stays visible, muted. Hover over a connection or a control line for its value.',
    // controller (WS-F-041)
    drawing: 'Drawing',
    drawDatapath: 'Datapath',
    drawFsm: 'State diagram',
    fsmWhere: 'The state diagram is shown in place of the datapath with "State diagram" above the drawing.',
    fsmTitle: 'State diagram of the multicycle controller',
    fsmDesc: (state, from) => `State diagram of the multicycle controller, with the core states and the additional states for the remaining instructions. Current state: ${state}${from ? `, entered from ${from}` : ''}.`,
    fsmLegend: 'Current state filled; the transition taken into it is drawn heavy. Dashed circles: additional states for the remaining instructions (LUI, AUIPC and, when on, JALR).',
    fsmDerived: 'The core states are those of the reference design; the dashed states are added for the remaining instructions.',
    outCaption: 'State-output table (with LUI and AUIPC); x: don\'t-care',
    outActive: (state) => `▶ marks the column of the current state, ${state}. Every output depends on the state alone (a Moore machine).`,
    outNote: 'The reference design sets every don\'t-care to 0; the signal table shows the values it drives.',
    jalrColumn: 'JALR: optional extension.',
    decoders: (aluop, aluctrl, op, immsel) => `Outside the state machine: ALU decoder ALUOp = ${aluop} → ALUCtrl = ${aluctrl}; ImmSel decoder op = ${op} → ImmSel = ${immsel}.`,
    pcen: (w, b, t, en) => `PCEn = PCWrite | (Branch & BranchTaken) = ${w} | (${b} & ${t}) = ${en}`,
    // cycle (WS-U-031)
    cycleLabel: 'Cycle',
    signalsCaption: 'Every signal of this cycle',
    // registers between steps (WS-F-042)
    regsCaption: 'Non-architectural registers between the steps',
    colReg: 'Register',
    colHolds: 'Holds now',
    colEnable: 'Written at the next edge',
    colNext: 'Value after the edge',
    colWhy: 'Needed because',
    always: 'yes (every edge)',
    yes: (sig) => `yes (${sig} = 1)`,
    no: (sig) => `no (${sig} = 0): keeps its value`,
    archCaption: 'Architectural state written at the next edge',
    archPc: (en, v) => (en ? `PC ← ${v} (PCEn = 1)` : 'PC keeps its value (PCEn = 0)'),
    archRf: (en, rd, v) => (en ? (rd ? `R[${rd}] ← ${v} (RegWrite = 1)` : 'RegWrite = 1 with rd = x0: no register changes') : 'No register is written (RegWrite = 0)'),
    archMem: (en, a, v) => (en ? `M[${a}] ← ${v} (MemWrite = 1)` : 'Memory is not written (MemWrite = 0)'),
    // states over time (WS-F-043)
    stripCaption: 'States over time: one row per instruction, one column per clock cycle. Select a cell to go to that cycle.',
    stripLegend: 'Each cell names the state of that cycle; the current cycle is outlined. The last column of each row is its last step.',
    colInstr: 'Instruction',
    colCycles: 'Cycles',
    goToCycle: (k) => `Go to cycle ${k}`,
    cellTitle: (state, k) => `${state} in cycle ${k}`,
    // step timing (tab:mc-delays, tab:mc-steps)
    illustrative: 'Illustrative values for teaching, not measurements of any technology.',
    stepsCaption: 'Critical path of each step (▲ sets the clock period, ▶ this cycle)',
    delayCaption: 'Delays (ps)',
    colStep: 'Step',
    colPath: 'Critical path',
    colDelay: 'Delay',
    tc: (tc, steps) => `Clock period T_c = ${tc} ps, set by ${steps}. Every step takes one cycle of this length.`,
    notInTable: (state) => `${state} is not in the step table.`,
    cpiNow: (n, c, cpi, t) => (n ? `So far: ${n} instructions in ${c} cycles, CPI = ${cpi}; at T_c = 410 ps, ${t} ns.` : 'No instruction has completed yet.'),
    // messages
    halted: (pc, cycles, n, cpi) => `Halted at ${pc} (jal x0, 0) after ${cycles} cycles; ${n} instructions, CPI = ${cpi}.`,
    caption: (profile, cycle) => `MAVILERA RISC-V, ${profile}, cycle ${cycle}`,
  }),

  // pipelined view (milestone M3; spec §8.3)
  pipe: Object.freeze({
    panel: 'Pipelined datapath',
    info: 'Pipeline details',
    diagramTitle: 'Five-stage pipelined RV32I datapath, with forwarding',
    note: 'This is a five-stage teaching pipeline. Production cores divide the work differently: the Hazard3 cores of the RP2350, for example, have three stages.',
    drawingNote: 'The drawing is the five-stage datapath with the forwarding multiplexers added; '
      + 'while a predictor is selected, the prediction hardware of the fetch stage is added on the left.',
    resolution: 'Resolve in',
    display: 'Display',
    exportSvg: 'Export SVG',
    exportPng: 'Export PNG',
    resolutions: { ex: 'EX (reference)', id: 'ID (extension)' },
    hazardFixed: 'Early resolution runs with the complete hazard unit.',
    extBanner: 'Extension: not the reference processor. Branches and jumps are resolved in ID '
      + '(early resolution); the comparator, target adder and forwarding into ID are not drawn.',
    tabDiagram: 'Pipeline diagram',
    tabRegisters: 'Pipeline registers',
    tabHazards: 'Hazards',
    tabPredictor: 'Predictor',
    tabCpi: 'CPI',
    tabSignals: 'Signals',
    hazard: 'Hazards',
    hazards: {
      full: 'Complete',
      stall: 'Task 3: forwarding, stall',
      memwb: 'Task 2: forwarding MEM, WB',
      mem: 'Task 1: forwarding MEM',
      none: 'Stub: none',
    },
    hazardShort: { full: 'complete', stall: 'Task 3', memwb: 'Task 2', mem: 'Task 1', none: 'stub' },
    hazardLong: {
      full: 'complete: forwarding, load-use stall and flush',
      stall: 'after Task 3: forwarding from MEM and WB and the load-use stall, no flush',
      memwb: 'after Task 2: forwarding from MEM and WB, no stall, no flush',
      mem: 'after Task 1: forwarding from MEM only, no stall, no flush',
      none: 'the supplied stub: no forwarding, no stall, no flush',
    },
    predictor: 'Predictor',
    predictors: { none: 'None (not taken)', '1bit': '1-bit', '2bit': '2-bit' },
    hazardTitle: 'Hazard handling: how far the hazard unit is built, from none to complete',
    resolutionTitle: 'Stage in which branches and jumps are resolved',
    entries: 'ENTRIES',
    stages: { IF: 'IF', ID: 'ID', EX: 'EX', MEM: 'MEM', WB: 'WB' },
    bubble: 'bubble',
    empty: '—',
    stallMark: 'stall',
    flushMark: 'flush',
    held: 'held',
    flushed: 'flushed',
    wrongPath: 'wrong path',
    status: (cycle, pc, halted, error) => `Cycle ${cycle} · PC ${pc}${halted ? ' · halted (halt in WB)' : ''}${error ? ' · stopped' : ''}`,
    noProgram: 'No program loaded: assemble a program for the pipelined processor.',
    stripLabel: 'Instruction in each stage',
    // pipeline diagram (WS-F-053)
    diagramCaption: 'Pipeline diagram: cycles left to right, instructions top to bottom. Select a cell to go to that cycle.',
    colInstr: 'Instruction',
    legend: 'IF ID EX MEM WB: the stage in that cycle · ‖ held by a stall · ✕ flushed · ○ bubble · ! on the wrong path, executed because nothing flushed it · '
      + 'the current cycle is outlined; cycles after it were run before and come back as they were.',
    bubbleRow: 'bubble (load-use)',
    goToCycle: (k) => `Go to cycle ${k}`,
    cellTitle: (stage, k, what) => `${stage} in cycle ${k}${what ? `: ${what}` : ''}`,
    earlier: '◀ earlier',
    later: 'later ▶',
    // pipeline registers (WS-F-051)
    regCaption: (name) => `${name}: contents in this cycle`,
    regStatus: { hold: 'stall = 1: keeps its contents at the next edge', clear: 'flush = 1: loads a bubble at the next edge', none: '' },
    regNever: 'EX/MEM and MEM/WB are never held or cleared.',
    colField: 'Field',
    colValue: 'Value',
    // hazards (WS-F-052, WS-F-054)
    unitCaption: 'Hazard unit outputs in this cycle',
    reasonsCaption: 'What happens in this cycle',
    nothing: 'No hazard in this cycle: no forwarding, no stall, no flush.',
    fwd: (sel, src, reg, user, from, prod) => `${sel} = ${src}: ${reg} of ${user} (in EX) is taken from the ${from} result of ${prod}.`,
    loadUse: (load, reg, user) => `Load-use: ${load} in EX writes ${reg}, read by ${user} in ID. The PC and IF/ID hold for one cycle (stall_if = stall_id = 1) and a bubble enters ID/EX (flush_ex = 1).`,
    loadUseMissed: (load, reg, user) => `Load-use hazard not handled at this stage: ${load} in EX writes ${reg}, read by ${user} in ID, which will not wait for the loaded value.`,
    redirect: (instr, why) => `Redirect: ${instr} in EX ${why}. The fetch goes to the correct address (PCSel_ex = 1).`,
    flushes: (list) => `The younger instructions ${list} are flushed (flush_id = flush_ex = 1): two cycles lost.`,
    noFlush: (list) => `Not flushed at this stage: ${list} carry on and will execute although they are on the wrong path.`,
    why: { jump: 'is a jump', taken: 'is a branch taken against its prediction', notTaken: 'is a branch not taken against its prediction' },
    branchWait: (br, reg, prod, stage) => `Extension: ${br} in ID compares ${reg}, which ${prod} in ${stage} has not produced in time; it waits in ID (stall_if = stall_id = 1) and a bubble enters ID/EX.`,
    fwdId: (br, prod) => `Extension: ${br} in ID takes a comparator operand from the MEM result of ${prod} (forwarding into ID).`,
    redirectId: (instr, why) => `Extension: ${instr} in ID ${why}. The fetch goes to the correct address (PCSel_id = 1).`,
    flushOne: (instr) => `The younger instruction ${instr} is flushed (flush_id = 1): one cycle lost.`,
    stale: (user, reg, got, want) => `Stale value: ${user} in EX uses ${reg} = ${got}, but the newest value of ${reg} is ${want}. Its result will be wrong.`,
    staleCount: (n, k, pc) => (n ? `Stale reads so far: ${n}; the first in cycle ${k}, by the instruction at ${pc}.` : 'No stale read so far.'),
    wrongCount: (n) => (n ? `Instructions executed on the wrong path so far: ${n}.` : ''),
    modeNote: (mode) => `Hazard handling: ${mode}. Change it above the drawing; the program restarts.`,
    // predictor (WS-F-055)
    predNone: 'No predictor: every branch is predicted not taken, and every taken branch costs two cycles.',
    predCaption: (kind, n) => `Branch-history table: ${n} ${kind} entries, indexed by PC bits [${Math.log2(n) + 1}:2]`,
    colIndex: 'Index',
    colCounter: 'Counter',
    colPredicts: 'Predicts',
    taken: 'taken',
    notTaken: 'not taken',
    lookup: (pc, k, branch, p) => (branch ? `Lookup in IF: the branch at ${pc} reads entry ${k} and is predicted ${p}.` : `Lookup in IF: entry ${k} (pc ${pc}) is read but not used, since the word is not a branch.`),
    update: (pc, stage, k, from, to, taken) => `Update at the edge: the branch at ${pc} in ${stage} was ${taken}; entry ${k} changes from ${from} to ${to}.`,
    noUpdate: (stage) => `No branch resolved in ${stage}: no update at this edge.`,
    predHardwareNote: 'The fetch stage computes the target PC + imm of a predicted branch with its own immediate generator and adder; '
      + 'the drawing adds them on the left while a predictor is selected (they are not part of the base drawing).',
    oneBitNote: 'The 1-bit predictor follows the usual description (the last outcome, reset to not taken). '
      + 'It has been checked against those rules; there is no reference RTL of it.',
    // CPI (WS-F-056)
    cpiCaption: 'Cycles and CPI so far',
    cpiRows: {
      cycles: 'Clock cycles', n: 'Instructions completed, N', stalls: 'Load-use stall cycles', redirects: 'Redirects (jumps and mispredicted branches)',
      flushCycles: (p) => `Flush cycles (${p} per redirect)`, branches: 'Branches', jumps: 'Jumps', mispredicts: 'Mispredicted branches',
      branchStalls: 'Stall cycles of branches waiting in ID',
    },
    modelCaption: 'Pipeline model: CPI_pipe = 1 + f_lu × 1 + f_br × m × p + f_j × p',
    modelCaptionEarly: 'Extension: CPI = 1 + f_lu + f_bs + f_br × m × p + f_j × p, with p = 1',
    symbols: {
      f_lu: 'f_lu, fraction of instructions held by a load-use stall', f_bs: 'f_bs, stall cycles of branches in ID per instruction',
      f_br: 'f_br, fraction of branches', f_j: 'f_j, fraction of jumps',
      m: 'm, misprediction rate of branches', p: 'p, penalty of a redirect (cycles)',
    },
    cpiModel: 'CPI_pipe from the model',
    cpiMeasured: 'Measured CPI = cycles / N',
    fill: (n) => `The model leaves out the pipeline fill of 4 cycles: 4 / N = ${n}.`,
    identity: (c, n, s, r) => `At the halt: ${c} cycles = N + 4 + stalls + 2 × redirects = ${n} + 4 + ${s} + 2 × ${r}.`,
    identityEarly: (c, n, s, r) => `At the halt: ${c} cycles = N + 4 + stalls + 1 × redirects = ${n} + 4 + ${s} + ${r}.`,
    incomplete: 'With incomplete hazard handling the counts include instructions on the wrong path, and the results may be wrong.',
    notYet: 'No instruction has completed yet.',
    // CPI by component and prediction statistics (WS-F-142)
    cpiBarCaption: 'CPI by component (pipeline model)',
    cpiBarLabel: (parts) => `CPI by component, pipeline model: ${parts}`,
    cpiParts: { base: 'Base, 1 per instruction', loadUse: 'Load-use stalls', branchWait: 'Branches waiting in ID (extension)', branch: 'Mispredicted branches', jump: 'Jumps' },
    cpiBarNote: 'From the counts above with the model of the CPI table; it leaves out the pipeline fill, so the measured CPI is a little higher.',
    predStats: (correct, n, rate, kind) => (n
      ? `Branches predicted correctly: ${correct} of ${n} (${rate}), predictor ${kind}.`
      : `No branch resolved yet (predictor ${kind}).`),
    // stop conditions of a run (WS-F-091)
    stopOn: 'Stop on',
    stopOnTitle: 'A run stops at the cycle in which the hazard unit does what is ticked here; breakpoints still apply.',
    stopEvents: { stall: 'Stall', flush: 'Flush', mispredict: 'Misprediction' },
    stopWhat: { stall: 'a stall', flush: 'a flush', mispredict: 'a mispredicted branch' },
    stoppedOn: (what, cycle, instr) => `Stopped in cycle ${cycle} on ${what}: ${instr}. See the Hazards tab for the reason.`,
    // run summary (WS-F-140)
    tabSummary: 'Run summary',
    summaryCaption: (cycles) => `Cycles lost in the ${cycles} cycle(s) run so far, by cause`,
    summaryTotals: 'Totals by cause',
    causes: { loadUse: 'Load-use stall', branchWait: 'Branch waits in ID (extension)', mispredict: 'Mispredicted branch', jump: 'Jump' },
    colCause: 'Cause',
    colInstrs: 'Instructions',
    colEvents: 'Times',
    colLost: 'Cycles lost',
    colCycles: 'In cycles (select to go there)',
    pair: (a, b) => `${a} → ${b}`,
    outcome: (taken) => (taken ? 'taken, predicted not taken' : 'not taken, predicted taken'),
    notFlushedNote: 'not flushed at this stage: no cycle lost, the wrong-path instructions executed',
    moreCycles: (n) => `+${n} more`,
    summaryNone: 'Nothing lost so far: no stall and no redirect.',
    summaryNote: 'Each row is one cause at one place in the program. A stall loses one cycle; a redirect loses the cycles of the instructions it flushes.',
    // folded loops (WS-F-141)
    fold: 'Fold repeated loop iterations',
    foldTitle: 'Iterations of a loop with the same timing as both neighbours are shown as one row; the first, the last and any that differ stay in full',
    foldRow: (n, a, b) => `↻ ${n} iteration(s) like those around, cycles ${a}–${b}`,
    foldCell: (n) => `×${n}`,
    gapHead: (a, b) => (a === b ? `${a}` : `${a}–${b}`),
    gapTitle: (a, b) => `Cycles ${a} to ${b}: only folded iterations`,
    foldNone: 'No repeated iteration to fold so far.',
    // signals
    signalsCaption: 'Every signal of this cycle, by stage',
    hazardStage: 'hazard unit',
    // messages
    halted: (pc, cycles, n) => `Halted: the halt instruction (jal x0, 0) at ${pc} reached WB after ${cycles} cycles; ${n} instructions completed.`,
    caption: (profile, cycle) => `MAVILERA RISC-V, ${profile}, cycle ${cycle}`,
  }),

  // the C-subset compiler (spec §10.1, WS-F-080 to WS-F-084)
  cc: Object.freeze({
    language: 'Language',
    languages: { asm: 'Assembly', c: 'C' },
    compile: 'Compile',
    mode: 'Translation',
    modes: { plain: 'Plain', register: 'Register' },
    modeTitle: 'Plain keeps every variable in the stack frame, as an unoptimised compiler does; '
      + 'Register keeps scalar locals and parameters in s1–s11. Neither optimises further.',
    march: 'ISA',
    marches: { rv32im: 'RV32IM', rv32i: 'RV32I' },
    marchTitle: 'RV32I has no multiply or divide instructions: the compiled program calls software routines for them.',
    asmTab: 'Assembly from C',
    asmNone: 'Compile the C program to see the assembly it becomes.',
    asmHint: 'Point at a line of C or of assembly to mark its counterpart on the other side.',
    note: 'A teaching translation, one statement at a time: a real compiler (GCC) produces different code.',
    compiled: (asmLines, words) => `Compiled: ${asmLines} line(s) of assembly, ${words} instruction word(s).`,
    errors: 'The C program has an error; fix it and compile again.',
    subsetHint: 'The simulator compiles a teaching subset of C: int, unsigned, char, short, _Bool and the <stdint.h> types up to 32 bits, '
      + 'one-dimensional arrays, pointers, functions with up to eight arguments, and putchar and exit built in. '
      + 'Structures, floating point, 64-bit types, goto and the standard library are outside it.',
    asmError: (line, msg) => `In the generated assembly (line ${line}): ${msg}`,
    fitHint: 'The processor views have small memories: 256 instruction words (multicycle: 128 words of code below the data at 0x200). '
      + 'Try the register translation, which is shorter, or a smaller program.',
    example: `/* Sum of an array: the C subset of MAVILERA. */
int nums[6] = { 3, -1, 4, 1, -5, 9 };

int sum(const int *a, int n)
{
    int s = 0;
    for (int i = 0; i < n; i++)
        s += a[i];
    return s;
}

int main(void)
{
    return sum(nums, 6);    /* the exit code: 11 */
}
`,
  }),

  // comparison of the three processors (WS-F-060; tab:mc-compare, tab:pipe-compare)
  compare: Object.freeze({
    panel: 'One program on the single-cycle, multicycle and pipelined processors',
    caption: 'The program of the editor run to its halt on each processor, with illustrative delays.',
    colQuantity: 'Quantity',
    columns: { ch06: 'Single-cycle', ch07: 'Multicycle', ch08: 'Pipelined' },
    rows: {
      n: 'Instructions, N', cycles: 'Clock cycles', cpi: 'CPI = cycles / N', tc: 'Clock period T_c (ps)',
      perInstr: 'Time per instruction, CPI × T_c (ps)', time: 'Execution time t_exec = N × CPI × T_c (ns)',
      speedup: 'Speed-up over the single-cycle processor', agrees: 'Registers and data at the halt equal the single-cycle run',
    },
    yes: 'yes',
    no: 'no',
    errors: {
      assembly: (d) => `does not assemble: ${d}`,
      profile: (d, ch) => `${d} is not implemented by the ${PROCESSOR[ch]} processor`,
      limit: (d) => `no halt within ${Number(d).toLocaleString('en-GB')} cycles`,
      stopped: (d) => `stopped: ${d}`,
    },
    predictor: 'Pipeline predictor',
    jalr: 'Multicycle: reference JALR state',
    run: 'Run again',
    tcNote: 'T_c: single-cycle, the slowest instruction class; multicycle, the slowest step; '
      + 'pipelined, the slowest stage plus the register overhead. Illustrative delays, not hardware timing.',
    cyclesNote: 'Cycles are counted to the halt as the reference testbenches count them; the pipelined count includes the four cycles of pipeline fill, '
      + 'which a long program makes negligible.',
    pipeNote: 'The pipelined processor is the reference design: complete hazard unit, branches resolved in EX.',
    differNote: 'A result differs from the single-cycle run. On the multicycle processor code and data share one memory and data start at 0x200, '
      + 'so a register that holds a data address differs, and a program that writes below 0x200 by absolute address overwrites its own code.',
    stoppedNote: 'A column without numbers names why the program did not run to its halt on that processor.',
    empty: 'Assemble a program to compare it.',
    running: 'Running on the three processors…',
  }),

  // the workspace: header, toolbar, resizable panes (M6 interface)
  subtitle: 'Visualize. Execute. Understand.',
  layout: Object.freeze({
    divider: 'Drag to resize; arrow keys move it, Enter or a double click restores it',
    collapse: (p) => `Fold ${p}`,
    expand: (p) => `Open ${p}`,
    view: 'View',
    reset: 'Reset layout',
    resetDone: 'The layout is back at its defaults.',
    show: 'Show',
    dock: 'Memory and console',
    dockBar: 'Memory · Console (folded): open',
    panes: { editor: 'Editor', inspector: 'Instruction inspector', counters: 'Counters', dock: 'Memory and console', info: 'Details', calls: 'Call stack' },
    note: 'Pane sizes are kept in this browser, for each view.',
  }),
  tools: Object.freeze({
    build: 'Assemble',
    buildC: 'Compile',
    group: 'Execution controls',
    modes: 'Processor views',
    clear: 'Clear messages',
    status: (line, col, lines) => `Ln ${line}, Col ${col} · ${lines} lines`,
    modified: 'Modified',
    saved: 'Kept in this browser',
    pc: 'Program counter',
    regDetail: (r, abi, hex, s, u, b) => `x${r} (${abi}) = ${hex} = ${s} signed = ${u} unsigned = ${b}`,
    zero: 'x0 is hard-wired to zero',
    colDec: 'Decimal',
    regPick: 'Select a register to see its value in every format.',
    themes: { '': 'Theme: as the system (click for dark)', dark: 'Theme: dark (click for light)', light: 'Theme: light (click to follow the system)' },
    noBreakLine: 'No instruction on that line to stop at.',
  }),
  // share link and settings file (WS-F-122, WS-F-144, WS-N-013)
  share: Object.freeze({
    copyLink: 'Copy share link',
    copyLinkTitle: 'A link that carries the program, the view and its settings in the part after #, which the browser never sends to the server',
    saveSettings: 'Save program and settings…',
    saveSettingsTitle: 'A .json file with the program, the view and its settings; open it with File ▸ Open',
    restore: 'Restore text before the link',
    restoreTitle: 'Put back the editor text that the last opened link or settings file replaced',
    copied: (n) => `Share link copied (${n.toLocaleString('en-GB')} characters). It holds the program, the view and its settings; nothing is stored on a server.`,
    copyFailed: 'The browser did not allow copying. Select the link below and copy it yourself:',
    tooLong: (n, limit) => `The program is too long for a link (${n.toLocaleString('en-GB')} characters; the limit is ${limit.toLocaleString('en-GB')}). Share it as a file with File ▸ ${'Save program and settings…'}.`,
    opened: (view) => `Opened a shared program in the ${view} view, with its settings.`,
    openedFile: (name, view) => `Opened ${name}: the program in the ${view} view, with its settings.`,
    keptNote: 'The text that was in the editor is kept: File ▸ Restore text before the link.',
    refused: (why) => `This link or file was not opened: ${why}.`,
    refusedVersion: 'It was made by another version of MAVILERA. Ask for a new link, or open the program as a plain .s or .c file.',
    restored: 'The text from before the link is back in the editor.',
    nothingToRestore: 'There is no earlier text to restore.',
  }),
  // example library (WS-F-123)
  examples: Object.freeze({
    menu: 'Examples…',
    title: 'Examples',
    note: 'Each example opens in the view of its processor. The text in the editor is kept: File ▸ Restore text before the link brings it back.',
    loading: 'Loading the list…',
    failed: (why) => `The examples could not be loaded: ${why}`,
    topics: {
      basics: 'Instructions, constants and memory', control: 'Branches, loops and procedures', tests: 'Simulator test programs',
      single: 'Single-cycle processor', multi: 'Multicycle processor', pipe: 'Pipelined processor',
    },
    opened: (title) => `Opened the example "${title}".`,
    needsJalr: 'This program uses jalr: tick the optional JALR extension under Display in this view, or it stops at the jalr.',
    noJalr: 'This program uses jalr, for which this multicycle processor has no state: it stops at the jalr.',
    noHalt: 'This program is for the listing and the encodings: it does not run to a halt and stops with an error when run.',
  }),
  // import of GCC -S output (WS-F-085)
  gcc: Object.freeze({
    imported: (name, n) => `${name} is GCC output: imported for the ISA profile with ${n} change(s), listed below. The original lines keep their numbers; additions are at the end.`,
    actions: {
      dropped: (what) => `${what}: debugging or linking directive, made a comment`,
      skipped: (what) => `section ${what}: not part of the program, made comments`,
      unknown: (what) => `section ${what}: not known to the simulator, made comments`,
      text: (what) => `section ${what}: placed in .text`,
      rodata: (what) => `section ${what}: read-only data placed in .data (the simulator does not protect it)`,
      label: (what) => `${what}, . : written as a label`,
      comm: (what) => `${what}: its space is added at the end, in .data`,
      plt: () => '@plt removed from a call',
      pcrel: () => 'PC-relative relocation: compile with -mcmodel=medlow (the default), which the assembler supports',
      unsupported: (what) => `${what}: 64-bit or floating-point data, which the simulator does not support`,
    },
    added: (list) => `Added at the end: start-up code (sp, call main, exit with its result)${list ? ` and the routines ${list}` : ''}.`,
    missing: (list) => `Called but not defined, and not supplied by the import: ${list}. The simulator has no C library; only putchar, exit and the multiply and divide helpers are supplied.`,
    note: 'Compile with: riscv32-…-gcc -S -march=rv32im -mabi=ilp32 (or rv32i) prog.c. Nothing is sent anywhere: open the .s file here.',
  }),
  // data import and export (WS-F-145)
  dataIo: Object.freeze({
    menu: 'Data in and out…',
    menuTitle: 'Load a CSV or binary file into a data array before a run, or save a memory range as CSV or .bin',
    title: 'Data in and out',
    loadHead: 'Load a file into a data array',
    loadNote: 'The values replace the array\'s initial contents in the program image, so every view starts from them; they stay in force when you assemble again, until you clear them. '
      + 'CSV or text: numbers separated by commas, spaces or lines (decimal, 0x…, 0b…), a heading line allowed. .bin: the bytes as they are.',
    array: 'Array',
    arrayOption: (name, addr, room) => `${name} (${addr}, room for ${room} bytes)`,
    element: 'Element size',
    sizes: { word: 'word (32 bits)', half: 'half-word (16 bits)', byte: 'byte (8 bits)' },
    file: 'File',
    load: 'Load',
    clear: 'Clear all loads',
    noArrays: 'The program has no data label: define one in .data, assemble, and try again.',
    noFile: 'Choose a file first.',
    loadedNow: (file, label, n) => `${file}: ${n} byte(s) loaded into ${label}.`,
    loaded: (file, label, n) => `${label} ← ${file} (${n} bytes)`,
    refused: (why) => `Not loaded: ${why}.`,
    saveHead: 'Save a memory range',
    from: 'From (label or address)',
    fromHint: 'label or 0x…',
    count: 'Number of elements',
    format: 'Format',
    save: 'Save',
    noMemory: 'Assemble a program first.',
    badFrom: 'Give a label of the program or a hexadecimal address.',
    badCount: 'The number of elements is 1 to 65536.',
    misaligned: (size) => `The address must be a multiple of ${size}.`,
    saved: (n, addr) => `Saved ${n} element(s) from ${addr}, from the memory as it is now.`,
    privacy: 'Files are read and written in this browser only; nothing is uploaded.',
    assembledLoads: (list) => `Data loaded before the run: ${list}.`,
    droppedLoad: (label, why) => (why === 'missing' ? `The data loaded into ${label} was not applied: the program has no data label ${label} now.`
      : `The data loaded into ${label} was not applied: it no longer fits.`),
  }),
  // encode/decode scratchpad (WS-F-024), at the top of the instruction inspector
  scratch: Object.freeze({
    label: 'Encode or decode',
    placeholder: 'addi a0, a0, 1   or   0x00150513',
    title: 'Type one instruction to see its machine word, or a word (0x… or 0b…) to see its instruction. '
      + 'Branches and jumps take a byte offset here, since there are no labels. Nothing is assembled into the program.',
    word: (hex, bin) => `${hex} = ${bin}`,
    decoded: (text) => `→ ${text}`,
    notInstr: 'This word is not an RV32I or M instruction.',
    oneOnly: 'One instruction only: no label or directive.',
    pick: 'Show the fields of this word',
  }),
  inspector: Object.freeze({
    type: (f) => `${f}-type`,
    opcode: 'opcode',
    fieldsCaption: 'Fields of the machine word',
    semantics: 'Operation',
    decoded: 'Decoded',
  }),
  // what each instruction does, in register-transfer notation (instruction inspector)
  semantics: Object.freeze({
    lui: 'x[rd] = imm << 12', auipc: 'x[rd] = pc + (imm << 12)',
    jal: 'x[rd] = pc + 4;  pc = pc + offset', jalr: 'x[rd] = pc + 4;  pc = (x[rs1] + imm) & ~1',
    beq: 'if (x[rs1] == x[rs2]) pc = pc + offset', bne: 'if (x[rs1] != x[rs2]) pc = pc + offset',
    blt: 'if (x[rs1] < x[rs2], signed) pc = pc + offset', bge: 'if (x[rs1] >= x[rs2], signed) pc = pc + offset',
    bltu: 'if (x[rs1] < x[rs2], unsigned) pc = pc + offset', bgeu: 'if (x[rs1] >= x[rs2], unsigned) pc = pc + offset',
    lb: 'x[rd] = sign-extend(M[x[rs1] + imm], 8 bits)', lh: 'x[rd] = sign-extend(M[x[rs1] + imm], 16 bits)',
    lw: 'x[rd] = M[x[rs1] + imm] (32 bits)', lbu: 'x[rd] = zero-extend(M[x[rs1] + imm], 8 bits)',
    lhu: 'x[rd] = zero-extend(M[x[rs1] + imm], 16 bits)',
    sb: 'M[x[rs1] + imm] = x[rs2][7:0]', sh: 'M[x[rs1] + imm] = x[rs2][15:0]', sw: 'M[x[rs1] + imm] = x[rs2]',
    addi: 'x[rd] = x[rs1] + imm', slti: 'x[rd] = (x[rs1] < imm, signed) ? 1 : 0', sltiu: 'x[rd] = (x[rs1] < imm, unsigned) ? 1 : 0',
    xori: 'x[rd] = x[rs1] ^ imm', ori: 'x[rd] = x[rs1] | imm', andi: 'x[rd] = x[rs1] & imm',
    slli: 'x[rd] = x[rs1] << shamt', srli: 'x[rd] = x[rs1] >> shamt (logical)', srai: 'x[rd] = x[rs1] >> shamt (arithmetic)',
    add: 'x[rd] = x[rs1] + x[rs2]', sub: 'x[rd] = x[rs1] - x[rs2]', sll: 'x[rd] = x[rs1] << x[rs2][4:0]',
    slt: 'x[rd] = (x[rs1] < x[rs2], signed) ? 1 : 0', sltu: 'x[rd] = (x[rs1] < x[rs2], unsigned) ? 1 : 0',
    xor: 'x[rd] = x[rs1] ^ x[rs2]', srl: 'x[rd] = x[rs1] >> x[rs2][4:0] (logical)', sra: 'x[rd] = x[rs1] >> x[rs2][4:0] (arithmetic)',
    or: 'x[rd] = x[rs1] | x[rs2]', and: 'x[rd] = x[rs1] & x[rs2]',
    mul: 'x[rd] = (x[rs1] × x[rs2]), low 32 bits', mulh: 'x[rd] = (x[rs1] × x[rs2]), high 32 bits, signed × signed',
    mulhsu: 'x[rd] = (x[rs1] × x[rs2]), high 32 bits, signed × unsigned', mulhu: 'x[rd] = (x[rs1] × x[rs2]), high 32 bits, unsigned',
    div: 'x[rd] = x[rs1] ÷ x[rs2], signed, rounded towards zero', divu: 'x[rd] = x[rs1] ÷ x[rs2], unsigned',
    rem: 'x[rd] = remainder of x[rs1] ÷ x[rs2], signed', remu: 'x[rd] = remainder of x[rs1] ÷ x[rs2], unsigned',
    fence: 'orders memory accesses (no effect in this simulator)', 'fence.i': 'synchronises instruction fetch (no effect in this simulator)',
    ecall: 'system call: a7 = 93 exit, a7 = 64 write', ebreak: 'stops the program (breakpoint trap)',
    wfi: 'waits for an interrupt (privileged profile, M7)', mret: 'returns from a machine-mode trap (privileged profile, M7)',
    csrrw: 'x[rd] = CSR;  CSR = x[rs1]', csrrs: 'x[rd] = CSR;  CSR = CSR | x[rs1]', csrrc: 'x[rd] = CSR;  CSR = CSR & ~x[rs1]',
    csrrwi: 'x[rd] = CSR;  CSR = uimm', csrrsi: 'x[rd] = CSR;  CSR = CSR | uimm', csrrci: 'x[rd] = CSR;  CSR = CSR & ~uimm',
  }),

  // what each pseudo-instruction does and what the assembler writes for it (editor help, WS-U-021)
  pseudoSemantics: Object.freeze({
    nop: 'no operation: addi x0, x0, 0', li: 'x[rd] = value: addi, or lui and addi for a value outside ±2048',
    la: 'x[rd] = address of label: lui and addi', mv: 'x[rd] = x[rs]: addi rd, rs, 0', not: 'x[rd] = ~x[rs]: xori rd, rs, -1',
    neg: 'x[rd] = -x[rs]: sub rd, x0, rs', seqz: 'x[rd] = (x[rs] == 0) ? 1 : 0: sltiu rd, rs, 1',
    snez: 'x[rd] = (x[rs] != 0) ? 1 : 0: sltu rd, x0, rs', sltz: 'x[rd] = (x[rs] < 0) ? 1 : 0: slt rd, rs, x0',
    sgtz: 'x[rd] = (x[rs] > 0) ? 1 : 0: slt rd, x0, rs',
    beqz: 'if (x[rs] == 0) pc = label: beq rs, x0, label', bnez: 'if (x[rs] != 0) pc = label: bne rs, x0, label',
    bltz: 'if (x[rs] < 0) pc = label: blt rs, x0, label', bgez: 'if (x[rs] >= 0) pc = label: bge rs, x0, label',
    blez: 'if (x[rs] <= 0) pc = label: bge x0, rs, label', bgtz: 'if (x[rs] > 0) pc = label: blt x0, rs, label',
    bgt: 'if (x[rs1] > x[rs2], signed) pc = label: blt rs2, rs1, label', ble: 'if (x[rs1] <= x[rs2], signed) pc = label: bge rs2, rs1, label',
    bgtu: 'if (x[rs1] > x[rs2], unsigned) pc = label: bltu rs2, rs1, label', bleu: 'if (x[rs1] <= x[rs2], unsigned) pc = label: bgeu rs2, rs1, label',
    j: 'pc = label: jal x0, label', jr: 'pc = x[rs]: jalr x0, 0(rs)', ret: 'pc = x[ra], the return: jalr x0, 0(ra)',
    call: 'x[ra] = pc + 4;  pc = label: jal ra, label', tail: 'pc = label, a call that does not return here: jal x0, label',
    halt: 'stops the program: jal x0, 0, a jump to itself', csrr: 'x[rd] = CSR: csrrs rd, csr, x0 (privileged profile, M7)',
    csrw: 'CSR = x[rs]: csrrw x0, csr, rs (privileged profile, M7)', csrs: 'CSR = CSR | x[rs]: csrrs x0, csr, rs (privileged profile, M7)',
    csrc: 'CSR = CSR & ~x[rs]: csrrc x0, csr, rs (privileged profile, M7)', csrwi: 'CSR = uimm: csrrwi x0, csr, uimm (privileged profile, M7)',
    csrsi: 'CSR = CSR | uimm: csrrsi x0, csr, uimm (privileged profile, M7)', csrci: 'CSR = CSR & ~uimm: csrrci x0, csr, uimm (privileged profile, M7)',
  }),
  // completion and hover help in the editor (WS-U-021)
  assist: Object.freeze({
    listLabel: 'Completions: ↑/↓ choose, Enter or Tab inserts, Esc closes',
    pseudo: 'pseudo-instruction',
    format: (f) => `${f}-type`,
    register: (abi, x) => `${abi} = ${x}`,
    regRoles: {
      zero: 'always 0', ra: 'return address', sp: 'stack pointer', gp: 'global pointer', tp: 'thread pointer',
      t: 'temporary (caller-saved)', s: 'saved (callee-saved)', a: 'argument or result', fp: 'frame pointer (s0)',
    },
  }),

  errorAt: (file, line, col) => `${file}:${line}:${col}`,
  errorSummary: 'Errors are marked in the editor; select one to go to it.',
});
