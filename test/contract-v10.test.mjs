// Contract version 10 (docs/architecture/arch-contract.md §27): the real-time run, the audio sink, the optional SAB
// transport and `.wasm` assets, for the pico2 module. The validator's checks; descriptors without the fields stay valid.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDescriptor, CONTRACT_VERSION, CAPABILITIES, ENGINE_HOOKS, REALTIME_TRANSPORTS, IMAGE_KINDS } from '../src/arch/contract.js';

const { descriptor: acc4 } = await import('./fixtures/arch/acc4/index.js');

const rt = { floorHz: 1e6, transports: ['sab', 'postMessage'] };
const audio = { sampleRate: 48000, channels: 1, processor: 'src/arch/pico2/audio-worklet.js' };
const full = () => ({
  ...acc4,
  capabilities: { ...acc4.capabilities, realtime: true, audio: true },
  realtime: rt, audio, assets: { wasm: ['src/arch/pico2/model.wasm'] },
});
const problems = (d) => validateDescriptor(d);
const has = (d, text) => problems(d).some((p) => p.includes(text));

test('v10: the version is 10 and the new names are listed', () => {
  assert.equal(CONTRACT_VERSION, 10);
  assert.ok(CAPABILITIES.includes('realtime') && CAPABILITIES.includes('audio'));
  assert.ok(ENGINE_HOOKS.includes('advance') && ENGINE_HOOKS.includes('drainAudio'));
  assert.deepEqual([...REALTIME_TRANSPORTS], ['postMessage', 'sab']);
});

test('v10: a descriptor without the new fields is unchanged in meaning', () => {
  assert.deepEqual(problems(acc4), []);
});

test('v10: a descriptor with realtime, audio and wasm assets is valid', () => {
  assert.deepEqual(problems(full()), []);
});

test('v10: realtime and its capability go together', () => {
  assert.ok(has({ ...acc4, realtime: rt }, 'capability realtime'));
  assert.ok(has({ ...acc4, capabilities: { ...acc4.capabilities, realtime: true } }, 'capability realtime'));
});

test('v10: realtime.floorHz and transports are checked', () => {
  for (const floorHz of [0, -1, NaN, '1e6']) assert.ok(has({ ...full(), realtime: { floorHz } }, 'floorHz'), String(floorHz));
  for (const transports of [[], ['sab', 'sab'], ['websocket'], 'sab']) {
    assert.ok(has({ ...full(), realtime: { floorHz: 1e6, transports } }, 'realtime.transports'), JSON.stringify(transports));
  }
  assert.deepEqual(problems({ ...full(), realtime: { floorHz: 1e6 } }), []); // transports are optional
});

test('v10: audio and its capability go together; its fields are checked', () => {
  assert.ok(has({ ...acc4, audio }, 'capability audio'));
  assert.ok(has({ ...full(), capabilities: { ...acc4.capabilities, realtime: true } }, 'capability audio'));
  for (const sampleRate of [0, 4000, 200000, 44100.5, '48000']) assert.ok(has({ ...full(), audio: { ...audio, sampleRate } }, 'audio.sampleRate'), String(sampleRate));
  for (const channels of [0, 3, 1.5]) assert.ok(has({ ...full(), audio: { ...audio, channels } }, 'audio.channels'), String(channels));
  for (const processor of ['', '/abs.js', '../up.js', 'https://x.example/p.js', 'a\\b.js', 'p.mjs', 7]) {
    assert.ok(has({ ...full(), audio: { ...audio, processor } }, 'audio.processor'), String(processor));
  }
});

test('v10: assets.wasm takes relative .wasm paths only, once each', () => {
  for (const wasm of [['/abs.wasm'], ['../m.wasm'], ['m.js'], ['https://x.example/m.wasm'], ['a.wasm', 'a.wasm'], 'm.wasm']) {
    assert.ok(has({ ...full(), assets: { wasm } }, 'assets.wasm'), JSON.stringify(wasm));
  }
  assert.ok(has({ ...full(), assets: { png: ['x.png'] } }, 'assets.png'));
  assert.deepEqual(problems({ ...full(), assets: {} }), []);
});

// added 2026-11-07 to the v10 draft (author's decision Q3 of pico2 P1-C1): the image kinds the shell passes to loadImage
test('v10: language.imageKinds lists kinds from IMAGE_KINDS once each and needs loadImage; imageImport needs loadImage', () => {
  assert.deepEqual([...IMAGE_KINDS], ['hex', 'bin', 'uf2', 'elf']);
  const withKinds = (k, extra = {}) => ({ ...acc4, language: { ...acc4.language, loadImage: () => ({}), imageKinds: k, ...extra } });
  assert.deepEqual(problems(withKinds(['uf2', 'elf', 'bin'])), []);
  assert.ok(has(withKinds([]), 'language.imageKinds'));
  assert.ok(has(withKinds(['uf2', 'uf2']), 'language.imageKinds'));
  assert.ok(has(withKinds(['zip']), 'language.imageKinds'));
  assert.ok(has(withKinds(['uf2'], { loadImage: undefined }), 'needs language.loadImage'));
  const noLoader = { ...acc4, capabilities: { ...acc4.capabilities, imageImport: true }, language: { ...acc4.language, loadImage: undefined } };
  assert.ok(has(noLoader, 'capability imageImport needs language.loadImage'));
});

// added 2026-11-07 to the v10 draft (author's request: pico2's processor views draw larger): View.layout
test('v10: View.layout gives a datapath view its default pane sizes, within limits', () => {
  const withView = (layout, kind = 'datapath') => ({ ...acc4, views: [...acc4.views, { id: 'lay', label: 'L', icon: 'chip', kind, load: async () => ({}), layout }] });
  assert.deepEqual(problems(withView({ drawing: 0.76, editor: 0.19 })), []);
  assert.ok(has(withView({ drawing: 0.95 }), 'layout.drawing'));
  assert.ok(has(withView({ editor: 0.05 }), 'layout.editor'));
  assert.ok(has(withView({ drawing: 0.7, width: 3 }), 'layout.width is not in the contract'));
  assert.ok(has(withView({ drawing: 0.7 }, 'bus'), 'layout is for datapath views'));
});
