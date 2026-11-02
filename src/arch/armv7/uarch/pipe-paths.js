// armv7/uarch/pipe-paths.js -- the connections of the ARM pipelined drawings (content/armv7/geometry/pipe.json and, for
// the Extended processor, pipe-extended.json) that the instructions in the five stages use in the current cycle (roadmap
// ARM-A4), from uarch/pipe.js or pipe-ext.js. The rules of the single-cycle paths (single-paths.js) applied stage by stage,
// as the RISC-V pipelined view does (src/uarch/pipe-paths.js): an input of a multiplexer is active when it is selected and
// the output is used; a stage that holds a bubble uses nothing; a forwarding feed is active when a forwarding select picks
// it; the write paths of Execute follow the condition (CondExE), so a failed condition leaves them muted (roadmap §7).
// Fetch and the next-PC multiplexers are active in every cycle. Pure JavaScript.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const ROWS = ['PCSrc', 'RegWrite', 'MemtoReg', 'MemWrite', 'ALUControl', 'ALUSrc', 'Branch', 'FlagWrite'];
const ROWS_EXT = [...ROWS, 'NoWrite', 'ShiftCtl'];
const LOGICAL = new Set([0, 1, 8, 9, 12, 13, 14, 15]);

/**
 * @param {object} c the cycle (ArmPipe or ArmPipeExt evaluate(): signals and live, the stages that hold an instruction)
 * @param {boolean} ext the Extended drawing
 * @returns {{wires: Set<string>, elements: Set<string>, stages: object}} stages: the wires of each stage, IF, ID, EX,
 *   MEM, WB, and fwd (the forwarding feeds in use)
 */
export function pipePaths(c, ext = false) {
  const s = c.signals;
  const live = c.live;
  const stages = { IF: new Set(), ID: new Set(), EX: new Set(), MEM: new Set(), WB: new Set(), fwd: new Set() };
  const e = new Set(['pc', 'imem', 'add4', 'brm', 'fd', 'de', 'de_c', 'em', 'em_c', 'mw', 'mw_c', 'hz', ...(ext ? ['fd_p'] : [])]); // registers always
  const add = (set, ...ids) => ids.forEach((id) => set.add(id));

  // IF: the fetch and the next PC (the branch target of Execute, or ResultW of Writeback, or PCPlus4F); in the Extended
  // processor PCPlus4F is also registered into IF/ID
  const IF = stages.IF;
  add(IF, 'pc_a', 'pc_imem', 'imem_fd', 'pc_add4', 'add4_a', 'brm_pc', ...(ext ? ['pc4_b', 'pc4_fd'] : []));
  if (s.BranchTakenE) { add(stages.EX, 'alu_a', 'alu_brm'); }
  else {
    add(IF, 'pcm_brm');
    e.add('pcm');
    if (s.PCSrcW) add(stages.WB, 'res_a', 'res_b', 'res_pcm');
    else add(IF, 'pc4_pcm');
  }

  // ID: the fields, the register reads (R15 is PCPlus8D), Extend, the Control Unit's rows
  if (live.ID) {
    const ID = stages.ID;
    add(ID, 'fd_bus', 'bus_up1', 'bus_up2', 'ins_cu', 'ins_cond', 'ra1m_rf', 'rd1_de', ...(ext ? ROWS_EXT : ROWS).map((r) => `cu_${r}`));
    ['cu', 'ra1m', 'rf'].forEach((x) => e.add(x));
    if (s.RegSrcD & 1) ID.add('c15_ra1m'); else ID.add('ins_rn');
    const ra2 = !s.ALUSrcD || s.MemWriteD;
    if (ra2) {
      add(ID, 'ra2m_rf', 'rd2_de');
      e.add('ra2m');
      if (s.RegSrcD & 2) add(ID, 'bus_dn1', 'ins_rd_a', 'rd_ra2m'); else ID.add('ins_rm');
    }
    if (s.RA1D === 15 || (ra2 && s.RA2D === 15)) add(ID, ...(ext ? ['pc4_c'] : ['pc4_b']), 'pc8_rf');
    if (s.ALUSrcD) { add(ID, 'bus_dn1', 'bus_dn2', 'ins_imm', 'ext_de'); e.add('ext'); }
    if (s.RegWriteD) {
      ID.add('wa3d');
      if (!ext) add(ID, 'bus_dn1', 'ins_rd_a');
      else {
        e.add('a3m');
        if (s.LinkD) ID.add('c14_a3m'); else add(ID, 'bus_dn1', 'ins_rd_a', 'rd_a3m');
      }
    }
    if (ext && s.LinkD) ID.add('p4_d');
  }

  // EX: forwarding, the shifter (Extended), the ALU, the Cond Unit; the writes it passes on follow CondExE
  if (live.EX) {
    const EX = stages.EX;
    const feed = (sel, own, mux) => {
      if (sel === 0b10) add(stages.fwd, 'aom_a', 'aom_fwd', `aom_${mux}`);
      else if (sel === 0b01) add(stages.fwd, 'res_a', 'res_up', `res_${mux}`);
      else EX.add(own);
      e.add(mux);
    };
    add(EX, 'de_cond', 'flags_cond', 'condex', 'condex_RegWrite', 'condex_MemWrite', 'condex_branch', 'fam_alu', 'bm_alu',
      'de_PCSrc', 'de_RegWrite', 'de_memtoreg', 'de_MemWrite', 'de_alucontrol', 'de_alusrc', 'de_branch', 'de_flagw',
      ...(ext ? ['de_nowrite', 'de_shiftctl'] : []));
    ['cond', 'flags', 'g_pcsrc', 'g_regw', 'g_memw', 'g_branch', 'alu', 'bm', ...(ext ? ['nw_bub'] : [])].forEach((x) => e.add(x));
    feed(s.ForwardAE, 'rd1e_fam', 'fam');
    const store = s.MemWriteE && s.CondExE;
    if (!s.ALUSrcE || store) { feed(s.ForwardBE, 'rd2e_fbm', 'fbm'); EX.add('fbm_a'); }
    if (s.ALUSrcE) EX.add('ext_bm');
    else if (ext) { add(EX, 'wd_sh', 'sh_bm', 'flags_dn', 'flags_sh'); e.add('sh'); }
    else EX.add('wd_bm');
    if (store) EX.add('wd_em');
    const regWrite = s.RegWriteE && s.CondExE && !(ext && s.NoWriteE);
    if ((regWrite || s.MemWriteE) && s.CondExE) add(EX, 'alu_a', 'alu_em');
    if (regWrite) EX.add('wa3e');
    if (s.FlagWriteE && s.CondExE) add(EX, 'alu_flags', 'cond_flags');
    if (ext) {
      // the flags into the ALU for ADC and SBC, and for a logical operation that sets them (C from ShiftCE, V kept)
      const logicalFlags = LOGICAL.has(s.ALUControlE) && s.FlagWriteE && !s.BranchE && !s.MemWriteE && s.ResultSrcE === 0;
      if (s.ALUControlE === 5 || s.ALUControlE === 6 || logicalFlags) add(EX, 'flags_dn', 'flags_alu');
      if (logicalFlags) add(EX, 'shc_alu');
      if (s.ResultSrcE === 0b11 && regWrite) EX.add('p4_e');
    }
  }

  // MEM: the data memory's address, data and output
  if (live.MEM) {
    const MEM = stages.MEM;
    add(MEM, 'em_PCSrc', 'em_RegWrite', 'em_MemtoReg', 'em_memwrite');
    if (s.MemWriteM) { add(MEM, 'aom_a', 'aom_dm', 'wdm_dm'); e.add('dm'); }
    if (s.RegWriteM) {
      MEM.add('wa3m');
      const src = ext ? s.ResultSrcM : s.MemtoRegM;
      if (src === 1 || src === 2) { add(MEM, 'aom_a', 'aom_dm', 'dm_mw'); e.add('dm'); }
      else if (src === 3) MEM.add('p4_m');
      else add(MEM, 'aom_a', 'aom_mw');
    }
  }

  // WB: the result multiplexer (the Byte unit, Extended), and the write of the register file or the PC
  if (live.WB) {
    const WB = stages.WB;
    add(WB, 'mw_PCSrc', 'mw_RegWrite', ext ? 'mw_ResultSrc' : 'mw_MemtoReg');
    if (s.RegWriteW || s.PCSrcW) {
      WB.add('res_a');
      e.add('rm');
      if (!ext) WB.add(s.MemtoRegW ? 'rdw_rm' : 'aow_rm');
      else {
        add(WB, ...[['aow_a', 'aow_rm'], ['rdw_a', 'rdw_rm'], ['rdw_a', 'rdw_byte', 'byte_rm', 'aow_a', 'aow_byte'], ['p4_w']][s.ResultSrcW]);
        if (s.ResultSrcW === 2) e.add('byte');
      }
      if (s.RegWriteW && s.WA3W !== 15) add(WB, 'res_b', 'res_rf', 'wa3w');
    }
  }

  const wires = new Set();
  for (const set of Object.values(stages)) for (const w of set) wires.add(w);
  return { wires, elements: e, stages };
}
