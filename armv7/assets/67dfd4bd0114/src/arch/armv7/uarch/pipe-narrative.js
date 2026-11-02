// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { STAGES } from './pipe-summary.js';
import { binary } from './signals.js';
import { ARMV7_STRINGS } from '../strings.js';
const R = ARMV7_STRINGS.pipeView.stageRtn;
const ALU_OPS = ARMV7_STRINGS.singleView.aluOps;
const ALU_EXPR_EXT = ARMV7_STRINGS.singleView.ext.aluExpr;
const h = (v) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
export function stageNarrative(c, { ext = false, name = () => '' } = {}) {
 const s = c.signals;
 const out = [];
 for (const st of STAGES) {
 const lines = [];
 const line = ([rtn, val], ...args) => lines.push({ rtn, val: val(...args) });
 if (st === 'IF') {
 line(R.fetch, h(s.PCF), h(s.InstrF));
 if (s.StallF) lines.push({ rtn: R.pcHeld });
 else line(R.pcNext(s.BranchTakenE ? R.pcFrom.branch : s.PCSrcW ? R.pcFrom.result : R.pcFrom.plus4), h(s.PCNext));
 if (s.FlushD && !s.StallD) lines.push({ rtn: R.flushD });
 } else if (!c.live[st]) {
 lines.push({ rtn: R.bubble });
 } else if (st === 'ID') {
 line(R.read(s.RA1D, s.RA2D), h(s.RD1D), h(s.RD2D));
 line(R.ext, h(s.ExtImmD));
 if (s.StallD) lines.push({ rtn: R.heldD });
 if (s.FlushE) lines.push({ rtn: s.StallD ? R.bubbleE : R.flushE });
 } else if (st === 'EX') {
 line(R.srcA(R.fwdA[s.ForwardAE]), h(s.SrcAE));
 const wd = `WriteDataE = ${R.fwdB[s.ForwardBE]}`;
 line(R.srcB(s.ALUSrcE ? R.immB : ext ? R.shifted(wd) : wd), h(s.SrcBE));
 const expr = ext ? ALU_EXPR_EXT[s.ALUControlE] : `SrcA ${ALU_OPS[s.ALUControlE]} SrcB`;
 const vals = expr.replace(/\bSrcA\b/g, h(s.SrcAE)).replace(/\bSrcB\b/g, h(s.SrcBE)).replace(/\bC\b/g, `C (${(s.FlagsE >> 1) & 1})`);
 line(R.alu(expr.replace(/\bSrcA\b/g, 'SrcAE').replace(/\bSrcB\b/g, 'SrcBE')), vals, h(s.ALUResultE));
 line(R.cond, binary(s.CondE, 4), binary(s.FlagsE, 4), s.CondExE);
 if (!s.CondExE && (s.PCSrcE || s.RegWriteE || s.MemWriteE || s.BranchE || s.FlagWriteE)) lines.push({ rtn: R.failed });
 else {
 if (s.FlagWriteE) line(R.flags, binary(s.FlagsNextE, 4));
 if (s.BranchTakenE) line(R.taken, h(s.ALUResultE));
 }
 } else if (st === 'MEM') {
 const load = ext ? s.ResultSrcM === 1 || s.ResultSrcM === 2 : s.MemtoRegM && !s.MemWriteM;
 if (s.MemWriteM) line(R.store, h(s.ALUOutM), h(s.WriteDataM));
 else if (load) line(R.load, h(s.ALUOutM), h(s.ReadDataM));
 else line(R.pass, h(s.ALUOutM));
 } else {
 const from = R.resultFrom[ext ? s.ResultSrcW : s.MemtoRegW ? 1 : 0];
 if (c.halt) lines.push({ rtn: R.halt });
 else if (s.PCSrcW) line(R.writePc(from), h(s.ResultW));
 else if (s.RegWriteW) line(R.writeReg(s.WA3W, from), h(s.ResultW));
 else lines.push({ rtn: R.noWrite });
 }
 out.push({ stage: st, who: name(st), lines });
 }
 return out;
}
