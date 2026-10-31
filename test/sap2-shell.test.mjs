// sap2-shell.test.mjs -- SAP-2 on the shell (plan step 4 of docs/architecture/sap-2-plan.md): the descriptor's
// capabilities and their reasons, the call stack, the .hex and .bin images, data files, the trace exports with the
// input log replayed, the ports panel's byte field, and the contract v8 panel check.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { descriptor as d } from '../src/arch/sap-2/index.js';
import { image, loadImage, memoryImage } from '../src/arch/sap-2/language.js';
import { parseByte } from '../src/arch/sap-2/ui/ports-panel.js';
import { capability, validateDescriptor, STEP_OVER_HOOKS, STOP } from '../src/arch/contract.js';

const template = (f) => readFileSync(new URL(`../content/sap-2/templates/${f}`, import.meta.url), 'utf8');
const asm = (text, data) => {
  const p = d.language.assemble([{ name: 'p.asm', text }], data ? { data } : undefined);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  return p;
};

test('capabilities: what SAP-2 lacks has its own reason; step over has its hooks; one view and the ports panel', async () => {
  assert.deepEqual(validateDescriptor(d), []);
  for (const k of ['cLanguage', 'memoryModel', 'cache', 'devices', 'traps', 'compare']) {
    const c = capability(d, k);
    assert.equal(c.enabled, false, k);
    assert.equal(typeof d.strings.capability[c.reason], 'string', `${k}: ${c.reason}`);
  }
  for (const k of ['stepOver', 'callStack', 'exercises', 'dataIO', 'imageImport', 'exportImage', 'exportTrace', 'scratch', 'worker', 'waveform', 'exportGolden']) {
    assert.equal(capability(d, k).enabled, true, k);
  }
  const e = d.engine.create(asm(d.language.defaultSource));
  for (const k of [...STEP_OVER_HOOKS, 'callStack', 'input', 'inputs']) assert.equal(typeof e[k], 'function', k);
  assert.deepEqual(d.views.map((v) => v.id), ['isa', 'bus']);
  assert.deepEqual(d.panels.map((p) => p.id), ['ports']);
  assert.ok(d.strings.appFull.includes('SAP-2'));
  assert.ok(existsSync(new URL(`../content/branding/mavilera/${d.content.logo}`, import.meta.url)), 'its header lockup');
});

test('the contract v8: panels are checked for id, label and load', () => {
  assert.deepEqual(validateDescriptor({ ...d, panels: {} }), ['panels: a list']);
  assert.deepEqual(validateDescriptor({ ...d, panels: [{ id: 'Ports', label: 'P', load: () => null }, { id: 'p', label: '' }] }),
    ['panel Ports: id, label, load', 'panel p: id, label, load']);
});

test('call stack: the innermost call with its site, target and return; empty after RET', () => {
  const e = d.engine.create(asm(template('subroutine.asm')));
  assert.deepEqual(e.callStack(), []);
  e.step(); e.step(); // MVI, CALL double
  assert.deepEqual(e.callStack(), [{ depth: 1, target: 0x0d, call: 0x02, ret: 0x05, sp: null, args: [] }]);
  assert.equal(e.stepOutTarget(), 0x05);
  e.step(); e.step(); e.step(); // MOV, ADD, RET
  assert.deepEqual(e.callStack(), []);
  assert.equal(e.stepOverTarget(), null); // OUT at the PC
  e.step();
  assert.equal(e.stepOverTarget(), 0x0a); // the second CALL
  // nested: the outer return address is lost; the frame names the call depth
  const n = d.engine.create(asm('CALL s1\nHLT\ns1: CALL s2\nRET\ns2: RET\n'));
  n.step(); n.step();
  assert.deepEqual(n.callStack(), [{ depth: 2, target: 0x08, call: 0x04, ret: 0x07, sp: null, args: [] }]);
});

test('images: .hex and .bin up to the last byte, read back to the same memory and listing', () => {
  const p = asm(template('subroutine.asm'));
  const { hex, bin } = image(p);
  assert.equal(bin.length, 0x10); // 0000H to 000FH, the RET of double
  assert.equal(hex, `${Array.from(bin, (x) => x.toString(16).padStart(2, '0')).join('\n')}\n`);
  for (const [content, kind] of [[hex, 'hex'], [bin, 'bin']]) {
    const q = loadImage(content, kind, `p.${kind}`);
    assert.deepEqual(memoryImage(q), memoryImage(p), kind);
    assert.deepEqual(q.listing.map((l) => [l.address, l.size, l.word]), p.listing.map((l) => [l.address, l.size, l.word]), kind);
    const e = d.engine.create(q);
    let stop;
    do stop = e.run({}); while (stop === STOP.CHUNK);
    assert.equal(e.state().output, 'Port 3 = 0EH = 14 (00001110)\nPort 3 = 1CH = 28 (00011100)\n', kind);
  }
  // a cut-off instruction and a byte that is not an op code are data
  assert.deepEqual(loadImage('3e\n05\n08\nc3\n00\n', 'hex', 'x.hex').listing.map((l) => [l.address, l.size, d.language.disassemble(l.word)]),
    [[0, 2, 'MVI A,05H'], [2, 1, 'DB 08H'], [3, 1, 'DB 0C3H'], [4, 1, 'NOP']]);
  assert.throws(() => loadImage('3e\nzz\n', 'hex', 'x.hex'), /'zz' is not a byte/);
  assert.throws(() => loadImage(new Uint8Array(0x10001), 'bin', 'x.bin'), /65,536/);
});

test('data files: a load replaces the bytes at its DB label; one larger than the label\'s room is refused', () => {
  const p = asm('LDA t\nHLT\nORG 0800H\nt: DB 1, 2, 3\nu: DB 9\n', [{ label: 't', bytes: Uint8Array.from([7, 8, 9]) }, { label: 'u', bytes: Uint8Array.from([1, 2]) }]);
  assert.deepEqual([...memoryImage(p).slice(0x800, 0x804)], [7, 8, 9, 9]);
  assert.deepEqual([...p.data[0].bytes], [7, 8, 9]);
  assert.deepEqual(p.loadReport, { applied: [{ label: 't', address: 0x800, n: 3 }], dropped: [{ label: 'u', why: 'room', room: 1, n: 2 }] });
});

test('trace exports: a record per instruction, memory writes, the input log replayed', () => {
  const p = asm(template('subroutine.asm'));
  const { records, error } = d.exports.trace(p, { cap: 100 });
  assert.equal(error, null);
  assert.equal(records.length, 12);
  assert.deepEqual(records[1].memory, [{ address: 0xfffe, value: 0x05 }, { address: 0xffff, value: 0x00 }]);
  const lines = d.exports.traceJsonLines(records).trimEnd().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines[1], { pc: 2, bytes: [0xcd, 0x0d, 0x00], asm: 'CALL 000DH', writes: {}, memory: records[1].memory });
  assert.equal(lines.at(-1).halt, true);
  const csv = d.exports.traceCsv(records).trimEnd().split('\n');
  assert.equal(csv[0], 'step,pc,bytes,instruction,A,B,C,S,Z,OUT3,OUT4');
  assert.equal(csv[1], '1,0x0000,3e 07,"MVI A,07H",0x07,0x00,0x00,0,0,0x00,0x00');
  assert.equal(csv.length, 13);
  const k = asm(template('keyboard.asm'));
  const inputs = [{ at: 0, key: 1 }, { at: 40, key: 2 }, { at: 80, key: 3 }];
  const t = d.exports.trace(k, { cap: 10_000, inputs });
  assert.equal(t.records.at(-1).halt, true);
  assert.equal(t.records.at(-2).OUT3, 6);
  assert.equal(d.exports.trace(k, { cap: 500 }).records.length, 500, 'without keys: waits until the cap');
});

test('ports panel: the byte field reads hexadecimal and the assembler\'s notations, not decimal', () => {
  for (const [t, v] of [['5', 5], ['ff', 255], ['10', 16], ['0FFH', 255], ['0x1f', 31], ['0b101', 5], [' 7 ', 7]]) assert.equal(parseByte(t), v, t);
  for (const t of ['', '100', '1FFH', 'g', '-1', '0x100', '12 3']) assert.equal(parseByte(t), null, t);
});
