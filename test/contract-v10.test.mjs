// Contract version 10 (docs/architecture/arch-contract.md §27): the real-time run, the audio sink, the optional SAB
// transport and `.wasm` assets, for the pico2 module. The validator's checks; descriptors without the fields stay valid.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDescriptor, CONTRACT_VERSION, CAPABILITIES, ENGINE_HOOKS, REALTIME_TRANSPORTS } from '../src/arch/contract.js';

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
