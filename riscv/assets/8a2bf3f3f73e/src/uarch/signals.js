// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
const ctrl = (name, width, values = null, rtl = name) => ({ name, width, kind: 'control', values, rtl });
const data = (name, width, rtl = name) => ({ name, width, kind: 'data', values: null, rtl });
export const SINGLE_SIGNALS = Object.freeze([
 ctrl('RegWrite', 1),
 ctrl('ImmSel', 3, { '000': 'I', '001': 'S', '010': 'B', '011': 'U', 100: 'J' }),
 ctrl('ALUSrc', 1, { 0: 'rs2_val', 1: 'imm' }),
 ctrl('MemWrite', 1),
 ctrl('ResultSel', 2, { '00': 'alu_y', '01': 'rdata', 10: 'pc_plus4', 11: 'pc_target' }),
 ctrl('Branch', 1, null, 'u_ctrl.Branch'),
 ctrl('Jump', 1, null, 'u_ctrl.Jump'),
 ctrl('ALUOp', 2, { '00': 'add', '01': 'sub', 10: 'funct3', 11: 'pass' }, 'u_ctrl.ALUOp'),
 ctrl('TargetSrc', 1, { 0: 'pc', 1: 'rs1_val' }),
 ctrl('ALUCtrl', 4, {
 '0000': 'add', 1000: 'sub', '0001': 'sll', '0010': 'slt', '0011': 'sltu', '0100': 'xor',
 '0101': 'srl', 1101: 'sra', '0110': 'or', '0111': 'and', 1111: 'pass',
 }),
 ctrl('BranchTaken', 1, null, 'u_ctrl.BranchTaken'),
 ctrl('PCSel', 1, { 0: 'pc_plus4', 1: 'pc_target' }),
 data('pc', 32), data('pc_plus4', 32), data('target_base', 32), data('pc_target', 32),
 data('pc_next', 32), data('instr', 32), data('op', 7), data('rs1', 5), data('rs2', 5),
 data('rd', 5), data('funct3', 3), data('funct7b5', 1), data('imm', 32),
 data('rs1_val', 32), data('rs2_val', 32), data('src_b', 32), data('alu_y', 32),
 data('zero', 1), data('lt', 1), data('ltu', 1), data('rdata', 32), data('result', 32),
]);
export const SINGLE_EXT_SIGNALS = Object.freeze([data('load_val', 32)]);
const V = {
 ImmSel: SINGLE_SIGNALS.find((s) => s.name === 'ImmSel').values,
 ALUOp: SINGLE_SIGNALS.find((s) => s.name === 'ALUOp').values,
 ALUCtrl: SINGLE_SIGNALS.find((s) => s.name === 'ALUCtrl').values,
 ResultSel: { '00': 'alu_y', '01': 'rdata', 10: 'pc_plus4', 11: 'pc_target' },
 fwd: (reg) => ({ '00': `${reg}_ex`, '01': 'result_wb', 10: 'exres_mem' }),
};
export const PIPE_SIGNALS = Object.freeze([
 ...[data('pc_if', 32), data('pc_next', 32), data('pc_plus4_if', 32), data('instr_if', 32),
 data('imm_b_if', 32), data('pc_pred_if', 32), ctrl('predict_taken', 1), ctrl('pred_if', 1)].map((s) => ({ ...s, stage: 'IF' })),
 ...[data('instr_id', 32), data('pc_id', 32), data('pc_plus4_id', 32), ctrl('pred_id', 1),
 data('op_id', 7), data('rs1_id', 5), data('rs2_id', 5), data('rd_id', 5), data('funct3_id', 3),
 data('funct7b5_id', 1), ctrl('uses_rs1', 1), ctrl('uses_rs2', 1),
 data('rs1_val_id', 32), data('rs2_val_id', 32), data('imm_id', 32),
 ctrl('RegWrite_id', 1), ctrl('ImmSel_id', 3, V.ImmSel), ctrl('ALUSrc_id', 1, { 0: 'fwd_b_ex', 1: 'imm_ex' }),
 ctrl('MemWrite_id', 1), ctrl('ResultSel_id', 2, V.ResultSel), ctrl('Branch_id', 1), ctrl('Jump_id', 1),
 ctrl('ALUOp_id', 2, V.ALUOp), ctrl('TargetSrc_id', 1, { 0: 'pc_ex', 1: 'src_a_ex' }),
 ctrl('ALUCtrl_id', 4, V.ALUCtrl)].map((s) => ({ ...s, stage: 'ID' })),
 ...[data('instr_ex', 32), data('pc_ex', 32), data('pc_plus4_ex', 32), ctrl('pred_ex', 1),
 data('rs1_ex', 5), data('rs2_ex', 5), data('rd_ex', 5), data('funct3_ex', 3),
 data('rs1_val_ex', 32), data('rs2_val_ex', 32), data('imm_ex', 32),
 ctrl('RegWrite_ex', 1), ctrl('ALUSrc_ex', 1, { 0: 'fwd_b_ex', 1: 'imm_ex' }), ctrl('MemWrite_ex', 1),
 ctrl('ResultSel_ex', 2, V.ResultSel), ctrl('Branch_ex', 1), ctrl('Jump_ex', 1),
 ctrl('TargetSrc_ex', 1, { 0: 'pc_ex', 1: 'src_a_ex' }), ctrl('ALUCtrl_ex', 4, V.ALUCtrl), ctrl('MemRead_ex', 1),
 data('src_a_ex', 32), data('fwd_b_ex', 32), data('src_b_ex', 32), data('alu_y_ex', 32),
 data('zero_ex', 1), data('lt_ex', 1), data('ltu_ex', 1), ctrl('BranchTaken_ex', 1),
 data('target_base_ex', 32), data('target_sum_ex', 32), data('pc_target_ex', 32),
 ctrl('taken_ex', 1), ctrl('PCSel_ex', 1, { 0: 'prediction', 1: 'pc_redirect_ex' }),
 data('pc_redirect_ex', 32), data('exres_ex', 32)].map((s) => ({ ...s, stage: 'EX' })),
 ...[data('instr_mem', 32), data('exres_mem', 32), data('store_data_mem', 32), data('rd_mem', 5),
 ctrl('RegWrite_mem', 1), ctrl('MemWrite_mem', 1), ctrl('ResultSel_mem', 2, V.ResultSel),
 ctrl('MemRead_mem', 1), data('rdata_mem', 32)].map((s) => ({ ...s, stage: 'MEM' })),
 ...[data('instr_wb', 32), data('exres_wb', 32), data('rdata_wb', 32), data('rd_wb', 5),
 ctrl('RegWrite_wb', 1), ctrl('ResultSel_wb', 2, V.ResultSel), data('result_wb', 32)].map((s) => ({ ...s, stage: 'WB' })),
 ...[ctrl('fwd_sel_a', 2, V.fwd('rs1_val')), ctrl('fwd_sel_b', 2, V.fwd('rs2_val')),
 ctrl('stall_if', 1), ctrl('stall_id', 1), ctrl('flush_id', 1), ctrl('flush_ex', 1)].map((s) => ({ ...s, stage: 'hazard' })),
]);
export const PIPE_EXT_SIGNALS = Object.freeze([
 { ...data('pc_seq_if', 32, null), stage: 'IF' },
 ...[ctrl('fwd_id_a', 2, { '00': 'rs1_val_id', 10: 'exres_mem' }, null), ctrl('fwd_id_b', 2, { '00': 'rs2_val_id', 10: 'exres_mem' }, null),
 data('cmp_a_id', 32, null), data('cmp_b_id', 32, null), ctrl('BranchTaken_id', 1, null, null), data('pc_target_id', 32, null),
 ctrl('taken_id', 1, null, null), ctrl('PCSel_id', 1, { 0: 'pc_seq_if', 1: 'pc_redirect_id' }, null),
 data('pc_redirect_id', 32, null)].map((s) => ({ ...s, stage: 'ID', extension: true })),
]);
export const SIGNAL_INFO = Object.freeze(Object.fromEntries(
 [...SINGLE_SIGNALS, ...SINGLE_EXT_SIGNALS, ...PIPE_SIGNALS, ...PIPE_EXT_SIGNALS].map((s) => [s.name, s])));
export const MC_STATES = Object.freeze(['FETCH', 'DECODE', 'ADDR', 'MEMRD', 'LOADWB', 'MEMWR', 'EXEC_R', 'EXEC_I',
 'ALUWB', 'BRANCH', 'JAL', 'JALR', 'LUI', 'AUIPC']);
const stateCodes = Object.fromEntries(MC_STATES.map((s, i) => [binary(i, 4), s]));
export const MULTI_SIGNALS = Object.freeze([
 ctrl('state', 4, stateCodes), ctrl('next', 4, stateCodes, 'u_ctrl.u_fsm.next'),
 ctrl('PCWrite', 1, null, 'u_ctrl.PCWrite'), ctrl('Branch', 1, null, 'u_ctrl.Branch'), ctrl('IRWrite', 1),
 ctrl('AddrSel', 1, { 0: 'pc', 1: 'alu_q' }), ctrl('MemWrite', 1), ctrl('RegWrite', 1),
 ctrl('ALUSrcA', 2, { '00': 'pc', '01': 'instr_pc', 10: 'rs1_q' }),
 ctrl('ALUSrcB', 2, { '00': 'rs2_q', '01': '4', 10: 'imm' }),
 ctrl('ALUOp', 2, SINGLE_SIGNALS.find((s) => s.name === 'ALUOp').values, 'u_ctrl.ALUOp'),
 ctrl('ResultSel', 2, { '00': 'alu_q', '01': 'mdr', 10: 'alu_y', 11: 'pc' }),
 ctrl('ImmSel', 3, SINGLE_SIGNALS.find((s) => s.name === 'ImmSel').values),
 ctrl('ALUCtrl', 4, SINGLE_SIGNALS.find((s) => s.name === 'ALUCtrl').values),
 ctrl('BranchTaken', 1, null, 'u_ctrl.BranchTaken'), ctrl('PCEn', 1),
 data('pc', 32), data('instr_pc', 32), data('ir', 32), data('op', 7), data('rd', 5), data('funct3', 3),
 data('rs1', 5), data('rs2', 5), data('funct7b5', 1), data('addr', 32), data('rdata', 32), data('mdr', 32),
 data('rs1_val', 32), data('rs2_val', 32), data('rs1_q', 32), data('rs2_q', 32), data('imm', 32),
 data('src_a', 32), data('src_b', 32), data('alu_y', 32), data('zero', 1), data('lt', 1), data('ltu', 1),
 data('alu_q', 32), data('result', 32), data('pc_next', 32),
]);
export const MULTI_INFO = Object.freeze(Object.fromEntries(MULTI_SIGNALS.map((s) => [s.name, s])));
export function binary(value, width) {
 return (value >>> 0).toString(2).padStart(width, '0').slice(-width);
}
export function meaning(name, value, info = SIGNAL_INFO) {
 const s = info[name];
 if (!s?.values) return null;
 return s.values[binary(value, s.width)] ?? null;
}
