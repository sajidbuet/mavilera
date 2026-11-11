// worker.js -- the Pico Full compiler Worker (pico2 P1-F2, research D33): downloads or reads from the cache the compiler
// and the SDK pack (assets.js), keeps them, and builds projects (host.js), so the page never waits on the compiler.
//
// Messages in:  {id, type: 'probe', base} | {id, type: 'load', base} | {id, type: 'build', files} | {id, type: 'forget'}
// Messages out: {id, type: 'progress', file: 'compiler'|'pack', loaded, total, done, fromCache?}
//               {id, type: 'result', value} (an ELF is transferred) | {id, type: 'error', code, message}
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { probe, getAsset, forget } from './assets.js';
import { CompilerHost } from './host.js';

let host = null;
let loading = null;

async function load(id, base) {
  const m = await probe(base);
  const t0 = performance.now();
  const progress = (file) => (p) => postMessage({ id, type: 'progress', file, ...p });
  // both at once: the compiler compiles while it arrives; the pack is small
  const [module, pack] = await Promise.all([
    getAsset(m.compiler, { asModule: true, onProgress: progress('compiler') }),
    getAsset(m.pack, { onProgress: progress('pack') }),
  ]);
  const t1 = performance.now();
  host = new CompilerHost({ module, pack });
  const pch = await host.prepare();
  return { version: m.version, times: { download: Math.round(t1 - t0), pch: Math.round(pch.ms) }, pch: pch.ok, fromCache: m.toDownload === 0 };
}

self.onmessage = async ({ data: { id, type, base, files } }) => {
  try {
    if (type === 'probe') { postMessage({ id, type: 'result', value: await probe(base) }); return; }
    if (type === 'load') {
      loading ??= load(id, base).finally(() => { loading = null; });
      postMessage({ id, type: 'result', value: await loading });
      return;
    }
    if (type === 'build') {
      if (!host) throw Object.assign(new Error('the compiler is not loaded'), { code: 'notLoaded' });
      const r = await host.build(files);
      postMessage({ id, type: 'result', value: r }, r.elf ? [r.elf.buffer] : []);
      return;
    }
    if (type === 'forget') { host = null; postMessage({ id, type: 'result', value: await forget() }); return; }
    throw new Error(`unknown message ${type}`);
  } catch (e) {
    postMessage({ id, type: 'error', code: e.code ?? 'failed', message: e.message });
  }
};
