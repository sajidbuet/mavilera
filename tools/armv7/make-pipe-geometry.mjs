// make-pipe-geometry.mjs -- writes the draft drawing of the ARM pipelined processor (roadmap ARM-A4; spec W-D32 Q8):
// content/armv7/geometry/pipe.json, the base design with full hazard handling (Harris and Harris's block topology of
// Figs 7.45-7.58, pp. 429-441, in MAVILERA's own layout and symbols). The geometry schema is the one of
// content/geometry/ch08.json (docs/ui/datapath-schematics.md); the coordinates are this application's, in cm with y up,
// traced from no figure. Wire signals are names of the ARM signal dictionary (src/arch/armv7/uarch/signals.js,
// PIPE_SIGNALS), which gives the bus-width markers. The author approves the drawing before it is wired up.
//
// Layout: the five stages left to right, separated by the pipeline registers (the Fetch/Decode register holds InstrD
// only, Fig 7.58, so PCPlus4F passes it as PCPlus8D, Fig 7.46; the others are drawn as a control part above and a data
// part below, with a gap between them); the control pipeline across the top, from the Control Unit in Decode; the Cond
// Unit, FlagsE and the CondExE gates in Execute (Fig 7.47); the forwarding multiplexers before the ALU (Fig 7.51); the
// Writeback, forwarding and branch-target returns along the bottom; the Hazard Unit below them. As in the approved
// single-cycle drawing, control signals are dashed stubs named at their destination: the Hazard Unit's inputs and
// outputs, the Decode-stage selects and the Execute-stage controls that end in Execute. The match signals enter the
// Hazard Unit as one stub, Match (Fig 7.51 abbreviates them so; the RA1E and RA2E pipeline registers are not drawn,
// as in the figure).
//
//   node tools/armv7/make-pipe-geometry.mjs
//
// Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = (name) => fileURLToPath(new URL(`../../content/armv7/geometry/${name}`, import.meta.url));
const r4 = (v) => +v.toFixed(4);

// --- shapes -----------------------------------------------------------------------------------------------------
/** A D-shaped AND gate `h` high and 0.5 wide: a straight back, then a half circle (as the single-cycle drawing). */
const gate = (h) => {
  const rad = h / 2;
  const arc = Array.from({ length: 9 }, (_, k) => {
    const t = -Math.PI / 2 + (k * Math.PI) / 8;
    return [r4(0.5 - rad + rad * Math.cos(t)), r4(rad * Math.sin(t))];
  });
  return [[0, -rad], ...arc, [0, rad]];
};
const muxLabels = (ys, names = ys.map((_, i) => String(i))) => ys.map((y, i) => ({ text: names[i], at: [0.02, y], anchor: 'west' }));
const pics = {
  mux2: {
    outline: [[0, -0.75], [0.6, -0.45], [0.6, 0.45], [0, 0.75]],
    anchors: { in0: [0, 0.4], in1: [0, -0.4], out: [0.6, 0], sel: [0.3, -0.6] },
    labels: muxLabels([0.4, -0.4]),
  },
  // the forwarding multiplexers (Fig 7.51): inputs 00 (register file), 01 (ResultW), 10 (ALUOutM)
  mux3: {
    outline: [[0, -1.0], [0.6, -0.65], [0.6, 0.65], [0, 1.0]],
    anchors: { in0: [0, 0.6], in1: [0, 0], in2: [0, -0.6], out: [0.6, 0], selTop: [0.3, 0.825], selBottom: [0.3, -0.825] },
    labels: muxLabels([0.6, 0, -0.6], ['00', '01', '10']),
  },
  alu: {
    outline: [[0, -1.1], [1, -0.5], [1, 0.5], [0, 1.1], [0, 0.28], [0.22, 0], [0, -0.28]],
    anchors: { a: [0, 0.7], b: [0, -0.7], out: [1, 0], ctrl: [0.5, -0.8], flags: [0.5, 0.8] },
    labels: [{ text: 'ALU', at: [0.6, 0], anchor: 'center' }],
  },
  // the CondExE gates (Fig 7.47; roadmap §7): two inputs 0.2 apart
  and2: { outline: gate(0.4), anchors: { a: [0, 0.1], b: [0, -0.1], out: [0.5, 0] }, labels: [] },
};

// --- where things are ----------------------------------------------------------------------------------------------
const TOP = 8.0; // the top of the control pipeline registers
const BOT = -5.1; // the bottom of the data pipeline registers
const DATA_TOP = 2.0; // the top of the data part of the D/E, E/M and M/W registers
const REG_W = 0.35;
const X = { fd: 3.6, de: 11.0, em: 18.4, mw: 22.8 }; // the pipeline registers' centres
const xOf = (k) => X[k.replace(/_c$/, '')]; // a control part sits above its data part
const L = (k) => r4(xOf(k) - REG_W / 2); // left edge
const R = (k) => r4(xOf(k) + REG_W / 2); // right edge
// the control rows, top to bottom (Fig 7.47's signals in its order, with Branch and FlagWrite moved down to the Cond Unit)
const ROW = { PCSrc: 7.6, RegWrite: 7.15, MemtoReg: 6.7, MemWrite: 6.25, ALUControl: 5.8, ALUSrc: 5.35, Branch: 4.9, FlagWrite: 4.45, Cond: 4.0 };
const CTL_BOTTOM = { de: 3.75, em: 5.95, mw: 6.45 }; // the bottom of each control part
const GX = 17.725; // the CondExE gates before the E/M register: their outputs touch it
const CX = 16.9; // the CondExE trunk
const BGX = 17.2; // the BranchTakenE gate
const gateY = (row) => r4(ROW[row] - 0.1);
// the returns along the bottom
const Y_AOM = -5.6; // ALUOutM to the forwarding multiplexers
const Y_WA3 = -6.3; // WA3W to the register file
const Y_RES = -6.9; // ResultW to the register file, the forwarding multiplexers and the PC
const Y_TGT = -7.4; // ALUResultE, the branch target, to the PC
const HZ = { x0: 2.5, x1: 20.0, y0: -8.9, y1: -8.1 };

const reg = (id, x, y0, y1, text = '') => ({ id, type: 'reg', at: [x, r4((y0 + y1) / 2)], size: [REG_W, r4(y1 - y0)], text });
const elements = [
  // Fetch
  { id: 'pcm', type: 'mux2', at: [-2.6, 0.4] },
  { id: 'brm', type: 'mux2', at: [-1.6, 0] },
  { id: 'pc', type: 'reg', at: [-0.3, 0], size: [0.7, 1.3], text: 'PC' },
  { id: 'add4', type: 'comb', at: [0.95, 3.4], size: [0.8, 0.6], text: '+4' },
  { id: 'imem', type: 'mem', at: [1.9, 0], size: [1.4, 2.0], text: '' },
  reg('fd', X.fd, -0.9, 0.9),
  // Decode
  { id: 'cu', type: 'block', at: [6.3, 6.05], size: [1.8, 3.9], text: 'Control\nunit' },
  { id: 'ra1m', type: 'mux2', at: [5.4, 1.3] },
  { id: 'ra2m', type: 'mux2', at: [5.4, -0.4] },
  { id: 'rf', type: 'block', at: [7.3, -0.85], size: [1.8, 5.7], text: '' },
  { id: 'ext', type: 'comb', at: [7.3, -4.6], size: [1.4, 0.6], text: 'Extend' },
  reg('de_c', X.de, CTL_BOTTOM.de, TOP), reg('de', X.de, BOT, DATA_TOP),
  // Execute
  { id: 'fam', type: 'mux3', at: [12.0, 0.75] },
  { id: 'fbm', type: 'mux3', at: [12.0, -1.35] },
  { id: 'bm', type: 'mux2', at: [13.6, -0.65] },
  { id: 'alu', type: 'alu', at: [14.8, 0.05] },
  { id: 'flags', type: 'reg', at: [13.9, 2.9], size: [0.9, 0.7], text: 'Flags' },
  { id: 'cond', type: 'comb', at: [15.7, 2.9], size: [1.4, 0.9], text: 'Cond\nUnit' },
  { id: 'g_pcsrc', type: 'and2', at: [GX, gateY('PCSrc')] },
  { id: 'g_regw', type: 'and2', at: [GX, gateY('RegWrite')] },
  { id: 'g_memw', type: 'and2', at: [GX, gateY('MemWrite')] },
  { id: 'g_branch', type: 'and2', at: [BGX, gateY('Branch')] },
  reg('em_c', X.em, CTL_BOTTOM.em, TOP), reg('em', X.em, BOT, DATA_TOP),
  // Memory
  { id: 'dm', type: 'mem', at: [20.4, -0.25], size: [1.5, 2.0], text: '' },
  reg('mw_c', X.mw, CTL_BOTTOM.mw, TOP), reg('mw', X.mw, BOT, DATA_TOP),
  // Writeback
  { id: 'rm', type: 'mux2', at: [23.4, -0.45] },
  // the Hazard Unit
  { id: 'hz', type: 'block', at: [r4((HZ.x0 + HZ.x1) / 2), r4((HZ.y0 + HZ.y1) / 2)], size: [r4(HZ.x1 - HZ.x0), r4(HZ.y1 - HZ.y0)], text: 'Hazard Unit' },
];

const wires = [];
const b = (id, signal, points, { arrow = true, style = 'bus', labels = [] } = {}) => wires.push({ id, style, arrow, points, signal, labels });
const c = (id, signal, points, opts = {}) => b(id, signal, points, { style: 'ctrl', ...opts });
const lab = (text, at, place) => ({ text, at, place });
const anc = (text, at, anchor) => ({ text, at, anchor });

// --- Fetch: the two next-PC multiplexers (Fig 7.58), the PC, the adder, the instruction memory
b('pcm_brm', 'PCMuxF', [[-2.0, 0.4], [-1.6, 0.4]]);
b('brm_pc', 'PCNext', [[-1.0, 0], [-0.65, 0]]);
b('pc_a', 'PCF', [[0.05, 0], [0.35, 0]], { arrow: false });
b('pc_imem', 'PCF', [[0.35, 0], [1.2, 0]]);
b('pc_add4', 'PCF', [[0.35, 0], [0.35, 3.4], [0.55, 3.4]]);
b('add4_a', 'PCPlus4F', [[1.35, 3.4], [1.75, 3.4]], { arrow: false });
b('pc4_pcm', 'PCPlus4F', [[1.75, 3.4], [1.75, 3.8], [-3.0, 3.8], [-3.0, 0.8], [-2.6, 0.8]], { labels: [lab('PCPlus4F', [-0.6, 3.8], 'above')] });
b('pc4_b', 'PCPlus4F', [[1.75, 3.4], [X.fd, 3.4]], { arrow: false });
b('pc8_rf', 'PCPlus8D', [[X.fd, 3.4], [7.6, 3.4], [7.6, 2.0]], { labels: [lab('PCPlus8D', [6.2, 3.4], 'above')] });
b('imem_fd', 'InstrF', [[2.6, 0], [L('fd'), 0]]);
// --- Decode: the instruction's fields, the register file, Extend, the Control Unit
b('fd_bus', 'InstrD', [[R('fd'), 0], [4.4, 0]], { arrow: false });
b('bus_up1', 'InstrD', [[4.4, 0], [4.4, 1.7]], { arrow: false });
b('bus_up2', 'InstrD', [[4.4, 1.7], [4.4, ROW.Cond]], { arrow: false });
b('bus_dn1', 'InstrD', [[4.4, 0], [4.4, -2.6]], { arrow: false });
b('bus_dn2', 'InstrD', [[4.4, -2.6], [4.4, -4.6]], { arrow: false });
b('ins_cu', 'Op,Funct,Rd', [[4.4, ROW.Cond], [4.4, 5.0], [5.4, 5.0]]);
b('ins_cond', 'Cond', [[4.4, ROW.Cond], [L('de'), ROW.Cond]], { labels: [lab('Cond 31:28', [9.0, ROW.Cond], 'above')] });
b('ins_rn', 'Rn', [[4.4, 1.7], [5.4, 1.7]], { labels: [anc('19:16', [4.45, 1.7], 'south west')] });
b('c15_ra1m', 'const15', [[5.1, 0.9], [5.4, 0.9]], { labels: [lab('15', [5.1, 0.9], 'left')] });
b('ins_rm', 'Rm', [[4.4, 0], [5.4, 0]], { labels: [anc('3:0', [4.45, 0], 'north west')] });
b('ins_rd_a', 'Rd', [[4.4, -2.6], [4.8, -2.6]], { arrow: false });
b('rd_ra2m', 'Rd', [[4.8, -2.6], [4.8, -0.8], [5.4, -0.8]]);
b('wa3d', 'WA3D', [[4.8, -2.6], [4.8, -4.0], [L('de'), -4.0]], { labels: [lab('15:12', [5.3, -4.0], 'above')] });
b('ins_imm', 'Imm24', [[4.4, -4.6], [6.6, -4.6]], { labels: [lab('23:0', [5.3, -4.6], 'below')] });
b('ra1m_rf', 'RA1D', [[6.0, 1.3], [6.4, 1.3]]);
b('ra2m_rf', 'RA2D', [[6.0, -0.4], [6.4, -0.4]]);
b('rd1_de', 'RD1D', [[8.2, 1.35], [L('de'), 1.35]]);
b('rd2_de', 'RD2D', [[8.2, -0.75], [L('de'), -0.75]]);
b('ext_de', 'ExtImmD', [[8.0, -4.6], [L('de'), -4.6]]);
const CU_X = 7.2; // the Control Unit's right edge
const D_ROWS = [['PCSrc', 'PCSrcD'], ['RegWrite', 'RegWriteD'], ['MemtoReg', 'MemtoRegD'], ['MemWrite', 'MemWriteD'], ['ALUControl', 'ALUControlD'],
  ['ALUSrc', 'ALUSrcD'], ['Branch', 'BranchD'], ['FlagWrite', 'FlagWriteD']];
for (const [row, s] of D_ROWS) c(`cu_${row}`, s, [[CU_X, ROW[row]], [L('de_c'), ROW[row]]], { labels: [anc(s, [CU_X + 0.05, ROW[row]], 'south west')] });
// --- Execute: forwarding, the ALU, the Cond Unit and its gates
b('rd1e_fam', 'RD1E', [[R('de'), 1.35], [12.0, 1.35]]);
b('rd2e_fbm', 'RD2E', [[R('de'), -0.75], [12.0, -0.75]]);
b('fam_alu', 'SrcAE', [[12.6, 0.75], [14.8, 0.75]], { labels: [lab('SrcAE', [13.7, 0.75], 'above')] });
b('fbm_a', 'WriteDataE', [[12.6, -1.35], [12.9, -1.35]], { arrow: false });
b('wd_bm', 'WriteDataE', [[12.9, -1.35], [12.9, -0.25], [13.6, -0.25]]);
b('wd_em', 'WriteDataE', [[12.9, -1.35], [12.9, -3.0], [L('em'), -3.0]], { labels: [lab('WriteDataE', [15.1, -3.0], 'below')] });
b('ext_bm', 'ExtImmE', [[R('de'), -4.6], [13.3, -4.6], [13.3, -1.05], [13.6, -1.05]]);
b('bm_alu', 'SrcBE', [[14.2, -0.65], [14.8, -0.65]]);
b('alu_a', 'ALUResultE', [[15.8, 0.05], [16.3, 0.05]], { arrow: false });
b('alu_em', 'ALUResultE', [[16.3, 0.05], [L('em'), 0.05]]);
b('alu_brm', 'ALUResultE', [[16.3, 0.05], [16.3, Y_TGT], [-2.0, Y_TGT], [-2.0, -0.4], [-1.6, -0.4]], { labels: [lab('ALUResultE', [1.0, Y_TGT], 'above')] });
b('alu_flags', 'ALUFlags', [[15.3, 0.85], [15.3, 2.45]], { labels: [lab('ALUFlags', [15.3, 1.65], 'right')] });
b('flags_cond', 'FlagsE', [[14.35, 2.9], [15.0, 2.9]]);
b('cond_flags', 'FlagsNextE', [[15.15, 3.35], [15.15, 3.65], [13.2, 3.65], [13.2, 2.9], [13.45, 2.9]], { labels: [lab('Flags′', [14.2, 3.65], 'below')] });
b('de_cond', 'CondE', [[R('de_c'), ROW.Cond], [15.6, ROW.Cond], [15.6, 3.35]]);
c('de_flagw', 'FlagWriteE', [[R('de_c'), ROW.FlagWrite], [16.2, ROW.FlagWrite], [16.2, 3.35]], { labels: [anc('FlagWriteE', [R('de_c') + 0.05, ROW.FlagWrite], 'south west')] });
c('de_alucontrol', 'ALUControlE', [[R('de_c'), ROW.ALUControl], [11.9, ROW.ALUControl]], { labels: [anc('ALUControlE', [11.95, ROW.ALUControl], 'west')] });
c('de_alusrc', 'ALUSrcE', [[R('de_c'), ROW.ALUSrc], [11.9, ROW.ALUSrc]], { labels: [anc('ALUSrcE', [11.95, ROW.ALUSrc], 'west')] });
c('condex', 'CondExE', [[16.4, 2.9], [CX, 2.9], [CX, gateY('PCSrc') - 0.1], [GX, gateY('PCSrc') - 0.1]], { labels: [anc('CondExE', [CX + 0.05, 2.9], 'north west')] });
for (const row of ['RegWrite', 'MemWrite']) c(`condex_${row}`, 'CondExE', [[CX, gateY(row) - 0.1], [GX, gateY(row) - 0.1]]);
c('condex_branch', 'CondExE', [[CX, gateY('Branch') - 0.1], [BGX, gateY('Branch') - 0.1]]);
for (const [row, s] of [['PCSrc', 'PCSrcE'], ['RegWrite', 'RegWriteE'], ['MemWrite', 'MemWriteE']]) {
  c(`de_${row}`, s, [[R('de_c'), ROW[row]], [GX, ROW[row]]], { labels: [anc(s, [R('de_c') + 0.05, ROW[row]], 'south west')] });
}
c('de_branch', 'BranchE', [[R('de_c'), ROW.Branch], [BGX, ROW.Branch]], { labels: [anc('BranchE', [13.4, ROW.Branch], 'south west')] });
c('de_memtoreg', 'MemtoRegE', [[R('de_c'), ROW.MemtoReg], [L('em_c'), ROW.MemtoReg]], { labels: [anc('MemtoRegE', [R('de_c') + 0.05, ROW.MemtoReg], 'south west')] });
// --- Memory
b('aom_a', 'ALUOutM', [[R('em'), 0.05], [19.0, 0.05]], { arrow: false });
b('aom_dm', 'ALUOutM', [[19.0, 0.05], [19.65, 0.05]]);
b('aom_mw', 'ALUOutM', [[19.0, 0.05], [19.0, 1.4], [L('mw'), 1.4]], { labels: [lab('ALUOutM', [21.0, 1.4], 'above')] });
// the forwarding feeds: a riser, then one connection to each multiplexer input (so that each can be shown on its own)
b('aom_fwd', 'ALUOutM', [[19.0, 0.05], [19.0, Y_AOM], [11.55, Y_AOM], [11.55, -1.95]], { arrow: false, labels: [lab('ALUOutM', [15.1, Y_AOM], 'below')] });
b('aom_fbm', 'ALUOutM', [[11.55, -1.95], [12.0, -1.95]]);
b('aom_fam', 'ALUOutM', [[11.55, -1.95], [11.55, 0.15], [12.0, 0.15]]);
b('wdm_dm', 'WriteDataM', [[R('em'), -3.0], [19.3, -3.0], [19.3, -0.95], [19.65, -0.95]]);
b('dm_mw', 'ReadDataM', [[21.15, -0.85], [L('mw'), -0.85]]);
for (const [row, s] of [['PCSrc', 'PCSrcM'], ['RegWrite', 'RegWriteM'], ['MemtoReg', 'MemtoRegM']]) c(`em_${row}`, s, [[R('em_c'), ROW[row]], [L('mw_c'), ROW[row]]], { labels: [anc(s, [R('em_c') + 0.05, ROW[row]], 'south west')] });
c('em_memwrite', 'MemWriteM', [[R('em_c'), ROW.MemWrite], [19.3, ROW.MemWrite]], { labels: [anc('MemWriteM', [19.35, ROW.MemWrite], 'west')] });
// --- Writeback
b('aow_rm', 'ALUOutW', [[R('mw'), 1.4], [23.2, 1.4], [23.2, -0.05], [23.4, -0.05]]);
b('rdw_rm', 'ReadDataW', [[R('mw'), -0.85], [23.4, -0.85]]);
for (const [row, s] of [['PCSrc', 'PCSrcW'], ['RegWrite', 'RegWriteW'], ['MemtoReg', 'MemtoRegW']]) c(`mw_${row}`, s, [[R('mw_c'), ROW[row]], [23.7, ROW[row]]], { labels: [anc(s, [23.75, ROW[row]], 'west')] });
b('res_a', 'ResultW', [[24.0, -0.45], [25.5, -0.45], [25.5, Y_RES], [11.35, Y_RES]], { arrow: false, labels: [lab('ResultW', [20.0, Y_RES], 'below')] });
b('res_b', 'ResultW', [[11.35, Y_RES], [6.2, Y_RES]], { arrow: false });
b('res_pcm', 'ResultW', [[6.2, Y_RES], [-3.4, Y_RES], [-3.4, 0], [-2.6, 0]]);
b('res_rf', 'ResultW', [[6.2, Y_RES], [6.2, -3.4], [6.4, -3.4]]);
b('res_up', 'ResultW', [[11.35, Y_RES], [11.35, -1.35]], { arrow: false });
b('res_fbm', 'ResultW', [[11.35, -1.35], [12.0, -1.35]]);
b('res_fam', 'ResultW', [[11.35, -1.35], [11.35, 0.75], [12.0, 0.75]]);
b('wa3e', 'WA3E', [[R('de'), -4.0], [L('em'), -4.0]]);
b('wa3m', 'WA3M', [[R('em'), -4.0], [L('mw'), -4.0]]);
b('wa3w', 'WA3W', [[R('mw'), -4.0], [23.6, -4.0], [23.6, Y_WA3], [6.0, Y_WA3], [6.0, -2.6], [6.4, -2.6]], { labels: [lab('WA3W', [20.0, Y_WA3], 'below')] });

const junctions = [[0.35, 0], [1.75, 3.4], [4.4, 0], [4.4, 1.7], [4.4, ROW.Cond], [4.4, -2.6], [4.8, -2.6], [12.9, -1.35], [16.3, 0.05],
  [19.0, 0.05], [11.55, -1.95], [11.35, Y_RES], [6.2, Y_RES], [11.35, -1.35], [CX, gateY('RegWrite') - 0.1], [CX, gateY('MemWrite') - 0.1],
  [CX, gateY('Branch') - 0.1]];

// --- control stubs, named at the destination ------------------------------------------------------------------------
const st = (signal, points, place, more = {}) => ({ signal, points, place, ...more });
const hzIn = (signal, x) => st(signal, [[x, HZ.y1 + 0.45], [x, HZ.y1]], null, { anchor: 'east' });
const hzOut = (signal, x) => st(signal, [[x, HZ.y0], [x, HZ.y0 - 0.45]], 'below', { label_at: 'end' });
const control = [
  // Fetch and the Fetch/Decode register
  st('PCSrcW', [[-2.3, -0.7], [-2.3, -0.2]], null, { anchor: 'north east' }),
  st('BranchTakenE', [[-1.3, -1.4], [-1.3, -0.6]], null, { anchor: 'north west' }),
  st('StallF', [[-0.3, 1.15], [-0.3, 0.65]], 'above'),
  st('StallD', [[X.fd, 1.4], [X.fd, 0.9]], 'above'),
  st('FlushD', [[X.fd, -1.4], [X.fd, -0.9]], 'below'),
  // Decode
  st('RegSrcD', [[5.65, 2.35], [5.65, 1.93]], 'above', { text: 'RegSrcD0' }),
  st('RegSrcD', [[5.65, -1.6], [5.65, -1.03]], 'below', { text: 'RegSrcD1' }),
  st('RegWriteW', [[6.75, 2.75], [6.75, 2.0]], 'above'),
  st('ImmSrcD', [[7.3, -5.25], [7.3, -4.9]], 'below'),
  st('FlushE', [[X.de, BOT - 0.45], [X.de, BOT]], null, { anchor: 'east' }),
  // Execute
  st('ForwardAE', [[12.35, 1.95], [12.35, 1.55]], 'above'),
  st('ForwardBE', [[12.35, -3.4], [12.35, -2.15]], 'below'),
  st('ALUSrcE', [[13.9, -1.85], [13.9, -1.25]], null, { anchor: 'west' }),
  st('ALUControlE', [[15.3, -2.5], [15.3, -0.75]], 'below'),
  st('BranchTakenE', [[BGX + 0.5, gateY('Branch')], [BGX + 0.85, gateY('Branch')]], 'right', { label_at: 'end' }),
  // Memory and Writeback
  st('MemWriteM', [[20.4, 1.15], [20.4, 0.75]], null, { anchor: 'west' }),
  st('MemtoRegW', [[23.7, -1.55], [23.7, -1.05]], null, { anchor: 'north west' }),
  // the Hazard Unit's inputs (Fig 7.58) and outputs
  { ...hzIn('Match_1E_M,Match_1E_W,Match_2E_M,Match_2E_W,Match_12D_E', 3.9), text: 'Match' }, hzIn('PCSrcD', 5.6), hzIn('MemtoRegE', 8.0), hzIn('PCSrcE', 9.6), hzIn('BranchTakenE', 12.0),
  hzIn('PCSrcM', 13.6), hzIn('RegWriteM', 15.6), hzIn('PCSrcW', 17.2), hzIn('RegWriteW', 19.2),
  hzOut('StallF', 4.0), hzOut('StallD', 6.5), hzOut('FlushD', 9.0), hzOut('FlushE', 11.5), hzOut('ForwardAE', 14.0), hzOut('ForwardBE', 16.8),
];

const sig = (text, at, anchor) => ({ type: 'label', style: 'sig', at, anchor, text });
const fig = (text, at, anchor) => ({ type: 'label', style: 'figlabel', at, anchor, text });
const title = (text, at) => ({ type: 'label', style: 'figtitle', at, text });
const labels = [
  title('IF', [0.0, 9.0]), title('ID', [7.3, 9.0]), title('EX', [14.7, 9.0]), title('MEM', [20.6, 9.0]), title('WB', [24.3, 9.0]),
  fig('IF/ID', [X.fd, 8.45]), fig('ID/EX', [X.de, 8.45]), fig('EX/MEM', [X.em, 8.45]), fig('MEM/WB', [X.mw, 8.45]),
  fig('Instruction\nmemory', [1.9, -1.05], 'north'),
  fig('Register\nfile', [7.3, -1.5], 'center'),
  fig('Data\nmemory', [20.4, -1.3], 'north'),
  sig('A', [1.2, 0], 'west'), sig('RD', [2.6, 0], 'east'),
  sig('A1', [6.4, 1.3], 'west'), sig('A2', [6.4, -0.4], 'west'), sig('A3', [6.4, -2.6], 'west'), sig('WD3', [6.4, -3.4], 'west'),
  sig('RD1', [8.2, 1.35], 'east'), sig('RD2', [8.2, -0.75], 'east'), sig('R15', [7.6, 2.0], 'north'), sig('WE3', [6.75, 2.0], 'north'),
  sig('A', [19.65, 0.05], 'west'), sig('WD', [19.65, -0.95], 'west'), sig('RD', [21.15, -0.85], 'east'), sig('WE', [20.4, 0.75], 'north'),
];

const COPY = 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: content (Apache-2.0).';
const TOPOLOGY = 'Harris and Harris, Digital Design and Computer Architecture: ARM Edition (2015), Figs 7.45-7.47 (pp. 429-430), 7.51 '
  + '(p. 434), 7.54 (p. 437), 7.57 (p. 439) and 7.58 (p. 441): the blocks and their connections only';
const ALT = 'Pipelined ARM processor with full hazard handling, in five stages separated by pipeline registers. Fetch (IF): two '
  + 'next-PC multiplexers, the first choosing PCPlus4F or ResultW by PCSrcW, the second that or the branch target ALUResultE by '
  + 'BranchTakenE; the PC register, enabled unless StallF; a + 4 adder; the instruction memory. The Fetch/Decode register holds '
  + 'the instruction only, enabled unless StallD and cleared by FlushD; PCPlus4F passes it and enters the register file as '
  + 'PCPlus8D, its R15 input. Decode (ID): the fields Rn, Rm, Rd and Instr23:0 branch to the register-address multiplexers, the '
  + 'register file and Extend; Op, Funct and Rd go to the Control Unit, whose signals run along the top through the pipeline '
  + 'registers; Rd goes on as WA3D, the register a result will be written to. Execute (EX): two forwarding multiplexers choose '
  + 'each operand from the register file (00), ResultW (01) or ALUOutM (10) by ForwardAE and ForwardBE; the ALU source multiplexer; '
  + 'the ALU; above it the Cond Unit with the flags register FlagsE, which computes CondExE from CondE and the flags and writes the '
  + 'new flags back; four AND gates let PCSrcE, RegWriteE, MemWriteE and BranchE through only when CondExE is 1; the last gives '
  + 'BranchTakenE. Memory (MEM): the data memory. Writeback (WB): the result multiplexer, by MemtoRegW. Along the bottom, ResultW '
  + 'returns to the register file, the forwarding multiplexers and the PC; WA3W to the register file; ALUOutM to the forwarding '
  + 'multiplexers; ALUResultE to the PC. Below them, the Hazard Unit takes the match signals, MemtoRegE, BranchTakenE, PCSrcD to '
  + 'PCSrcW, RegWriteM and RegWriteW, and gives StallF, StallD, FlushD, FlushE, ForwardAE and ForwardBE. Control signals are dashed.';

const geom = {
  _copyright: COPY,
  _source: {
    topology: TOPOLOGY,
    layout: "MAVILERA's own (spec W-D32 Q8); not traced from the figures",
    generated_by: 'tools/armv7/make-pipe-geometry.mjs',
    status: 'approved by the author on 2026-11-01 (A4-Q4)',
  },
  profile: 'arm-pipe', units: 'cm', y_up: true, pics, elements, labels, wires, junctions, control, figures: {}, alt: ALT,
};

writeFileSync(out('pipe.json'), `${JSON.stringify(geom, null, 1)}\n`);
console.log(`content/armv7/geometry/pipe.json: ${geom.elements.length} elements, ${geom.wires.length} wires, ${geom.control.length} stubs`);

// --- the Extended drawing (uarch/pipe-ext.js; A4-Q5 to A4-Q8) --------------------------------------------------------
// The base drawing spread (the base file unchanged, as A3-Q10): Execute and everything to its right 1.4 cm right for the
// shifter; Writeback 1.6 cm more for the Byte unit and the four-input result multiplexer; the control rows from
// ALUControl up 0.45 cm (ShiftCtl's row) and from PCSrc up 0.45 more (NoWrite's row); the pipeline registers taller, with
// PCPlus4 (A4-Q5) along their top. Then the replaced parts and the added ones, in the spread coordinates.
const CUT1 = 13.15;
const CUT2 = 23.05;
const tx = (x) => r4(x + (x >= CUT1 ? 1.4 : 0) + (x >= CUT2 ? 1.6 : 0));
const ty = (y) => r4(y + (y >= 7.4 ? 0.9 : y >= 5.6 ? 0.45 : 0));
const tp = ([x, y]) => [tx(x), ty(y)];
const TOP_X = 9.3; // the registers' new top; PCPlus4 runs at Y_P4
const Y_P4 = 9.1;
const XE = (x) => tx(x); // a base x in the spread drawing
const GXE = XE(GX); // the CondExE gates
const CXE = XE(CX);
const ROWX = { PCSrc: 8.5, NoWrite: 8.05, RegWrite: 7.6, ResultSrc: 7.15, MemWrite: 6.7, ALUControl: 6.25, ShiftCtl: 5.8 };

const moveEl = (e) => {
  if (e.size) {
    const [x0, y0] = tp([e.at[0] - e.size[0] / 2, e.at[1] - e.size[1] / 2]);
    const [x1, y1] = tp([e.at[0] + e.size[0] / 2, e.at[1] + e.size[1] / 2]);
    return { ...e, at: [r4((x0 + x1) / 2), r4((y0 + y1) / 2)], size: [r4(x1 - x0), r4(y1 - y0)] };
  }
  return { ...e, at: tp(e.at) };
};
const moveLabels = (ls) => ls.map((l) => ({ ...l, at: tp(l.at) }));

const DROP_EL = new Set(['rm', 'g_regw', 'de_c', 'em_c', 'mw_c']);
const DROP_W = new Set(['wa3d', 'wd_bm', 'pc4_b', 'pc8_rf', 'aow_rm', 'rdw_rm', 'res_a', 'condex_RegWrite', 'mw_PCSrc', 'mw_RegWrite', 'mw_MemtoReg']);
const RENAME = { cu_MemtoReg: 'ResultSrcD', de_memtoreg: 'ResultSrcE', em_MemtoReg: 'ResultSrcM' };
const ctlTop = (k) => reg(`${k}_c`, XE(X[k]), CTL_BOTTOM[k], TOP_X);

const elementsX = [
  ...elements.filter((e) => !DROP_EL.has(e.id)).map(moveEl),
  ctlTop('de'), ctlTop('em'), ctlTop('mw'),
  reg('fd_p', X.fd, Y_P4 - 0.2, Y_P4 + 0.2), // the IF/ID register's PCPlus4 field (the IF/ID register is drawn in two parts)
  { id: 'a3m', type: 'mux2', at: [5.2, -3.6] },
  { id: 'sh', type: 'comb', at: [13.75, -0.25], size: [0.9, 0.6], text: 'Shift' },
  { id: 'g_regw', type: 'and3', at: [GXE, ROWX.RegWrite] },
  { id: 'nw_bub', type: 'bubble', at: [r4(GXE - 0.05), r4(ROWX.RegWrite + 0.25)] },
  { id: 'byte', type: 'comb', at: [25.8, -0.85], size: [0.7, 0.5], text: 'Byte' },
  { id: 'rm', type: 'mux4f', at: [27.0, -0.1] },
];
const wiresX = [
  ...wires.filter((w) => !DROP_W.has(w.id)).map((w) => {
    const sig = RENAME[w.id];
    return { ...w, signal: sig ?? w.signal, points: w.points.map(tp), labels: w.labels.map((l) => ({ ...l, text: sig ?? l.text, at: tp(l.at) })) };
  }),
];
const ew = (id, signal, points, opts = {}) => { const before = wires.length; b(id, signal, points, opts); wiresX.push(wires.pop()); if (wires.length !== before) throw new Error(id); };
const ec = (id, signal, points, opts = {}) => ew(id, signal, points, { style: 'ctrl', ...opts });
// PCPlus4: registered into IF/ID (A4-Q5) and carried along the registers' top; PCPlus8D still bypasses the register
ew('pc4_b', 'PCPlus4F', [[1.75, 3.4], [2.3, 3.4]], { arrow: false });
ew('pc4_c', 'PCPlus4F', [[2.3, 3.4], [2.6, 3.4]], { arrow: false });
ew('pc8_rf', 'PCPlus8D', [[2.6, 3.4], [2.6, 3.8], [7.6, 3.8], [7.6, 2.0]], { labels: [lab('PCPlus8D', [6.2, 3.8], 'below')] });
ew('pc4_fd', 'PCPlus4F', [[2.3, 3.4], [2.3, Y_P4], [L('fd'), Y_P4]]);
ew('p4_d', 'PCPlus4D', [[R('fd'), Y_P4], [L('de'), Y_P4]], { labels: [lab('PCPlus4D', [9.0, Y_P4], 'above')] });
ew('p4_e', 'PCPlus4E', [[R('de'), Y_P4], [XE(L('em')), Y_P4]], { labels: [lab('PCPlus4E', [15.0, Y_P4], 'above')] });
ew('p4_m', 'PCPlus4M', [[XE(R('em')), Y_P4], [XE(L('mw')), Y_P4]], { labels: [lab('PCPlus4M', [22.0, Y_P4], 'above')] });
ew('p4_w', 'PCPlus4W', [[XE(R('mw')), Y_P4], [26.7, Y_P4], [26.7, 0.65], [27.0, 0.65]], { labels: [lab('PCPlus4W', [25.6, Y_P4], 'above')] });
// the A3 multiplexer: BL writes R14 (Link)
ew('rd_a3m', 'Rd', [[4.8, -2.6], [4.8, -3.2], [5.2, -3.2]]);
ew('c14_a3m', 'const14', [[4.9, -4.0], [5.2, -4.0]], { labels: [lab('14', [4.9, -4.0], 'left')] });
ew('wa3d', 'WA3D', [[5.8, -3.6], [5.9, -3.6], [5.9, -4.0], [L('de'), -4.0]]);
// the shifter (Example 7.3) between forwarding multiplexer B and the SrcB multiplexer; the flags into it and into the ALU
ew('wd_sh', 'WriteDataE', [[12.9, -1.35], [12.9, -0.25], [13.3, -0.25]]);
ew('sh_bm', 'ShiftResultE', [[14.2, -0.25], [XE(13.6), -0.25]]);
const FX = 15.0; // the FlagsE trunk below the flags register
ew('flags_dn', 'FlagsE', [[FX, ty(2.55)], [FX, 1.3]], { arrow: false });
ew('flags_sh', 'FlagsE', [[FX, 1.3], [13.6, 1.3], [13.6, 0.05]]);
ew('flags_alu', 'FlagsE', [[FX, 1.3], [16.55, 1.3], [16.55, 0.94]]);
ew('shc_alu', 'ShiftCE', [[14.0, 0.05], [14.0, 1.15], [16.35, 1.15], [16.35, 1.06]]);
// NoWrite (Example 7.2) and ShiftCtl, carried from Decode
ec('cu_NoWrite', 'NoWriteD', [[CU_X, ROWX.NoWrite], [L('de_c'), ROWX.NoWrite]], { labels: [anc('NoWriteD', [CU_X + 0.05, ROWX.NoWrite], 'south west')] });
ec('cu_ShiftCtl', 'ShiftCtlD', [[CU_X, ROWX.ShiftCtl], [L('de_c'), ROWX.ShiftCtl]], { labels: [anc('ShiftCtlD', [CU_X + 0.05, ROWX.ShiftCtl], 'south west')] });
ec('de_nowrite', 'NoWriteE', [[R('de_c'), ROWX.NoWrite], [r4(GXE - 0.3), ROWX.NoWrite], [r4(GXE - 0.3), r4(ROWX.RegWrite + 0.25)], [r4(GXE - 0.1), r4(ROWX.RegWrite + 0.25)]],
  { labels: [anc('NoWriteE', [R('de_c') + 0.05, ROWX.NoWrite], 'south west')] });
ec('de_shiftctl', 'ShiftCtlE', [[R('de_c'), ROWX.ShiftCtl], [11.9, ROWX.ShiftCtl]], { labels: [anc('ShiftCtlE', [11.95, ROWX.ShiftCtl], 'west')] });
ec('condex_RegWrite', 'CondExE', [[CXE, r4(ROWX.RegWrite - 0.25)], [GXE, r4(ROWX.RegWrite - 0.25)]]);
// Writeback: the Byte unit (A4-Q6) and the four-input result multiplexer; the rows of Writeback end short
for (const [row, s] of [['PCSrc', 'PCSrcW'], ['RegWrite', 'RegWriteW'], ['ResultSrc', 'ResultSrcW']]) {
  ec(`mw_${row}`, s, [[XE(R('mw_c')), ROWX[row]], [24.8, ROWX[row]]], { labels: [anc(s, [24.85, ROWX[row]], 'west')] });
}
ew('aow_a', 'ALUOutW', [[XE(R('mw')), 1.4], [24.6, 1.4], [24.6, 0.15], [25.8, 0.15]], { arrow: false });
ew('aow_rm', 'ALUOutW', [[25.8, 0.15], [27.0, 0.15]]);
ew('aow_byte', 'ALUOutW1:0', [[25.8, 0.15], [25.8, -0.6]], { labels: [lab('1:0', [25.8, -0.05], 'right')] });
ew('rdw_a', 'ReadDataW', [[XE(R('mw')), -0.85], [25.0, -0.85]], { arrow: false });
ew('rdw_rm', 'ReadDataW', [[25.0, -0.85], [25.0, -0.35], [27.0, -0.35]]);
ew('rdw_byte', 'ReadDataW', [[25.0, -0.85], [25.45, -0.85]]);
ew('byte_rm', 'ReadByteW', [[26.15, -0.85], [27.0, -0.85]]);
ew('res_a', 'ResultW', [[27.6, -0.1], [28.3, -0.1], [28.3, Y_RES], [11.35, Y_RES]], { arrow: false, labels: [lab('ResultW', [21.4, Y_RES], 'below')] });

const DROP_J = (j) => (j[0] === CX && j[1] === r4(gateY('RegWrite') - 0.1));
const junctionsX = [...junctions.filter((j) => !DROP_J(j)).map(tp),
  [2.3, 3.4], [FX, 1.3], [CXE, r4(ROWX.RegWrite - 0.25)], [25.0, -0.85], [25.8, 0.15]];

const DROP_C = new Set(['MemtoRegW', 'MemtoRegE']);
const controlX = [
  ...control.filter((c) => !DROP_C.has(c.signal)).map((c) => ({ ...c, points: c.points.map(tp) })),
  hzIn('ResultSrcE', 8.0),
  st('LinkD', [[5.5, -2.7], [5.5, -3.0]], 'above'),
  st('ShiftCtlE', [[13.75, -1.0], [13.75, -0.55]], 'below'),
  st('ResultSrcW', [[27.3, -1.5], [27.3, -1.0]], 'below'),
];

const picsX = {
  ...pics,
  mux4f: {
    outline: [[0, -1.1], [0.6, -0.7], [0.6, 0.7], [0, 1.1]],
    anchors: { in3: [0, 0.75], in0: [0, 0.25], in1: [0, -0.25], in2: [0, -0.75], out: [0.6, 0], sel: [0.3, -0.9] },
    labels: muxLabels([0.75, 0.25, -0.25, -0.75], ['3', '0', '1', '2']),
  },
  // RegWrite = RegWriteE AND CondExE AND NOT NoWriteE (Example 7.2): three inputs, the top one inverted
  and3: { outline: gate(0.7), anchors: { a: [0, 0.25], c: [0, 0], b: [0, -0.25], out: [0.5, 0] }, labels: [] },
  bubble: { outline: Array.from({ length: 12 }, (_, k) => [r4(0.05 * Math.cos((k * Math.PI) / 6)), r4(0.05 * Math.sin((k * Math.PI) / 6))]), anchors: {}, labels: [] },
};
const labelsX = [
  ...moveLabels(labels.filter((l) => l.style !== 'figtitle' && !['IF/ID', 'ID/EX', 'EX/MEM', 'MEM/WB'].includes(l.text))),
  title('IF', [0.0, 10.1]), title('ID', [7.3, 10.1]), title('EX', [16.1, 10.1]), title('MEM', [22.0, 10.1]), title('WB', [26.6, 10.1]),
  fig('IF/ID', [X.fd, 9.6]), fig('ID/EX', [X.de, 9.6]), fig('EX/MEM', [XE(X.em), 9.6]), fig('MEM/WB', [XE(X.mw), 9.6]),
];

const ext = {
  _copyright: COPY,
  _source: {
    topology: `${TOPOLOGY}; NoWrite after Example 7.2 and the shifter after Example 7.3 (p. 402)`,
    design: "the Extended pipelined processor: MAVILERA's own design (W-D32 C5 ruling; A4-Q5 to A4-Q8), semantics from ARM DDI 0406C.d; see src/arch/armv7/uarch/pipe-ext.js",
    layout: 'the base drawing spread, with parts added and connections replaced (as A3-Q10)',
    generated_by: 'tools/armv7/make-pipe-geometry.mjs',
    status: 'approved by the author on 2026-11-01 (A4-Q9)',
  },
  profile: 'arm-pipe', units: 'cm', y_up: true, pics: picsX, elements: elementsX, labels: labelsX, wires: wiresX, junctions: junctionsX,
  control: controlX, figures: {},
  alt: `${ALT.replace('by MemtoRegW', 'by ResultSrcW').replace(', MemtoRegE,', ', ResultSrcE,')} The Extended variant, this application's own design, adds: `
    + 'PCPlus4 registered into the Fetch/Decode register and carried along the top of every pipeline register to Writeback, for BL\'s link '
    + 'value; an A3 multiplexer in Decode choosing Rd or 14 (LinkD); a shifter between forwarding multiplexer B and the SrcB multiplexer, '
    + 'driven by ShiftCtlE and the C flag, whose carry ShiftCE and the flags go to the ALU, which takes a four-bit ALUControlE; NoWrite, '
    + 'carried to Execute and inverted into the RegWrite gate; in Writeback a Byte unit taking the byte of ReadDataW at ALUOutW1:0, and a '
    + 'four-input result multiplexer choosing ALUOutW, ReadDataW, ReadByteW or PCPlus4W by ResultSrcW.',
};
writeFileSync(out('pipe-extended.json'), `${JSON.stringify(ext, null, 1)}\n`);
console.log(`content/armv7/geometry/pipe-extended.json: ${ext.elements.length} elements, ${ext.wires.length} wires, ${ext.control.length} stubs`);
