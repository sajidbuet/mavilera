// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
const PASS = 0b1111;
const OP_R = 0b0110011;
const OP_LUI = 0b0110111;
const OP_AUIPC = 0b0010111;
const OP_JAL = 0b1101111;
export function pipePaths(s, { predictor = false, early = false } = {}) {
 const stages = { IF: new Set(), ID: new Set(), EX: new Set(), MEM: new Set(), WB: new Set(), fwd: new Set() };
 const e = new Set();
 const IF = stages.IF;
 IF.add('pcm_pc').add('pc_a').add('pc_imem').add('imem_r1').add('pc_add4').add('pc4_r1').add('pc_r1');
 if (s.PCSel_ex) IF.add('tgt_pcm');
 else if (!s.PCSel_id && !predictor) IF.add('pc4_pcm');
 else if (!s.PCSel_id) {
 IF.add('pm_pcm');
 e.add('pm');
 if (s.pred_if) { IF.add('padd_pm').add('pc_padd').add('immb_padd').add('imem_immb'); e.add('padd').add('immb'); }
 else IF.add('pc4_pm');
 }
 if (predictor) e.add('pm');
 ['pcm', 'pc', 'imem', 'add4', 'r1', 'r2', 'r3', 'r4'].forEach((x) => e.add(x));
 if (s.instr_id !== 0) {
 const op = s.op_id;
 const id = stages.ID;
 id.add('ins_a').add('ins_b').add('ins_dec').add('ins_c').add('pc4_id').add('pc_id').add('ctl_id');
 e.add('dec');
 if (s.uses_rs1) { id.add('ins_rs1').add('rd1_r2'); e.add('rf'); }
 if (s.uses_rs2) { id.add('ins_rs2').add('rd2_r2'); e.add('rf'); }
 if (op !== OP_R) { id.add('ins_imm').add('imm_r2'); e.add('imm'); }
 if (s.RegWrite_id) id.add('ins_rd');
 }
 if (s.instr_ex !== 0) {
 const ex = stages.EX;
 const op = s.instr_ex & 0x7f;
 const usesA = !(op === OP_LUI || op === OP_AUIPC || op === OP_JAL);
 const branchEx = s.Branch_ex && !early;
 const target = branchEx || (s.Jump_ex && !early) || s.ResultSel_ex === 0b11;
 const aluUsed = branchEx || s.MemWrite_ex || (s.RegWrite_ex && s.ResultSel_ex <= 0b01);
 const feed = (sel, reg, mux) => {
 if (sel === 0b10) stages.fwd.add('mem_up').add(`mem_${mux}`);
 else if (sel === 0b01) stages.fwd.add('wb_up').add(`wb_${mux}`);
 else ex.add(reg);
 };
 const srcA = () => { feed(s.fwd_sel_a, 'rs1_fa', 'fa'); e.add('fa'); };
 const srcB = () => { feed(s.fwd_sel_b, 'rs2_fb', 'fb'); ex.add('fb_out'); e.add('fb'); };
 ex.add('ctl_ex');
 if (aluUsed) {
 ex.add('bm_alu').add('alu_a');
 e.add('alu').add('bm');
 if (s.ALUCtrl_ex !== PASS && usesA) { srcA(); ex.add('fa_alu'); }
 if (s.ALUSrc_ex) ex.add('imm_bm'); else { srcB(); ex.add('fwdb_bm'); }
 }
 if (branchEx) { ex.add('alu_flags'); e.add('bc'); }
 if (s.MemWrite_ex) { srcB(); ex.add('store_r3'); }
 if (target) {
 ex.add('tm_tadd').add('imm_tadd').add('tadd_a');
 e.add('tm').add('tadd');
 if (s.TargetSrc_ex) { srcA(); ex.add('rs1_tm'); } else ex.add('pc_tm');
 }
 if (s.RegWrite_ex || s.MemWrite_ex) {
 ex.add('xm_r3');
 e.add('xm');
 ex.add(['alu_xm', 'alu_xm1', 'pc4_xm', 'tgt_xm'][s.ResultSel_ex]);
 }
 if (s.RegWrite_ex) ex.add('rd_ex');
 }
 if (s.instr_mem !== 0) {
 const mem = stages.MEM;
 if (s.RegWrite_mem) mem.add('ctl_mem').add('rd_mem');
 if (s.MemRead_mem || s.MemWrite_mem) { mem.add('exres_dm'); e.add('dm'); }
 if (s.MemWrite_mem) mem.add('store_dm');
 if (s.MemRead_mem && s.RegWrite_mem) mem.add('dm_r4');
 else if (s.RegWrite_mem) mem.add('exres_r4');
 }
 if (s.instr_wb !== 0 && s.RegWrite_wb) {
 stages.WB.add(s.ResultSel_wb === 0b01 ? 'rdata_rm' : 'exres_rm').add('result_rf').add('rd_rf');
 e.add('rm').add('rf');
 }
 const wires = new Set();
 for (const set of Object.values(stages)) for (const w of set) wires.add(w);
 return { wires, elements: e, stages };
}
