// node-test-repro.mjs -- development tool (Windows): repeats `node --test [flags] <files>` and counts runs that do not finish
// within a timeout; on such a run it lists the process tree with CPU times and thread wait states, and asks the stuck process's
// inspector (process._debugProcess) what keeps it alive. Written for the pico2-uf2 stall (docs/architecture/pico2-uf2-test-stall.md).
//   node tools/node-test-repro.mjs <repo> <runs> <timeoutSec> [node flags] <file...>
//   env: REPRO_PIPE=1 (runner output to a pipe, else a file), REPRO_CONTINUE=1 (kill a hung run and go on counting),
//        REPRO_DIRECT=1 (run the file with plain `node`, no test runner), REPRO_PROBE=runner (probe the runner, not the child)
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { spawn, execFileSync } from 'node:child_process';
import { openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const [repo, runs, tmo, ...rest] = process.argv.slice(2);
const extra = rest.filter((a) => a.startsWith('--')), files = rest.filter((a) => !a.startsWith('--'));

function tree(root) {
  const rows = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,KernelModeTime,UserModeTime | ConvertTo-Json'], { encoding: 'utf8' }));
  const out = []; const walk = (pid, d) => { for (const r of rows) if (r.ParentProcessId === pid) { out.push({ ...r, d }); walk(r.ProcessId, d + 1); } };
  const me = rows.find((r) => r.ProcessId === root); if (me) out.push({ ...me, d: 0 });
  walk(root, 1); return out;
}
async function ask(pid, port) {
  process._debugProcess(pid);
  await new Promise((r) => setTimeout(r, 800));
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => r({ timeout: true }), 5000); });
  const expr = `JSON.stringify({ res: process.getActiveResourcesInfo(), handles: process._getActiveHandles().map(h => { const o = { t: h.constructor && h.constructor.name }; try { if (h.fd !== undefined) o.fd = h.fd; if (h._type) o.type = h._type; if (h.pid) o.pid = h.pid; if (h.spawnfile) o.file = h.spawnfile; if (h.readable !== undefined) o.readable = h.readable; if (h.writable !== undefined) o.writable = h.writable; if (h.writableLength !== undefined) o.wlen = h.writableLength; if (h._isStdio) o.stdio = true; } catch {} return o; }), reqs: process._getActiveRequests().map(r => r.constructor && r.constructor.name), argv: process.argv, exitCode: process.exitCode })`;
  const r = await call('Runtime.evaluate', { expression: expr });
  ws.close();
  return r.timeout ? 'no answer in 5 s (main thread busy or blocked)' : (r.result?.result?.value ?? JSON.stringify(r));
}

let hung = 0;
for (let i = 0; i < +runs; i++) {
  const t0 = Date.now();
  const logf = join(tmpdir(), `uf2-repro-${process.pid}-${i}.log`);
  const fd = openSync(logf, 'w');
  const PIPE = process.env.REPRO_PIPE === '1'; let pout = '';
  const p = spawn(process.execPath, [...(process.env.REPRO_DIRECT === '1' ? [] : ['--test']), ...extra, ...files], { cwd: repo, stdio: PIPE ? ['ignore', 'pipe', 'pipe'] : ['ignore', fd, fd] });
  if (PIPE) { p.stdout.on('data', (d) => { pout += d; }); p.stderr.on('data', (d) => { pout += d; }); }
  const r = await new Promise((res) => {
    const k = setTimeout(() => res({ hung: true }), +tmo * 1000);
    p.on('exit', (code) => { clearTimeout(k); res({ hung: false, code }); });
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const out = PIPE ? pout : readFileSync(logf, 'utf8');
  if (r.hung && process.env.REPRO_CONTINUE === '1') { hung++; console.log(`run ${i}: HUNG`); for (const n of tree(p.pid)) { try { process.kill(n.ProcessId); } catch {} } continue; }
  if (r.hung) {
    hung++;
    console.log(`run ${i}: HUNG after ${dt}s (runner pid ${p.pid}); output tail:\n${out.slice(-600)}`);
    const nodes = tree(p.pid);
    for (const n of nodes) console.log(`${'  '.repeat(n.d)}${n.ProcessId} cpu(user ms)=${Math.round(n.UserModeTime / 1e4)} ${n.CommandLine}`);
    const which = process.env.REPRO_PROBE === 'runner' ? nodes[0] : nodes[nodes.length - 1];
    try { console.log(`probe ${which.ProcessId} -> ${await ask(which.ProcessId, 9229)}`); } catch (e) { console.log(`inspector failed: ${e.message}`); }
    for (const n of nodes) console.log(`threads of ${n.ProcessId}:\n` + execFileSync('pwsh', ['-NoProfile', '-Command',
      `(Get-Process -Id ${n.ProcessId}).Threads | ForEach-Object { '{0} {1} {2} {3:N0}ms start={4}' -f $_.Id, $_.ThreadState, $(if ($_.ThreadState -eq 'Wait') { $_.WaitReason } else { '' }), $_.TotalProcessorTime.TotalMilliseconds, $_.StartAddress }; 'handles: ' + (Get-Process -Id ${n.ProcessId}).HandleCount`], { encoding: 'utf8' }));
    await new Promise((r) => setTimeout(r, 3000));
    for (const n of tree(p.pid)) console.log(`after probe: ${n.ProcessId} cpu(user ms)=${Math.round(n.UserModeTime / 1e4)}`);
    p.kill(); for (const n of nodes) { try { process.kill(n.ProcessId); } catch {} }
    process.exit(2);
  }
  const m = out.match(/ℹ (pass|fail) \d+/g);
  console.log(`run ${i}: exit ${r.code} in ${dt}s ${m ? m.join(' ') : ''}`);
}
console.log(`hung ${hung} of ${runs}`);
