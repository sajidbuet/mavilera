// npu-wave.js -- the platform devices' signals in the waveform panel and the VCD export: the NPU's (NPU-3, gate V of
// docs/research/gpu-npu/roadmaps/NPU_DEVELOPMENT_ROADMAP.md; WS-F-125, WS-F-146) and the GPU's (GPU-7, decision G30).
// A processor model with the platform devices is wrapped so that each frame of a cycle carries, besides the processor's
// signals, each device's signals of the same cycle: its registers during it (Device.visible) and the bus access the
// cycle made. The access is known only after the cycle's edge, so the wrapper runs the model one cycle ahead of the
// recording, once for all devices. Pure JavaScript, no DOM; no change to the architecture contract (the view's export
// model is still a model).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { NPU_N, npuSignals } from './npu.js';

/**
 * The NPU signals of a waveform, in the panel's order: the bus side (soc_npu's d_ bus and sel_acc, FIG-0114), the
 * controller (FIG-0114: start, clear, busy, done, w_load, run, step), the array's edges (a_left, psum_bottom of
 * mac_array) and the registers ACT and RESULT. `vcd` is the path in the VCD file: the scope `npu` holds the simulator's
 * model of the device, which is not a net of the processor's RTL.
 */
export function npuWaveSignals(n = NPU_N) {
  const out = [];
  const add = (name, width, vcdName = name) => out.push({ name: `npu.${name}`, width, kind: 'npu', vcd: `npu.${vcdName}` });
  add('sel_acc', 1); add('d_addr', 32); add('d_wdata', 32); add('d_rdata', 32);
  add('start', 1); add('clear', 1); add('busy', 1); add('done', 1); add('w_load', 1); add('run', 1); add('step', 3);
  for (let r = 0; r < n; r++) add(`a_left[${r}]`, 8, `a_left${r}`);
  for (let c = 0; c < n; c++) add(`psum_bottom[${c}]`, 32, `psum_bottom${c}`);
  for (let j = 0; j < n; j++) add(`act[${j}]`, 8, `act${j}`);
  for (let i = 0; i < n; i++) add(`result[${i}]`, 32, `result${i}`);
  return out;
}
export const NPU_WAVE_SIGNALS = Object.freeze(npuWaveSignals());

/** The frame values (names of NPU_WAVE_SIGNALS) of the cycle whose registers are S and whose bus access is `bus`. */
export function npuFrame(S, bus, n = NPU_N) {
  const { values } = npuSignals(S, bus, n);
  const f = {};
  for (const k of ['sel_acc', 'd_addr', 'd_wdata', 'd_rdata', 'start', 'clear', 'busy', 'done', 'w_load', 'run', 'step']) f[`npu.${k}`] = values[k] >>> 0;
  for (let r = 0; r < n; r++) {
    f[`npu.a_left[${r}]`] = values[`a_left[${r}]`] & 0xff;
    f[`npu.psum_bottom[${r}]`] = values[`psum_bottom[${r}]`] >>> 0;
    f[`npu.act[${r}]`] = values.act[r] & 0xff;
    f[`npu.result[${r}]`] = values.result[r] >>> 0;
  }
  return f;
}

/**
 * The export model `x` ({model, signals, ...} of a processor view) with the signals of the devices `parts` added to its
 * frames: parts [{device, signals, frame: (S, bus) => values}], S the device's registers during the cycle and bus its
 * access of the cycle (or null). `x` itself when there is no part. evaluate() of cycle k executes cycle k on the inner
 * model (the frame's bus access is the one stamped k, NPU-1's convention: a store and a load carry the cycle that
 * executes them); step() then only reports that cycle's result. Everything else reads the inner model.
 */
export function withDeviceSignals(x, parts) {
  if (!parts.length) return x;
  const inner = x.model;
  let ahead = null; // {result, r}: cycle inner.cycle - 1 evaluated and executed
  const look = () => {
    if (ahead) return ahead;
    const k = inner.cycle;
    const result = inner.evaluate();
    const before = parts.map((p) => ({ S: p.device.visible, last: p.device.last }));
    const r = inner.step();
    const signals = { ...result.signals };
    parts.forEach((p, i) => {
      const d = p.device;
      const bus = d.last !== before[i].last && d.last?.cycle === k ? d.last : null;
      Object.assign(signals, p.frame(before[i].S, bus));
    });
    ahead = { result: { ...result, signals }, r };
    return ahead;
  };
  const model = new Proxy(inner, {
    get(t, prop) {
      if (prop === 'evaluate') return () => look().result;
      if (prop === 'step') return () => { if (!ahead) return inner.step(); const { r } = ahead; ahead = null; return r; };
      if (prop === 'cycle') return inner.cycle - (ahead && ahead.r === 'step' ? 1 : 0);
      if (prop === 'run') return (...a) => { ahead = null; return inner.run(...a); }; // the looked-ahead cycle counts as run
      const v = Reflect.get(t, prop);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  return { ...x, model, signals: [...x.signals, ...parts.flatMap((p) => p.signals)] };
}

/** The NPU part of withDeviceSignals for a platform (null without the NPU). */
export const npuPart = (platform) => (platform?.npu ? { device: platform.npu, signals: NPU_WAVE_SIGNALS, frame: (S, bus) => npuFrame(S, bus, platform.npu.n) } : null);

/** The export model with the NPU of `platform` added to its frames, or `x` itself when the platform has no NPU. */
export function withNpuSignals(x, platform) {
  const p = npuPart(platform);
  return p ? withDeviceSignals(x, [p]) : x;
}
