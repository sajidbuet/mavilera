// riscv/strings.js -- the RISC-V interface strings, in British English (WS-N-007, W-D12): the architecture's part of
// the interface text (spec W-D29; docs/architecture/arch-contract.md phase 4). The descriptor gives them as `strings`;
// the shell merges them over its own (src/ui/strings.js, `mergeStrings`) when it loads the architecture. The RISC-V
// modules that also run without the shell (the descriptor, under Node.js and in the Worker) read them from here.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const orList = (xs) => {
  const q = xs.map((x) => `'${x}'`);
  return q.length > 1 ? `${q.slice(0, -1).join(', ')} or ${q[q.length - 1]}` : q[0];
};

// The processor of a datapath profile, by its number (profiles.js `chapter`), for messages.
const PROCESSOR = Object.freeze({ 6: 'single-cycle', 7: 'multicycle', 8: 'pipelined' });

export const RISCV_STRINGS = Object.freeze({
  appFull: 'RISC-V Laboratory',
  aboutText: 'MAVILERA is an educational platform for exploring microprocessor architecture. This module, the RISC-V Laboratory, is an interactive, browser-based environment for exploring RISC-V instruction execution, processor architecture, '
    + 'and microarchitectural behavior through assembly programming, simulation, debugging, and visualization.',
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
    fixedNote: 'One step is one clock cycle. The connections that the current state uses are highlighted, and the state is named on the control unit; '
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

  formatName: (f) => `${f}-type`,

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

  // joined with the shell's groups of the same name
  capability: Object.freeze({
    trapsNeedPriv: 'Traps and privileged state need the profile "ISA with traps and devices".',
    privNoWorker: 'On the profile with traps and devices a run stays on this page, so that the devices can be watched.',
  }),
  tools: Object.freeze({ zero: 'x0 is hard-wired to zero', colAlias: 'ABI' }),
  colValue: 'Word value',
  examples: Object.freeze({
    topics: {
      basics: 'Instructions, constants and memory', control: 'Branches, loops and procedures', tests: 'Simulator test programs',
      single: 'Single-cycle processor', multi: 'Multicycle processor', pipe: 'Pipelined processor',
    },
    needsJalr: 'This program uses jalr: tick the optional JALR extension under Display in this view, or it stops at the jalr.',
    noJalr: 'This program uses jalr, for which this multicycle processor has no state: it stops at the jalr.',
  }),
  calls: Object.freeze({
    empty: 'No call in progress. A call is a jal or jalr that writes ra; it ends when a jalr returns to the address after it.',
    site: (where, call, ret, sp) => `called at ${where} (${call}) · returns to ${ret}${sp ? ` · sp ${sp}` : ''}`,
    args: 'a0–a7 at the call',
    note: 'The simulator does not know how many arguments a procedure takes: all of a0–a7 are shown as they were at the call, in signed decimal (point at one for hex).',
  }),
  scratch: Object.freeze({
    placeholder: 'addi a0, a0, 1   or   0x00150513',
    title: 'Type one instruction to see its machine word, or a word (0x… or 0b…) to see its instruction. '
      + 'Branches and jumps take a byte offset here, since there are no labels. Nothing is assembled into the program.',
    notInstr: 'This word is not an RV32I or M instruction.',
  }),
  inspector: Object.freeze({
    type: (f) => `${f}-type`,
    opcode: 'opcode',
  }),
  assist: Object.freeze({
    format: (f) => `${f}-type`,
    register: (abi, x) => `${abi} = ${x}`,
    regRoles: {
      zero: 'always 0', ra: 'return address', sp: 'stack pointer', gp: 'global pointer', tp: 'thread pointer',
      t: 'temporary (caller-saved)', s: 'saved (callee-saved)', a: 'argument or result', fp: 'frame pointer (s0)',
    },
  }),

  profileNames: { iss: 'ISA (RV32I + M)', 'iss-priv': 'ISA with traps and devices', ch06: 'Single-cycle processor', ch07: 'Multicycle processor', ch08: 'Pipelined processor' },

  memGoSp: 'Show the memory at the stack pointer (sp = x2)',

  classes: { alu: 'ALU', load: 'Load', store: 'Store', branch_taken: 'Branch taken', branch_not_taken: 'Branch not taken',
    jump: 'Jump', mul: 'Multiply', div: 'Divide', system: 'System' },

  stackUse: 'Deepest stack use (bytes)',

  profileError: (mn, ch) => `${mn} is not implemented by the ${PROCESSOR[ch]} processor.`,

  profileIss: (mn) => `${mn} needs the privileged profile (milestone M7).`,

  profileHint: (ch) => `Choose the profile "ISA (RV32I + M)" to run it, or rewrite it with the instructions of the ${PROCESSOR[ch]} processor.`,

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

  abiViolation: (v) => `ABI: ${v}`,

  // the uninitialised-value check (WS-F-147)
  uninit: (v) => `Uninitialised: ${v}`,

  uninitNote: 'A simulator check: the value is whatever the register or memory happened to hold (here 0). Write it before reading it. '
    + 'Saving ra or s0–s11 on the stack in a prologue is not reported.',

  uninitMore: 'More uninitialised reads follow; only the first 20 after a reset are listed.',

  viewIsa: 'ISA',

  viewSingle: 'Single-cycle',

  viewMulti: 'Multicycle',

  viewPipe: 'Pipelined',

  viewCompare: 'Compare',

  // the C-subset compiler (spec §10.1, WS-F-080 to WS-F-084)
  cc: Object.freeze({
    languages: { c: 'C' },
    sourceLine: (n) => `C line ${n}`,
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
  mem: Object.freeze({
    modes: { ideal: 'Ideal: every access takes one cycle (the reference processors)' },
    intro: 'The setting applies to the three processor views and the comparison. The instruction-level (ISA) view has no clock and no memory timing, but shows the contents and counts of the caches at the current instruction. '
      + 'Changing the setting restarts the program.',
    devicesNote: 'Processor views only: the three devices appear in the address map at 0x4000_0000, 0x4000_1000 and 0x4000_2000, and the Peripherals tab shows their board. A program polls them with lw and sw; interrupts and traps belong to the profile "ISA with traps and devices". Stepping back restores the devices.',
    sizeNote: 'Processor views only. The default, 256 words, is the reference size; larger sizes make cache examples possible.',
    cpuNames: { isa: 'Instruction-level view', single: 'Single-cycle processor', multi: 'Multicycle processor', pipe: 'Pipelined processor', compare: 'Processors' },
    // the Peripherals tab
    periphNote: 'The address map below is what the processor sees. The devices (GPIO, timer, UART) are modelled in the profile "ISA with traps and devices"; choose it in the Profile list of the instruction-level view.',
    periphNoteDevices: 'The address map below is what the processor sees: the platform devices sit in the window 0x4000_0000 to 0x4FFF_FFFF.',
    idealMap: 'Ideal memory: the chapter processors’ own memory, wrapping over the whole address space.',
    // the comparison under the memory models (compare mode, D9)
    cmp: Object.freeze({
      title: 'Memory models compared',
      intro: 'Each processor runs the program under three memory models: A ideal memory, B main memory without a cache, C main memory with the caches. '
        + 'B and C use the main-memory timing and the cache designs of the Memory model setting (the Memory button).',
      scenarios: { A: 'A · Ideal memory', B: 'B · Main memory, no cache', C: 'C · Main memory with cache' },
      scenarioShort: { A: 'A', B: 'B', C: 'C' },
      colProcessor: 'Processor', colScenario: 'Memory model', colCycles: 'Cycles', colRetired: 'Instructions', colCpi: 'CPI', colIpc: 'IPC',
      colStallData: 'Stall: data', colStallFetch: 'Stall: fetch', colStallArb: 'Stall: arbitration', colStallTotal: 'Stall cycles',
      colHitI: 'L1I hit rate', colHitD: 'L1D hit rate', colSame: 'Same result as A',
      caption: 'Cycles, CPI, IPC, stall cycles by cause and cache hit rate, for each processor and memory model',
      ratiosCaption: 'Ratios of cycles: the cost of the memory, for each processor',
      ratioCA: 'C ÷ A', ratioCB: 'C ÷ B', ratioBA: 'B ÷ A',
      vsSingleCaption: 'CPI of each processor relative to the single-cycle processor, for each memory model',
      chartTitle: 'CPI by processor and memory model',
      chartLabel: (parts) => `Bar chart of CPI: ${parts}`,
      csv: 'Download CSV', csvName: 'memory-comparison.csv', csvDone: (n) => `Saved the memory comparison (${n} rows).`,
      notBuilt: (s, why) => `Memory model ${s} cannot be run: ${why}`,
      differNote: 'A result differs from the same processor on ideal memory. The memory model must never change what a program computes; this is a defect to report.',
      byDesign: 'Cycle counts differ from rvcache.py by design: here the cost of dirty evictions and write-throughs is charged (switch the write buffer to ideal in the Memory model to absorb them). Hit and miss counts are designed to follow its rules. Nothing here is claimed to agree with the RTL.',
      cpiOnly: 'Only CPI and IPC are reported: cycles per second has no meaning without a clock frequency.',
      yes: 'yes', no: 'NO', na: 'n/a',
    }),
  }),

  // the platform of the profile iss-priv: board, devices, traps (Peripherals tab)
  platform: Object.freeze({
    heading: 'Platform board',
    intro: 'The LEDs show the GPIO output register (bit n lights LED n). The four switches are GPIO input bits 7 to 4 and the push button is input bit 8. Press them with the mouse or the keyboard (Space or Enter); each change is a pin event at the current cycle, kept in the stimulus script below.',
    figureLabel: 'Platform board: eight LEDs, four switches, a push button, the timer, the UART and the interrupt lines to the processor',
    led: (n, on) => `LED ${n} (OUT bit ${n}): ${on ? 'on' : 'off'}`,
    sw: (n) => `Switch ${n} (input bit ${4 + n})`,
    button: 'Push button (input bit 8)',
    boardLabels: { gpio: 'GPIO', timer: 'TIMER', uart: 'UART', cpu: 'Processor', leds: 'LEDs', switches: 'Switches', button: 'Button', tx: 'TX', rx: 'RX',
      mtip: 'MTIP', meip: 'MEIP', mtime: 'MTIME', cmp: 'MTIMECMP' },
    notPriv: 'The platform devices belong to the profile "ISA with traps and devices". Choose it in the Profile list (instruction-level view), or open one of the templates in the group Devices and traps.',
    cpuHeading: 'Processor',
    cpu: { mode: 'Mode', modeM: 'Machine (M)', modeU: 'User (U)', cycle: 'Cycle', retired: 'Instructions retired', traps: 'Traps taken', idle: 'Cycles waiting in wfi',
      mie: 'mstatus.MIE', mpie: 'mstatus.MPIE', enabled: 'mie', pending: 'mip', mtvec: 'mtvec', mepc: 'mepc', mcause: 'mcause', mtval: 'mtval', last: 'Last trap',
      none: 'none yet', vectored: 'vectored', direct: 'direct', on: 'on', off: 'off', noTraps: 'no traps in this view' },
    set: { heading: 'Settings', div: 'MTIME advances once every (cycles)', entry: 'Cycles to take a trap', zero: 'mtval is always 0', check: 'Trap check: interrupt handlers must restore every register and return to mepc',
      note: 'Any change restarts the program. These are the options of the reference model (--mtime-div, --trap-entry, --mtval-zero, --trap-check); they are kept with the program in links and settings files.',
      violations: 'Trap check', noViolations: 'No handler has been found to break the rules so far.' },
    trapViolation: (m) => `Trap check: ${m}`,
    regHeading: 'Device registers',
    regNote: 'Values are read without side effects (a peek): reading RXDATA here does not take the byte.',
    colOffset: 'Offset', colReg: 'Register', colAccess: 'Access', colValue: 'Value',
    access: { rw: 'read, write', ro: 'read only', wo: 'write only', w1c: 'write 1 to clear' },
    uartHeading: 'UART terminal',
    uartOut: 'Transmitted bytes', uartIn: 'Send a character to the receiver', uartSend: 'Send', uartPlaceholder: 'text',
    uartStatus: (s) => `STATUS: TX ${s.txrdy ? 'ready' : 'busy'}, RX ${s.rxvalid ? 'byte waiting' : 'empty'}${s.txovr ? ', TX byte lost' : ''}${s.rxovr ? ', RX byte lost' : ''}`,
    uartNote: 'The UART is a simple model written for this laboratory: a byte takes 4 CPU cycles to send, the receiver holds 8 bytes. It is not part of the reference model that the rest of the platform is checked against.',
    uartSent: (n) => `Sent ${n} byte${n === 1 ? '' : 's'} to the receiver at the current cycle.`,
    irqHeading: 'Interrupts',
    irqNone: 'No interrupt has been requested yet.',
    irqCols: { source: 'Source', events: 'Requests', taken: 'Taken', acked: 'Acknowledged', toHandler: 'Request to handler (cycles)', toAck: 'Request to acknowledge (cycles)' },
    irqNote: 'Cycles are those of the abstract processor: one per instruction, 3 to take a trap. They are not measurements of a real core.',
    stimHeading: 'Stimulus script',
    stimNone: 'No pin events yet.',
    stimEvent: (e) => `cycle ${e.cycle}: ${e.text}`,
    stimClear: 'Clear the script',
    stimCleared: 'The stimulus script is cleared; the program restarts.',
    stimNote: 'Pin events apply at their cycle on every run; going back in time replays them.',
    scriptError: (why) => `The stimulus script is not valid: ${why}`,
    pinText: { sw: (n, v) => `switch ${n} ${v ? 'up' : 'down'}`, btn: (v) => `button ${v ? 'pressed' : 'released'}`, other: 'pins changed' },
  }),
});
