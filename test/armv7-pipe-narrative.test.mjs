// armv7-pipe-narrative.test.mjs -- the narrative of each pipeline stage (src/arch/armv7/uarch/pipe-narrative.js; roadmap
// ARM-A6): every stage has a line in every cycle of the base templates and of an Extended program, with no missing
// value; the load-use stall, forwarding, a taken branch with its flushes, a failed condition, a write-back and the end are
// each told in their own words.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assemble } from '../src/arch/armv7/language.js';
import { ArmPipe } from '../src/arch/armv7/uarch/pipe.js';
import { ArmPipeExt } from '../src/arch/armv7/uarch/pipe-ext.js';
import { stageNarrative } from '../src/arch/armv7/uarch/pipe-narrative.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const load = (text, ext = false) => {
  const p = assemble([{ name: 't.s', text }], { profile: 'arm-pipe', subset: ext ? 'extended' : null });
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const m = ext ? new ArmPipeExt({ hazard: 'full' }) : new ArmPipe({ hazard: 'full' });
  m.load(p);
  return m;
};
const text = (n) => n.map((x) => `${x.stage}: ${x.lines.map((l) => `${l.rtn} | ${l.val ?? ''}`).join(' / ')}`).join('\n');
/** Every cycle's narrative, as text, to the end. */
function cycles(m, ext) {
  const out = [];
  for (let k = 0; k < 2000; k++) {
    const n = stageNarrative(m.evaluate(), { ext, name: (st) => st });
    assert.deepEqual(n.map((x) => x.stage), ['IF', 'ID', 'EX', 'MEM', 'WB']);
    for (const x of n) assert.ok(x.lines.length, `cycle ${m.cycle}, ${x.stage}: no line`);
    const t = text(n);
    assert.doesNotMatch(t, /undefined|NaN|null/, `cycle ${m.cycle}:\n${t}`);
    out.push(t);
    const r = m.step();
    if (r !== 'step') { assert.equal(r, 'halt', m.error); break; }
  }
  return out;
}

test('every stage is told in every cycle: the base templates and an Extended program', () => {
  for (const f of ['base-sum.s', 'fig-7-60.s']) {
    const all = cycles(load(readFileSync(`${ROOT}content/armv7/templates/${f}`, 'utf8')), false);
    assert.ok(all.length > 10, f);
    assert.match(all.at(-1), /WB: B \. : a branch to itself/, f);
  }
  const ext = 'MOV R0, #3\nMOV R1, #0\nloop: ADD R1, R1, R0, LSL #1\nSUBS R0, R0, #1\nBNE loop\nBL f\nSTR R1, [R2, #0x800]\nLDRB R3, [R2, #0x800]\n'
    + 'ADC R4, R3, #1\ndone: B done\nf: MOV PC, LR\n';
  const all = cycles(load(ext, true), true);
  assert.ok(all.some((t) => /ALUResultE ← SrcAE \+ SrcBE \+ C/.test(t)), 'ADC names the carry');
  assert.ok(all.some((t) => /ShiftResultE, the shifted WriteDataE/.test(t)), 'a shifted register operand');
  assert.ok(all.some((t) => /R14 ← ResultW = PCPlus4W/.test(t)), 'BL writes LR from PCPlus4W');
  assert.ok(all.some((t) => /R3 ← ResultW = ReadByteW/.test(t)), 'LDRB writes back the byte');
});

test('the load-use stall, forwarding, a taken branch, a failed condition and a write-back', () => {
  const m = load('SUB R0, R0, R0\nLDR R1, [R0, #0x800]\nADD R2, R1, R1\nSUBS R3, R0, R0\nADDNE R4, R4, #1\nBEQ over\nADD R5, R5, #1\n'
    + 'over: ADD R6, R2, R2\ndone: B done\n');
  const all = cycles(m, false);
  const stall = all.find((t) => /The Fetch\/Decode register keeps this instruction \(StallD = 1\)/.test(t));
  assert.ok(stall, 'the stall');
  assert.match(stall, /PCF keeps its value \(StallF = 1\)/);
  assert.match(stall, /a bubble goes into EX while this instruction waits in ID/);
  assert.doesNotMatch(stall, /FlushD = 1/);
  assert.ok(all.some((t) => /SrcAE ← ResultW \(forwarded from WB, ForwardAE = 01\)/.test(t)), 'the loaded value is forwarded from WB');
  assert.ok(all.some((t) => /SrcAE ← ALUOutM \(forwarded from MEM, ForwardAE = 10\)/.test(t)), 'a result forwarded from MEM');
  assert.ok(all.some((t) => /CondExE = 0: the gates hold/.test(t)), 'ADDNE fails');
  const taken = all.find((t) => /PCF ← ALUResultE, the branch target \(BranchTakenE = 1\)/.test(t));
  assert.ok(taken, 'BEQ is taken');
  assert.match(taken, /IF: .*PCF ← PCNext = ALUResultE \(BranchTakenE = 1\)/s);
  assert.match(taken, /IF: [^\n]*the instruction fetched now is removed/);
  assert.match(taken, /ID: [^\n]*this instruction is removed and a bubble goes into EX/);
  assert.ok(all.some((t) => /WB: R2 ← ResultW = ALUOutW \| R2 = 0x00000000 after the edge/.test(t)), 'the write-back of R2');
  assert.ok(all.some((t) => /WB: R1 ← ResultW = ReadDataW/.test(t)), 'the load writes back ReadDataW');
  assert.ok(!all.some((t) => /R5 ← ResultW/.test(t)), 'the flushed ADD R5 never writes back');
});
