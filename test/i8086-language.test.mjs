// The 8086 assembler, disassembler and encoding table (roadmap 8086-B1): hand-checked encodings from Intel's tables
// (IFUM 9800722-03, Tables 4-7 to 4-14), assembler diagnostics, the listing word's bytes, and, when SingleStepTests/8086
// is present outside the repository, a round trip over its instruction bytes: decode, write as text, assemble the text,
// and decode again to the same instruction (an equivalent encoding counts: MOV AX,BX has two).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, disassemble, fields, describe, scratch, bytesOf, editor, CODE_BASE, MNEMONICS } from '../src/arch/i8086/language.js';
import { decodeBytes, format, FORMS, BY_OPCODE, statusOf } from '../src/arch/i8086/isa.js';
import { available, files, load, metadata, SST_DIR } from '../tools/i8086/sst.mjs';

const asm = (text, o) => assemble([{ name: 't.asm', text }], o);
const bytes = (text) => {
  const p = asm(text);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  return p.listing.flatMap((l) => bytesOf(l.word, l.address)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
};

test('i8086: encodings of the documented forms (IFUM Tables 4-12, 4-13)', () => {
  const cases = [
    ['MOV AX, 1234H', 'b8 34 12'], ['MOV AL, 12H', 'b0 12'], ['MOV BX, CX', '89 cb'], ['MOV CL, [BX+SI]', '8a 08'],
    ['MOV [BX+SI+12H], AL', '88 40 12'], ['MOV [BP+1234H], DX', '89 96 34 12'], ['MOV AX, [1234H]', 'a1 34 12'],
    ['MOV [1234H], AL', 'a2 34 12'], ['MOV BYTE PTR [BX], 7', 'c6 07 07'], ['MOV WORD PTR [DI-2], 0FFFFH', 'c7 45 fe ff ff'],
    ['MOV DS, AX', '8e d8'], ['MOV AX, ES', '8c c0'], ['MOV ES:[BX], CS', '26 8c 0f'], ['MOV AL, ES:[DI]', '26 8a 05'],
    ['MOV [BP], AL', '88 46 00'],
    ['ADD AX, 5', '05 05 00'], ['ADD CX, 5', '83 c1 05'], ['ADD AL, 5', '04 05'], ['ADD AX, 1234H', '05 34 12'], ['ADD BX, 1234H', '81 c3 34 12'],
    ['ADD BX, -1', '83 c3 ff'], ['SUB WORD PTR [SI], 80H', '81 2c 80 00'], ['CMP BYTE PTR [BX], 0', '80 3f 00'],
    ['AND AL, 0FH', '24 0f'], ['TEST AL, 1', 'a8 01'], ['TEST CX, DX', '85 d1'], ['TEST DX, CX', '85 ca'],
    ['XCHG AX, BX', '93'], ['XCHG BX, AX', '93'], ['XCHG AL, AH', '86 e0'],
    ['INC AX', '40'], ['INC AL', 'fe c0'], ['DEC WORD PTR [BX]', 'ff 0f'], ['NEG AL', 'f6 d8'], ['NOT BYTE PTR [SI]', 'f6 14'],
    ['MUL BL', 'f6 e3'], ['IMUL CX', 'f7 e9'], ['DIV WORD PTR [BX]', 'f7 37'], ['IDIV BL', 'f6 fb'],
    ['SHL AX, 1', 'd1 e0'], ['SAL AX, 1', 'd1 e0'], ['SHR BYTE PTR [BX], CL', 'd2 2f'], ['SAR DX, CL', 'd3 fa'], ['RCL AL, 1', 'd0 d0'],
    ['PUSH AX', '50'], ['PUSH ES', '06'], ['PUSH WORD PTR [BX]', 'ff 37'], ['POP DS', '1f'], ['POP WORD PTR [BX]', '8f 07'],
    ['LEA SI, [BX+DI+10H]', '8d 71 10'], ['LDS SI, [BX]', 'c5 37'], ['LES DI, DWORD PTR [BX]', 'c4 3f'],
    ['IN AL, 60H', 'e4 60'], ['IN AX, DX', 'ed'], ['OUT 0E9H, AL', 'e6 e9'], ['OUT DX, AX', 'ef'],
    ['INT 21H', 'cd 21'], ['INT 3', 'cc'], ['INTO', 'ce'], ['IRET', 'cf'], ['RET', 'c3'], ['RET 4', 'c2 04 00'], ['RETF', 'cb'],
    ['AAM', 'd4 0a'], ['AAD', 'd5 0a'], ['DAA', '27'], ['CBW', '98'], ['CWD', '99'], ['XLAT', 'd7'], ['XLATB', 'd7'],
    ['REP MOVSB', 'f3 a4'], ['REPE CMPSW', 'f3 a7'], ['REPNE SCASB', 'f2 ae'], ['LOCK INC WORD PTR [BX]', 'f0 ff 07'], ['ES: LODSB', '26 ac'],
    ['JMP 1234H:5678H', 'ea 78 56 34 12'], ['CALL 1000H:0000H', '9a 00 00 00 10'], ['JMP BX', 'ff e3'], ['CALL WORD PTR [BX]', 'ff 17'],
    ['JMP DWORD PTR [BX]', 'ff 2f'], ['CALL DWORD PTR [SI]', 'ff 1c'], ['JMP [BX]', 'ff 27'],
    ['HLT', 'f4'], ['NOP', '90'], ['CLC', 'f8'], ['STD', 'fd'], ['CMC', 'f5'], ['LAHF', '9f'], ['PUSHF', '9c'], ['WAIT', '9b'],
  ];
  for (const [text, want] of cases) assert.equal(bytes(text), want, text);
});

test('i8086: jumps are relative to the next instruction; short when in range, forward jumps shrink', () => {
  assert.equal(bytes('here: JMP here'), 'eb fe');
  assert.equal(bytes('JMP there\nthere: NOP'), 'eb 00 90');
  assert.equal(bytes('JMP NEAR PTR there\nthere: NOP'), 'e9 00 00 90');
  assert.equal(bytes('JE x\nNOP\nx: HLT'), '74 01 90 f4');
  assert.equal(bytes('CALL f\nHLT\nf: RET'), 'e8 01 00 f4 c3');
  assert.equal(bytes('l: LOOP l'), 'e2 fe');
  const far = asm(`JMP x\n${'NOP\n'.repeat(200)}x: HLT`);
  assert.ok(far.ok);
  assert.equal(far.listing[0].size, 3, 'a jump of 200 bytes is near');
  const bad = asm(`JE x\n${'NOP\n'.repeat(200)}x: HLT`);
  assert.equal(bad.ok, false);
  assert.match(bad.diagnostics[0].message, /short jump/);
});

test('i8086: data, labels, EQU, DUP, OFFSET and typed variables', () => {
  const p = asm(`N EQU 3
        MOV AX, count      ; a word variable: memory
        MOV AX, OFFSET count
        MOV CX, N
        INC count
        MOV AL, msg[BX]
        HLT
count   DW 7
msg     DB 'Hi', 0
buf     DB N DUP (1, 2)
        END`);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const t = p.listing.map((l) => disassemble(l.word, l.address));
  assert.deepEqual(t.slice(0, 6), ['MOV AX, [0011H]', 'MOV AX, 0011H', 'MOV CX, 0003H', 'INC WORD PTR [0011H]', 'MOV AL, [BX+13H]', 'HLT']);
  assert.equal(p.symbols.count, CODE_BASE + 0x11);
  assert.deepEqual([...p.data[1].bytes], [0x48, 0x69, 0]);
  assert.deepEqual([...p.data[2].bytes], [1, 2, 1, 2, 1, 2]);
  assert.equal(p.entry, CODE_BASE);
  assert.equal(asm('ORG 100H\nstart: NOP\nEND start').entry, CODE_BASE + 0x100);
});

test('i8086: diagnostics', () => {
  const msg = (text) => asm(text).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message).join(' | ');
  assert.match(msg('INC [BX]'), /BYTE PTR or WORD PTR/);
  assert.match(msg('MOV AX, BL'), /differ in size/);
  assert.match(msg('MOV AX, [DX]'), /cannot address memory/);
  assert.match(msg('JMP nowhere'), /not defined/);
  assert.match(msg('x: NOP\nx: NOP'), /defined twice/);
  assert.match(msg('FOO AX'), /not an 8086 instruction/);
  assert.match(msg('MOV CS, AX'), /Wrong operands/);
  assert.match(msg('MOV AL, 300'), /Wrong operands|byte/);
  assert.match(msg('x SEGMENT'), /not supported/);
  assert.equal(asm('ASSUME CS:x\nNOP').ok, true);
});

test('i8086: a listing word keeps its bytes, also with a leading 00H', () => {
  const p = asm('ADD BL, AL\nRET\nADD [BX+SI], AL');
  assert.deepEqual(p.listing.map((l) => disassemble(l.word, l.address)), ['ADD BL, AL', 'RET', 'ADD [BX+SI], AL']);
  assert.equal(p.listing[0].word.toString(16).padStart(4, '0'), '00c3');
  // without the remembered bytes, the shortest reading of its own length
  assert.equal(disassemble(0x8bc3, 0x55555), 'MOV AX, BX');
  // an instruction longer than six bytes: its prefix on a row of its own
  const q = asm('MOV WORD PTR ES:[1234H], 5678H');
  assert.deepEqual(q.listing.map((l) => l.size), [1, 6]);
  assert.equal(disassemble(q.listing[0].word, q.listing[0].address), 'ES:');
});

test('i8086: fields, description, scratch line and editor help', () => {
  const p = asm('MOV [BX+SI+12H], AL');
  const f = fields(p.listing[0].word, p.listing[0].address);
  assert.deepEqual(f.map((x) => [x.short, x.bits, x.value]), [['op', '23:16', 0x88], ['mod', '15:14', 1], ['reg', '13:11', 0], ['r/m', '10:8', 0], ['disp', '7:0', 0x12]]);
  assert.match(describe(p.listing[0].word, p.listing[0].address).kind, /op code · ModR\/M · displacement 8 \(3 bytes\)/);
  assert.equal(scratch('').kind, 'empty');
  assert.equal(scratch('B8 34 12').text, 'MOV AX, 1234H');
  assert.equal(scratch('MOV AX, 1234H').rows[0].size, 3);
  assert.equal(scratch('x: NOP').ok, false);
  for (const m of MNEMONICS) assert.equal(editor.help(m.toLowerCase())?.kind, 'instruction', m);
  assert.equal(editor.help('ax').kind, 'register');
});

test('i8086: the table has one entry per op code (or eight for a group), and the assembler emits documented forms only', () => {
  for (let op = 0; op < 256; op++) {
    const e = BY_OPCODE[op];
    assert.ok(e, `op code ${op.toString(16)}`);
    if (Array.isArray(e)) assert.equal(e.filter(Boolean).length, 8, `group ${op.toString(16)}`);
  }
  for (const f of FORMS) if (f.asm) assert.equal(f.status, 'normal', `${f.mnem} ${f.op.toString(16)}`);
});

test('i8086 [TEST]: the table\'s statuses agree with SingleStepTests metadata', { skip: available() ? false : `SingleStepTests/8086 not found at ${SST_DIR}` }, () => {
  const meta = metadata();
  for (const [hex, e] of Object.entries(meta.opcodes)) {
    const op = parseInt(hex, 16);
    const mine = BY_OPCODE[op];
    if (e.reg) for (const [r, x] of Object.entries(e.reg)) assert.equal(statusOf(mine[Number(r)], Number(r) << 3), x.status, `${hex}.${r}`);
    else assert.equal(Array.isArray(mine) ? 'group' : mine.status, e.status, hex);
  }
});

// the meaning of a decoded instruction, for comparing two encodings of it
function meaning(d) {
  const ops = d.operands.map((o) => {
    if (o.t === 'mem') return `m${o.size}:${o.direct ? 'd' : o.rm}:${(o.direct ? o.disp : o.disp) & 0xffff}`;
    if (o.t === 'imm') return `i${o.value & (o.size === 8 && !o.short ? 0xff : 0xffff)}`;
    if (o.t === 'rel') return `t${(d.length + o.value) & 0xffff}`;
    if (o.t === 'far') return `f${o.seg}:${o.off}`;
    if (o.t === 'sreg') return `s${o.n}`;
    if (o.t === 'const') return `i${o.value}`;
    return `${o.t}${o.size}:${o.n}`;
  });
  const sym = ['XCHG', 'TEST'].includes(d.entry.mnem) ? ops.slice().sort() : ops;
  const mnem = d.entry.op === 0xcc ? 'INT' : d.entry.mnem;
  const args = d.entry.op === 0xcc ? ['i3'] : (d.entry.op === 0xd4 || d.entry.op === 0xd5) ? ops : sym;
  return `${d.lock ? 'LOCK ' : ''}${d.rep ?? ''} ${d.seg && d.operands.some((o) => o.t === 'mem') ? d.seg : ''} ${mnem} ${args.join(',')}`;
}

test('i8086 [TEST]: decode, write and assemble again round-trips the instruction bytes of SingleStepTests', { skip: available() ? false : `SingleStepTests/8086 not found at ${SST_DIR}` }, () => {
  let n = 0; let exact = 0;
  const failures = [];
  for (const f of files().filter((x) => x.status === 'normal')) {
    let tests;
    try { tests = load(f.name); } catch { continue; }
    for (const t of tests.slice(0, 8)) {
      const d = decodeBytes(t.bytes);
      if (d.status !== 'normal') continue;
      assert.equal(d.length, t.bytes.length, `length of ${t.name}`);
      const text = format(d, 0);
      const p = asm(text);
      if (!p.ok) { failures.push(`${f.name} ${text}: ${p.diagnostics[0]?.message}`); continue; }
      const back = p.listing.flatMap((l) => bytesOf(l.word, l.address));
      const d2 = decodeBytes(back);
      n += 1;
      if (back.join() === t.bytes.join()) exact += 1;
      if (meaning(d2) !== meaning(d)) failures.push(`${f.name} ${text}: ${meaning(d)} became ${meaning(d2)}`);
    }
  }
  assert.deepEqual(failures.slice(0, 10), []);
  assert.ok(n > 2000, `${n} instructions`);
  console.log(`round trip: ${n} instructions, ${exact} with the same bytes`);
});
