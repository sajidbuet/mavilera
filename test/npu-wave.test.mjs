// npu-wave.test.mjs -- NPU-3, the NPU's signals in the waveform panel and the VCD export (src/mem/npu-wave.js): on
// every processor host with the platform devices, each NPU bus access sits in the frame of the cycle that executes it,
// the controller follows it by one edge, the processor's own signals are those of an unwrapped run, and the VCD file
// puts the NPU's signals in the scope npu.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assemble } from '../src/asm/assembler.js';
import { SingleCycle } from '../src/uarch/single.js';
import { Multicycle } from '../src/uarch/multi.js';
import { Pipeline } from '../src/uarch/pipe.js';
import { Platform } from '../src/mem/platform.js';
import { buildMemsys, defaultConfig } from '../src/mem/config.js';
import { parseHexWords } from '../src/shell/data-io.js';
import { NPU_BASE } from '../src/mem/npu.js';
import { NPU_WAVE_SIGNALS, withNpuSignals } from '../src/mem/npu-wave.js';
import { recordFrames, vcd } from '../src/shell/vcd.js';
import { ch07 } from './ch07-content.mjs';
import { ROOT } from './npu-fixtures.mjs';

const T6 = JSON.parse(readFileSync(join(ROOT, 'content', 'data', 'ch06-tables.json'), 'utf8'));
const T7 = ch07({ jalr: false }).t7;
const HOSTS = {
  single: (ms) => new SingleCycle(T6, { memsys: ms, historyLimit: 0 }),
  multi: (ms) => new Multicycle(T6, T7, { memsys: ms, historyLimit: 0 }),
  pipe: (ms) => new Pipeline(T6, { memsys: ms, historyLimit: 0 }),
};
const SIGNALS = [{ name: 'pc', width: 32, kind: 'data' }];

// a whole NPU run without a data array (the multicycle host fetches from the same memory, so the template's data at
// address 0 would overwrite its code): four weights, four activations, start, poll STATUS, read the four results
const SHORT = [
  '        li   s1, 0x50000000',
  ...[0, 1, 2, 3].flatMap((i) => [`        li   t0, ${[0x01020304, 0x05060708, -0x01020304, 0x7f80017f][i]}`, `        sw   t0, ${0x10 + 4 * i}(s1)`]),
  ...[0, 1, 2, 3].flatMap((j) => [`        li   t0, ${[3, -2, 127, -128][j]}`, `        sw   t0, ${0x20 + 4 * j}(s1)`]),
  '        li   t0, 3',
  '        sw   t0, 0(s1)',
  'poll:   lw   t1, 4(s1)',
  '        andi t1, t1, 1',
  '        bne  t1, x0, poll',
  ...[0, 1, 2, 3].map((i) => `        lw   a${i}, ${0x30 + 4 * i}(s1)`),
  '        halt',
].join('\n');

function program(kind) {
  if (kind === 'short') {
    const p = assemble([{ name: 'short.s', text: SHORT }], { profile: 'ch06' });
    assert.ok(p.ok, p.errors.map((e) => e.message).join('; '));
    return p;
  }
  const p = assemble([{ name: 'npu-mv.s', text: readFileSync(join(ROOT, 'content', 'templates', 'npu-mv.s'), 'utf8') }], { profile: 'ch06' });
  assert.ok(p.ok, p.errors.map((e) => e.message).join('; '));
  const data = parseHexWords(readFileSync(join(ROOT, 'test', 'fixtures', 'npu', 'ch11', 'data', 'v1', 'data.hex'), 'utf8'));
  return { ...p, segments: [...p.segments, { address: 0, bytes: data, executable: false }] };
}

function host(kind, prog) {
  const platform = new Platform();
  const { memsys } = buildMemsys({ ...defaultConfig(), words: 1024, devices: true }, { platform });
  const model = HOSTS[kind](memsys);
  model.load(program(prog));
  return { model, platform };
}

for (const [kind, prog] of [['single', 'template'], ['pipe', 'template'], ['single', 'short'], ['multi', 'short'], ['pipe', 'short']]) {
  test(`${kind}, ${prog}: every NPU bus access in the frame of its cycle, the controller one edge later, the processor unchanged`, () => {
    const plain = host(kind, prog);
    const { frames: ref, stop: refStop } = recordFrames(plain.model, 5000);
    assert.equal(refStop, 'halt', plain.model.error ?? refStop);
    const log = plain.platform.npu.log;
    assert.ok(log.length >= 9 + 4, 'weights, activations, start, status polls and results');

    const { model, platform } = host(kind, prog);
    const x = withNpuSignals({ model, signals: SIGNALS, module: 'm', label: 'l' }, platform);
    assert.deepEqual(x.signals.slice(1), NPU_WAVE_SIGNALS);
    const { frames, stop } = recordFrames(x.model, 5000);
    assert.equal(stop, 'halt');
    assert.equal(frames.length, ref.length, 'the same number of cycles');
    assert.equal(x.model.cycle, plain.model.cycle);
    frames.forEach((f, k) => {
      for (const key of Object.keys(ref[k])) assert.equal(f[key], ref[k][key], `cycle ${k}: ${key} as without the NPU's signals`);
      for (const s of NPU_WAVE_SIGNALS) assert.ok(Number.isInteger(f[s.name]) && f[s.name] >= 0, `cycle ${k}: ${s.name}`);
    });
    const at = new Map(log.map((e) => [e.cycle, e]));
    assert.equal(at.size, log.length, 'one access per cycle');
    frames.forEach((f, k) => {
      const e = at.get(k);
      assert.equal(f['npu.sel_acc'], e ? 1 : 0, `cycle ${k}: sel_acc`);
      if (!e) return;
      assert.equal(f['npu.d_addr'], (NPU_BASE + e.offset) >>> 0, `cycle ${k}: d_addr`);
      if (e.kind === 'write') assert.equal(f['npu.d_wdata'], e.value, `cycle ${k}: d_wdata`);
      else assert.equal(f['npu.d_rdata'], e.value, `cycle ${k}: d_rdata`);
      if (e.register === 'CTRL') {
        assert.equal(f['npu.start'], 1);
        assert.equal(f['npu.busy'], 0, 'the start is taken at the end of its cycle');
        assert.equal(frames[k + 1]['npu.w_load'], 1, 'LOADW in the next cycle');
        for (let s = 0; s < 8; s++) {
          assert.equal(frames[k + 2 + s]['npu.run'], 1);
          assert.equal(frames[k + 2 + s]['npu.step'], s);
        }
        assert.equal(frames[k + 10]['npu.busy'], 0, 'idle after step 7');
        assert.equal(frames[k + 10]['npu.done'], 1);
      }
      if (e.register.startsWith('RESULT')) assert.equal(f['npu.d_rdata'], f[`npu.result[${e.register.slice(6)}]`], 'the read gives the register');
    });
  });
}

test('the VCD file: the NPU in the scope npu, its accesses as value changes', () => {
  const { model, platform } = host('single', 'template');
  const x = withNpuSignals({ model, signals: SIGNALS, module: 'rv32i_single', label: 'ch06' }, platform);
  const { frames } = recordFrames(x.model, 5000);
  const text = vcd(frames, x.signals, { module: 'rv32i_single' });
  assert.match(text, /\$scope module npu \$end/);
  for (const name of ['sel_acc', 'd_addr', 'busy', 'done', 'w_load', 'run', 'step', 'a_left0', 'psum_bottom3', 'result0']) {
    assert.match(text, new RegExp(`\\$var wire \\d+ \\S+ ${name}( \\[\\d+:0\\])? \\$end`), name);
  }
  const id = text.match(/\$var wire 1 (\S+) w_load \$end/)[1];
  assert.equal(text.split('\n').filter((l) => l === `1${id}`).length, 1, 'w_load rises once');
});

test('without an NPU the export model is unchanged', () => {
  const x = { model: {}, signals: SIGNALS };
  assert.equal(withNpuSignals(x, null), x);
  assert.equal(withNpuSignals(x, new Platform({ npu: false })), x);
});
