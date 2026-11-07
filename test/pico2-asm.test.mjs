// The pico2 assembler (P1-M1). The main check is a round trip over the 1,882 encodings of the decoder's golden sample
// (test/fixtures/pico2-decode-golden.jsonl, checked against GNU objdump): each is disassembled, the text is assembled at the
// same address, and the result must disassemble to the same text (and be the same word, apart from encodings whose ignored
// fields the decoder does not keep). Then the pseudo-instructions, directives, expressions and the error messages.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble, disassemble, TEXT_BASE, DATA_BASE } from '../src/arch/pico2/language.js';
import { decode, OP } from '../src/arch/pico2/core/decode.js';
import { create } from '../src/arch/pico2/engine.js';
import { DEFAULT_SOURCE } from '../src/arch/pico2/index.js';

const golden = readFileSync(new URL('./fixtures/pico2-decode-golden.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const asm = (text) => assemble([{ name: 't.s', text }]);
const words = (p) => p.listing.map((r) => r.word >>> 0);

test('round trip: every legal encoding of the golden sample assembles from its disassembly to the same instruction', () => {
  let exact = 0, equivalent = 0, skipped = 0;
  for (const { w, pc } of golden) {
    const d = decode(w);
    if (d.op === OP.ILLEGAL) { skipped++; continue; }
    // the sample's addresses lie outside the SRAM: the instruction goes to an address of the same alignment, and its text (with
    // absolute branch targets) is made at that address
    const at = TEXT_BASE + (pc & 3);
    const text = disassemble(w, at);
    const p = asm(`.text\n${pc & 3 ? `.space ${pc & 3}\n` : ''}${text.replace('\t', ' ')}\n`);
    assert.ok(p.ok, `${text}: ${JSON.stringify(p.diagnostics)}`);
    const row = p.listing.at(-1);
    assert.equal(row.address, at);
    const again = disassemble(row.word, at);
    const want = (w & 3) === 3 ? w >>> 0 : w & 0xffff;
    if (row.word >>> 0 === want) exact++;
    else { equivalent++; assert.equal(again, text, `0x${want.toString(16)} ${text}`); }
  }
  assert.ok(exact > 1700, `${exact} exact, ${equivalent} equivalent, ${skipped} illegal skipped`);
});

test('pseudo-instructions expand as the RISC-V assembly manual gives them', () => {
  const cases = [
    ['nop', ['addi\tzero,zero,0']], ['mv a0, a1', ['addi\ta0,a1,0']], ['not t0, t1', ['xori\tt0,t1,-1']], ['neg a0, a1', ['sub\ta0,zero,a1']],
    ['seqz a0, a1', ['sltiu\ta0,a1,1']], ['snez a0, a1', ['sltu\ta0,zero,a1']], ['li a0, -5', ['addi\ta0,zero,-5']],
    ['li a0, 0x12345678', ['lui\ta0,0x12345', 'addi\ta0,a0,1656']], ['li a0, 0x800', ['lui\ta0,0x1', 'addi\ta0,a0,-2048']],
    ['ret', ['jalr\tzero,0(ra)']], ['jr t0', ['jalr\tzero,0(t0)']], ['jalr t0', ['jalr\tra,0(t0)']], ['csrr a0, mstatus', ['csrrs\ta0,mstatus,zero']],
    ['csrw mtvec, a0', ['csrrw\tzero,mtvec,a0']], ['csrsi mstatus, 8', ['csrrsi\tzero,mstatus,8']], ['rdcycle a0', ['csrrs\ta0,cycle,zero']],
    ['zext.b a0, a1', ['andi\ta0,a1,255']], ['c.nop', ['c.addi\tzero,0']], ['fence', ['fence\tiorw,iorw']],
  ];
  for (const [src, want] of cases) {
    const p = asm(src);
    assert.ok(p.ok, `${src}: ${JSON.stringify(p.diagnostics)}`);
    assert.deepEqual(p.listing.map((r) => r.text), want, src);
    if (want.length > 1) assert.deepEqual(p.listing.map((r) => r.part), want.map((_, i) => i));
  }
});

test('branches, jumps, la and call reach their labels; li of a large constant runs to the right value', () => {
  const p = asm(`_start: la a0, data\n call f\n li a2, 0x12345678\n beqz zero, end\n nop\nend: ebreak\nf: ret\n .data\ndata: .word 7\n`);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  assert.equal(p.symbols.data, DATA_BASE);
  const e = create(p);
  let stop; do stop = e.run({ chunk: 1000 }); while (stop === 'chunk');
  assert.equal(stop, 'halt');
  const s = e.state();
  assert.equal(s.registers.x10, DATA_BASE);
  assert.equal(s.registers.x12, 0x12345678);
  assert.equal(s.pc, p.symbols.end);
});

test('directives: words, halves, bytes, strings, alignment, space, .equ, sections; %hi and %lo', () => {
  const p = asm(`.equ N, 3\n.data\nb: .byte 1, 255, -1\n.align 2\nw: .word N+1, b\nh: .half 0x1234\ns: .asciz "hi\\n"\n.balign 4\nz: .space 8\n.text\nlui a0, %hi(w)\naddi a0, a0, %lo(w)\nebreak\n`);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const seg = p.segments.find((s) => !s.executable);
  assert.deepEqual([...seg.bytes.slice(0, 3)], [1, 255, 255]);
  assert.equal(p.symbols.w, DATA_BASE + 4);
  assert.deepEqual([...seg.bytes.slice(4, 8)], [4, 0, 0, 0]);
  assert.equal(new DataView(seg.bytes.buffer).getUint32(8, true), DATA_BASE);
  assert.deepEqual([...seg.bytes.slice(14, 18)], [104, 105, 10, 0]);
  assert.equal(p.symbols.z % 4, 0);
  const e = create(p);
  e.run({ chunk: 10 });
  assert.equal(e.state().registers.x10, p.symbols.w);
});

test('compressed and Zcmp instructions are written explicitly; their operand limits are reported', () => {
  const p = asm('c.addi a0, 4\nc.lw a1, 4(a2)\ncm.push {ra, s0-s1}, -16\ncm.mva01s s1, s2\nc.j 0x20000000\n');
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  assert.deepEqual(p.listing.map((r) => r.size), [2, 2, 2, 2, 2]);
  assert.deepEqual(p.listing.map((r) => r.text), ['c.addi\ta0,4', 'c.lw\ta1,4(a2)', 'cm.push\t{ra,s0-s1},-16', 'cm.mva01s\ts1,s2', 'c.j\t0x20000000']);
  for (const bad of ['c.lw a1, 4(t0)', 'c.addi a0, 64', 'cm.push {ra, s0-s10}, -64', 'cm.push {ra}, -12']) {
    const q = asm(bad);
    assert.equal(q.ok, false, bad);
  }
});

test('error messages: unknown mnemonic, register, range, undefined and duplicate labels, operand count; with line numbers', () => {
  const p = asm('add a0, a1\nfoo a0\naddi a0, a0, 4096\nbeq a0, a1, nowhere\nx: nop\nx: nop\naddi q9, a0, 1\nslli a0, a0, 32\n');
  assert.equal(p.ok, false);
  const by = Object.fromEntries(p.diagnostics.map((d) => [d.line, d.message]));
  assert.match(by[1], /takes 3 operands/);
  assert.match(by[2], /not a Hazard3 instruction/);
  assert.match(by[3], /out of range/);
  assert.match(by[4], /'nowhere' is not defined/);
  assert.match(by[6], /defined twice/);
  assert.match(by[7], /not a register/);
  assert.match(by[8], /out of range/);
});

test('AMO ordering suffixes and lr/sc', () => {
  const p = asm('lr.w.aq a0, (a1)\nsc.w.rl a2, a3, (a1)\namoadd.w.aqrl a0, a1, (a2)\n');
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  assert.deepEqual(p.listing.map((r) => r.text), ['lr.w.aq\ta0,(a1)', 'sc.w.rl\ta2,a3,(a1)', 'amoadd.w.aqrl\ta0,a1,(a2)']);
});

test('the default program: the sum is 150, the square 22500, and the stack is back where it started', () => {
  const p = asm(DEFAULT_SOURCE);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const e = create(p);
  let stop; do stop = e.run({ chunk: 1000 }); while (stop === 'chunk');
  assert.equal(stop, 'halt');
  const s = e.state();
  assert.equal(s.registers.x12, 150);
  assert.equal(s.registers.x10, 22500);
  assert.equal(s.registers.x13, 4, 'cpop(150): 0b10010110 has four one bits');
  assert.equal(s.registers.x2, 0x20082000);
  const total = e.peek(p.symbols.total, 4);
  assert.equal(new DataView(total.buffer).getUint32(0, true), 150);
});
