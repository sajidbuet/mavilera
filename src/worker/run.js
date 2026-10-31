// run.js -- Web Worker for long runs (spec §5.3): continues the page's engine from its snapshot (architecture
// contract, W-D29: the architecture by id, engine.create(program, options), restore(snapshot)), runs in slices of
// about 50 ms so that a "pause" message is seen between slices, reports progress, and returns the engine's
// snapshot, with the history of every step, so that stepping back after a run works as after single steps
// (WS-F-090). An "input" message (contract v8: a panel's input, SAP-2's keys) goes to the engine between
// slices; "done" says how many it applied, so that the page applies the ones that came too late.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { ARCHITECTURES } from '../arch/registry.js';
import { STOP } from '../arch/contract.js';

let engine = null;
let opts = null;
let pauseRequested = false;
let started = 0;
let applied = 0; // inputs given to the engine during this run
let loading = false; // the architecture is being loaded for a run
let queued = []; // inputs that came while it was loading

function slice() {
  const t0 = performance.now();
  let stop;
  do {
    stop = engine.run({ ...opts, chunk: 50_000, resumed: started > 0 });
    started += 1;
  } while (stop === STOP.CHUNK && !pauseRequested && performance.now() - t0 < 50);
  if (stop === STOP.CHUNK && pauseRequested) stop = STOP.PAUSE;
  if (stop === STOP.CHUNK) {
    postMessage({ type: 'progress', retired: engine.state().retired });
    setTimeout(slice, 0); // lets a pause message in
    return;
  }
  postMessage({ type: 'done', stop, snapshot: engine.snapshot(), applied });
  engine = null;
}

onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'run') {
    pauseRequested = false;
    loading = true;
    queued = [];
    const { descriptor } = await ARCHITECTURES[m.arch]();
    engine = descriptor.engine.create(m.program, m.options);
    engine.restore(m.snapshot);
    loading = false;
    opts = m.run;
    started = 0;
    applied = 0;
    for (const x of queued) if (engine.input) { engine.input(x); applied += 1; } // before the first slice, as the page gave them
    slice();
  } else if (m.type === 'pause') {
    pauseRequested = true;
  } else if (m.type === 'input') {
    if (loading) queued.push(m.x);
    else if (engine?.input) { engine.input(m.x); applied += 1; }
  }
};
