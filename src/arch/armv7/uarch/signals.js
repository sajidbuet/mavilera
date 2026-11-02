// armv7/uarch/signals.js -- the signal dictionary of the ARM single-cycle processor (roadmap milestone ARM-A2; signal
// dictionary of docs/roadmaps/ARMV7A-DEVELOPMENT-ROADMAP.md §3.2): name, width, kind and value meanings, in Harris and
// Harris's names (spec W-D32 Q4; DDCA ARM ed., Figs 7.13-7.14, pp. 399-401; the single-cycle HDL's `datapath`,
// `controller`, `decoder` and `condlogic`). `values` maps a binary code to what it selects, in signal names; the
// interface adds prose from strings.js. Rn, Rm and Imm24 name the instruction fields Instr19:16, Instr3:0 and
// Instr23:0 that the drawing carries to the register-file multiplexers and to Extend. The same shape as the RISC-V
// dictionary (src/uarch/signals.js), which drives the bus-width markers of the drawing. Pure data.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const ctrl = (name, width, values = null) => ({ name, width, kind: 'control', values });
const data = (name, width) => ({ name, width, kind: 'data', values: null });

const FLAG_SET = { '00': '—', 10: 'N, Z', 11: 'N, Z, C, V' };

/** The single-cycle processor of Fig 7.13 (p. 399), the Harris base design (tier H). */
export const SINGLE_SIGNALS = Object.freeze([
  // control: Main Decoder (Table 7.2), ALU Decoder (Table 7.3), PC Logic, Conditional Logic (Fig 7.14)
  ctrl('RegSrc', 2, { '00': 'Rn, Rm', '01': '15, Rm', 10: 'Rn, Rd', 11: '15, Rd' }),
  ctrl('ImmSrc', 2, { '00': 'imm8', '01': 'imm12', 10: 'imm24' }),
  ctrl('ALUSrc', 1, { 0: 'WriteData', 1: 'ExtImm' }),
  ctrl('MemtoReg', 1, { 0: 'ALUResult', 1: 'ReadData' }),
  ctrl('RegW', 1),
  ctrl('MemW', 1),
  ctrl('Branch', 1),
  ctrl('ALUOp', 1, { 0: 'ADD', 1: 'cmd' }),
  ctrl('ALUControl', 2, { '00': 'ADD', '01': 'SUB', 10: 'AND', 11: 'ORR' }),
  ctrl('FlagW', 2, FLAG_SET),
  ctrl('PCS', 1),
  ctrl('CondEx', 1),
  ctrl('FlagWrite', 2, FLAG_SET),
  ctrl('RegWrite', 1),
  ctrl('MemWrite', 1),
  ctrl('PCSrc', 1, { 0: 'PCPlus4', 1: 'Result' }),
  // data
  data('PC', 32), data('PCPlus4', 32), data('PCPlus8', 32), data('PCNext', 32), data('Instr', 32),
  data('Cond', 4), data('Op', 2), data('Funct', 6), data('Rn', 4), data('Rm', 4), data('Rd', 4), data('Imm24', 24),
  data('RA1', 4), data('RA2', 4), data('SrcA', 32), data('WriteData', 32), data('ExtImm', 32), data('SrcB', 32),
  data('ALUResult', 32), data('ALUFlags', 4), data('ReadData', 32), data('Result', 32), data('Flags', 4),
]);

export const SIGNAL_INFO = Object.freeze(Object.fromEntries(SINGLE_SIGNALS.map((s) => [s.name, s])));

const OPS = ['AND', 'EOR', 'SUB', 'RSB', 'ADD', 'ADC', 'SBC', 'RSC', 'TST', 'TEQ', 'CMP', 'CMN', 'ORR', 'MOV', 'BIC', 'MVN'];
const CHANGED = {
  ALUOp: ctrl('ALUOp', 2, { '00': 'ADD', '01': 'U', 10: 'cmd' }),
  ALUControl: ctrl('ALUControl', 4, Object.fromEntries(OPS.map((o, i) => [binary(i, 4), o]))),
  FlagW: ctrl('FlagW', 2, { '00': '—', 11: 'N, Z, C, V' }),
  FlagWrite: ctrl('FlagWrite', 2, { '00': '—', 11: 'N, Z, C, V' }),
  PCSrc: ctrl('PCSrc', 1, { 0: 'PCPlus4', 1: 'PCTarget' }),
  Branch: ctrl('Branch', 1, { 0: 'Result', 1: 'ALUResult' }),
};

/**
 * The Extended datapath variant (uarch/single-ext.js; W-D32 C5 ruling, W-D35): the base dictionary without MemtoReg,
 * with ALUOp, ALUControl and FlagW widened or re-encoded, and the signals the extension adds. NoWrite is Harris's
 * (Example 7.2); ResultSrc follows the multicycle design's name (Fig 7.30); the rest are this application's names.
 */
export const SINGLE_EXT_SIGNALS = Object.freeze([
  ...SINGLE_SIGNALS.filter((s) => s.name !== 'MemtoReg').map((s) => CHANGED[s.name] ?? s),
  ctrl('ResultSrc', 2, { '00': 'ALUResult', '01': 'ReadData', 10: 'ReadByte', 11: 'PCPlus4' }),
  ctrl('NoWrite', 1),
  ctrl('Link', 1, { 0: 'Rd', 1: '14' }),
  ctrl('ShiftCtl', 7),
  data('Instr11:5', 7), data('WA3', 4), data('ShiftResult', 32), data('ShiftC', 1), data('ALUResult1:0', 2), data('ReadByte', 32),
  data('PCTarget', 32),
]);

export const SIGNAL_INFO_EXT = Object.freeze(Object.fromEntries(SINGLE_EXT_SIGNALS.map((s) => [s.name, s])));

const STATE_VALUES = Object.fromEntries(['Fetch', 'Decode', 'MemAdr', 'MemRead', 'MemWB', 'MemWrite', 'ExecuteR', 'ExecuteI', 'ALUWB', 'Branch']
  .map((s, i) => [binary(i, 4), `S${i} ${s}`]));

/**
 * The multicycle processor of Fig 7.30 (p. 414) with the control unit of Fig 7.31 (p. 415), the Harris base design
 * (uarch/multi.js; roadmap ARM-A3). RD1 and RD2 are the register file's outputs; A and WriteData the registers they load
 * (Figs 7.21, 7.27); Instr is the output of IR. CondExDelayed is CondEx after the one-cycle delay of p. 413 ("we also
 * delay CondEx by one cycle"); state and next are the Main FSM's state register and next state (S0-S9, Fig 7.41).
 */
export const MULTI_SIGNALS = Object.freeze([
  ctrl('state', 4, STATE_VALUES),
  ctrl('next', 4, STATE_VALUES),
  // control: Main FSM (Fig 7.41), Instr Decoder (Table 7.6), ALU Decoder (Table 7.3), PC Logic, Conditional Logic (Fig 7.31)
  ctrl('NextPC', 1),
  ctrl('Branch', 1),
  ctrl('MemW', 1),
  ctrl('RegW', 1),
  ctrl('IRWrite', 1),
  ctrl('AdrSrc', 1, { 0: 'PC', 1: 'ALUOut' }),
  ctrl('ResultSrc', 2, { '00': 'ALUOut', '01': 'Data', 10: 'ALUResult' }),
  ctrl('ALUSrcA', 1, { 0: 'A', 1: 'PC' }),
  ctrl('ALUSrcB', 2, { '00': 'WriteData', '01': 'ExtImm', 10: '4' }),
  ctrl('ALUOp', 1, { 0: 'ADD', 1: 'cmd' }),
  ctrl('RegSrc', 2, { '00': 'Rn, Rm', '01': '15, Rm', 10: 'Rn, Rd', 11: '15, Rd' }),
  ctrl('ImmSrc', 2, { '00': 'imm8', '01': 'imm12', 10: 'imm24' }),
  ctrl('ALUControl', 2, { '00': 'ADD', '01': 'SUB', 10: 'AND', 11: 'ORR' }),
  ctrl('FlagW', 2, FLAG_SET),
  ctrl('PCS', 1),
  ctrl('CondEx', 1),
  ctrl('CondExDelayed', 1),
  ctrl('FlagWrite', 2, FLAG_SET),
  ctrl('PCSGated', 1), // PCS AND CondExDelayed: the OR gate's input, unnamed in Fig 7.31c (this application's name)
  ctrl('PCWrite', 1),
  ctrl('RegWrite', 1),
  ctrl('MemWrite', 1),
  // data
  data('PC', 32), data('Adr', 32), data('ReadData', 32), data('Instr', 32), data('Data', 32),
  data('Cond', 4), data('Op', 2), data('Funct', 6), data('Rn', 4), data('Rm', 4), data('Rd', 4), data('Imm24', 24),
  data('RA1', 4), data('RA2', 4), data('RD1', 32), data('RD2', 32), data('A', 32), data('WriteData', 32),
  data('ExtImm', 32), data('SrcA', 32), data('SrcB', 32), data('ALUResult', 32), data('ALUFlags', 4), data('ALUOut', 32),
  data('Result', 32), data('Flags', 4),
]);

export const MULTI_INFO = Object.freeze(Object.fromEntries(MULTI_SIGNALS.map((s) => [s.name, s])));

const STATE_VALUES_EXT = { ...STATE_VALUES, 1010: 'S10 Link', 1011: 'S11 BranchL' };
const CHANGED_MULTI = {
  state: ctrl('state', 4, STATE_VALUES_EXT),
  next: ctrl('next', 4, STATE_VALUES_EXT),
  ALUOp: ctrl('ALUOp', 2, { '00': 'ADD', '01': 'U', 10: 'cmd' }),
  ALUControl: CHANGED.ALUControl,
  FlagW: CHANGED.FlagW,
  FlagWrite: CHANGED.FlagWrite,
  ResultSrc: ctrl('ResultSrc', 2, { '00': 'ALUOut', '01': 'Data', 10: 'ALUResult', 11: 'PC' }),
};

/**
 * The Extended multicycle processor (uarch/multi-ext.js; W-D32 C5 ruling, A3-Q3 to A3-Q5): the multicycle dictionary with
 * the twelve states, ALUOp, ALUControl and FlagW as in the single-cycle Extended datapath, ResultSrc with the PC, and the
 * signals the extension adds: the shifter's, the Byte unit's (ByteSel selects ReadByte into Data), Link and WA3 for BL,
 * and NoWrite. The added names are those of the single-cycle Extended dictionary where it has one.
 */
export const MULTI_EXT_SIGNALS = Object.freeze([
  ...MULTI_SIGNALS.map((s) => CHANGED_MULTI[s.name] ?? s),
  ctrl('NoWrite', 1),
  ctrl('Link', 1, { 0: 'Rd', 1: '14' }),
  ctrl('ShiftCtl', 7),
  ctrl('ByteSel', 1, { 0: 'ReadData', 1: 'ReadByte' }),
  data('Instr11:5', 7), data('WA3', 4), data('ShiftResult', 32), data('ShiftC', 1), data('ALUOut1:0', 2), data('ReadByte', 32),
  data('DataIn', 32),
]);

export const MULTI_EXT_INFO = Object.freeze(Object.fromEntries(MULTI_EXT_SIGNALS.map((s) => [s.name, s])));

const FWD = { '00': 'register file', '01': 'ResultW', 10: 'ALUOutM' };

/**
 * The pipelined processor of Fig 7.58 (p. 441), the Harris base design (uarch/pipe.js; roadmap ARM-A4, §5): Harris's
 * stage-suffixed names (F, D, E, M, W) for the pipeline registers' signals and the Hazard Unit's (Figs 7.47, 7.51,
 * 7.54, 7.57). Cond, Op, Funct, Rn, Rd, Rm and Imm24 are the fields of InstrD (Fig 7.47 labels Op, Funct and Rd at the
 * Control Unit). PCNext is PC' (as in the single-cycle dictionary). This application's names for wires the figures leave
 * unnamed: PCMuxF (the output of the PCSrcW multiplexer, before the branch multiplexer), RD1D, RD2D (the register file's
 * outputs), RD1E, RD2E (the D/E register's), ExtImmD, ReadDataM, FlagsNextE (the Cond Unit's Flags', fed back to
 * FlagsE) and StallFTextbook (StallF as p. 440 gives it, before the correction of A4-Q2).
 */
export const PIPE_SIGNALS = Object.freeze([
  // control, Decode: the single-cycle Control Unit (p. 430) and PCSrcD = (Rd == 15) AND RegW (p. 438)
  ctrl('RegSrcD', 2, { '00': 'Rn, Rm', '01': '15, Rm', 10: 'Rn, Rd', 11: '15, Rd' }),
  ctrl('ImmSrcD', 2, { '00': 'imm8', '01': 'imm12', 10: 'imm24' }),
  ctrl('ALUSrcD', 1, { 0: 'WriteDataE', 1: 'ExtImmE' }),
  ctrl('MemtoRegD', 1, { 0: 'ALUOutW', 1: 'ReadDataW' }),
  ctrl('RegWriteD', 1), ctrl('MemWriteD', 1), ctrl('BranchD', 1),
  ctrl('ALUControlD', 2, { '00': 'ADD', '01': 'SUB', 10: 'AND', 11: 'ORR' }),
  ctrl('FlagWriteD', 2, FLAG_SET),
  ctrl('PCSrcD', 1),
  // control, Execute
  ctrl('PCSrcE', 1), ctrl('RegWriteE', 1),
  ctrl('MemtoRegE', 1, { 0: 'ALUOutW', 1: 'ReadDataW' }),
  ctrl('MemWriteE', 1),
  ctrl('ALUControlE', 2, { '00': 'ADD', '01': 'SUB', 10: 'AND', 11: 'ORR' }),
  ctrl('BranchE', 1),
  ctrl('ALUSrcE', 1, { 0: 'WriteDataE', 1: 'ExtImmE' }),
  ctrl('FlagWriteE', 2, FLAG_SET),
  ctrl('CondE', 4), ctrl('CondExE', 1), ctrl('BranchTakenE', 1),
  // control, Memory and Writeback
  ctrl('PCSrcM', 1), ctrl('RegWriteM', 1), ctrl('MemtoRegM', 1), ctrl('MemWriteM', 1),
  ctrl('PCSrcW', 1, { 0: 'PCPlus4F', 1: 'ResultW' }), ctrl('RegWriteW', 1),
  ctrl('MemtoRegW', 1, { 0: 'ALUOutW', 1: 'ReadDataW' }),
  // Hazard Unit
  ctrl('Match_1E_M', 1), ctrl('Match_1E_W', 1), ctrl('Match_2E_M', 1), ctrl('Match_2E_W', 1), ctrl('Match_12D_E', 1),
  ctrl('ForwardAE', 2, FWD), ctrl('ForwardBE', 2, FWD),
  ctrl('LDRstall', 1), ctrl('PCWrPendingF', 1), ctrl('StallF', 1), ctrl('StallFTextbook', 1), ctrl('StallD', 1),
  ctrl('FlushD', 1), ctrl('FlushE', 1),
  // data
  data('PCF', 32), data('InstrF', 32), data('PCPlus4F', 32), data('PCMuxF', 32), data('PCNext', 32),
  data('InstrD', 32), data('Cond', 4), data('Op', 2), data('Funct', 6), data('Rn', 4), data('Rd', 4), data('Rm', 4), data('Imm24', 24),
  data('PCPlus8D', 32), data('RA1D', 4), data('RA2D', 4), data('RD1D', 32), data('RD2D', 32), data('ExtImmD', 32), data('WA3D', 4),
  data('RD1E', 32), data('RD2E', 32), data('ExtImmE', 32), data('WA3E', 4), data('RA1E', 4), data('RA2E', 4),
  data('SrcAE', 32), data('WriteDataE', 32), data('SrcBE', 32), data('ALUResultE', 32), data('ALUFlags', 4),
  data('FlagsE', 4), data('FlagsNextE', 4),
  data('ALUOutM', 32), data('WriteDataM', 32), data('WA3M', 4), data('ReadDataM', 32),
  data('ALUOutW', 32), data('ReadDataW', 32), data('WA3W', 4), data('ResultW', 32),
]);

export const PIPE_INFO = Object.freeze(Object.fromEntries(PIPE_SIGNALS.map((s) => [s.name, s])));

const RESULT_SRC = { '00': 'ALUOutW', '01': 'ReadDataW', 10: 'ReadByteW', 11: 'PCPlus4W' };
const CHANGED_PIPE = {
  ALUControlD: ctrl('ALUControlD', 4, CHANGED.ALUControl.values), ALUControlE: ctrl('ALUControlE', 4, CHANGED.ALUControl.values),
  FlagWriteD: ctrl('FlagWriteD', 2, CHANGED.FlagW.values), FlagWriteE: ctrl('FlagWriteE', 2, CHANGED.FlagW.values),
  ALUSrcD: ctrl('ALUSrcD', 1, { 0: 'ShiftResultE', 1: 'ExtImmE' }), ALUSrcE: ctrl('ALUSrcE', 1, { 0: 'ShiftResultE', 1: 'ExtImmE' }),
};
const MEMTOREG = new Set(['MemtoRegD', 'MemtoRegE', 'MemtoRegM', 'MemtoRegW']);

/**
 * The Extended pipelined processor (uarch/pipe-ext.js; W-D32 C5 ruling, A4-Q5 to A4-Q8): the base dictionary with
 * MemtoReg replaced by ResultSrc in every stage, ALUControl and FlagWrite as in the single-cycle Extended datapath, and
 * the added signals: NoWrite, Link, ShiftCtl, the shifter's ShiftResultE and ShiftCE, the link value PCPlus4 in every
 * stage after Fetch, and the Byte unit's ReadByteW (names as in the single-cycle Extended dictionary, with stage letters).
 */
export const PIPE_EXT_SIGNALS = Object.freeze([
  ...PIPE_SIGNALS.filter((s) => !MEMTOREG.has(s.name)).map((s) => CHANGED_PIPE[s.name] ?? s),
  ...['D', 'E', 'M', 'W'].map((x) => ctrl(`ResultSrc${x}`, 2, RESULT_SRC)),
  ctrl('NoWriteD', 1), ctrl('NoWriteE', 1), ctrl('LinkD', 1, { 0: 'Rd', 1: '14' }), ctrl('ShiftCtlD', 7), ctrl('ShiftCtlE', 7),
  data('Instr11:5', 7), data('PCPlus4D', 32), data('PCPlus4E', 32), data('PCPlus4M', 32), data('PCPlus4W', 32),
  data('ShiftResultE', 32), data('ShiftCE', 1), data('ALUOutW1:0', 2), data('ReadByteW', 32),
]);

export const PIPE_EXT_INFO = Object.freeze(Object.fromEntries(PIPE_EXT_SIGNALS.map((s) => [s.name, s])));

/** Binary text of a signal value, `width` digits. */
export function binary(value, width) {
  return (value >>> 0).toString(2).padStart(width, '0').slice(-width);
}

/** What a control value selects, from `values` of `info` (default SIGNAL_INFO), or null. */
export function meaning(name, value, info = SIGNAL_INFO) {
  const s = info[name];
  if (!s?.values) return null;
  return s.values[binary(value, s.width)] ?? null;
}
