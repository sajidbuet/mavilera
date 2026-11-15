// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { STATES, STATE_OUTPUTS, FSM_OUTPUTS, instrDecode } from './multi.js';
import { STATES_EXT, STATE_OUTPUTS_EXT, FSM_OUTPUTS_EXT } from './multi-ext.js';
const ALUOUT_READ = new Set(['Decode', 'MemAdr', 'ExecuteR', 'ExecuteI', 'Link']);
export const MULTI_DELAY_KEYS = Object.freeze(['pcq', 'setup', 'imem', 'rf', 'ext', 'mux', 'alu', 'dec', 'aludec', 'cond', 'gate']);
export const MULTI_EXT_DELAY_KEYS = Object.freeze([...MULTI_DELAY_KEYS, 'shift', 'byte']);
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
 set('PCS', d.gate, ['Main FSM', ext ? 'WA3' : 'Instr']);
 set('PCSGated', d.gate, ['PCS', 'CondExDelayed']);
 set('PCWrite', d.gate, ['PCSGated', 'Main FSM']);
 set('RegWrite', d.gate, ['CondExDelayed', 'Main FSM', ext ? 'Instr Decoder' : null]);
 set('MemWrite', d.gate, ['CondExDelayed', 'Main FSM']);
 const endpoints = [];
 const end = (name, inputs) => { set(name, d.setup, inputs); endpoints.push(name); };
 if (s.IRWrite) end('IR', ['ReadData', 'Main FSM']);
 if (s.PCWrite) end('PC register', ['Result', 'PCWrite']);
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
export function stateTable(delays, ext = false) {
 const rows = (ext ? STATES_EXT : STATES).map((state) => {
 const r = multiCriticalPath(delays, stateSignals(state, ext), ext);
 return { state, delay: r.critical.delay, end: r.critical.end, path: r.critical.path };
 });
 const tc = Math.max(...rows.map((r) => r.delay));
 return { rows, tc, setBy: rows.filter((r) => r.delay === tc).map((r) => r.state) };
}
