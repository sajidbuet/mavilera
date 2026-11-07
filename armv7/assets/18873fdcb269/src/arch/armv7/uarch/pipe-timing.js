// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const PIPE_DELAY_KEYS = Object.freeze(['pcq', 'setup', 'imem', 'rf', 'ext', 'mux', 'alu', 'add', 'dmem', 'dec', 'aludec', 'cond', 'gate', 'hazard']);
export const PIPE_EXT_DELAY_KEYS = Object.freeze([...PIPE_DELAY_KEYS, 'shift', 'byte']);
const STAGE_OF = { 'IF/ID register': 'IF', 'ID/EX register': 'ID', 'EX/MEM register': 'EX', FlagsE: 'EX', 'MEM/WB register': 'MEM',
 'data memory (store)': 'MEM' };
const stageOf = (end, path) => (end === 'PC register' ? (path.some((p) => p.node === 'ALUResultE') ? 'EX' : 'IF') : STAGE_OF[end]);
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
 set('InstrF', d.imem, ['PCF']);
 set('PCPlus4F', d.add, ['PCF']);
 set('Control Unit', d.dec, ['InstrD']);
 set('ALU Decoder', d.aludec, ['Control Unit']);
 set('RA multiplexers', d.mux, ['InstrD', 'Control Unit']);
 set('ExtImmD', d.ext, ['InstrD', 'Control Unit']);
 if (ext) set('A3 multiplexer', d.mux, ['InstrD', 'Control Unit']);
 if (ext) set('ReadByteW', d.byte, ['MEM/WB']);
 set('ResultW', d.mux, ['MEM/WB', ext ? 'ReadByteW' : null]);
 set('ForwardAE, ForwardBE', d.hazard, ['ID/EX', 'EX/MEM', 'MEM/WB']);
 set('SrcAE, WriteDataE', d.mux, ['ID/EX', 'ResultW', 'EX/MEM', 'ForwardAE, ForwardBE']);
 if (ext) set('ShiftResultE', d.shift, ['SrcAE, WriteDataE', 'ID/EX', 'FlagsE']);
 set('SrcBE', d.mux, [ext ? 'ShiftResultE' : 'SrcAE, WriteDataE', 'ID/EX']);
 set('ALUResultE', d.alu, ['SrcAE, WriteDataE', 'SrcBE', 'ID/EX', ...(ext ? ['FlagsE', 'ShiftResultE'] : [])]);
 set('CondExE', d.cond, ['ID/EX', 'FlagsE']);
 set('gated controls', d.gate, ['CondExE', 'ID/EX']);
 set('BranchTakenE', d.gate, ['CondExE', 'ID/EX']);
 set('StallF, StallD, FlushD, FlushE', d.hazard, ['RA multiplexers', 'Control Unit', 'ID/EX', 'EX/MEM', 'MEM/WB', 'BranchTakenE']);
 set('PCMuxF', d.mux, ['PCPlus4F', 'ResultW', 'MEM/WB']);
 set('PCNext', d.mux, ['PCMuxF', 'ALUResultE', 'BranchTakenE']);
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
