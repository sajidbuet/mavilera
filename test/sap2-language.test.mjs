// SAP-2 assembly language (src/arch/sap-2/language.js; plan step 2 of docs/architecture/sap-2-plan.md): the 43
// instructions against the reference sheet's §2 (op codes, lengths, T states, flags), every instruction assembled and
// disassembled back, placement, the data listing, every error, fields, the scratch line and the editor data.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { assemble, disassemble, fields, describe, editor, scratch, parseNumber, INSTRUCTIONS, BY_OPCODE, MNEMONICS }
  from '../src/arch/sap-2/language.js';

const asm = (text) => assemble([{ name: 'main.asm', text }]);
const image = (p) => { const m = new Uint8Array(0x10000); for (const s of p.segments) m.set(s.bytes, s.address); return m; };
const bytesAt = (p, a, n) => [...image(p).slice(a, a + n)];

// the reference sheet is a private document (W-D25): in the public repository this check is skipped
const SHEET = new URL('../docs/architecture/sap-2-reference.md', import.meta.url);
test('the 43 instructions equal the reference sheet, §2: form, op code, bytes, T states, flags', { skip: !existsSync(SHEET) && 'no reference sheet' }, () => {
  const text = readFileSync(SHEET, 'utf8');
  const s2 = text.slice(text.indexOf('## 2.'), text.indexOf('## 3.'));
  const rows = s2.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  assert.equal(rows.length, 43);
  assert.equal(INSTRUCTIONS.length, 43);
  rows.forEach(([n, form, op, bytes, states, flags], k) => {
    const i = INSTRUCTIONS[k];
    const [t, nt] = states.split('/').map((x) => Number(x.trim()));
    assert.deepEqual([i.form, i.opcode, i.bytes, i.states, i.notTaken, i.flags], [form, parseInt(op, 16), Number(bytes), t, nt ?? null, flags === 'S, Z'], `row ${n}`);
  });
});

test('op codes are distinct; no op code of two or three bytes is 00', () => {
  assert.equal(Object.keys(BY_OPCODE).length, 43);
  for (const i of INSTRUCTIONS) if (i.bytes > 1) assert.notEqual(i.opcode, 0, i.form);
  assert.equal(MNEMONICS.length, 27);
});

/** One source line per instruction, with operands chosen to show the byte order. */
const sample = (i) => {
  const val = { byte: '5AH', port: i.mnemonic === 'IN' ? '2' : '4', address: '1234H' }[i.operand];
  const ops = [...i.regs, ...(val ? [val] : [])];
  return `${i.mnemonic}${ops.length ? ` ${ops.join(',')}` : ''}`;
};

test('every instruction assembles to its op code, length and operand bytes, and disassembles back', () => {
  for (const i of INSTRUCTIONS) {
    const p = asm(sample(i));
    assert.ok(p.ok, `${sample(i)}: ${JSON.stringify(p.diagnostics)}`);
    const operand = { byte: [0x5a], port: [i.mnemonic === 'IN' ? 2 : 4], address: [0x34, 0x12] }[i.operand] ?? [];
    assert.deepEqual(bytesAt(p, 0, i.bytes), [i.opcode, ...operand], i.form);
    const [row] = p.listing;
    assert.equal(row.size, i.bytes, i.form);
    assert.equal(row.word.toString(16).padStart(2 * i.bytes, '0'), [i.opcode, ...operand].map((b) => b.toString(16).padStart(2, '0')).join(''), i.form);
    const back = asm(disassemble(row.word));
    assert.ok(back.ok, disassemble(row.word));
    assert.deepEqual(back.listing.map((r) => [r.word, r.size]), [[row.word, row.size]], i.form);
  }
  assert.equal(disassemble(0xcd0020), 'CALL 2000H');
  assert.equal(disassemble(0x3e05), 'MVI A,05H');
  assert.equal(disassemble(0x0eff), 'MVI C,0FFH');
  assert.equal(disassemble(0xdb01), 'IN 01H');
  assert.equal(disassemble(0xd303), 'OUT 03H');
  assert.equal(disassemble(0xc3feff), 'JMP 0FFFEH');
  assert.equal(disassemble(0x78), 'MOV A,B');
  assert.equal(disassemble(0x76), 'HLT');
  assert.equal(disassemble(0x00), 'NOP');
});

test('every byte disassembles: an op code of one byte as its instruction, anything else as data that reassembles', () => {
  for (let w = 0; w < 256; w++) {
    const t = disassemble(w);
    const i = BY_OPCODE[w];
    if (i?.bytes === 1) assert.equal(t, i.form);
    else assert.match(t, /^DB [0-9][0-9A-F]*H$/, t);
    assert.equal(image(asm(t))[0], w, t);
  }
  assert.equal(disassemble(0x8005), 'DB 80H, 05H'); // a one-byte op code with a byte after it is not one instruction
});

test('labels, ORG, DB and DW: little-endian addresses and words, data in the data listing', () => {
  const p = asm([
    '        ORG 2000H',
    'start:  LDA x      ; A <- M[x]',
    '        CALL incr',
    '        JNZ start',
    '        HLT',
    'incr:   INR A',
    '        RET',
    'x:      DB 7, -1, 0b11',
    'w:      DW 1234H, start, -2',
  ].join('\n'));
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  assert.deepEqual(p.symbols, { start: 0x2000, incr: 0x200a, x: 0x200c, w: 0x200f });
  assert.deepEqual(bytesAt(p, 0x2000, 0x15), [0x3a, 0x0c, 0x20, 0xcd, 0x0a, 0x20, 0xc2, 0x00, 0x20, 0x76, 0x3c, 0xc9,
    7, 0xff, 3, 0x34, 0x12, 0x00, 0x20, 0xfe, 0xff]);
  assert.deepEqual(p.listing.map((r) => [r.address, r.size, r.line, r.part]), [[0x2000, 3, 2, 0], [0x2003, 3, 3, 0], [0x2006, 3, 4, 0],
    [0x2009, 1, 5, 0], [0x200a, 1, 6, 0], [0x200b, 1, 7, 0]]);
  assert.equal(p.listing[0].text, 'start:  LDA x');
  assert.deepEqual(p.data.map((d) => [d.address, [...d.bytes], d.line]), [[0x200c, [7, 0xff, 3], 8], [0x200f, [0x34, 0x12, 0, 0x20, 0xfe, 0xff], 9]]);
  assert.deepEqual(p.segments.map((s) => [s.address, s.bytes.length, s.executable]), [[0x2000, 12, true], [0x200c, 9, false]]);
  assert.deepEqual(p.symbolTable.map((s) => [s.name, s.section]), [['start', 'mem'], ['incr', 'mem'], ['x', 'data'], ['w', 'data']]);
  assert.equal(p.entry, 0);
});

test('case and spacing: mnemonics and registers in any case, spaces around the comma', () => {
  const p = asm('mvi b, 10\n  Mov  c , A\nout 3\nin 01H\nhlt');
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  assert.deepEqual(bytesAt(p, 0, 8), [0x06, 10, 0x4f, 0xd3, 3, 0xdb, 1, 0x76]);
});

test('number notations', () => {
  for (const [t, v] of [['12', 12], ['-3', -3], ['0x1F', 31], ['0b101', 5], ['0FH', 15], ['0FFFFH', 0xffff], ['2000h', 0x2000],
    ['FFH', null], ['x', null], ['1.5', null]]) assert.equal(parseNumber(t), v, t);
});

test('errors: each with line, column and length', () => {
  const cases = [
    ['MOV A,A', /Wrong operands for MOV: SAP-2 has MOV A,B, MOV A,C, MOV B,A, MOV B,C, MOV C,A and MOV C,B/],
    ['ADD A', /Wrong operands for ADD: SAP-2 has ADD B and ADD C/],
    ['MVI A', /Wrong operands for MVI/],
    ['JMP', /Wrong operands for JMP: SAP-2 has JMP address/],
    ['HLT 1', /HLT takes no operand/],
    ['SUI 5', /'SUI' is not an SAP-2 instruction/],
    ['IN 3', /IN reads input port 1 or 2; SAP-2 has no input port 3/],
    ['OUT 01H', /OUT writes output port 3 or 4; SAP-2 has no output port 1/],
    ['IN port', /'port' is not a number/],
    ['MVI B,256', /256 does not fit in a byte/],
    ['ANI -129', /-129 does not fit in a byte/],
    ['LDA 10000H', /address 65536 is outside/],
    ['JZ nowhere', /label 'nowhere' is not defined/],
    ['STA 1+2', /'1\+2' is not a number or a label/],
    ['DB', /DB needs a value/],
    ['DW 70000', /70000 does not fit in two bytes/],
    ['ORG 10000H', /address 65536 is outside/],
    ['ORG x', /'x' is not a number/],
    ['top: HLT\ntop: HLT', /'top' is defined twice/],
    ['mov: HLT', /cannot be a label/],
    ['B: HLT', /cannot be a label/],
    ['ORG 0FFFEH\nJMP 0', /memory ends at FFFFH/],
    ['HLT\nORG 0\nNOP', /0000H is already used/],
  ];
  for (const [text, re] of cases) {
    const p = asm(text);
    assert.equal(p.ok, false, text);
    assert.equal(p.diagnostics.length, 1, `${text}: ${JSON.stringify(p.diagnostics)}`);
    const d = p.diagnostics[0];
    assert.match(d.message, re, text);
    assert.ok(Number.isInteger(d.line) && Number.isInteger(d.column) && d.column >= 1 && Number.isInteger(d.length), JSON.stringify(d));
  }
  // the column and length of an operand: the value after the comma
  assert.deepEqual((({ column, length }) => [column, length])(asm('  MVI C, 300').diagnostics[0]), [10, 3]);
  assert.deepEqual((({ column, length }) => [column, length])(asm('OUT 5').diagnostics[0]), [5, 1]);
  assert.ok(asm('SUI 5').diagnostics[0].note.includes('43 instructions'));
});

test('a warning for bytes at FFFEH-FFFFH when the program has a CALL; none without one', () => {
  const p = asm('ORG 2000H\nNOP\nCALL 2100H\nHLT\nORG 0FFFDH\nDB 1, 2\nDB 3');
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  assert.deepEqual(p.diagnostics.map((d) => [d.severity, d.line, d.column, d.length]), [['warning', 6, 1, 2], ['warning', 7, 1, 2]]);
  assert.match(p.diagnostics[0].message, /the CALL at 2001H overwrites/);
  assert.deepEqual(asm('HLT\nORG 0FFFEH\nDW 0').diagnostics, []);
  assert.deepEqual(asm('CALL 0\nORG 0FFFCH\nDW 0').diagnostics, []);
});

test('an empty source assembles to an empty program; comments and blank lines are ignored', () => {
  const p = asm('; nothing\n\n   \n');
  assert.ok(p.ok);
  assert.equal(p.listing.length, 0);
  assert.equal(p.segments.length, 0);
});

test('fields: the op code, then a byte, a port, or an address low byte first; describe gives format and operand', () => {
  assert.deepEqual(fields(0x78).map((f) => [f.name, f.bits, f.value]), [['op code', '7:0', 0x78]]);
  assert.deepEqual(fields(0x3e05).map((f) => [f.name, f.bits, f.value]), [['op code', '15:8', 0x3e], ['byte', '7:0', 5]]);
  assert.deepEqual(fields(0xd304).map((f) => [f.name, f.value, f.meaning]), [['op code', 0xd3, 'op code of OUT byte'], ['port', 4, 'port 4']]);
  assert.deepEqual(fields(0xcd0020).map((f) => [f.name, f.bits, f.value]), [['op code', '23:16', 0xcd], ['address low', '15:8', 0], ['address high', '7:0', 0x20]]);
  assert.match(fields(0x08)[0].meaning, /not an op code/);
  assert.deepEqual(describe(0xcd0020), { kind: 'op code · address, low byte first (3 bytes)', immediate: 0x2000 });
  assert.deepEqual(describe(0xe60f), { kind: 'op code · byte (2 bytes)', immediate: 15 });
  assert.deepEqual(describe(0x2f), { kind: 'op code (1 byte)' });
  assert.equal(describe(0x08), null);
  // the fields of every listing row span its bits without a gap
  for (const i of INSTRUCTIONS) {
    const [row] = asm(sample(i)).listing;
    const f = fields(row.word);
    assert.equal(f[0].bits.split(':')[0], String(8 * row.size - 1), i.form);
    assert.equal(f[f.length - 1].bits.split(':')[1], '0', i.form);
  }
});

test('the scratch line: bytes decode, an instruction encodes, errors are worded', () => {
  assert.deepEqual(scratch('  '), { kind: 'empty', ok: true });
  const d = scratch('0CDH 00H 20H');
  assert.deepEqual([d.kind, d.ok, d.text, d.rows[0].word, d.rows[0].size], ['decode', true, 'CALL 2000H', 0xcd0020, 3]);
  assert.deepEqual([scratch('62, 5').text, scratch('0x76').text], ['MVI A,05H', 'HLT']);
  assert.deepEqual(scratch('8'), { kind: 'decode', ok: false });
  assert.match(scratch('3EH').error.message, /MVI A,byte has 2 bytes/);
  assert.match(scratch('76H 1').error.message, /HLT has one byte/);
  assert.match(scratch('300').error.message, /'300' is not a byte/);
  const e = scratch('jmp 0800h');
  assert.deepEqual([e.kind, e.ok, e.rows[0].word, e.rows[0].size], ['encode', true, 0xc30008, 3]);
  assert.match(scratch('x: HLT').error.message, /One instruction only/);
  assert.match(scratch('DW 5').error.message, /One instruction only/);
  assert.match(scratch('IN 4').error.message, /no input port 4/);
});

test('editor data: lower-case words; help and detail for every mnemonic and register', () => {
  assert.deepEqual(editor.mnemonics, MNEMONICS.map((m) => m.toLowerCase()));
  assert.deepEqual([editor.registers, editor.directives], [['a', 'b', 'c'], ['db', 'dw', 'org']]);
  for (const m of editor.mnemonics) {
    const h = editor.help(m);
    assert.equal(h.kind, 'instruction', m);
    assert.ok(h.usage && h.operation && h.format, m);
    assert.match(editor.detail(m, 'mnemonic'), new RegExp(`^${m.toUpperCase()}`));
    // every form of the mnemonic is in its usage
    for (const i of INSTRUCTIONS.filter((x) => x.mnemonic === m.toUpperCase())) {
      assert.ok(h.usage.includes(i.operand === 'port' ? `${m.toUpperCase()} 0` : i.form), `${m}: ${i.form}`);
    }
  }
  assert.match(editor.help('jnz').format, /10 T states if the jump is taken, 7 if not/);
  assert.match(editor.help('call').format, /3 bytes\); 18 T states/);
  for (const r of editor.registers) assert.equal(editor.help(r).kind, 'register');
  assert.equal(editor.help('sui'), null);
});
