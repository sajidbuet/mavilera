// armv7/uarch/timing.js -- the critical path of an ARM single-cycle instruction (roadmap ARM-A2; spec W-D35), for the
// base design and the Extended datapath, with the rules of the platform's single-cycle timing (the RISC-V view's):
//   1. an output is valid its delay after the last of the inputs it uses becomes valid; a select counts as an input;
//   2. every path starts at a register: the PC and the flags are valid t_pcq after the edge; the Main Decoder's
//      outputs follow the instruction, the ALU Decoder's t_aludec later, the Condition Check's CondEx follows Cond and
//      the flags, and each gated write enable is an AND gate after CondEx and its request;
//   3. a path ends at the input of a clocked element, t_setup before the next edge: the register file (a write), the
//      data memory (a store), the flags (FlagWrite) and the PC, which is loaded in every cycle.
// Wire delays are ignored. The delays are illustrative (content/armv7/data/single-delays.json; not Harris's Table 7.5,
// W-D32 Q9). Each edge names the drawing's connections it runs along, so that the view can draw the path. Pure.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/**
 * Arrival times and the critical path of one instruction.
 * @param {object} d delays by key (single-delays.json)
 * @param {object} s the cycle's signals (or a class's: uarch/single.js, single-ext.js)
 * @param {boolean} ext the Extended datapath
 * @returns {{arrival: object, endpoints: {end: string, delay: number}[], critical: {end, delay, path: {node, t, wires}[]} | null}}
 */
export function criticalPath(d, s, ext = false) {
  const arr = {};
  const from = {};
  const set = (node, delay, inputs) => {
    let best = null;
    for (const inp of inputs) if (inp && (!best || arr[inp[0]] > arr[best[0]])) best = inp;
    arr[node] = (best ? arr[best[0]] : 0) + delay;
    from[node] = best;
  };
  const r15 = (n) => n === 15;
  set('PC', d.pcq, []);
  set('Flags', d.pcq, []);
  set('Instr', d.imem, [['PC', ['pc_a', 'pc_imem']]]);
  set('Decoder', d.dec, [['Instr', ['imem_bus', 'bus_up1', 'bus_up2', ext ? 'ins_ctl_x' : 'ins_ctl']]]);
  set('ALUControl', d.aludec, [['Decoder', []]]);
  set('CondEx', d.cond, [['Instr', ['imem_bus', 'bus_up1', 'bus_up2', 'ins_cond']], ['Flags', ['flags_cc']]]);
  set('PCPlus4', d.add, [['PC', ['pc_a', 'pc_add4']]]);
  set('PCPlus8', d.add, [['PCPlus4', ['pc4_a', 'pc4_add8']]]);
  set('RA1', d.mux, [['Decoder', []], s.RegSrc & 1 ? null : ['Instr', ['imem_bus', 'bus_up1', 'ins_rn']]]);
  set('RA2', d.mux, [['Decoder', []], ['Instr', s.RegSrc & 2 ? ['imem_bus', 'bus_dn1', 'ins_rd_a', 'rd_ra2m'] : ['imem_bus', 'ins_rm']]]);
  set('SrcA', d.rf, [['RA1', ['ra1m_rf']], r15(s.RA1) ? ['PCPlus8', ['pc8_rf']] : null]);
  set('WriteData', d.rf, [['RA2', ['ra2m_rf']], r15(s.RA2) ? ['PCPlus8', ['pc8_rf']] : null]);
  set('ExtImm', d.ext, [['Decoder', []], ['Instr', ['imem_bus', 'bus_dn1', 'bus_dn2', 'ins_imm']]]);
  let operandB = ['WriteData', ['rd2_a', 'rd2_bm']];
  if (ext) {
    set('ShiftResult', d.shift, [['Decoder', []], ['WriteData', ['rd2_a', 'rd2_sh']], ['Flags', ['flags_dn']]]);
    operandB = ['ShiftResult', ['sh_bm']];
  }
  set('SrcB', d.mux, [['Decoder', []], s.ALUSrc ? ['ExtImm', ['ext_bm']] : operandB]);
  set('ALUResult', d.alu, [['SrcA', ['rd1_alu']], ['SrcB', ['bm_alu']], ['ALUControl', []],
    ...(ext ? [['Flags', ['flags_dn', 'flags_alu']], s.ALUSrc ? null : ['ShiftResult', ['shc_alu']]] : [])]);
  set('ReadData', d.dmem, [['ALUResult', ['alu_a', 'alu_dm']]]);
  let resultIn;
  if (ext) {
    set('ReadByte', d.byte, [['ReadData', ['dm_a', 'dm_byte']], ['ALUResult', ['alu_a', 'alu_up', 'alu_byte']]]);
    resultIn = [['ALUResult', ['alu_a', 'alu_up', 'alu_rm4']], ['ReadData', ['dm_a', 'dm_rm4']], ['ReadByte', ['byte_rm4']],
      ['PCPlus4', ['pc4_a', 'pc4_rm4']]][s.ResultSrc];
  } else resultIn = s.MemtoReg ? ['ReadData', ['dm_rm']] : ['ALUResult', ['alu_a', 'alu_rm']];
  set('Result', d.mux, [['Decoder', []], resultIn]);
  // the gated enables: RegWrite also waits for NoWrite (the ALU Decoder) in the Extended datapath
  set('RegWrite', d.gate, [['CondEx', ['condex', ext ? 'condex_regw3' : 'condex_regw']], [ext ? 'ALUControl' : 'Decoder', []]]);
  set('MemWrite', d.gate, [['CondEx', ['condex', 'condex_memw']], ['Decoder', []]]);
  set('FlagWrite', d.gate, [['CondEx', ['condex', 'condex_flagw']], ['ALUControl', []]]);
  set('PCSrc', d.gate, [['CondEx', ['condex']], ['Decoder', []]]);
  let next = ['Result', ext ? ['res_a', 'res_tgm'] : ['res_a', 'res_pcm']];
  if (ext) {
    set('PCTarget', d.mux, [['Decoder', []], s.Branch ? ['ALUResult', ['alur_tgm']] : ['Result', ['res_a', 'res_tgm']]]);
    next = ['PCTarget', ['tgm_pcm']];
  }
  set('PCNext', d.mux, [['PCSrc', []], s.PCSrc ? next : ['PCPlus4', ['pc4_a', 'pc4_pcm']]]);

  const endpoints = [];
  const end = (name, inputs) => { set(name, d.setup, inputs); endpoints.push(name); };
  const wa3 = ext ? s.WA3 : s.Rd;
  if (s.RegWrite && wa3 !== 15) {
    end('register file', [['RegWrite', []], ['Result', ['res_a', 'res_rf']],
      ...(ext ? [[s.Link ? 'Decoder' : 'Instr', s.Link ? [] : ['imem_bus', 'bus_dn1', 'ins_rd_a', 'rd_wa3m', 'wa3m_rf']]] : [])]);
  }
  if (s.MemWrite) end('data memory', [['MemWrite', []], ['ALUResult', ['alu_a', 'alu_dm']], ['WriteData', ['rd2_a', 'rd2_dm']]]);
  if (s.FlagWrite) end('flags', [['FlagWrite', []], ['ALUResult', ['alu_flags']]]);
  end('PC register', [['PCNext', ['pcm_pc']]]); // not 'PC': that node is the start of every path
  let last = null;
  for (const e of endpoints) if (!last || arr[e] > arr[last]) last = e;
  const path = [];
  for (let n = last; n; n = from[n]?.[0]) path.unshift({ node: n, t: arr[n], wires: from[n]?.[1] ?? [] });
  return { arrival: arr, endpoints: endpoints.map((e) => ({ end: e, delay: arr[e] })), critical: { end: last, delay: arr[last], path } };
}

/** The signals of a Main Decoder row with the condition passed, for the per-class table (rows of single.js or single-ext.js). */
export function classSignals(row, outputs) {
  const s = Object.fromEntries(outputs.map((k) => [k, row[k]]));
  const branch = row.cls === 'b' || row.cls === 'bl';
  const dp = row.cls === 'dpReg' || row.cls === 'dpImm';
  return { ...s, RA1: branch ? 15 : 1, RA2: row.cls === 'dpReg' ? 2 : 3, Rd: 3, WA3: s.Link ? 14 : 3, CondEx: 1, RegWrite: s.RegW,
    MemWrite: s.MemW, PCSrc: s.Branch, FlagWrite: dp ? 0b11 : 0, ALUControl: 0 };
}

/** The critical path of every class of a Main Decoder, and the clock period they set. */
export function classTable(delays, main, outputs, ext = false) {
  const rows = main.map((row) => {
    const r = criticalPath(delays, classSignals(row, outputs), ext);
    return { cls: row.cls, delay: r.critical.delay, path: r.critical.path };
  });
  const tc = Math.max(...rows.map((r) => r.delay));
  return { rows, tc, setBy: rows.filter((r) => r.delay === tc).map((r) => r.cls) };
}

/** Delays by key from content/armv7/data/single-delays.json. */
export function delayMap(json) {
  return Object.fromEntries(json.delays.map((x) => [x.key, x.ps]));
}
