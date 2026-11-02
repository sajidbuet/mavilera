// make-single-geometry.mjs -- writes the drawings of the ARM single-cycle processor (roadmap ARM-A2; spec W-D32 Q8,
// W-D35): content/armv7/geometry/single.json, the base design (Harris and Harris's block topology of Fig 7.13 and
// Fig 7.14, pp. 399-401, in MAVILERA's own layout and symbols), and content/armv7/geometry/single-extended.json, the
// Extended datapath variant: the same drawing with parts added and a few connections replaced (W-D35: an overlay of the
// base drawing), for the model of src/arch/armv7/uarch/single-ext.js. The geometry schema is the one of
// content/geometry/ch06.json (docs/ui/datapath-schematics.md); the coordinates are this application's, in cm with y up,
// traced from no figure. Wire signals are names of the ARM signal dictionaries (src/arch/armv7/uarch/signals.js), which
// give the bus-width markers. The author approves each drawing before it is wired up.
//
//   node tools/armv7/make-single-geometry.mjs
//
// Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = (name) => fileURLToPath(new URL(`../../content/armv7/geometry/${name}`, import.meta.url));
const r4 = (v) => +v.toFixed(4);

// --- shapes -----------------------------------------------------------------------------------------------------
/** A D-shaped AND gate `h` high and 0.5 wide: a straight back, then a half circle. */
const gate = (h) => {
  const rad = h / 2;
  const arc = Array.from({ length: 9 }, (_, k) => {
    const t = -Math.PI / 2 + (k * Math.PI) / 8;
    return [r4(0.5 - rad + rad * Math.cos(t)), r4(rad * Math.sin(t))];
  });
  return [[0, -rad], ...arc, [0, rad]];
};
const muxLabels = (ys) => ys.map((y, i) => ({ text: String(i), at: [0.02, y], anchor: 'west' }));
const pics = {
  mux2: {
    outline: [[0, -0.75], [0.6, -0.45], [0.6, 0.45], [0, 0.75]],
    anchors: { in0: [0, 0.4], in1: [0, -0.4], out: [0.6, 0], sel: [0.3, -0.6] },
    labels: muxLabels([0.4, -0.4]),
  },
  alu: {
    outline: [[0, -1.1], [1, -0.5], [1, 0.5], [0, 1.1], [0, 0.28], [0.22, 0], [0, -0.28]],
    anchors: { a: [0, 0.7], b: [0, -0.7], out: [1, 0], ctrl: [0.5, -0.8], flags: [0.5, 0.8] },
    labels: [{ text: 'ALU', at: [0.6, 0], anchor: 'center' }],
  },
  // a two-input AND gate: the gating of a write by CondEx (roadmap §7)
  and2: { outline: gate(0.5), anchors: { a: [0, 0.12], b: [0, -0.12], out: [0.5, 0] }, labels: [] },
};
const picsExt = {
  ...pics,
  mux4: {
    outline: [[0, -1.1], [0.6, -0.7], [0.6, 0.7], [0, 1.1]],
    anchors: { in0: [0, 0.75], in1: [0, 0.25], in2: [0, -0.25], in3: [0, -0.75], out: [0.6, 0], sel: [0.3, 0.9] },
    labels: muxLabels([0.75, 0.25, -0.25, -0.75]),
  },
  // RegWrite = RegW AND CondEx AND NOT NoWrite (Example 7.2): three inputs, the middle one inverted
  and3: { outline: gate(0.6), anchors: { a: [0, 0.2], c: [0, 0], b: [0, -0.2], out: [0.5, 0] }, labels: [] },
  bubble: { outline: Array.from({ length: 12 }, (_, k) => [r4(0.05 * Math.cos((k * Math.PI) / 6)), r4(0.05 * Math.sin((k * Math.PI) / 6))]), anchors: {}, labels: [] },
};

// --- the base drawing -------------------------------------------------------------------------------------------
const GX = 14.8; // the AND gates' left edge
const CX = 14.5; // the CondEx trunk
const GATES = { pcsrc: 6.3, regw: 5.45, memw: 4.45, flagw: 3.7 }; // their centres (y)
const gy = (k, port) => GATES[k] + (port === 'a' ? 0.12 : -0.12);

const elements = [
  { id: 'pcm', type: 'mux2', at: [0.2, 0] },
  { id: 'pc', type: 'reg', at: [1.5, 0], size: [0.8, 1.3], text: 'PC' },
  { id: 'add4', type: 'comb', at: [2.9, 2.85], size: [0.8, 0.6], text: '+4' },
  { id: 'imem', type: 'mem', at: [3.45, 0], size: [1.4, 2.0], text: '' },
  { id: 'add8', type: 'comb', at: [7.0, 2.85], size: [0.8, 0.6], text: '+4' },
  { id: 'ra1m', type: 'mux2', at: [5.5, 1.3] },
  { id: 'ra2m', type: 'mux2', at: [5.5, -0.4] },
  { id: 'rf', type: 'block', at: [7.4, -0.95], size: [1.8, 5.5], text: '' },
  { id: 'ext', type: 'comb', at: [7.4, -4.6], size: [1.4, 0.6], text: 'Extend' },
  { id: 'bm', type: 'mux2', at: [10.8, -0.7] },
  { id: 'alu', type: 'alu', at: [11.6, 0] },
  { id: 'dm', type: 'mem', at: [14.0, -0.3], size: [1.5, 2.0], text: '' },
  { id: 'rm', type: 'mux2', at: [16.2, 0.1] },
  { id: 'dec', type: 'block', at: [6.0, 5.125], size: [3.2, 2.85], text: 'Decoder' },
  { id: 'flags', type: 'reg', at: [12.45, 2.8], size: [0.9, 0.7], text: 'Flags' },
  { id: 'cc', type: 'comb', at: [13.85, 2.8], size: [0.9, 0.7], text: 'Condition\ncheck' },
  ...Object.entries(GATES).map(([k, y]) => ({ id: `g_${k}`, type: 'and2', at: [GX, y] })),
];

const wires = [];
const w = (list, id, signal, points, { arrow = true, style = 'bus', labels = [] } = {}) => list.push({ id, style, arrow, points, signal, labels });
const b = (...a) => w(wires, ...a);
const lab = (text, at, place) => ({ text, at, place });

// PC, the adders and the next-PC multiplexer
b('pcm_pc', 'PCNext', [[0.8, 0], [1.1, 0]]);
b('pc_a', 'PC', [[1.9, 0], [2.25, 0]], { arrow: false });
b('pc_imem', 'PC', [[2.25, 0], [2.75, 0]]);
b('pc_add4', 'PC', [[2.25, 0], [2.25, 2.85], [2.5, 2.85]]);
b('pc4_a', 'PCPlus4', [[3.3, 2.85], [3.7, 2.85]], { arrow: false });
b('pc4_add8', 'PCPlus4', [[3.7, 2.85], [6.6, 2.85]]);
b('pc4_pcm', 'PCPlus4', [[3.7, 2.85], [3.7, 3.55], [-0.15, 3.55], [-0.15, 0.4], [0.2, 0.4]], { labels: [lab('PCPlus4', [1.8, 3.55], 'above')] });
b('pc8_rf', 'PCPlus8', [[7.4, 2.85], [7.6, 2.85], [7.6, 1.8]], { labels: [{ text: 'PCPlus8', at: [7.6, 2.85], anchor: 'south west' }] });
// the instruction and its fields
b('imem_bus', 'Instr', [[4.15, 0], [4.6, 0]], { arrow: false });
b('bus_up1', 'Instr', [[4.6, 0], [4.6, 1.7]], { arrow: false });
b('bus_up2', 'Instr', [[4.6, 1.7], [4.6, 3.3]], { arrow: false });
b('bus_dn1', 'Instr', [[4.6, 0], [4.6, -2.6]], { arrow: false });
b('bus_dn2', 'Instr', [[4.6, -2.6], [4.6, -4.6]], { arrow: false });
b('ins_ctl', 'Op,Funct,Rd', [[4.6, 3.3], [4.6, 3.7]]);
b('ins_cond', 'Cond', [[4.6, 3.3], [13.85, 3.3], [13.85, 3.15]], { labels: [lab('Cond 31:28', [9.6, 3.3], 'above')] });
b('ins_rn', 'Rn', [[4.6, 1.7], [5.5, 1.7]], { labels: [lab('19:16', [5.05, 1.7], 'above')] });
b('c15_ra1m', 'const15', [[5.2, 0.9], [5.5, 0.9]], { labels: [lab('15', [5.2, 0.9], 'left')] });
b('ins_rm', 'Rm', [[4.6, 0], [5.5, 0]], { labels: [lab('3:0', [5.0, 0], 'above')] });
b('ins_rd_a', 'Rd', [[4.6, -2.6], [5.1, -2.6]], { arrow: false });
b('ins_rd', 'Rd', [[5.1, -2.6], [6.5, -2.6]], { labels: [lab('15:12', [5.6, -2.6], 'below')] });
b('rd_ra2m', 'Rd', [[5.1, -2.6], [5.1, -0.8], [5.5, -0.8]]);
b('ins_imm', 'Imm24', [[4.6, -4.6], [6.7, -4.6]], { labels: [lab('23:0', [5.6, -4.6], 'above')] });
// register file, Extend, ALU, data memory, result
b('ra1m_rf', 'RA1', [[6.1, 1.3], [6.5, 1.3]]);
b('ra2m_rf', 'RA2', [[6.1, -0.4], [6.5, -0.4]]);
b('rd1_alu', 'SrcA', [[8.3, 0.7], [11.6, 0.7]], { labels: [lab('SrcA', [10.6, 0.7], 'above')] });
b('rd2_a', 'WriteData', [[8.3, -0.3], [8.5, -0.3]], { arrow: false });
b('rd2_bm', 'WriteData', [[8.5, -0.3], [10.8, -0.3]]);
b('rd2_dm', 'WriteData', [[8.5, -0.3], [8.5, -3.2], [13.0, -3.2], [13.0, -0.9], [13.25, -0.9]], { labels: [lab('WriteData', [11.2, -3.2], 'below')] });
b('ext_bm', 'ExtImm', [[8.1, -4.6], [10.45, -4.6], [10.45, -1.1], [10.8, -1.1]]);
b('bm_alu', 'SrcB', [[11.4, -0.7], [11.6, -0.7]]);
b('alu_a', 'ALUResult', [[12.6, 0], [12.9, 0]], { arrow: false });
b('alu_dm', 'ALUResult', [[12.9, 0], [13.25, 0]]);
b('alu_rm', 'ALUResult', [[12.9, 0], [12.9, 1.6], [16.0, 1.6], [16.0, 0.5], [16.2, 0.5]], { labels: [lab('ALUResult', [14.45, 1.6], 'above')] });
b('dm_rm', 'ReadData', [[14.75, -0.3], [16.2, -0.3]]);
b('res_a', 'Result', [[16.8, 0.1], [17.4, 0.1], [17.4, -6.0], [6.2, -6.0]], { arrow: false, labels: [lab('Result', [11.5, -6.0], 'above')] });
b('res_rf', 'Result', [[6.2, -6.0], [6.2, -3.4], [6.5, -3.4]]);
b('res_pcm', 'Result', [[6.2, -6.0], [-0.15, -6.0], [-0.15, -0.4], [0.2, -0.4]]);
// the conditional logic: flags, Condition Check, and the AND gates of CondEx
b('alu_flags', 'ALUFlags', [[12.1, 0.8], [12.1, 2.45]], { labels: [lab('ALUFlags', [12.1, 1.6], 'left')] });
b('flags_cc', 'Flags', [[12.9, 2.8], [13.4, 2.8]]);
b('condex', 'CondEx', [[14.3, 2.8], [CX, 2.8], [CX, gy('pcsrc', 'b')], [GX, gy('pcsrc', 'b')]], { style: 'ctrl', labels: [{ text: 'CondEx', at: [CX, 2.95], anchor: 'west' }] });
for (const k of ['regw', 'memw', 'flagw']) b(`condex_${k}`, 'CondEx', [[CX, gy(k, 'b')], [GX, gy(k, 'b')]], { style: 'ctrl' });
for (const [k, s] of [['pcsrc', 'PCS'], ['regw', 'RegW'], ['memw', 'MemW'], ['flagw', 'FlagW']]) {
  b(`dec_${k}`, s, [[7.6, gy(k, 'a')], [GX, gy(k, 'a')]], { style: 'ctrl', labels: [{ text: s, at: [7.65, gy(k, 'a')], anchor: 'south west' }] });
}

const junctions = [[2.25, 0], [3.7, 2.85], [4.6, 0], [4.6, 1.7], [4.6, 3.3], [4.6, -2.6], [5.1, -2.6], [8.5, -0.3], [12.9, 0], [6.2, -6.0],
  ...['regw', 'memw', 'flagw'].map((k) => [CX, gy(k, 'b')])];

// control stubs, named at the destination (the controller is their origin)
const gateOut = (k, s) => ({ signal: s, points: [[GX + 0.5, GATES[k]], [GX + 0.9, GATES[k]]], label_at: 'end', place: 'right' });
const control = [
  { signal: 'PCSrc', points: [[0.5, -1.0], [0.5, -0.6]], place: 'below' },
  { signal: 'RegSrc', text: 'RegSrc0', points: [[5.8, 2.25], [5.8, 1.9]], place: 'above' },
  { signal: 'RegSrc', text: 'RegSrc1', points: [[5.8, -1.4], [5.8, -1.0]], place: 'below' },
  { signal: 'RegWrite', points: [[8.1, 2.2], [8.1, 1.8]], place: 'right' },
  { signal: 'ImmSrc', points: [[7.4, -5.25], [7.4, -4.9]], place: 'below' },
  { signal: 'ALUSrc', points: [[11.1, -1.75], [11.1, -1.3]], place: 'below' },
  { signal: 'ALUControl', points: [[12.1, -2.2], [12.1, -0.8]], place: 'below' },
  { signal: 'MemWrite', points: [[14.0, 1.1], [14.0, 0.7]], place: 'above' },
  { signal: 'MemtoReg', points: [[16.5, -0.85], [16.5, -0.5]], place: 'below' },
  { signal: 'FlagWrite', points: [[11.5, 2.58], [12.0, 2.58]], place: 'left' },
  gateOut('pcsrc', 'PCSrc'), gateOut('regw', 'RegWrite'), gateOut('memw', 'MemWrite'), gateOut('flagw', 'FlagWrite'),
];

const sig = (text, at, anchor) => ({ type: 'label', style: 'sig', at, anchor, text });
const fig = (text, at, anchor) => ({ type: 'label', style: 'figlabel', at, anchor, text });
const labels = [
  fig('Conditional logic', [GX + 0.25, 6.58], 'south'),
  fig('Instruction\nmemory', [3.45, -1.05], 'north'),
  fig('Register\nfile', [7.4, -1.5], 'center'),
  fig('Data\nmemory', [14.0, -1.35], 'north'),
  sig('A', [2.75, 0], 'west'), sig('RD', [4.15, 0], 'east'),
  sig('A1', [6.5, 1.3], 'west'), sig('A2', [6.5, -0.4], 'west'), sig('A3', [6.5, -2.6], 'west'), sig('WD3', [6.5, -3.4], 'west'),
  sig('RD1', [8.3, 0.7], 'east'), sig('RD2', [8.3, -0.3], 'east'), sig('R15', [7.6, 1.8], 'north'),
  sig('A', [13.25, 0], 'west'), sig('WD', [13.25, -0.9], 'west'), sig('RD', [14.75, -0.3], 'east'),
];

const COPY = 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: content (Apache-2.0).';
const TOPOLOGY = 'Harris and Harris, Digital Design and Computer Architecture: ARM Edition (2015), Fig 7.13 (p. 399) and Fig 7.14 (pp. 400-401): the blocks and their connections only';
const ALT = 'Single-cycle ARM datapath. From left to right: the next-PC multiplexer, the PC register with a PC + 4 adder above it, '
  + 'the instruction memory, the instruction bus from which the fields Rn, Rm, Rd and Instr23:0 branch to two register-address '
  + 'multiplexers, the register file and the Extend unit, a second + 4 adder whose output PCPlus8 enters the register file as R15, '
  + 'the ALU with its source multiplexer, the data memory and the result multiplexer, whose output returns along the bottom to the '
  + 'register file\'s write-data port and to the next-PC multiplexer. Across the top, the controller: the Decoder, which reads Op, '
  + 'Funct and Rd; the Flags register, written from ALUFlags; the Condition Check, which compares Cond with the flags and gives CondEx; '
  + 'and four AND gates that let PCS, RegW, MemW and FlagW through only when CondEx is 1. Control signals are dashed stubs.';

const base = {
  _copyright: COPY,
  _source: {
    topology: TOPOLOGY,
    layout: "MAVILERA's own (spec W-D32 Q8); not traced from the figure",
    generated_by: 'tools/armv7/make-single-geometry.mjs',
    status: 'approved by the author on 2026-10-31 (W-D35); the re-spaced layout approved on 2026-11-01 (A2-Q10)',
  },
  profile: 'arm-single', units: 'cm', y_up: true, pics, elements, labels, wires, junctions, control, figures: {}, alt: ALT,
};

// --- the Extended datapath: the base drawing with parts added and connections replaced ----------------------------
const HIDE = new Set(['res_pcm', 'ins_rd', 'rd2_bm', 'alu_rm', 'dm_rm', 'dec_regw', 'condex_regw', 'ins_ctl']);
const REPLACE_EL = { rm: { id: 'rm', type: 'mux4', at: [16.2, 0.1] }, g_regw: { id: 'g_regw', type: 'and3', at: [GX, GATES.regw] } };
const ew = [];
const e = (...a) => w(ew, ...a);
const RY = GATES.regw;
// the target multiplexer: a branch writes the PC from ALUResult, so that BL can write PCPlus4 to LR through Result
e('res_tgm', 'Result', [[6.2, -6.0], [-2.1, -6.0], [-2.1, -1.0], [-0.9, -1.0]]);
e('alur_tgm', 'ALUResult', [[-1.1, -2.6], [-1.1, -1.8], [-0.9, -1.8]], { labels: [lab('ALUResult', [-1.1, -2.6], 'below')] });
e('tgm_pcm', 'PCTarget', [[-0.3, -1.4], [-0.05, -1.4], [-0.05, -0.4], [0.2, -0.4]]);
// the A3 multiplexer: BL writes R14
e('rd_wa3m', 'Rd', [[5.1, -2.2], [5.5, -2.2]]);
e('c14_wa3m', 'const14', [[5.2, -3.0], [5.5, -3.0]], { labels: [lab('14', [5.2, -3.0], 'left')] });
e('wa3m_rf', 'WA3', [[6.1, -2.6], [6.5, -2.6]]);
// the shifter (Example 7.3) and the flags the ALU and the shifter read
e('rd2_sh', 'WriteData', [[8.5, -0.3], [8.8, -0.3]]);
e('sh_bm', 'ShiftResult', [[9.8, -0.3], [10.8, -0.3]]);
e('shc_alu', 'ShiftC', [[9.65, 0.15], [9.65, 1.2], [11.85, 1.2], [11.85, 0.95]], { style: 'wire', labels: [lab('ShiftC', [10.0, 1.2], 'above')] });
e('flags_dn', 'Flags', [[13.15, 2.8], [13.15, 1.9], [9.4, 1.9], [9.4, 0.15]], { labels: [lab('Flags', [10.5, 1.9], 'above')] });
e('flags_alu', 'Flags', [[12.35, 1.9], [12.35, 0.65]]);
// the result multiplexer with LDRB's byte and BL's link value
e('alu_up', 'ALUResult', [[12.9, 0], [12.9, 1.6], [15.65, 1.6]], { arrow: false, labels: [lab('ALUResult', [14.3, 1.6], 'above')] });
e('alu_rm4', 'ALUResult', [[15.65, 1.6], [16.0, 1.6], [16.0, 0.85], [16.2, 0.85]]);
e('alu_byte', 'ALUResult1:0', [[15.65, 1.6], [15.65, 0.1]], { labels: [lab('1:0', [15.65, 0.75], 'left')] });
e('dm_a', 'ReadData', [[14.75, -0.3], [15.0, -0.3]], { arrow: false });
e('dm_rm4', 'ReadData', [[15.0, -0.3], [15.0, 0.35], [16.2, 0.35]]);
e('dm_byte', 'ReadData', [[15.0, -0.15], [15.35, -0.15]]);
e('byte_rm4', 'ReadByte', [[15.95, -0.15], [16.2, -0.15]]);
e('pc4_rm4', 'PCPlus4', [[16.05, -1.3], [16.05, -0.65], [16.2, -0.65]], { labels: [lab('PCPlus4', [16.05, -1.3], 'below')] });
// the decoder reads Instr11:5 for the shifter; NoWrite gates RegWrite (Example 7.2)
e('ins_ctl_x', 'Op,Funct,Rd,Instr11:5', [[4.6, 3.3], [4.6, 3.7]]);
e('dec_regw3', 'RegW', [[7.6, RY + 0.2], [GX, RY + 0.2]], { style: 'ctrl', labels: [{ text: 'RegW', at: [7.65, RY + 0.2], anchor: 'south west' }] });
e('dec_nowrite', 'NoWrite', [[7.6, RY], [GX - 0.1, RY]], { style: 'ctrl', labels: [{ text: 'NoWrite', at: [7.65, RY], anchor: 'north west' }] });
e('condex_regw3', 'CondEx', [[CX, RY - 0.2], [GX, RY - 0.2]], { style: 'ctrl' });

const ext = {
  ...base,
  _source: {
    topology: `${TOPOLOGY}; NoWrite after Example 7.2 and the shifter after Example 7.3 (p. 402)`,
    design: "the Extended datapath variant: MAVILERA's own design (W-D32 C5 ruling), semantics from ARM DDI 0406C.d; see src/arch/armv7/uarch/single-ext.js",
    layout: 'the base drawing with parts added and connections replaced (W-D35)',
    generated_by: 'tools/armv7/make-single-geometry.mjs',
    status: 'approved by the author on 2026-11-01 (A2-Q11)',
  },
  pics: picsExt,
  elements: [...elements.map((x) => REPLACE_EL[x.id] ?? x),
    { id: 'tgm', type: 'mux2', at: [-0.9, -1.4] },
    { id: 'wa3m', type: 'mux2', at: [5.5, -2.6] },
    { id: 'sh', type: 'comb', at: [9.3, -0.3], size: [1.0, 0.9], text: 'Shift' },
    { id: 'byte', type: 'comb', at: [15.65, -0.15], size: [0.6, 0.5], text: 'Byte' },
    { id: 'nw_bub', type: 'bubble', at: [GX - 0.05, RY] }],
  wires: [...wires.filter((x) => !HIDE.has(x.id)), ...ew],
  junctions: [...junctions.filter(([x, y]) => !(x === 5.1 && y === -2.6) && !(x === CX && y === gy('regw', 'b'))),
    [5.1, -2.2], [13.15, 2.8], [12.35, 1.9], [15.0, -0.15], [15.65, 1.6], [CX, RY - 0.2]],
  control: [...control.filter((c) => c.signal !== 'MemtoReg'),
    { signal: 'ResultSrc', points: [[16.5, 1.9], [16.5, 1.0]], place: 'above' },
    { signal: 'Branch', points: [[-0.6, -2.35], [-0.6, -2.0]], anchor: 'west' },
    { signal: 'Link', points: [[5.8, -3.55], [5.8, -3.2]], anchor: 'east' },
    { signal: 'ShiftCtl', points: [[9.3, -1.15], [9.3, -0.75]], place: 'below' }],
  alt: `${ALT} The Extended datapath adds: a shifter (Shift) between RD2 and the SrcB multiplexer, driven by ShiftCtl and the C flag, `
    + 'whose carry ShiftC and the flags go to the ALU, which takes a four-bit ALUControl; NoWrite from the Decoder, inverted into the '
    + 'RegWrite gate; an A3 multiplexer choosing Rd or 14 (Link); a four-input result multiplexer choosing ALUResult, ReadData, '
    + 'the byte ReadByte (from the Byte unit, by ALUResult1:0) or PCPlus4 (ResultSrc); and a target multiplexer before the next-PC '
    + 'multiplexer, giving ALUResult to the PC for a branch (Branch) and Result otherwise.',
};

for (const [name, g] of [['single.json', base], ['single-extended.json', ext]]) {
  writeFileSync(out(name), `${JSON.stringify(g, null, 1)}\n`);
  console.log(`content/armv7/geometry/${name}: ${g.elements.length} elements, ${g.wires.length} wires, ${g.control.length} stubs`);
}
