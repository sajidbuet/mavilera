// armv7/uarch/multi-paths.js -- the active path of an ARM multicycle cycle (roadmap ARM-A3): which connections and
// elements of the drawing (content/armv7/geometry/multi.json, or multi-extended.json for the Extended processor) the
// current state uses, from the state and its signals. The paths follow the datapath operation of each state (Fig 7.41,
// p. 423): the memory when the state reads or writes it (Fetch, MemRead, MemWrite), the ALU when the state's µOp uses its
// result (Fetch, Decode, MemAdr, ExecuteR, ExecuteI, Branch; Link in the Extended processor), ALUOut when the next state
// reads it, the register reads in Decode (A and WriteData load the values the later states use), and the Result bus when
// it is written to the PC or the register file, or read as R15 in Decode. A multiplexer's input is active when it is
// selected and its output is used. The registers that load on every edge (A, WriteData, Data, ALUOut) are shown only
// where their new value is used. The controller, the instruction fields it reads and the conditional logic are active in
// every cycle; the write paths follow the gated PCWrite, RegWrite, MemWrite and FlagWrite, so a failed condition leaves
// them muted (roadmap §7). The Extended processor (A3-Q3 to A3-Q5) adds the Byte unit before Data, the shifter before the
// SrcB multiplexer with its carry and the flags into the ALU, the A3 multiplexer, the PC into the Result multiplexer and
// NoWrite into the RegWrite gate. Pure JavaScript.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { STATES } from './multi.js';

const STATES_EXT = [...STATES, 'Link', 'BranchL'];
const ALU_STATES = new Set(['Fetch', 'Decode', 'MemAdr', 'ExecuteR', 'ExecuteI', 'Branch', 'Link']);
const ALUOUT_STATES = new Set(['Decode', 'MemAdr', 'ExecuteR', 'ExecuteI', 'Link']); // their ALUResult is read from ALUOut next

/**
 * @param {object} s the signals of the cycle (uarch/multi.js or multi-ext.js evaluate().signals)
 * @param {boolean} ext the Extended processor's drawing
 * @returns {{wires: Set<string>, elements: Set<string>}}
 */
export function multiPath(s, ext = false) {
  const state = (ext ? STATES_EXT : STATES)[s.state];
  const w = new Set(['ir_bus', 'bus_up1', 'bus_up2', 'ins_ctl', 'ins_cond', 'flags_cc', 'condex', 'condex_cxd', 'cxd_pcs', 'cxd_memw',
    'cu_flagw', 'cu_memw', 'cu_pcs', 'cu_nextpc', 'pcs_or', ...(ext ? ['cu_regw3', 'cxd_regw3', 'cu_nowrite'] : ['cu_regw', 'cxd_regw'])]);
  const e = new Set(['ir', 'cu', 'flags', 'cc', 'cxd', 'g_flagw', 'g_memw', 'g_regw', 'g_pcs', 'g_pcwrite', ...(ext ? ['nw_bub'] : [])]);
  const add = (...ids) => ids.forEach((id) => w.add(id));
  const down = (n) => { add('bus_dn1'); if (n > 1) add('bus_dn2'); if (n > 2) add('bus_dn3'); };
  const aluOut = () => { add('ao_j'); e.add('aoreg'); };

  // the memory: the address from the PC or ALUOut
  const memory = state === 'Fetch' || state === 'MemRead' || state === 'MemWrite';
  if (memory && (state !== 'MemWrite' || s.MemWrite)) {
    add('am_mem');
    e.add('am').add('mem');
    if (s.AdrSrc) { aluOut(); add('ao_am'); } else { add('pc_out', 'pc_am'); e.add('pc'); }
  }
  if (s.IRWrite) add('mem_rd', 'rd_ir');
  if (state === 'MemRead') {
    e.add('data');
    if (!ext) add('mem_rd', 'rd_data');
    else {
      add('mem_rd', 'rd_dn', 'dsm_data');
      e.add('dsm');
      if (s.ByteSel) { add('rd_byte', 'byte_dsm', 'ao_byte'); e.add('byte').add('aoreg'); } else add('rd_dsm');
    }
  }
  if (s.MemWrite) { add('wd_mem', 'wd_j'); e.add('wdreg'); }

  // the register reads of Decode, and R15 = Result (PC + 8)
  if (state === 'Decode') {
    add('ra1m_rf', 'ra2m_rf', 'rd1_a', 'rd2_wd');
    e.add('ra1m').add('ra2m').add('rf').add('areg').add('wdreg');
    if (s.RegSrc & 1) add('c15_ra1m'); else add('ins_rn');
    if (s.RegSrc & 2) { add('rd_ra2m', 'ins_rd_a'); down(2); } else { add('ins_rm'); down(1); }
    if (s.RA1 === 15 || s.RA2 === 15) add('res_r15');
  }

  // the ALU and its sources
  if (ALU_STATES.has(state)) {
    add('sa_alu', 'sb_alu', 'alu_j');
    e.add('sam').add('sbm').add('alu');
    if (s.ALUSrcA) { add('pc_out', 'pc_sa'); e.add('pc'); } else { add('a_sa'); e.add('areg'); }
    if (s.ALUSrcB === 0) {
      add('wd_j');
      e.add('wdreg');
      if (ext) { add('wd_sh', 'sh_sb'); e.add('sh'); } else add('wd_sb');
    } else if (s.ALUSrcB === 1) { add('ext_sb', 'ins_imm'); down(3); e.add('ext'); } else add('c4_sb');
    if (ALUOUT_STATES.has(state)) { add('alu_ao'); e.add('aoreg'); }
    if (s.FlagWrite) add('alu_flags');
    if (ext && s.ALUOp === 0b10) {
      // the flags into the ALU: C for ADC, SBC and RSC, and the flags a logical operation with S keeps; ShiftC from the shifter
      if ([5, 6, 7].includes(s.ALUControl) || s.FlagWrite) add('flags_alu');
      if (s.FlagWrite && s.ALUSrcB === 0) add('shc_alu');
    }
  }

  // the Result bus: to the PC, to the register file, or as R15 in Decode
  const wa3 = ext ? s.WA3 : s.Rd;
  const toPc = s.PCWrite === 1;
  const toRf = s.RegWrite === 1 && wa3 !== 15;
  const r15 = state === 'Decode' && w.has('res_r15');
  if (toPc || toRf || r15) {
    add('rm_res');
    e.add('rm');
    if (s.ResultSrc === 0) { aluOut(); add('ao_rm'); } else if (s.ResultSrc === 1) { add('data_rm'); e.add('data'); } else if (s.ResultSrc === 2) add('alu_j', 'alu_rm');
    else { add('pc_out', 'pc_sa', 'pc_rm'); e.add('pc'); }
    if (toPc) { add('res_a2', 'res_pc'); e.add('pc'); }
    if (toRf) {
      add('res_a2', 'res_wd3');
      e.add('rf');
      if (!ext) { add('ins_rd_a', 'ins_rd'); down(2); } else {
        add('wa3m_rf');
        e.add('wa3m');
        if (s.Link) add('c14_wa3m'); else { add('ins_rd_a', 'rd_wa3m'); down(2); }
      }
    }
  }
  return { wires: w, elements: e };
}
