// armv7/uarch/pipe-timing.js -- the clock period of the ARM pipelined processor (roadmap ARM-A4, part 3): the critical
// path into every clocked element, stage by stage, with the rules of the single-cycle and multicycle timing
// (uarch/timing.js, multi-timing.js):
//   1. an output is valid its delay after the last of the inputs it may use becomes valid (the worst case over every
//      instruction: every multiplexer input counts); a select counts as an input;
//   2. every path starts at a register, valid t_pcq after the edge: the PC, the four pipeline registers and FlagsE. The
//      Control Unit's Main Decoder follows InstrD t_dec later and its ALU Decoder t_aludec after that; the Cond Unit's
//      CondExE follows CondE and FlagsE t_cond later; each AND gate takes t_gate; the Hazard Unit gives its outputs
//      t_hazard after the last of its inputs (its comparisons and its logic as one block: this application's choice);
//   3. a path ends t_setup before the next edge at a clocked element: the PC, a pipeline register, FlagsE, the data
//      memory (a store). The register file is written in the first half of the cycle and read in the second (Harris and
//      Harris, p. 431; Eq 7.5, p. 442): its write must be done at half the period, so the period is at least twice the
//      Writeback path into it; its read starts at half the period, so the period is at least twice the read and the
//      setup, and at least twice the time the read address needs.
// Eq 7.5 gives the Execute stage as t_pcq + 2 t_mux + t_ALU + t_setup; the branch multiplexer between ALUResultE and the
// PC (Fig 7.58) is one multiplexer more on the path of a taken branch, and the forwarding multiplexers wait for the
// Hazard Unit's selects; both are counted here (this application's reading of the figure). Wire delays are ignored. The
// delays are the illustrative values of content/armv7/data/single-delays.json (W-D32 Q9; not Table 7.5), so that the
// three processors can be compared. Pure.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/** The delay keys this timing uses. */
export const PIPE_DELAY_KEYS = Object.freeze(['pcq', 'setup', 'imem', 'rf', 'ext', 'mux', 'alu', 'add', 'dmem', 'dec', 'aludec', 'cond', 'gate', 'hazard']);
/** With the Extended processor's shifter (in Execute) and Byte unit (in Writeback; A4-Q6, A4-Q13). */
export const PIPE_EXT_DELAY_KEYS = Object.freeze([...PIPE_DELAY_KEYS, 'shift', 'byte']);

/**
 * The stage whose logic a path ends in: the stage before the clocked element it goes into; for the PC, Execute when the
 * path comes through the ALU (a taken branch), Fetch otherwise.
 */
const STAGE_OF = { 'IF/ID register': 'IF', 'ID/EX register': 'ID', 'EX/MEM register': 'EX', FlagsE: 'EX', 'MEM/WB register': 'MEM',
  'data memory (store)': 'MEM' };
const stageOf = (end, path) => (end === 'PC register' ? (path.some((p) => p.node === 'ALUResultE') ? 'EX' : 'IF') : STAGE_OF[end]);

/**
 * Every timing constraint of the pipeline and the clock period they set.
 * @param {object} d delays by key
 * @param {boolean} ext the Extended processor: the shifter between forwarding multiplexer B and the SrcB multiplexer
 *   (ShiftCtlE and FlagsE as further inputs), the flags and ShiftCE into the ALU, the Byte unit before the result
 *   multiplexer, and the A3 multiplexer in Decode
 * @returns {{rows: {stage: string, end: string, delay: number, half: boolean, path: {node: string, t: number}[]}[], tc: number,
 *   setBy: string[]}} rows: the paths into each clocked element, and the three half-cycle constraints of the register file
 *   (half: true; delay is then twice the half-cycle path, the period it needs)
 */
export function pipeTiming(d, ext = false) {
  const arr = {};
  const from = {};
  const set = (node, delay, inputs) => {
    let best = null;
    for (const inp of inputs) if (inp && (!best || arr[inp] > arr[best])) best = inp;
    arr[node] = (best ? arr[best] : 0) + delay;
    from[node] = best;
  };
  for (const r of ['PCF', 'InstrD', 'ID/EX', 'FlagsE', 'EX/MEM', 'MEM/WB']) set(r, d.pcq, []);
  // Fetch
  set('InstrF', d.imem, ['PCF']);
  set('PCPlus4F', d.add, ['PCF']);
  // Decode
  set('Control Unit', d.dec, ['InstrD']);
  set('ALU Decoder', d.aludec, ['Control Unit']);
  set('RA multiplexers', d.mux, ['InstrD', 'Control Unit']);
  set('ExtImmD', d.ext, ['InstrD', 'Control Unit']);
  if (ext) set('A3 multiplexer', d.mux, ['InstrD', 'Control Unit']);
  // Writeback (Extended: the Byte unit before the result multiplexer)
  if (ext) set('ReadByteW', d.byte, ['MEM/WB']);
  set('ResultW', d.mux, ['MEM/WB', ext ? 'ReadByteW' : null]);
  // Execute: the Hazard Unit's forwarding selects, the forwarding and SrcB multiplexers, the ALU, the Cond Unit
  set('ForwardAE, ForwardBE', d.hazard, ['ID/EX', 'EX/MEM', 'MEM/WB']);
  set('SrcAE, WriteDataE', d.mux, ['ID/EX', 'ResultW', 'EX/MEM', 'ForwardAE, ForwardBE']);
  if (ext) set('ShiftResultE', d.shift, ['SrcAE, WriteDataE', 'ID/EX', 'FlagsE']);
  set('SrcBE', d.mux, [ext ? 'ShiftResultE' : 'SrcAE, WriteDataE', 'ID/EX']);
  set('ALUResultE', d.alu, ['SrcAE, WriteDataE', 'SrcBE', 'ID/EX', ...(ext ? ['FlagsE', 'ShiftResultE'] : [])]);
  set('CondExE', d.cond, ['ID/EX', 'FlagsE']);
  set('gated controls', d.gate, ['CondExE', 'ID/EX']);
  set('BranchTakenE', d.gate, ['CondExE', 'ID/EX']);
  // the Hazard Unit's stalls and flushes: Match_12D_E (RA1D, RA2D against WA3E), MemtoRegE, PCSrcD/E/M/W, BranchTakenE
  set('StallF, StallD, FlushD, FlushE', d.hazard, ['RA multiplexers', 'Control Unit', 'ID/EX', 'EX/MEM', 'MEM/WB', 'BranchTakenE']);
  // the next PC: PCSrcW's multiplexer, then the branch multiplexer
  set('PCMuxF', d.mux, ['PCPlus4F', 'ResultW', 'MEM/WB']);
  set('PCNext', d.mux, ['PCMuxF', 'ALUResultE', 'BranchTakenE']);
  // Memory
  set('ReadDataM', d.dmem, ['EX/MEM']);

  const rows = [];
  const pathOf = (n) => { const p = []; for (let x = n; x; x = from[x]) p.unshift({ node: x, t: arr[x] }); return p; };
  const end = (name, inputs) => {
    set(name, d.setup, inputs);
    const path = pathOf(name);
    rows.push({ stage: stageOf(name, path), end: name, delay: arr[name], half: false, path });
  };
  end('PC register', ['PCNext', 'StallF, StallD, FlushD, FlushE']);
  end('IF/ID register', ['InstrF', 'StallF, StallD, FlushD, FlushE']);
  end('ID/EX register', ['ExtImmD', 'ALU Decoder', 'StallF, StallD, FlushD, FlushE', ext ? 'A3 multiplexer' : null]);
  end('EX/MEM register', ['ALUResultE', 'SrcAE, WriteDataE', 'gated controls']);
  end('FlagsE', ['ALUResultE', 'gated controls']);
  end('data memory (store)', ['EX/MEM']);
  end('MEM/WB register', ['ReadDataM']);
  // the register file's two halves (Eq 7.5)
  const half = (stage, endName, nodes) => {
    const t = nodes.reduce((a, n) => a + n.t, 0);
    let acc = 0;
    rows.push({ stage, end: endName, delay: 2 * t, half: true, path: nodes.map((n) => ({ node: n.node, t: (acc += n.t) })) });
  };
  half('ID', 'register-file read, second half of Decode', [{ node: 'read', t: d.rf }, { node: 'setup of ID/EX', t: d.setup }]);
  half('ID', 'read address by mid-cycle', [{ node: 'InstrD', t: d.pcq }, { node: 'Control Unit', t: d.dec }, { node: 'RA multiplexers', t: d.mux }]);
  half('ID', 'R15 input (PCPlus8D) by mid-cycle', [{ node: 'PCF', t: d.pcq }, { node: 'PCPlus4F = PCPlus8D', t: d.add }]);
  half('WB', 'register-file write, first half of Writeback', [{ node: 'MEM/WB', t: d.pcq }, ...(ext ? [{ node: 'ReadByteW', t: d.byte }] : []),
    { node: 'ResultW', t: d.mux }, { node: 'setup of the register file', t: d.setup }]);
  const order = ['IF', 'ID', 'EX', 'MEM', 'WB'];
  rows.sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage) || b.delay - a.delay);
  const tc = Math.max(...rows.map((r) => r.delay));
  return { rows, tc, setBy: rows.filter((r) => r.delay === tc).map((r) => `${r.stage}: ${r.end}`) };
}
