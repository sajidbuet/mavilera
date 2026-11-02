// make-multi-geometry.mjs -- writes the drawings of the ARM multicycle processor (roadmap ARM-A3; spec W-D32 Q8):
// content/armv7/geometry/multi-extended.json, the Extended variant (MAVILERA's own design, A3-Q3 to A3-Q5; see the end
// of this file), and content/armv7/geometry/multi.json, the base design: Harris and Harris's block topology of Fig 7.30 (p. 414) with the
// control unit of Fig 7.31 (p. 415), in MAVILERA's own layout and symbols, and the Main FSM of Fig 7.41 (p. 423) as a
// state diagram (`fsm`, drawn by src/ui/fsm.js) in this application's own arrangement. The geometry schema is the one of
// content/geometry/ch07.json (docs/ui/datapath-schematics.md); the coordinates are this application's, in cm with y up,
// traced from no figure. Wire signals are names of the ARM signal dictionary (src/arch/armv7/uarch/signals.js,
// MULTI_SIGNALS), which give the bus-width markers. The author approves the drawing before it is wired up.
//
//   node tools/armv7/make-multi-geometry.mjs
//
// Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = (name) => fileURLToPath(new URL(`../../content/armv7/geometry/${name}`, import.meta.url));
const r4 = (v) => +v.toFixed(4);

// --- shapes -----------------------------------------------------------------------------------------------------
/** A D-shaped AND gate `h` high and 0.5 wide. */
const gate = (h) => {
  const rad = h / 2;
  const arc = Array.from({ length: 9 }, (_, k) => {
    const t = -Math.PI / 2 + (k * Math.PI) / 8;
    return [r4(0.5 - rad + rad * Math.cos(t)), r4(rad * Math.sin(t))];
  });
  return [[0, -rad], ...arc, [0, rad]];
};
/** An OR gate `h` high and 0.6 long: a pointed front and a concave back. */
const orGate = (h) => {
  const r = h / 2;
  const front = Array.from({ length: 9 }, (_, k) => {
    const t = -1 + k / 4; // -1 .. 1
    return [r4(0.6 * (1 - t * t) ** 0.5 * 0.55 + 0.27 * (1 - Math.abs(t)) + 0.05), r4(r * t)];
  });
  const back = Array.from({ length: 5 }, (_, k) => {
    const t = 1 - k / 2; // 1 .. -1
    return [r4(0.1 * (1 - t * t)), r4(r * t)];
  });
  return [...front.map(([x, y], i) => [i === 4 ? 0.6 : x, y]), ...back.slice(1, -1)];
};
const muxLabels = (ys, order) => ys.map((y, i) => ({ text: String(order[i]), at: [0.02, y], anchor: 'west' }));
const MUX2 = [[0, -0.75], [0.6, -0.45], [0.6, 0.45], [0, 0.75]];
const MUX3 = [[0, -1.0], [0.6, -0.7], [0.6, 0.7], [0, 1.0]];
const pics = {
  mux2: { outline: MUX2, anchors: { in0: [0, 0.4], in1: [0, -0.4], out: [0.6, 0] }, labels: muxLabels([0.4, -0.4], [0, 1]) },
  // input 1 on top: the SrcA multiplexer takes the PC from above
  mux2f: { outline: MUX2, anchors: { in1: [0, 0.4], in0: [0, -0.4], out: [0.6, 0] }, labels: muxLabels([0.4, -0.4], [1, 0]) },
  mux3: { outline: MUX3, anchors: { in0: [0, 0.5], in1: [0, 0], in2: [0, -0.5], out: [0.6, 0] }, labels: muxLabels([0.5, 0, -0.5], [0, 1, 2]) },
  // input 2 on top: the Result multiplexer takes ALUResult from above and ALUOut from below
  mux3f: { outline: MUX3, anchors: { in2: [0, 0.5], in1: [0, 0], in0: [0, -0.5], out: [0.6, 0] }, labels: muxLabels([0.5, 0, -0.5], [2, 1, 0]) },
  alu: {
    outline: [[0, -1.1], [1, -0.5], [1, 0.5], [0, 1.1], [0, 0.28], [0.22, 0], [0, -0.28]],
    anchors: { a: [0, 0.7], b: [0, -0.7], out: [1, 0], ctrl: [0.5, -0.8], flags: [0.5, 0.8] },
    labels: [{ text: 'ALU', at: [0.6, 0], anchor: 'center' }],
  },
  and2: { outline: gate(0.5), anchors: { a: [0, 0.12], b: [0, -0.12], out: [0.5, 0] }, labels: [] },
  or2: { outline: orGate(0.5), anchors: { a: [0.06, 0.12], b: [0.06, -0.12], out: [0.6, 0] }, labels: [] },
};

// --- the controller: the control unit, the flags, Condition Check, the CondEx delay and the gates (Fig 7.31) ----------
const GX = 12.2; // the gates' left edge
const CX = 11.8; // the CondEx trunk, and above the delay register the CondExDelayed trunk
const ORX = GX + 0.95; // the OR gate of PCWrite
const GATES = { flagw: 5.6, memw: 6.7, regw: 7.4, pcs: 8.1 };
const gy = (k, port) => GATES[k] + (port === 'a' ? 0.12 : -0.12);
const CU_RIGHT = 7.0;

const elements = [
  { id: 'pc', type: 'reg', at: [1.0, 0], size: [0.8, 1.3], text: 'PC' },
  { id: 'am', type: 'mux2', at: [2.1, -0.4] },
  { id: 'mem', type: 'mem', at: [3.95, -0.4], size: [1.9, 2.4], text: '' },
  { id: 'ir', type: 'reg', at: [5.75, 0.8], size: [0.7, 0.8], text: 'IR' },
  { id: 'data', type: 'reg', at: [5.75, -1.6], size: [0.7, 0.7], text: 'Data' },
  { id: 'ra1m', type: 'mux2', at: [7.6, 1.6] },
  { id: 'ra2m', type: 'mux2', at: [7.6, -0.2] },
  { id: 'rf', type: 'block', at: [9.6, -0.3], size: [1.8, 4.4], text: '' },
  { id: 'ext', type: 'comb', at: [9.6, -3.4], size: [1.4, 0.6], text: 'Extend' },
  { id: 'areg', type: 'reg', at: [11.4, 1.0], size: [1.0, 0.6], text: 'A' },
  { id: 'wdreg', type: 'reg', at: [11.4, -0.5], size: [1.0, 0.6], text: 'WriteData' },
  { id: 'sam', type: 'mux2f', at: [12.6, 1.4] },
  { id: 'sbm', type: 'mux3', at: [12.6, -1.0] },
  { id: 'alu', type: 'alu', at: [13.6, 0.2] },
  { id: 'aoreg', type: 'reg', at: [15.4, 0.2], size: [0.8, 0.7], text: 'ALUOut' },
  { id: 'rm', type: 'mux3f', at: [16.8, 0.2] },
  { id: 'cu', type: 'block', at: [4.4, 7.0], size: [5.2, 3.4], text: '' },
  { id: 'flags', type: 'reg', at: [14.1, 4.45], size: [0.9, 0.7], text: 'Flags' },
  { id: 'cc', type: 'comb', at: [12.6, 4.45], size: [1.0, 0.7], text: 'Condition\ncheck' },
  { id: 'cxd', type: 'reg', at: [CX, 6.1], size: [0.5, 0.4], text: '' },
  ...Object.entries(GATES).map(([k, y]) => ({ id: `g_${k}`, type: 'and2', at: [GX, y] })),
  { id: 'g_pcwrite', type: 'or2', at: [ORX, 8.3] },
];

const wires = [];
const b = (id, signal, points, { arrow = true, style = 'bus', labels = [] } = {}) => wires.push({ id, style, arrow, points, signal, labels });
const lab = (text, at, place) => ({ text, at, place });

// the PC, the address multiplexer, the memory, IR and Data
b('pc_out', 'PC', [[1.4, 0], [1.65, 0]], { arrow: false });
b('pc_am', 'PC', [[1.65, 0], [2.1, 0]]);
b('pc_sa', 'PC', [[1.65, 0], [1.65, 3.0], [12.3, 3.0], [12.3, 1.8], [12.6, 1.8]], { labels: [lab('PC', [4.5, 3.0], 'above')] });
b('am_mem', 'Adr', [[2.7, -0.4], [3.0, -0.4]]);
b('mem_rd', 'ReadData', [[4.9, -0.4], [5.1, -0.4]], { arrow: false });
b('rd_ir', 'ReadData', [[5.1, -0.4], [5.1, 0.8], [5.4, 0.8]]);
b('rd_data', 'ReadData', [[5.1, -0.4], [5.1, -1.6], [5.4, -1.6]]);
// the instruction and its fields
b('ir_bus', 'Instr', [[6.1, 0.8], [6.6, 0.8]], { arrow: false });
b('bus_up1', 'Instr', [[6.6, 0.8], [6.6, 2.0]], { arrow: false });
b('bus_up2', 'Instr', [[6.6, 2.0], [6.6, 5.0]], { arrow: false, labels: [{ text: 'Instr', at: [6.6, 4.3], anchor: 'west' }] });
b('ins_ctl', 'Op,Funct,Rd', [[6.6, 5.0], [6.6, 5.3]]);
b('ins_cond', 'Cond', [[6.6, 5.0], [12.6, 5.0], [12.6, 4.8]], { labels: [lab('Cond 31:28', [9.0, 5.0], 'above')] });
b('ins_rn', 'Rn', [[6.6, 2.0], [7.6, 2.0]], { labels: [lab('19:16', [7.05, 2.0], 'above')] });
b('c15_ra1m', 'const15', [[7.3, 1.2], [7.6, 1.2]], { labels: [lab('15', [7.3, 1.2], 'left')] });
b('bus_dn1', 'Instr', [[6.6, 0.8], [6.6, 0.2]], { arrow: false });
b('ins_rm', 'Rm', [[6.6, 0.2], [7.6, 0.2]], { labels: [lab('3:0', [7.05, 0.2], 'above')] });
b('bus_dn2', 'Instr', [[6.6, 0.2], [6.6, -1.8]], { arrow: false });
b('ins_rd_a', 'Rd', [[6.6, -1.8], [7.2, -1.8]], { arrow: false });
b('ins_rd', 'Rd', [[7.2, -1.8], [8.7, -1.8]], { labels: [lab('15:12', [7.95, -1.8], 'below')] });
b('rd_ra2m', 'Rd', [[7.2, -1.8], [7.2, -0.6], [7.6, -0.6]]);
b('bus_dn3', 'Instr', [[6.6, -1.8], [6.6, -3.4]], { arrow: false });
b('ins_imm', 'Imm24', [[6.6, -3.4], [8.9, -3.4]], { labels: [lab('23:0', [7.6, -3.4], 'above')] });
// the register file, A, WriteData, Extend, the source multiplexers and the ALU
b('ra1m_rf', 'RA1', [[8.2, 1.6], [8.7, 1.6]]);
b('ra2m_rf', 'RA2', [[8.2, -0.2], [8.7, -0.2]]);
b('rd1_a', 'RD1', [[10.5, 1.0], [10.9, 1.0]]);
b('rd2_wd', 'RD2', [[10.5, -0.5], [10.9, -0.5]]);
b('a_sa', 'A', [[11.9, 1.0], [12.6, 1.0]]);
b('wd_j', 'WriteData', [[11.9, -0.5], [12.0, -0.5]], { arrow: false });
b('wd_sb', 'WriteData', [[12.0, -0.5], [12.6, -0.5]]);
b('wd_mem', 'WriteData', [[12.0, -0.5], [12.0, -4.8], [2.85, -4.8], [2.85, -1.2], [3.0, -1.2]], { labels: [lab('WriteData', [5.0, -4.8], 'above')] });
b('ext_sb', 'ExtImm', [[10.3, -3.4], [12.25, -3.4], [12.25, -1.0], [12.6, -1.0]], { labels: [lab('ExtImm', [11.1, -3.4], 'above')] });
b('c4_sb', 'const4', [[12.45, -1.95], [12.45, -1.5], [12.6, -1.5]], { labels: [lab('4', [12.45, -1.95], 'below')] });
b('sa_alu', 'SrcA', [[13.2, 1.4], [13.4, 1.4], [13.4, 0.9], [13.6, 0.9]]);
b('sb_alu', 'SrcB', [[13.2, -1.0], [13.4, -1.0], [13.4, -0.5], [13.6, -0.5]]);
// ALUOut, the Result multiplexer and the Result bus back to the register file and the PC
b('alu_j', 'ALUResult', [[14.6, 0.2], [14.8, 0.2]], { arrow: false });
b('alu_ao', 'ALUResult', [[14.8, 0.2], [15.0, 0.2]]);
b('alu_rm', 'ALUResult', [[14.8, 0.2], [14.8, 0.7], [16.8, 0.7]], { labels: [lab('ALUResult', [15.8, 0.7], 'above')] });
b('ao_j', 'ALUOut', [[15.8, 0.2], [16.1, 0.2], [16.1, -0.3]], { arrow: false });
b('ao_rm', 'ALUOut', [[16.1, -0.3], [16.8, -0.3]]);
b('ao_am', 'ALUOut', [[16.1, -0.3], [16.1, -5.2], [1.85, -5.2], [1.85, -0.8], [2.1, -0.8]], { labels: [lab('ALUOut', [9.0, -5.2], 'below')] });
b('data_rm', 'Data', [[6.1, -1.6], [6.3, -1.6], [6.3, -4.4], [16.5, -4.4], [16.5, 0.2], [16.8, 0.2]], { labels: [lab('Data', [14.0, -4.4], 'above')] });
b('rm_res', 'Result', [[17.4, 0.2], [17.7, 0.2], [17.7, 3.6], [10.15, 3.6]], { arrow: false });
b('res_r15', 'Result', [[10.15, 3.6], [10.15, 1.9]]);
b('res_a2', 'Result', [[10.15, 3.6], [9.45, 3.6]], { arrow: false });
b('res_wd3', 'Result', [[9.45, 3.6], [9.45, 1.9]]);
b('res_pc', 'Result', [[9.45, 3.6], [0.3, 3.6], [0.3, 0], [0.6, 0]], { labels: [lab('Result', [4.5, 3.6], 'above')] });
// the conditional logic (Fig 7.31c): flags, Condition Check, CondEx and its one-cycle delay, the gates
b('alu_flags', 'ALUFlags', [[14.1, 1.0], [14.1, 4.1]], { labels: [{ text: 'ALUFlags', at: [14.1, 2.3], anchor: 'west' }] });
b('flags_cc', 'Flags', [[13.65, 4.45], [13.1, 4.45]]);
b('condex', 'CondEx', [[12.1, 4.45], [CX, 4.45], [CX, gy('flagw', 'b')], [GX, gy('flagw', 'b')]], { style: 'ctrl', labels: [{ text: 'CondEx', at: [CX - 0.05, 4.6], anchor: 'east' }] });
b('condex_cxd', 'CondEx', [[CX, gy('flagw', 'b')], [CX, 5.9]], { style: 'ctrl' });
b('cxd_pcs', 'CondExDelayed', [[CX, 6.3], [CX, gy('pcs', 'b')], [GX, gy('pcs', 'b')]], { style: 'ctrl', labels: [{ text: 'CondExDelayed', at: [CX - 0.3, 6.1], anchor: 'east' }] });
for (const k of ['memw', 'regw']) b(`cxd_${k}`, 'CondExDelayed', [[CX, gy(k, 'b')], [GX, gy(k, 'b')]], { style: 'ctrl' });
for (const [k, s] of [['flagw', 'FlagW'], ['memw', 'MemW'], ['regw', 'RegW'], ['pcs', 'PCS']]) {
  b(`cu_${k}`, s, [[CU_RIGHT, gy(k, 'a')], [GX, gy(k, 'a')]], { style: 'ctrl', labels: [{ text: s, at: [CU_RIGHT + 0.05, gy(k, 'a')], anchor: 'south west' }] });
}
b('cu_nextpc', 'NextPC', [[CU_RIGHT, 8.62], [ORX - 0.15, 8.62], [ORX - 0.15, 8.42], [ORX + 0.06, 8.42]], { style: 'ctrl', labels: [{ text: 'NextPC', at: [CU_RIGHT + 0.05, 8.62], anchor: 'south west' }] });
b('pcs_or', 'PCSGated', [[GX + 0.5, GATES.pcs], [GX + 0.75, GATES.pcs], [GX + 0.75, 8.18], [ORX + 0.06, 8.18]], { style: 'ctrl' });

const junctions = [[1.65, 0], [5.1, -0.4], [6.6, 0.8], [6.6, 2.0], [6.6, 0.2], [6.6, -1.8], [7.2, -1.8], [6.6, 5.0], [12.0, -0.5],
  [14.8, 0.2], [16.1, -0.3], [10.15, 3.6], [9.45, 3.6], [CX, gy('flagw', 'b')], [CX, gy('memw', 'b')], [CX, gy('regw', 'b')]];

// control stubs, named at the destination (the control unit is their origin)
const gateOut = (id, x, y, s) => ({ signal: s, points: [[x, y], [x + 0.4, y]], label_at: 'end', place: 'right' });
const control = [
  { signal: 'PCWrite', points: [[1.0, 1.1], [1.0, 0.65]], place: 'above' },
  { signal: 'AdrSrc', points: [[2.4, 0.65], [2.4, 0.2]], place: 'above' },
  { signal: 'MemWrite', points: [[3.95, 1.25], [3.95, 0.8]], place: 'above' },
  { signal: 'IRWrite', points: [[5.75, 1.6], [5.75, 1.2]], place: 'above' },
  { signal: 'RegSrc', text: 'RegSrc0', points: [[7.9, 2.6], [7.9, 2.2]], anchor: 'east' },
  { signal: 'RegSrc', text: 'RegSrc1', points: [[7.9, -1.2], [7.9, -0.8]], place: 'below' },
  { signal: 'RegWrite', points: [[11.0, 1.65], [10.5, 1.65]], anchor: 'west' },
  { signal: 'ImmSrc', points: [[9.6, -4.05], [9.6, -3.7]], anchor: 'west' },
  { signal: 'ALUSrcA', points: [[13.0, 2.45], [13.0, 1.95]], place: 'above' },
  { signal: 'ALUSrcB', points: [[13.0, -2.3], [13.0, -1.8]], place: 'below' },
  { signal: 'ALUControl', points: [[14.1, -1.5], [14.1, -0.6]], place: 'below' },
  { signal: 'ResultSrc', points: [[17.1, 1.5], [17.1, 1.05]], anchor: 'east' },
  { signal: 'FlagWrite', points: [[15.0, 4.45], [14.55, 4.45]], anchor: 'west' },
  gateOut('g_pcwrite', ORX + 0.6, 8.3, 'PCWrite'), gateOut('g_regw', GX + 0.5, GATES.regw, 'RegWrite'),
  gateOut('g_memw', GX + 0.5, GATES.memw, 'MemWrite'), gateOut('g_flagw', GX + 0.5, GATES.flagw, 'FlagWrite'),
];

const sig = (text, at, anchor) => ({ type: 'label', style: 'sig', at, anchor, text });
const fig = (text, at, anchor) => ({ type: 'label', style: 'figlabel', at, anchor, text });
const labels = [
  fig('Control unit', [4.4, 8.15], 'center'),
  fig('Main FSM, Instr Decoder,\nALU Decoder, PC Logic', [3.9, 6.0], 'center'),
  fig('Instr / Data\nmemory', [3.95, 0.3], 'center'),
  fig('Register\nfile', [9.6, -1.0], 'center'),
  fig('Conditional logic', [GX + 0.5, 8.75], 'south'),
  sig('A', [3.0, -0.4], 'west'), sig('WD', [3.0, -1.2], 'west'), sig('RD', [4.9, -0.4], 'east'),
  sig('A1', [8.7, 1.6], 'west'), sig('A2', [8.7, -0.2], 'west'), sig('A3', [8.7, -1.8], 'west'),
  sig('RD1', [10.5, 1.0], 'east'), sig('RD2', [10.5, -0.5], 'east'), sig('WD3', [9.45, 1.9], 'north'), sig('R15', [10.15, 1.9], 'north'),
];

// --- the Main FSM (Fig 7.41) in this application's own arrangement ---------------------------------------------------
const R = 0.85;
const ST = {
  Fetch: [0, 0], Decode: [3.0, 0],
  MemAdr: [10.0, 3.6], ExecuteR: [10.0, 1.2], ExecuteI: [10.0, -1.2], Branch: [10.0, -3.6],
  MemRead: [13.2, 4.6], MemWrite: [13.2, 2.6], ALUWB: [13.2, 0],
  MemWB: [16.4, 4.6],
  Link: [6.6, -6.2], BranchL: [10.0, -6.2], // the Extended processor's states for BL (A3-Q3)
};
/** A straight arc between two states, from rim to rim, with a label at `t` of its length (or where x = `atX`). */
const arc = (from, to, text, { t = 0.5, atX = null, anchor = 'south' } = {}) => {
  const [x0, y0] = ST[from];
  const [x1, y1] = ST[to];
  const d = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / d;
  const uy = (y1 - y0) / d;
  const p0 = [r4(x0 + R * ux), r4(y0 + R * uy)];
  const p1 = [r4(x1 - R * ux), r4(y1 - R * uy)];
  const a = { from, to, points: [p0, p1] };
  const k = atX === null ? t : (atX - p0[0]) / (p1[0] - p0[0]);
  if (text) a.label = { text, at: [r4(p0[0] + (p1[0] - p0[0]) * k), r4(p0[1] + (p1[1] - p0[1]) * k)], anchor };
  return a;
};
/**
 * The state diagram: the base FSM, or with `ext` the Extended FSM, whose BL passes Decode, Link and BranchL (A3-Q3); the
 * added states are drawn dashed (`selfstudy`, as the RISC-V diagram's added states), Branch then returns along the
 * ALUWB rail, and the return rail runs lower, under the new states.
 */
function fsmFor(ext) {
  const RAIL = ext ? -7.8 : -5.2; // the return path to Fetch
  const back = (from, points) => ({ from, to: 'Fetch', return: true, points: [...points, [0, RAIL], [0, -R]] });
  const ids = Object.keys(ST).filter((id) => ext || (id !== 'Link' && id !== 'BranchL'));
  return {
    r: R,
    states: ids.map((id) => ({ id, at: ST[id], ...(id === 'Fetch' ? { initial: 'above' } : {}), ...(id === 'Link' || id === 'BranchL' ? { selfstudy: true } : {}) })),
    arcs: [
      arc('Fetch', 'Decode'),
      arc('Decode', 'MemAdr', 'Op = 01', { anchor: 'south east' }),
      arc('Decode', 'ExecuteR', 'Op = 00, Funct5 = 0', { atX: 8.8, anchor: 'south east' }),
      arc('Decode', 'ExecuteI', 'Op = 00, Funct5 = 1', { atX: 8.8, anchor: 'north east' }),
      arc('Decode', 'Branch', ext ? 'Op = 10, Funct4 = 0' : 'Op = 10', { t: ext ? 0.7 : 0.5, anchor: 'north east' }),
      ...(ext ? [arc('Decode', 'Link', 'Op = 10, Funct4 = 1', { t: 0.55, anchor: 'east' }), arc('Link', 'BranchL')] : []),
      arc('MemAdr', 'MemRead', 'Funct0 = 1', { t: 0.55, anchor: 'south' }),
      arc('MemAdr', 'MemWrite', 'Funct0 = 0', { t: 0.55, anchor: 'north' }),
      arc('MemRead', 'MemWB'),
      arc('ExecuteR', 'ALUWB'),
      arc('ExecuteI', 'ALUWB'),
      back('MemWB', [[16.4 + R, 4.6], [18.0, 4.6], [18.0, RAIL]]),
      back('MemWrite', [[13.2 + R, 2.6], [14.8, 2.6], [14.8, RAIL]]),
      back('ALUWB', [[13.2 + R, 0], [14.8, 0], [14.8, RAIL]]),
      // the return arcs share the last segment: one arrow ends them
      ext ? back('Branch', [[10.0 + R, -3.6], [14.8, -3.6], [14.8, RAIL]]) : { ...back('Branch', [[10.0, -3.6 - R], [10.0, RAIL]]), arrow: true },
      ...(ext ? [{ ...back('BranchL', [[10.0, -6.2 - R], [10.0, RAIL]]), arrow: true }] : []),
    ],
    junctions: ext ? [[14.8, 0], [14.8, -3.6], [14.8, RAIL], [10.0, RAIL]] : [[14.8, 0], [14.8, RAIL], [10.0, RAIL]],
    labels: [{ text: 'reset', at: [0, 2 * R], anchor: 'south' }],
  };
}
const fsm = fsmFor(false);

const COPY = 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: content (Apache-2.0).';
const TOPOLOGY = 'Harris and Harris, Digital Design and Computer Architecture: ARM Edition (2015), Fig 7.30 (p. 414), Fig 7.31 (p. 415) and Fig 7.41 (p. 423): the blocks, their connections and the states only';
const ALT = 'Multicycle ARM datapath. From left to right: the PC register, the address multiplexer choosing the PC or ALUOut as '
  + 'the address Adr, the one memory for instructions and data, and the two registers its read data loads: IR, enabled by '
  + 'IRWrite, and Data. From IR the instruction bus gives the fields Rn, Rm, Rd and Instr23:0 to two register-address '
  + 'multiplexers, the register file and the Extend unit. The register file\'s outputs load the registers A and WriteData; '
  + 'A or the PC (SrcA multiplexer) and WriteData, ExtImm or the constant 4 (SrcB multiplexer) enter the ALU, whose result '
  + 'loads ALUOut. The Result multiplexer chooses ALUOut, Data or ALUResult; Result returns along the top to the register '
  + 'file\'s write-data port, its R15 input and the PC. WriteData also goes to the memory\'s write-data port, Data to the '
  + 'Result multiplexer and ALUOut to the address multiplexer, along the bottom. Above, the controller: the control unit '
  + '(Main FSM, Instr Decoder, ALU Decoder and PC Logic), which reads Op, Funct and Rd; the Flags register, written from '
  + 'ALUFlags; the Condition Check, which gives CondEx; a register that delays CondEx by one cycle; and the gates: FlagWrite = '
  + 'FlagW AND CondEx, MemWrite = MemW AND CondExDelayed, RegWrite = RegW AND CondExDelayed, and PCWrite = (PCS AND '
  + 'CondExDelayed) OR NextPC. Control signals are dashed stubs.';

const geom = {
  _copyright: COPY,
  _source: {
    topology: TOPOLOGY,
    layout: "MAVILERA's own (spec W-D32 Q8); not traced from the figures",
    generated_by: 'tools/armv7/make-multi-geometry.mjs',
    status: 'approved by the author on 2026-11-01 (A3-Q2)',
  },
  profile: 'arm-multi', units: 'cm', y_up: true, pics, elements, labels, wires, junctions, control, figures: {}, alt: ALT, fsm,
};

// --- the Extended datapath (uarch/multi-ext.js; W-D32 C5 ruling, A3-Q3 to A3-Q5) -------------------------------------
// The base drawing spread to the right, so that the added parts fit without crowding (no connection of the base changes
// its endpoints' order): +1.5 cm from IR and Data on (room for the Byte unit and its multiplexer), +1.0 cm from the
// register file on (the A3 multiplexer), +1.0 cm from the source multiplexers on (the shifter). The control unit is
// stretched to its new right edge. Then connections are replaced and parts added, as in the single-cycle Extended drawing.
const fx = (x) => r4(x + (x >= 5.25 ? 1.5 : 0) + (x >= 8.3 ? 1.0 : 0) + (x >= 12.08 ? 1.0 : 0));
const CU_L = 4.4 - 2.6;
const inCu = (x, y) => x > CU_L && x < CU_RIGHT && y > 5.3;
const cuX = (x) => r4(CU_L + ((x - CU_L) * (fx(CU_RIGHT) - CU_L)) / (CU_RIGHT - CU_L));
const fp = ([x, y]) => [fx(x), y];
const spreadEl = (e) => {
  if (!e.size) return { ...e, at: fp(e.at) };
  const l = fx(e.at[0] - e.size[0] / 2);
  const r = fx(e.at[0] + e.size[0] / 2);
  return { ...e, at: [r4((l + r) / 2), e.at[1]], size: [r4(r - l), e.size[1]] };
};
const spreadLabel = (l) => ({ ...l, at: [inCu(l.at[0], l.at[1]) ? cuX(l.at[0]) : fx(l.at[0]), l.at[1]] });
const spreadWire = (w) => ({ ...w, points: w.points.map(fp), labels: w.labels.map((l) => ({ ...l, at: fp(l.at) })) });

const XG = fx(GX); // 15.7: the gates
const XC = fx(CX); // 13.3: the CondEx trunk
const XCU = fx(CU_RIGHT); // 8.5: the control unit's right edge
const RY = GATES.regw;
const MUX4 = [[0, -1.25], [0.6, -0.95], [0.6, 0.95], [0, 1.25]];
const picsExt = {
  ...pics,
  // input 3 on top: the Result multiplexer takes the PC from above; inputs 2 to 0 stay where the base drawing has them
  mux4f: { outline: MUX4, anchors: { in3: [0, 0.75], in2: [0, 0.25], in1: [0, -0.25], in0: [0, -0.75], out: [0.6, 0] }, labels: muxLabels([0.75, 0.25, -0.25, -0.75], [3, 2, 1, 0]) },
  // RegWrite = RegW AND CondExDelayed AND NOT NoWrite: three inputs, the middle one inverted (as the single-cycle drawing)
  and3: { outline: gate(0.6), anchors: { a: [0, 0.2], c: [0, 0], b: [0, -0.2], out: [0.5, 0] }, labels: [] },
  bubble: { outline: Array.from({ length: 12 }, (_, k) => [r4(0.05 * Math.cos((k * Math.PI) / 6)), r4(0.05 * Math.sin((k * Math.PI) / 6))]), anchors: {}, labels: [] },
};
const HIDE = new Set(['rd_data', 'wd_sb', 'ins_rd', 'rm_res', 'cu_regw', 'cxd_regw', 'ins_ctl']);
const REPLACE_EL = { rm: { id: 'rm', type: 'mux4f', at: [fx(16.8), 0.45] }, g_regw: { id: 'g_regw', type: 'and3', at: [XG, RY] } };
const ew = [];
const e = (id, signal, points, { arrow = true, style = 'bus', labels = [] } = {}) => ew.push({ id, style, arrow, points, signal, labels });
// LDRB: the Byte unit and the Data multiplexer before the Data register (A3-Q5); the byte at ALUOut1:0, the address in MemRead
e('rd_dn', 'ReadData', [[5.1, -0.4], [5.1, -1.2]], { arrow: false });
e('rd_dsm', 'ReadData', [[5.1, -1.2], [6.2, -1.2]]);
e('rd_byte', 'ReadData', [[5.1, -1.2], [5.1, -2.0], [5.3, -2.0]]);
e('byte_dsm', 'ReadByte', [[6.1, -2.0], [6.2, -2.0]]);
e('dsm_data', 'DataIn', [[6.8, -1.6], [6.9, -1.6]]);
e('ao_byte', 'ALUOut1:0', [[5.9, -5.2], [5.9, -2.225]], { labels: [lab('1:0', [5.9, -3.6], 'right')] });
// BL: the A3 multiplexer (Rd or 14)
e('rd_wa3m', 'Rd', [[8.7, -1.8], [10.1, -1.8]], { labels: [lab('15:12', [9.4, -1.8], 'below')] });
e('c14_wa3m', 'const14', [[9.8, -2.6], [10.1, -2.6]], { labels: [lab('14', [9.8, -2.6], 'left')] });
e('wa3m_rf', 'WA3', [[10.7, -2.2], [10.9, -2.2], [10.9, -1.8], [11.2, -1.8]]);
// the shifter (Example 7.3) between WriteData and the SrcB multiplexer; its carry and the flags enter the ALU
e('wd_sh', 'WriteData', [[14.5, -0.5], [14.75, -0.5]]);
e('sh_sb', 'ShiftResult', [[15.65, -0.5], [16.1, -0.5]]);
e('shc_alu', 'ShiftC', [[15.45, -0.8], [15.45, -2.9], [17.35, -2.9], [17.35, -0.75]], { style: 'wire', labels: [lab('ShiftC', [16.4, -2.9], 'below')] });
e('flags_alu', 'Flags', [[17.35, 4.1], [17.35, 1.15]]);
// BL: the PC into the Result multiplexer (ResultSrc 11), and Result out of its new centre
e('pc_rm', 'PC', [[15.8, 3.0], [19.1, 3.0], [19.1, 1.2], [20.3, 1.2]]);
e('rm_res', 'Result', [[20.9, 0.45], [21.6, 0.45], [21.6, 3.6], [fx(10.15), 3.6]], { arrow: false });
// the control unit: Instr11:5 for the shifter; NoWrite, inverted, into the RegWrite gate (A3-Q4)
e('ins_ctl', 'Op,Funct,Rd,Instr11:5', [[fx(6.6), 5.0], [fx(6.6), 5.3]]);
e('cu_regw3', 'RegW', [[XCU, RY + 0.2], [XG, RY + 0.2]], { style: 'ctrl', labels: [{ text: 'RegW', at: [XCU + 0.05, RY + 0.2], anchor: 'south west' }] });
e('cu_nowrite', 'NoWrite', [[XCU, RY], [XG - 0.1, RY]], { style: 'ctrl', labels: [{ text: 'NoWrite', at: [XCU + 1.5, RY], anchor: 'north west' }] });
e('cxd_regw3', 'CondExDelayed', [[XC, RY - 0.2], [XG, RY - 0.2]], { style: 'ctrl' });

const ALT_EXT = `${ALT} The Extended datapath adds: a Byte unit and a multiplexer (ByteSel) before the Data register, which loads `
  + 'the byte at ALUOut1:0 for LDRB; an A3 multiplexer choosing Rd or 14 (Link); a shifter (Shift) between WriteData and the '
  + 'SrcB multiplexer, driven by ShiftCtl and the C flag, whose carry ShiftC and the flags go to the ALU, which takes a four-bit '
  + 'ALUControl; a fourth Result-multiplexer input, the PC, for the link value; and NoWrite from the control unit, inverted into '
  + 'the RegWrite gate.';
const geomExt = {
  _copyright: COPY,
  _source: {
    topology: `${TOPOLOGY}; NoWrite after Example 7.2 and the shifter after Example 7.3 (p. 402)`,
    design: "the Extended datapath variant: MAVILERA's own design (W-D32 C5 ruling, A3-Q3 to A3-Q5), semantics from ARM DDI 0406C.d; see src/arch/armv7/uarch/multi-ext.js",
    layout: 'the base drawing spread to the right, with parts added and connections replaced',
    generated_by: 'tools/armv7/make-multi-geometry.mjs',
    status: 'approved by the author on 2026-11-01 (A3-Q10)',
  },
  profile: 'arm-multi', units: 'cm', y_up: true, pics: picsExt,
  elements: [...elements.map((x) => REPLACE_EL[x.id] ?? spreadEl(x)),
    { id: 'byte', type: 'comb', at: [5.7, -2.0], size: [0.8, 0.45], text: 'Byte' },
    { id: 'dsm', type: 'mux2', at: [6.2, -1.6] },
    { id: 'wa3m', type: 'mux2', at: [10.1, -2.2] },
    { id: 'sh', type: 'comb', at: [15.2, -0.5], size: [0.9, 0.6], text: 'Shift' },
    { id: 'nw_bub', type: 'bubble', at: [XG - 0.05, RY] }],
  labels: labels.map(spreadLabel),
  wires: [...wires.filter((x) => !HIDE.has(x.id)).map(spreadWire), ...ew],
  junctions: [...junctions.filter(([x, y]) => !(x === CX && y === gy('regw', 'b'))).map(fp),
    [5.1, -1.2], [5.9, -5.2], [15.8, 3.0], [XC, RY - 0.2]],
  control: [...control.map((c) => ({ ...c, points: c.points.map(fp) })).filter((c) => c.signal !== 'ResultSrc' && c.signal !== 'ALUControl'),
    { signal: 'ResultSrc', points: [[20.6, 1.95], [20.6, 1.6]], place: 'above' },
    { signal: 'ALUControl', points: [[fx(14.1), -1.5], [fx(14.1), -0.6]], anchor: 'north west' },
    { signal: 'ByteSel', points: [[6.5, -0.6], [6.5, -1.0]], place: 'above' },
    { signal: 'Link', points: [[10.4, -3.2], [10.4, -2.8]], anchor: 'east' },
    { signal: 'ShiftCtl', points: [[15.2, 0.35], [15.2, -0.2]], place: 'above' }],
  figures: {}, alt: ALT_EXT, fsm: fsmFor(true),
};

for (const [name, g] of [['multi.json', geom], ['multi-extended.json', geomExt]]) {
  writeFileSync(out(name), `${JSON.stringify(g, null, 1)}\n`);
  console.log(`content/armv7/geometry/${name}: ${g.elements.length} elements, ${g.wires.length} wires, ${g.control.length} stubs, ${g.fsm.states.length} states, ${g.fsm.arcs.length} arcs`);
}
