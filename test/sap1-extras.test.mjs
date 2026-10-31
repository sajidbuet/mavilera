// sap1-extras.test.mjs -- the SAP-1 scratch line, data files and golden dump (capabilities scratch, dataIO and
// exportGolden; arch-contract.md §23): a byte decodes and an instruction encodes, with the assembler's errors; a file
// loaded at a data label replaces its bytes as far as its room goes; the golden dump lists the values loaded into OUT
// by the bus view's export model, which also reports a run without a halt. The shell's data arrays are unchanged for
// the RISC-V programs of content/ and test/.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { descriptor } from '../src/arch/sap-1/index.js';
import { scratch, assembleWithData } from '../src/arch/sap-1/language.js';
import { create } from '../src/arch/sap-1/engine.js';
import { dataArrays } from '../src/shell/data-io.js';
import { listFiles } from '../tools/site-files.mjs';
import { assemble as rvAssemble } from '../src/asm/assembler.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = 'LDA x\nADD y\nOUT\nHLT\nORG 0DH\nx: DB 5\ny: DB 7, 9\n';

test('the scratch line: a byte decodes, an instruction encodes, errors are the assembler\'s', () => {
  assert.deepEqual(scratch('  '), { kind: 'empty', ok: true });
  for (const t of ['29', '0x1D', '1DH', '0b00011101']) {
    const r = scratch(t);
    assert.equal(r.kind, 'decode', t);
    assert.ok(r.ok);
    assert.equal(r.text, 'ADD 0DH');
    assert.equal(r.rows[0].word, 0x1d);
  }
  assert.deepEqual([scratch('0x60').kind, scratch('0x60').ok, scratch('0x60').text], ['decode', false, 'DB 60H'], 'no SAP-1 opcode');
  assert.equal(scratch('300').ok, false);
  const e = scratch('lda 9');
  assert.deepEqual([e.kind, e.ok, e.rows.map((r) => r.word)], ['encode', true, [0x09]]);
  assert.equal(scratch('OUT').rows[0].word, 0xe0);
  assert.match(scratch('JMP 3').error.message, /not an SAP-1 instruction/);
  assert.ok(scratch('JMP 3').error.note, 'the hint line');
  assert.match(scratch('LDA x').error.message, /label 'x' is not defined/);
  assert.match(scratch('x: LDA 3').error.message, /One instruction only/);
  assert.match(scratch('DB 4').error.message, /One instruction only/);
});

test('data files: the DB labels are data arrays; a load replaces their bytes as far as their room goes', () => {
  const p = descriptor.language.assemble([{ name: 'a.asm', text: SRC }]);
  assert.deepEqual(dataArrays(p), [{ name: 'x', address: 13, room: 1 }, { name: 'y', address: 14, room: 2 }]);
  const q = assembleWithData([{ name: 'a.asm', text: SRC }], { data: [{ label: 'y', bytes: Uint8Array.from([1, 2]) }, { label: 'x', bytes: Uint8Array.from([1, 2]) }, { label: 'z', bytes: Uint8Array.from([1]) }] });
  assert.deepEqual(q.loadReport, { applied: [{ label: 'y', address: 14, n: 2 }], dropped: [{ label: 'x', why: 'room', room: 1, n: 2 }, { label: 'z', why: 'missing' }] });
  assert.deepEqual([...q.data.find((d) => d.address === 14).bytes], [1, 2], 'the listing shows the loaded values');
  const e = create(q);
  while (!e.state().halted) e.step();
  assert.equal(e.state().registers.OUT, 6, '5 + 1');
  assert.equal(e.peek(15, 1)[0], 2);
  // a label of an instruction is not a data array
  assert.deepEqual(dataArrays(descriptor.language.assemble([{ name: 'a.asm', text: 'go: LDA 0\nHLT\n' }])), []);
});

test('the shell\'s data arrays are unchanged for every RISC-V program of content/ and test/ (one data segment)', () => {
  // the arrays as computed before SAP-1 (its first data segment only), against the shared function now
  const before = (program) => {
    const seg = program?.segments?.find((s) => !s.executable);
    if (!seg) return [];
    const end = seg.address + seg.bytes.length;
    const labels = (program.symbolTable ?? []).filter((s) => s.section === 'data' && s.address < end).sort((a, b) => a.address - b.address);
    return labels.map((s, i) => {
      let next = end;
      for (let k = i + 1; k < labels.length; k++) if (labels[k].address > s.address) { next = labels[k].address; break; }
      return { name: s.name, address: s.address, room: next - s.address };
    }).filter((a) => a.room > 0);
  };
  let n = 0;
  for (const f of [...listFiles(join(ROOT, 'content')), ...listFiles(join(ROOT, 'test'))].filter((p) => p.endsWith('.s'))) {
    for (const profile of ['iss', 'ch06', 'ch08']) {
      const p = rvAssemble([{ name: f, text: readFileSync(join(ROOT, f), 'utf8') }], { profile });
      if (!p.ok) continue;
      assert.deepEqual(dataArrays(p), before(p), `${f} ${profile}`);
      n += 1;
    }
  }
  assert.ok(n > 100, `${n} programs`);
});

test('the golden dump: the values loaded into OUT by the bus view\'s export model; a run without a halt is reported', async () => {
  const { exportModel } = await import('../src/arch/sap-1/ui/bus-view.js'); // the module loads without a DOM
  const p = descriptor.language.assemble([{ name: 'a.asm', text: 'LDA x\nOUT\nADD x\nOUT\nHLT\nORG 0FH\nx: DB 200\n' }]);
  const m = exportModel(p);
  assert.equal(m.run(1000), 'halt');
  assert.deepEqual(descriptor.exports.golden(m), { text: 'c8\n90\n', count: 2 }, '200, then 400 mod 256 = 144');
  const loop = exportModel(descriptor.language.assemble([{ name: 'a.asm', text: 'OUT\n' }]));
  assert.equal(loop.run(500), 'budget');
  assert.equal(loop.outs.length > 0, true);
});
