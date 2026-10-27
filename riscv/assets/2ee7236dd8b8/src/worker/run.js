// run.js -- Web Worker for long runs (spec §5.3): continues a session from
// the page's snapshot, runs in slices of about 50 ms so that a "pause"
// message is seen between slices, reports progress, and returns the final
// state with the history of every step it made, so that stepping back after
// a run works as after single steps (WS-F-090).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Session, STOP } from '../core/session.js';

let session = null;
let opts = null;
let pauseRequested = false;
let started = 0;

function slice() {
  const t0 = performance.now();
  let stop;
  do {
    stop = session.run({ ...opts, chunk: 50_000, resumed: started > 0 });
    started += 1;
  } while (stop === STOP.CHUNK && !pauseRequested && performance.now() - t0 < 50);
  if (stop === STOP.CHUNK && pauseRequested) stop = STOP.PAUSE;
  if (stop === STOP.CHUNK) {
    postMessage({ type: 'progress', instret: session.hart.instret, runCount: session.runCount });
    setTimeout(slice, 0); // lets a pause message in
    return;
  }
  const res = session.workerResult(stop);
  const transfer = [res.history.pc.buffer, res.history.info.buffer, res.history.regOld.buffer,
    res.history.memAddr.buffer, res.history.memOld.buffer, ...[...res.state.pages.values()].map((p) => p.buffer)];
  postMessage({ type: 'done', result: res }, transfer);
  session = null;
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'run') {
    session = Session.fromWorkerRequest(m.request);
    opts = m.request.opts;
    pauseRequested = false;
    started = 0;
    slice();
  } else if (m.type === 'pause') {
    pauseRequested = true;
  }
};
