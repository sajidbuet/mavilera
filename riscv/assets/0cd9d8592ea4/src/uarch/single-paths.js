// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
const PASS = 0b1111;
export function activePath(c) {
 const w = new Set(['pc_a', 'pc_imem', 'imem_bus', 'pcm_pc']);
 const e = new Set(['pcm', 'pc', 'imem', 'cu']);
 const add = (...ids) => ids.forEach((id) => w.add(id));
 const rs1 = () => { add('bus_a', 'bus_b', 'ins_rs1'); e.add('rf'); };
 const rs2 = () => { add('bus_a', 'ins_rs2', 'rd2_a'); e.add('rf'); };
 const imm = () => { add('bus_d', 'bus_e', 'ins_imm'); e.add('imm'); };
 const plus4 = () => { add('pc_add4'); e.add('add4'); };
 const target = () => {
 add('tm_tadd', 'imm_tadd');
 e.add('tm').add('tadd');
 imm();
 if (c.TargetSrc) { add('rs1_tm'); rs1(); } else add('pc_tm');
 };
 const wb = c.RegWrite ? c.ResultSel : -1;
 const aluUsed = c.Branch || c.MemWrite || wb === 0 || wb === 1;
 if (c.PCSel) { add('tgt_pcm'); target(); } else { add('pc4_pcm'); plus4(); }
 if (aluUsed) {
 e.add('alu').add('bm');
 add('bm_alu');
 if (c.ALUCtrl !== PASS) { add('rd1_alu'); rs1(); }
 if (c.ALUSrc) { add('imm_bm'); imm(); } else { add('rd2_bm'); rs2(); }
 }
 if (c.Branch) add('alu_flags', 'bus_b', 'bus_c');
 if (c.MemWrite) { add('alu_a', 'alu_dm', 'rd2_dm'); rs2(); e.add('dm'); }
 if (wb >= 0) {
 add('bus_d', 'ins_rd', 'result_rf');
 e.add('rf').add('rm');
 if (wb === 0) add('alu_a', 'alu_rm');
 else if (wb === 1) { add('alu_a', 'alu_dm', 'dm_rm'); e.add('dm'); }
 else if (wb === 2) { add('pc4_rm'); plus4(); }
 else { add('tgt_rm'); target(); }
 }
 return { wires: w, elements: e };
}
