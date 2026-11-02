// armv7/uarch/multi-timing.js -- the critical path of each state of the ARM multicycle processor (roadmap ARM-A3; author
// decision A3-Q6), with the rules of the single-cycle timing (uarch/timing.js):
//   1. an output is valid its delay after the last of the inputs it uses becomes valid; a select counts as an input;
//   2. every path starts at a register, valid t_pcq after the edge: the PC, IR, Data, A, WriteData, ALUOut, the flags,
//      CondExDelayed and the Main FSM's state register. The FSM's outputs (a Moore machine) follow the state t_dec later;
//      the Instr Decoder follows IR t_dec later; the ALU Decoder follows ALUOp and Funct t_aludec later; the PC Logic,
//      the AND gates and the OR gate of PCWrite take t_gate each;
//   3. a path ends t_setup before the next edge at a clocked element whose new value is used: IR (IRWrite), the PC
//      (PCWrite), Data (MemRead), A and WriteData (Decode), ALUOut (when the next state reads it), the register file
//      (RegWrite), the memory (MemWrite), the flags (FlagWrite) and CondExDelayed (every edge).
// The one memory reads in the instruction-memory time (t_imem). Wire delays are ignored. The delays are the illustrative
// values of content/armv7/data/single-delays.json (W-D32 Q9; not Harris and Harris's Table 7.5), so that the multicycle
// clock can be compared with the single-cycle one. Pure.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { STATES, STATE_OUTPUTS, FSM_OUTPUTS, instrDecode } from './multi.js';
import { STATES_EXT, STATE_OUTPUTS_EXT, FSM_OUTPUTS_EXT } from './multi-ext.js';

const ALUOUT_READ = new Set(['Decode', 'MemAdr', 'ExecuteR', 'ExecuteI', 'Link']); // the next state reads ALUOut

/** The delay keys this timing uses (the rest of single-delays.json belongs to the single-cycle processors). */
export const MULTI_DELAY_KEYS = Object.freeze(['pcq', 'setup', 'imem', 'rf', 'ext', 'mux', 'alu', 'dec', 'aludec', 'cond', 'gate']);
/** With the Extended processor's shifter and Byte unit. */
export const MULTI_EXT_DELAY_KEYS = Object.freeze([...MULTI_DELAY_KEYS, 'shift', 'byte']);

/**
 * Arrival times and the critical path of one cycle.
 * @param {object} d delays by key
 * @param {object} s the cycle's signals (uarch/multi.js or multi-ext.js evaluate().signals, or stateSignals())
 * @param {boolean} ext the Extended processor: the shifter before the SrcB multiplexer (ShiftCtl from the Instr Decoder,
 *   C from the flags), the flags and ShiftC into the ALU, the Byte unit and its multiplexer before Data, the PC into the
 *   Result multiplexer, the A3 multiplexer (Link) before the write port, and NoWrite into the RegWrite gate
 * @returns {{arrival: object, endpoints: {end: string, delay: number}[], critical: {end: string, delay: number, path: {node: string, t: number}[]}}}
 */
export function multiCriticalPath(d, s, ext = false) {
  const state = (ext ? STATES_EXT : STATES)[s.state];
  const arr = {};
  const from = {};
  const set = (node, delay, inputs) => {
    let best = null;
    for (const inp of inputs) if (inp && (!best || arr[inp] > arr[best])) best = inp;
    arr[node] = (best ? arr[best] : 0) + delay;
    from[node] = best;
  };
  for (const r of ['PC', 'Instr', 'Data', 'A', 'WriteData', 'ALUOut', 'Flags', 'CondExDelayed', 'state']) set(r, d.pcq, []);
  set('Main FSM', d.dec, ['state']);
  set('Instr Decoder', d.dec, ['Instr']);
  set('ALU Decoder', d.aludec, ['Main FSM', 'Instr']);
  set('Adr', d.mux, ['Main FSM', s.AdrSrc ? 'ALUOut' : 'PC']);
  set('ReadData', d.imem, ['Adr']);
  set('ExtImm', d.ext, ['Instr Decoder', 'Instr']);
  set('SrcA', d.mux, ['Main FSM', s.ALUSrcA ? 'PC' : 'A']);
  if (ext) set('ShiftResult', d.shift, ['Instr Decoder', 'WriteData', 'Flags']);
  set('SrcB', d.mux, ['Main FSM', [ext ? 'ShiftResult' : 'WriteData', 'ExtImm', null, null][s.ALUSrcB]]);
  set('ALUResult', d.alu, ['SrcA', 'SrcB', 'ALU Decoder', ...(ext ? ['Flags', s.ALUSrcB === 0 ? 'ShiftResult' : null] : [])]);
  set('Result', d.mux, ['Main FSM', ['ALUOut', 'Data', 'ALUResult', ext ? 'PC' : null][s.ResultSrc]]);
  if (ext) {
    set('ReadByte', d.byte, ['ReadData', 'ALUOut']);
    set('DataIn', d.mux, ['Instr Decoder', s.ByteSel ? 'ReadByte' : 'ReadData']);
    set('WA3', d.mux, ['Main FSM', s.Link ? null : 'Instr']);
  }
  set('RA1', d.mux, ['Instr Decoder', s.RegSrc & 1 ? null : 'Instr']);
  set('RA2', d.mux, ['Instr Decoder', 'Instr']);
  set('RD1', d.rf, ['RA1', s.RA1 === 15 ? 'Result' : null]);
  set('RD2', d.rf, ['RA2', s.RA2 === 15 ? 'Result' : null]);
  set('CondEx', d.cond, ['Instr', 'Flags']);
  set('FlagWrite', d.gate, ['CondEx', 'ALU Decoder']);
  set('PCS', d.gate, ['Main FSM', ext ? 'WA3' : 'Instr']); // the PC Logic: (Rd == 15 AND RegW) OR Branch (Extended: WA3)
  set('PCSGated', d.gate, ['PCS', 'CondExDelayed']);
  set('PCWrite', d.gate, ['PCSGated', 'Main FSM']);
  set('RegWrite', d.gate, ['CondExDelayed', 'Main FSM', ext ? 'Instr Decoder' : null]); // Extended: NoWrite, inverted
  set('MemWrite', d.gate, ['CondExDelayed', 'Main FSM']);

  const endpoints = [];
  const end = (name, inputs) => { set(name, d.setup, inputs); endpoints.push(name); };
  if (s.IRWrite) end('IR', ['ReadData', 'Main FSM']);
  if (s.PCWrite) end('PC register', ['Result', 'PCWrite']); // not 'PC': that node is the start of the PC's paths
  if (state === 'MemRead') end('Data register', [ext ? 'DataIn' : 'ReadData']);
  if (state === 'Decode') { end('A register', ['RD1']); end('WriteData register', ['RD2']); }
  if (ALUOUT_READ.has(state)) end('ALUOut register', ['ALUResult']);
  if (s.RegWrite && (ext ? s.WA3 : s.Rd) !== 15) end('register file', ['Result', 'RegWrite', ext ? 'WA3' : 'Instr']);
  if (s.MemWrite) end('memory', ['Adr', 'WriteData', 'MemWrite']);
  if (s.FlagWrite) end('flags', ['ALUResult', 'FlagWrite']);
  end('CondExDelayed register', ['CondEx']);
  let last = null;
  for (const e of endpoints) if (!last || arr[e] > arr[last]) last = e;
  const path = [];
  for (let n = last; n; n = from[n]) path.unshift({ node: n, t: arr[n] });
  return { arrival: arr, endpoints: endpoints.map((e) => ({ end: e, delay: arr[e] })), critical: { end: last, delay: arr[last], path } };
}

/**
 * The signals of a state for the per-state table: its outputs (a don't-care drives 0), the condition passed, and the
 * instruction that makes the state slowest: in Decode a branch (R15 read through Result, RA1 = 15), in ExecuteR and
 * ExecuteI an instruction with S (the flags written), in MemWB and ALUWB a destination other than R15; in the Extended
 * processor ExecuteR with a shifted register, MemRead and MemWB of LDRB, and Link and BranchL of BL.
 */
export function stateSignals(state, ext = false) {
  const row = (ext ? STATE_OUTPUTS_EXT : STATE_OUTPUTS).find((r) => r.state === state);
  const s = Object.fromEntries((ext ? FSM_OUTPUTS_EXT : FSM_OUTPUTS).map((k) => [k, row[k] ?? 0]));
  const branch = ['Decode', 'Branch', 'Link', 'BranchL'].includes(state);
  const Op = branch ? 0b10 : ['MemAdr', 'MemRead', 'MemWB', 'MemWrite'].includes(state) ? 0b01 : 0b00;
  const id = instrDecode(Op);
  const Rd = 3;
  const PCS = s.Branch ? 1 : 0;
  const x = ext ? { ByteSel: state === 'MemRead' || state === 'MemWB' ? 1 : 0, WA3: s.Link ? 14 : Rd, NoWrite: 0,
    ShiftCtl: state === 'ExecuteR' ? 0b0001000 : 0 } : {};
  return { ...s, ...x, state: (ext ? STATES_EXT : STATES).indexOf(state), RegSrc: id.RegSrc, ImmSrc: id.ImmSrc, RA1: id.RegSrc & 1 ? 15 : 1,
    RA2: id.RegSrc & 2 ? Rd : 2, Rd, CondEx: 1, CondExDelayed: 1, PCS, PCWrite: PCS | s.NextPC, RegWrite: s.RegW, MemWrite: s.MemW,
    FlagWrite: state === 'ExecuteR' || state === 'ExecuteI' ? 0b11 : 0 };
}

/** The critical path of every state and the clock period they set. */
export function stateTable(delays, ext = false) {
  const rows = (ext ? STATES_EXT : STATES).map((state) => {
    const r = multiCriticalPath(delays, stateSignals(state, ext), ext);
    return { state, delay: r.critical.delay, end: r.critical.end, path: r.critical.path };
  });
  const tc = Math.max(...rows.map((r) => r.delay));
  return { rows, tc, setBy: rows.filter((r) => r.delay === tc).map((r) => r.state) };
}
