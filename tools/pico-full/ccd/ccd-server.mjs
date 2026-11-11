// ccd-server.mjs -- compile daemon for building the Pico Full runtimes and SDK pack with the WebAssembly clang/lld
// (pico2 P1-F2; from experiment E-CC-WASM-1). Compiles the multi-call llvm.wasm once and runs each job in a fresh WASI
// instance on a worker thread.
//   node tools/pico-full/ccd/ccd-server.mjs <llvm.wasm> [port=47321] [workers=availableParallelism]
// POST /run {tool, args, pwd} -> {code, stdout, stderr (base64), ms}.
// A clang job that links or assembles (.S) is run as the driver would run it: first `-###`, then each printed job in
// its own instance, because WASI cannot spawn processes. The guest sees C:\ as "/".
// Development tool only (not part of the site).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, availableParallelism } from 'node:os';
import { join } from 'node:path';
import { WASI } from 'node:wasi';

// Guest path of the host temp folder; the driver needs a writable TMPDIR for .S preprocessing.
const GUEST_TMP = tmpdir().replace(/^[Cc]:[\\/]/, '/').replace(/\\/g, '/');

if (!isMainThread) {
  const { module } = workerData;
  let seq = 0;
  parentPort.on('message', async ({ id, argv0, args, pwd }) => {
    const base = join(tmpdir(), `ccd-${process.pid}-${workerData.n}-${seq++}`);
    const o = openSync(base + '.out', 'w+'), e = openSync(base + '.err', 'w+');
    let code;
    const t0 = performance.now();
    try {
      const wasi = new WASI({ version: 'preview1', args: [argv0, ...args], env: { PWD: pwd, HOME: GUEST_TMP, TMPDIR: GUEST_TMP },
        preopens: { '/': 'C:\\' }, stdout: o, stderr: e, returnOnExit: true });
      const inst = await WebAssembly.instantiate(module, wasi.getImportObject());
      code = wasi.start(inst);
    } catch (err) {
      writeFileSync(e, `ccd: trap in ${argv0}: ${err && err.message}\n`);
      code = 134;
    }
    const ms = performance.now() - t0;
    closeSync(o); closeSync(e);
    const stdout = readFileSync(base + '.out'), stderr = readFileSync(base + '.err');
    unlinkSync(base + '.out'); unlinkSync(base + '.err');
    parentPort.postMessage({ id, code: code ?? 0, stdout, stderr, ms });
  });
} else {
  const { createServer } = await import('node:http');
  const [wasmPath, portArg, nArg] = process.argv.slice(2);
  if (!wasmPath) { console.error('usage: node ccd-server.mjs <llvm.wasm> [port] [workers]'); process.exit(2); }
  const port = Number(portArg || 47321);
  const N = Number(nArg || availableParallelism());
  const t0 = performance.now();
  const module = await WebAssembly.compile(readFileSync(wasmPath));
  console.log(`ccd: compiled ${wasmPath} in ${(performance.now() - t0).toFixed(0)} ms; ${N} workers; port ${port}`);

  const idle = [], queue = [], pending = new Map();
  let nextId = 0, made = 0;
  // Each node:wasi instance keeps an OS handle for the "/" preopen until it is garbage-collected; a worker that runs
  // thousands of jobs runs out of handles (UVWASI_EMFILE, E-CC-WASM-1). Workers are replaced after 100 jobs.
  const JOBS_PER_WORKER = 100;
  function spawn() {
    const w = new Worker(new URL(import.meta.url), { workerData: { module, n: made++ } });
    w.jobs = 0;
    w.on('message', (m) => {
      const r = pending.get(m.id); pending.delete(m.id); r(m);
      if (++w.jobs >= JOBS_PER_WORKER) { w.terminate(); release(spawn()); } else release(w);
    });
    w.on('error', (err) => console.error('ccd worker error', err));
    return w;
  }
  for (let n = 0; n < N; n++) idle.push(spawn());
  function release(w) { const job = queue.shift(); if (job) dispatch(w, job); else idle.push(w); }
  function dispatch(w, job) { pending.set(job.id, job.resolve); w.postMessage(job.msg); }
  function run(argv0, args, pwd) {
    return new Promise((resolve) => {
      const job = { id: nextId++, resolve };
      job.msg = { id: job.id, argv0, args, pwd };
      const w = idle.pop();
      if (w) dispatch(w, job); else queue.push(job);
    });
  }
  const parseJobs = (text) => text.split(/\r?\n/).filter((l) => l.startsWith(' "')).map((l) =>
    [...l.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1')));
  const isLink = (tool, args) => /clang/.test(tool) &&
    !args.some((a) => ['-c', '-S', '-E', '-M', '-MM', '-###', '--version', '-cc1', '-cc1as', '-fsyntax-only'].includes(a) ||
      a.startsWith('-print-') || a.startsWith('--print-'));
  // Assembly inputs: the driver runs cc1as as a subprocess (not in-process), so plan those too.
  const isAsm = (tool, args) => /clang/.test(tool) && !args.includes('-###') && !args.includes('-cc1') &&
    !args.includes('-cc1as') && !args.includes('-E') && args.some((a) => /\.(S|s|sx)$/.test(a) && !a.startsWith('-'));
  async function job(tool, args, pwd) {
    if (!isLink(tool, args) && !isAsm(tool, args)) return run(tool, args, pwd);
    // -fuse-ld is dropped: under WASI the driver cannot find a linker program and rejects it; the driver's default
    // linker job ("ld") is run as ld.lld instead.
    const plan = await run(tool, [...args.filter((a) => !a.startsWith('-fuse-ld=')), '-###'], pwd);
    if (plan.code !== 0) return plan;
    const jobs = parseJobs(Buffer.from(plan.stderr).toString('utf8'));
    if (jobs.length === 0) return { ...plan, code: 1, stderr: Buffer.concat([Buffer.from(plan.stderr), Buffer.from('ccd: no jobs parsed from -###\n')]) };
    let out = Buffer.alloc(0), err = Buffer.alloc(0), ms = plan.ms;
    for (const [prog, ...a] of jobs) {
      let argv0 = (a[0] === '-cc1' || a[0] === '-cc1as') ? tool : prog.split('/').pop();
      if (/^(ld|riscv32-unknown-elf-ld|ld\.lld)$/.test(argv0)) argv0 = 'ld.lld';
      const r = await run(argv0, a, pwd);
      out = Buffer.concat([out, r.stdout]); err = Buffer.concat([err, r.stderr]); ms += r.ms;
      if (r.code !== 0) return { code: r.code, stdout: out, stderr: err, ms };
    }
    return { code: 0, stdout: out, stderr: err, ms };
  }

  createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const { tool, args, pwd } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const r = await job(tool, args, pwd);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ code: r.code, stdout: Buffer.from(r.stdout).toString('base64'),
        stderr: Buffer.from(r.stderr).toString('base64'), ms: r.ms }));
    });
  }).listen(port, '127.0.0.1');
}
