// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const PATH_CLASS = Object.freeze({
 R: 'R-type', 'I-ALU': 'I-type ALU', lw: 'lw', sw: 'sw', branch: 'branch',
 jal: 'jal', jalr: 'jalr', lui: 'lui', auipc: 'auipc',
});
const PASS = 0b1111;
export function criticalPath(d, c) {
 const arr = {};
 const from = {};
 const set = (node, delay, inputs) => {
 let best = null;
 for (const inp of inputs) if (!best || arr[inp[0]] > arr[best[0]]) best = inp;
 arr[node] = (best ? arr[best[0]] : 0) + delay;
 from[node] = best;
 };
 set('pc', d.pcq, []);
 set('instr', d.imem, [['pc', ['pc_a', 'pc_imem']]]);
 set('dec', d.dec, [['instr', ['imem_bus', 'bus_a', 'bus_b', 'bus_c']]]);
 set('ALUCtrl', d.aludec, [['dec', []]]);
 set('rs1_val', d.rf, [['instr', ['imem_bus', 'bus_a', 'bus_b', 'ins_rs1']]]);
 set('rs2_val', d.rf, [['instr', ['imem_bus', 'bus_a', 'ins_rs2']]]);
 set('imm', d.imm, [['instr', ['imem_bus', 'bus_d', 'bus_e', 'ins_imm']]]);
 set('pc_plus4', d.add, [['pc', ['pc_a', 'pc_add4']]]);
 set('src_b', d.mux, [['dec', []], c.ALUSrc ? ['imm', ['imm_bm']] : ['rs2_val', ['rd2_a', 'rd2_bm']]]);
 const aluIn = [['src_b', ['bm_alu']], ['ALUCtrl', []]];
 if (c.ALUCtrl !== PASS) aluIn.unshift(['rs1_val', ['rd1_alu']]);
 set('alu_y', d.alu, aluIn);
 set('target_base', d.mux, [['dec', []], c.TargetSrc ? ['rs1_val', ['rs1_tm']] : ['pc', ['pc_a', 'pc_tm']]]);
 set('pc_target', d.add, [['target_base', ['tm_tadd']], ['imm', ['imm_tadd']]]);
 set('PCSel', d.br, c.Branch ? [['dec', []], ['alu_y', ['alu_flags']]] : [['dec', []]]);
 set('pc_next', d.mux, [['PCSel', []], c.PCSel ? ['pc_target', ['tgt_pcm']] : ['pc_plus4', ['pc4_pcm']]]);
 set('rdata', d.dmem, [['alu_y', ['alu_a', 'alu_dm']]]);
 const resultIn = [['alu_y', ['alu_a', 'alu_rm']], ['rdata', ['dm_rm']], ['pc_plus4', ['pc4_rm']], ['pc_target', ['tgt_rm']]];
 set('result', d.mux, [['dec', []], resultIn[c.ResultSel]]);
 const endpoints = [];
 if (c.RegWrite) {
 set('RF', d.setup, [['dec', []], ['result', ['result_rf']]]);
 endpoints.push('RF');
 }
 if (c.MemWrite) {
 set('DM', d.setup, [['dec', []], ['alu_y', ['alu_a', 'alu_dm']], ['rs2_val', ['rd2_a', 'rd2_dm']]]);
 endpoints.push('DM');
 }
 if (c.Branch || c.Jump) {
 set('PC', d.setup, [['pc_next', ['pcm_pc']]]);
 endpoints.push('PC');
 }
 let end = null;
 for (const e of endpoints) if (!end || arr[e] > arr[end]) end = e;
 const path = [];
 for (let n = end; n; n = from[n]?.[0]) path.unshift({ node: n, t: arr[n], wires: from[n]?.[1] ?? [] });
 return {
 arrival: arr,
 endpoints: endpoints.map((e) => ({ end: e, delay: arr[e] })),
 critical: end ? { end, delay: arr[end], path } : null,
 };
}
export function classControl(column, tables) {
 const v = Object.fromEntries(Object.entries(column.values).map(([k, s]) => [k, parseInt(s.replace(/x/g, '0'), 2)]));
 const row = tables.alu_decoder.find((r) => r.ALUOp === column.values.ALUOp && r.funct3 === 'xxx');
 v.ALUCtrl = row ? parseInt(row.ALUCtrl, 2) : 0;
 v.PCSel = v.Jump | v.Branch;
 return v;
}
export function classTable(delays, tables) {
 const rows = tables.main_decoder.columns.map((col) => {
 const r = criticalPath(delays, classControl(col, tables));
 return { cls: col.class, label: PATH_CLASS[col.class], delay: r.critical.delay, path: r.critical.path };
 });
 const tc = Math.max(...rows.map((r) => r.delay));
 return { rows, tc, setBy: rows.filter((r) => r.delay === tc).map((r) => r.cls) };
}
export function delayMap(json) {
 return Object.fromEntries(json.delays.map((x) => [x.key, x.ps]));
}
