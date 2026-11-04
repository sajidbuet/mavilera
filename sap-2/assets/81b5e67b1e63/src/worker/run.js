// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { ARCHITECTURES } from '../arch/registry.js';
import { STOP } from '../arch/contract.js';
let engine = null;
let opts = null;
let pauseRequested = false;
let started = 0;
let applied = 0;
let loading = false;
let queued = [];
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
 setTimeout(slice, 0);
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
 for (const x of queued) if (engine.input) { engine.input(x); applied += 1; }
 slice();
 } else if (m.type === 'pause') {
 pauseRequested = true;
 } else if (m.type === 'input') {
 if (loading) queued.push(m.x);
 else if (engine?.input) { engine.input(m.x); applied += 1; }
 }
};
