// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { NPU_N, npuSignals } from './npu.js';
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
export function withNpuSignals(x, platform) {
 const npu = platform?.npu;
 if (!npu) return x;
 const inner = x.model;
 let ahead = null;
 const look = () => {
 if (ahead) return ahead;
 const k = inner.cycle;
 const result = inner.evaluate();
 const S = npu.visible;
 const before = npu.last;
 const r = inner.step();
 const bus = npu.last !== before && npu.last?.cycle === k ? npu.last : null;
 ahead = { result: { ...result, signals: { ...result.signals, ...npuFrame(S, bus, npu.n) } }, r };
 return ahead;
 };
 const model = new Proxy(inner, {
 get(t, prop) {
 if (prop === 'evaluate') return () => look().result;
 if (prop === 'step') return () => { if (!ahead) return inner.step(); const { r } = ahead; ahead = null; return r; };
 if (prop === 'cycle') return inner.cycle - (ahead && ahead.r === 'step' ? 1 : 0);
 if (prop === 'run') return (...a) => { ahead = null; return inner.run(...a); };
 const v = Reflect.get(t, prop);
 return typeof v === 'function' ? v.bind(t) : v;
 },
 });
 return { ...x, model, signals: [...x.signals, ...NPU_WAVE_SIGNALS] };
}
