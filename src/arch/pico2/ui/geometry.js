// geometry.js -- the drawing of the pico2 pipeline view (P1-M3; design docs/architecture/pico2-p1m3-pipeline.md §5): Hazard3's
// three stages F, X and M and the register written after M, left to right, with the elements the stage model can fill
// (R-HZ-01 "Implications"): no prefetch FIFO or instruction buffer (decision Q2). The simulator's own drawing (C4): it copies
// no figure of the Hazard3 documentation, the datasheet or the textbook. Coordinates in the SVG's user units; pure data.
// Layout: units in columns per stage; the paths back to F (jump, trap, BTB update) and the paths back to X (register write,
// forwarding from after M) run in lanes below the units; forwarding from M runs in a lane above the X units.
// Approved by the author on 2026-11-06 (decision Q6), as drawn.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const VIEW = Object.freeze({ w: 1240, h: 640 });

/** Stage bands: id and x range (titles in strings.js pipeline.stages). */
export const BANDS = Object.freeze([
  { id: 'F', x: 8, w: 250 }, { id: 'X', x: 284, w: 552 }, { id: 'M', x: 862, w: 206 }, { id: 'W', x: 1092, w: 142 },
]);
/** Pipeline registers between the stages (thin vertical bars). */
export const BARS = Object.freeze([
  { id: 'FX', x: 262, y: 44, w: 16, h: 512 }, { id: 'XM', x: 842, y: 44, w: 16, h: 512 }, { id: 'MW', x: 1072, y: 44, w: 16, h: 512 },
]);

/**
 * Units: id, stage, box, and the lines of values they show (signal names of the stage model, or keys the view fills).
 * `mux: true` draws a multiplexer (trapezoid) whose inputs are listed in `inputs` at the y offsets `inY`.
 */
export const UNITS = Object.freeze([
  // F
  { id: 'FETCH', stage: 'F', x: 20, y: 56, w: 220, h: 104, lines: ['fPc', 'fInstr', 'fState'] },
  { id: 'NPC', stage: 'F', x: 20, y: 214, w: 220, h: 70, lines: ['npcSource'] },
  { id: 'BTB', stage: 'F', x: 20, y: 330, w: 220, h: 70, lines: ['btb_src_addr', 'btb_valid'] },
  // X
  { id: 'DEC', stage: 'X', x: 296, y: 56, w: 300, h: 104, lines: ['d_pc', 'xInstr', 'd_regs', 'xState'] },
  { id: 'RF', stage: 'X', x: 296, y: 196, w: 92, h: 224, lines: ['rs1', 'rs2'] },
  { id: 'BYP1', stage: 'X', x: 420, y: 205, w: 40, h: 80, mux: true, inputs: ['regs', 'xm', 'mw', 'zero'], inY: [16, 32, 48, 64], lines: ['x_rs1_bypass'] },
  { id: 'BYP2', stage: 'X', x: 420, y: 315, w: 40, h: 80, mux: true, inputs: ['regs', 'xm', 'mw', 'zero'], inY: [16, 32, 48, 64], lines: ['x_rs2_bypass'] },
  { id: 'ALU', stage: 'X', x: 500, y: 196, w: 124, h: 66, lines: ['aluOp'] },
  { id: 'ADDR', stage: 'X', x: 500, y: 282, w: 124, h: 56, lines: ['addrUse'] },
  { id: 'CMP', stage: 'X', x: 500, y: 356, w: 124, h: 56, lines: ['branch'] },
  { id: 'MULDIV', stage: 'X', x: 668, y: 250, w: 150, h: 52, lines: ['x_stall_muldiv'] },
  { id: 'CSR', stage: 'X', x: 668, y: 314, w: 150, h: 44, lines: ['csr'] },
  { id: 'AMO', stage: 'X', x: 668, y: 370, w: 150, h: 40, lines: ['x_stall_on_amo'] },
  { id: 'CTRL', stage: 'X', x: 480, y: 440, w: 338, h: 104, lines: ['x_stall', 'stallCause', 'x_jump_req', 'x_branch_was_predicted', 'x_btb_set'] },
  // M
  { id: 'DBUS', stage: 'M', x: 870, y: 56, w: 192, h: 84, lines: ['busAddr', 'busDir'] },
  { id: 'RES', stage: 'M', x: 870, y: 180, w: 192, h: 92, lines: ['xm_rd', 'm_result', 'm_reg_wen'] },
  { id: 'STD', stage: 'M', x: 870, y: 310, w: 192, h: 56, lines: ['storeData'] },
  { id: 'TRAP', stage: 'M', x: 870, y: 444, w: 192, h: 84, lines: ['m_trap_enter_vld', 'm_trap_is_irq', 'trapTo'] },
  // after M
  { id: 'MW', stage: 'W', x: 1100, y: 180, w: 126, h: 76, lines: ['mw_rd', 'mw_result'] },
]);

/**
 * Wires: id, points, an optional label at `at` (text start), and `kind`: 'data' (default), 'ctrl' (thin, dashed) or 'fwd'
 * (a forwarding path). An arrowhead at the last point unless `noHead`. `units`: the units it joins (for highlighting).
 */
export const WIRES = Object.freeze([
  // F
  { id: 'npcToFetch', pts: [[130, 214], [130, 160]], label: 'pc', at: [136, 192] },
  { id: 'btbToNpc', pts: [[130, 330], [130, 284]], kind: 'ctrl', label: 'predicted target', at: [136, 312] },
  { id: 'fetchToBar', pts: [[240, 100], [262, 100]] },
  { id: 'barToDec', pts: [[278, 100], [296, 100]] },
  { id: 'predecode', pts: [[240, 146], [250, 146], [250, 221], [296, 221]], kind: 'ctrl', label: 'rs1, rs2', at: [178, 198] },
  // X: register file, bypass, functional units
  { id: 'rf1', pts: [[388, 221], [420, 221]] },
  { id: 'rf2', pts: [[388, 331], [420, 331]] },
  { id: 'byp1Alu', pts: [[460, 245], [475, 245], [475, 216], [500, 216]], label: 'rs1', at: [462, 238] },
  { id: 'byp1Addr', pts: [[475, 245], [475, 300], [500, 300]], noHead: false },
  { id: 'byp1Cmp', pts: [[475, 300], [475, 372], [500, 372]] },
  { id: 'byp2Alu', pts: [[460, 355], [490, 355], [490, 244], [500, 244]], label: 'rs2', at: [462, 349] },
  { id: 'byp2Cmp', pts: [[490, 355], [490, 396], [500, 396]] },
  { id: 'decImm', pts: [[560, 160], [560, 196]], kind: 'ctrl', label: 'imm, pc', at: [566, 188] },
  { id: 'aluOut', pts: [[624, 228], [842, 228]], label: 'x_alu_result', at: [660, 222] },
  { id: 'mdOut', pts: [[818, 276], [842, 276]] },
  { id: 'csrOut', pts: [[818, 336], [842, 336]] },
  { id: 'addrOut', pts: [[624, 300], [650, 300], [650, 98], [870, 98]], label: 'x_addr_sum (address phase)', at: [658, 92] },
  { id: 'target', pts: [[624, 326], [638, 326], [638, 440]], kind: 'ctrl' },
  { id: 'taken', pts: [[540, 412], [540, 440]], kind: 'ctrl' },
  { id: 'storeData', pts: [[490, 396], [490, 428], [864, 428], [864, 338], [870, 338]], label: 'store data', at: [672, 424] },
  // into and out of M
  { id: 'xmToRes', pts: [[858, 228], [870, 228]] },
  { id: 'xmToTrap', pts: [[858, 486], [870, 486]], kind: 'ctrl' },
  { id: 'busLoad', pts: [[966, 140], [966, 180]], label: 'load data', at: [972, 164] },
  { id: 'resToBar', pts: [[1062, 220], [1072, 220]] },
  { id: 'barToMw', pts: [[1088, 220], [1100, 220]] },
  // paths back
  { id: 'fwdXm', pts: [[842, 176], [405, 176], [405, 237], [420, 237]], kind: 'fwd', label: 'xm_result', at: [660, 170] },
  { id: 'fwdXm2', pts: [[405, 237], [405, 347], [420, 347]], kind: 'fwd' },
  { id: 'fwdMw', pts: [[1163, 256], [1163, 604], [412, 604], [412, 363], [420, 363]], kind: 'fwd', label: 'mw_result', at: [880, 601] },
  { id: 'fwdMw2', pts: [[412, 363], [412, 253], [420, 253]], kind: 'fwd' },
  { id: 'fwdMwStd', pts: [[1163, 352], [1062, 352]], kind: 'fwd' },
  { id: 'regWrite', pts: [[966, 272], [966, 292], [1067, 292], [1067, 620], [286, 620], [286, 400], [296, 400]], label: 'write rd at the end of M (m_reg_wen)', at: [420, 617] },
  { id: 'btbSet', pts: [[740, 544], [740, 556], [130, 556], [130, 400]], kind: 'ctrl', label: 'x_btb_set', at: [150, 553] },
  { id: 'jumpToF', pts: [[600, 544], [600, 572], [248, 572], [248, 260], [240, 260]], kind: 'ctrl', label: 'x_jump_req, target', at: [420, 569] },
  { id: 'trapToF', pts: [[870, 510], [866, 510], [866, 588], [254, 588], [254, 238], [240, 238]], kind: 'ctrl', label: 'trap entry: mtvec (mret: mepc)', at: [620, 585] },
]);
