// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
const ROWS = ['PCSrc', 'RegWrite', 'MemtoReg', 'MemWrite', 'ALUControl', 'ALUSrc', 'Branch', 'FlagWrite'];
const ROWS_EXT = [...ROWS, 'NoWrite', 'ShiftCtl'];
const LOGICAL = new Set([0, 1, 8, 9, 12, 13, 14, 15]);
export function pipePaths(c, ext = false) {
 const s = c.signals;
 const live = c.live;
 const stages = { IF: new Set(), ID: new Set(), EX: new Set(), MEM: new Set(), WB: new Set(), fwd: new Set() };
 const e = new Set(['pc', 'imem', 'add4', 'brm', 'fd', 'de', 'de_c', 'em', 'em_c', 'mw', 'mw_c', 'hz', ...(ext ? ['fd_p'] : [])]);
 const add = (set, ...ids) => ids.forEach((id) => set.add(id));
 const IF = stages.IF;
 add(IF, 'pc_a', 'pc_imem', 'imem_fd', 'pc_add4', 'add4_a', 'brm_pc', ...(ext ? ['pc4_b', 'pc4_fd'] : []));
 if (s.BranchTakenE) { add(stages.EX, 'alu_a', 'alu_brm'); }
 else {
 add(IF, 'pcm_brm');
 e.add('pcm');
 if (s.PCSrcW) add(stages.WB, 'res_a', 'res_b', 'res_pcm');
 else add(IF, 'pc4_pcm');
 }
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
 const logicalFlags = LOGICAL.has(s.ALUControlE) && s.FlagWriteE && !s.BranchE && !s.MemWriteE && s.ResultSrcE === 0;
 if (s.ALUControlE === 5 || s.ALUControlE === 6 || logicalFlags) add(EX, 'flags_dn', 'flags_alu');
 if (logicalFlags) add(EX, 'shc_alu');
 if (s.ResultSrcE === 0b11 && regWrite) EX.add('p4_e');
 }
 }
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
