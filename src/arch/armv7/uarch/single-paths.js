// armv7/uarch/single-paths.js -- the active path of an ARM single-cycle cycle (roadmap ARM-A2): which connections and
// elements of the drawing (content/armv7/geometry/single.json) the current instruction uses, from its signals. An input
// of a multiplexer is active when it is selected and the multiplexer's output is used; a field bus when its field is
// read; R15's PCPlus8 path when a register port reads R15. Fetch, the decoder's inputs and the conditional logic are
// active in every cycle, since every instruction is conditional. The ALU and its operands are active in every cycle (the
// datapath computes them); the write paths follow the gated signals RegWrite, MemWrite, PCSrc and FlagWrite, so a
// failed condition leaves them muted (roadmap §7). Pure JavaScript.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/**
 * @param {object} s the signals of the cycle (uarch/single.js evaluate().signals)
 * @returns {{wires: Set<string>, elements: Set<string>}}
 */
export function activePath(s) {
  const w = new Set(['pc_a', 'pc_imem', 'imem_bus', 'pcm_pc', 'bus_up1', 'bus_up2', 'ins_ctl', 'ins_cond', 'flags_cc',
    'condex', 'condex_regw', 'condex_memw', 'condex_flagw', 'dec_pcsrc', 'dec_regw', 'dec_memw', 'dec_flagw']);
  const e = new Set(['pcm', 'pc', 'imem', 'dec', 'flags', 'cc', 'g_pcsrc', 'g_regw', 'g_memw', 'g_flagw']);
  const add = (...ids) => ids.forEach((id) => w.add(id));
  const plus4 = () => { add('pc_add4', 'pc4_a'); e.add('add4'); };
  const plus8 = () => { plus4(); add('pc4_add8', 'pc8_rf'); e.add('add8'); };
  const down = () => add('bus_dn1');

  // operand A: Rn or R15
  add('ra1m_rf', 'rd1_alu');
  e.add('ra1m').add('rf').add('alu');
  if (s.RegSrc & 1) add('c15_ra1m'); else add('ins_rn');
  // operand B, and the store's data: Rm or Rd through RA2
  const ra2 = !s.ALUSrc || s.MemW;
  if (ra2) {
    add('ra2m_rf', 'rd2_a');
    e.add('ra2m');
    if (s.RegSrc & 2) { add('rd_ra2m', 'ins_rd_a'); down(); } else add('ins_rm');
  }
  if (s.RA1 === 15 || (ra2 && s.RA2 === 15)) plus8();
  e.add('bm');
  add('bm_alu');
  if (s.ALUSrc) { add('ext_bm', 'ins_imm', 'bus_dn2'); down(); e.add('ext'); } else add('rd2_bm');
  // the writes
  if (s.MemWrite) { add('alu_a', 'alu_dm', 'rd2_dm'); e.add('dm'); }
  if (s.FlagWrite) add('alu_flags');
  if (s.RegWrite || s.PCSrc) {
    add('res_a', 'alu_a');
    e.add('rm');
    if (s.MemtoReg) { add('alu_dm', 'dm_rm'); e.add('dm'); } else add('alu_rm');
    if (s.RegWrite && s.Rd !== 15) { add('res_rf', 'ins_rd_a', 'ins_rd'); down(); }
  }
  if (s.PCSrc) add('res_pcm'); else { add('pc4_pcm'); plus4(); }
  return { wires: w, elements: e };
}

const LOGICAL = new Set([0, 1, 8, 9, 12, 13, 14, 15]);

/**
 * The active path of the Extended datapath (content/armv7/geometry/single-extended.json; uarch/single-ext.js), by the
 * same rules: the shifter and the flags it reads for a register operand, the flags and ShiftC the ALU reads, the A3
 * multiplexer for a register write, the four result inputs, and the target multiplexer for a write to the PC.
 * @param {object} s the signals of the cycle (ArmSingleExt evaluate().signals)
 */
export function activePathExt(s) {
  const w = new Set(['pc_a', 'pc_imem', 'imem_bus', 'pcm_pc', 'bus_up1', 'bus_up2', 'ins_ctl_x', 'ins_cond', 'flags_cc',
    'condex', 'condex_regw3', 'condex_memw', 'condex_flagw', 'dec_pcsrc', 'dec_regw3', 'dec_nowrite', 'dec_memw', 'dec_flagw']);
  const e = new Set(['pcm', 'pc', 'imem', 'dec', 'flags', 'cc', 'g_pcsrc', 'g_regw', 'g_memw', 'g_flagw', 'nw_bub']);
  const add = (...ids) => ids.forEach((id) => w.add(id));
  const plus4 = () => { add('pc_add4', 'pc4_a'); e.add('add4'); };
  const plus8 = () => { plus4(); add('pc4_add8', 'pc8_rf'); e.add('add8'); };
  const down = () => add('bus_dn1');

  add('ra1m_rf', 'rd1_alu');
  e.add('ra1m').add('rf').add('alu');
  if (s.RegSrc & 1) add('c15_ra1m'); else add('ins_rn');
  const ra2 = !s.ALUSrc || s.MemW;
  if (ra2) {
    add('ra2m_rf', 'rd2_a');
    e.add('ra2m');
    if (s.RegSrc & 2) { add('rd_ra2m', 'ins_rd_a'); down(); } else add('ins_rm');
  }
  if (s.RA1 === 15 || (ra2 && s.RA2 === 15)) plus8();
  e.add('bm');
  add('bm_alu');
  if (s.ALUSrc) { add('ext_bm', 'ins_imm', 'bus_dn2'); down(); e.add('ext'); } else { add('rd2_sh', 'sh_bm'); e.add('sh'); }
  // the flags: the shifter's carry in for a register operand; the ALU's for ADC and SBC, and for a logical operation
  // that sets the flags (C from ShiftC, V kept)
  const dp = s.ALUOp === 0b10;
  const logicalFlags = dp && LOGICAL.has(s.ALUControl) && s.FlagWrite;
  const aluFlags = dp && (s.ALUControl === 5 || s.ALUControl === 6 || logicalFlags);
  if ((dp && !s.ALUSrc) || aluFlags) add('flags_dn');
  if (aluFlags) add('flags_alu');
  if (logicalFlags) add('shc_alu');
  // the writes
  if (s.MemWrite) { add('alu_a', 'alu_dm', 'rd2_dm'); e.add('dm'); }
  if (s.FlagWrite) add('alu_flags');
  if (s.RegWrite || (s.PCSrc && !s.Branch)) {
    add('res_a');
    e.add('rm');
    if (s.ResultSrc === 0) add('alu_a', 'alu_up', 'alu_rm4');
    else if (s.ResultSrc === 1) { add('alu_a', 'alu_dm', 'dm_a', 'dm_rm4'); e.add('dm'); }
    else if (s.ResultSrc === 2) { add('alu_a', 'alu_dm', 'dm_a', 'dm_byte', 'byte_rm4', 'alu_up', 'alu_byte'); e.add('dm').add('byte'); }
    else add('pc4_rm4');
    if (s.RegWrite && s.WA3 !== 15) {
      add('res_rf', 'wa3m_rf');
      e.add('wa3m');
      if (s.Link) add('c14_wa3m'); else { add('rd_wa3m', 'ins_rd_a'); down(); }
    }
  }
  if (s.PCSrc) {
    add('tgm_pcm');
    e.add('tgm');
    if (s.Branch) add('alur_tgm'); else add('res_tgm');
  } else { add('pc4_pcm'); plus4(); }
  return { wires: w, elements: e };
}
