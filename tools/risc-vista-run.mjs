// risc-vista-run.mjs -- headless runner (WS-F-127): the simulator's own modules
// under Node.js, on a program and a profile, printing a JSON report and
// writing the exports of spec §13. For the conformance tests and for
// instructors' checks on their own machines; not a hosted service (WS-N-008).
//
//   node tools/risc-vista-run.mjs [options] file.s [more.s ...]
//
//   --profile iss|ch06|ch07|ch08  machine profile (default iss)
//   --model                       run the datapath model of a ch06-ch08 profile
//                                 (cycles, CPI) instead of the ISA simulator
//   --subset lab|ext              ch06 options (laboratory subset, xori/lbu extension)
//   --jalr                        ch07: the JALR state (optional extension of the controller)
//   --hazard none|mem|memwb|stall|full, --predictor none|1bit|2bit, --entries N,
//   --early                       ch08 options (default: the reference processor)
//   --limit N                     instruction or cycle budget (default 10 000 000)
//   --trace-json FILE, --trace-csv FILE   trace of retired instructions ('-': stdout)
//   --golden FILE                 golden dump of the model (with --model)
//   --vcd FILE                    VCD of the model's signals (with --model)
//   --compare                     the comparison of the three processors (WS-F-060)
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { assemble } from '../src/asm/assembler.js';
import { Hart, run, SimError } from '../src/core/iss.js';
import { PROFILES } from '../src/core/profiles.js';
import { SingleCycle } from '../src/uarch/single.js';
import { Multicycle } from '../src/uarch/multi.js';
import { Pipeline } from '../src/uarch/pipe.js';
import { SINGLE_SIGNALS, SINGLE_EXT_SIGNALS, MULTI_SIGNALS, PIPE_SIGNALS, PIPE_EXT_SIGNALS } from '../src/uarch/signals.js';
import { goldenText, traceRecords, traceJsonLines, traceCsv, recordFrames, vcd } from '../src/core/exports.js';
import { compare } from '../src/uarch/compare.js';
import { withJalr } from '../src/uarch/ch07-jalr.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const content = (rel) => JSON.parse(readFileSync(join(ROOT, 'content', rel), 'utf8'));
// the multicycle tables with the optional JALR state merged back where its file is present (src/uarch/ch07-jalr.js)
const tables7 = () => withJalr(null, content('data/ch07-tables.json'), existsSync(join(ROOT, 'content/data/ch07-jalr.json')) ? content('data/ch07-jalr.json') : null).t7;

function parse(argv) {
  const o = { profile: 'iss', files: [], limit: 10_000_000, predictor: 'none', entries: 8, hazard: 'full' };
  const flags = new Set(['--model', '--jalr', '--early', '--compare']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags.has(a)) o[a.slice(2)] = true;
    else if (a.startsWith('--')) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      o[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
    } else o.files.push(a);
  }
  o.limit = Number(o.limit);
  o.entries = Number(o.entries);
  if (!PROFILES[o.profile]) throw new Error(`unknown profile ${o.profile}`);
  if (!o.files.length) throw new Error('no source file');
  if (o.model && o.profile === 'iss') throw new Error('--model needs a profile ch06, ch07 or ch08');
  if ((o.golden || o.vcd) && !o.model) throw new Error('--golden and --vcd need --model');
  return o;
}

const write = (file, text) => (file === '-' ? process.stdout.write(text) : writeFileSync(file, text));

function makeModel(o) {
  const t6 = content('data/ch06-tables.json');
  if (o.profile === 'ch06') {
    const ext = o.subset === 'ext';
    return { model: new SingleCycle(t6, { ext, historyLimit: 0 }), signals: ext ? [...SINGLE_SIGNALS, ...SINGLE_EXT_SIGNALS] : SINGLE_SIGNALS, module: 'rv32i_single' };
  }
  if (o.profile === 'ch07') {
    return { model: new Multicycle(t6, tables7(), { jalr: Boolean(o.jalr), historyLimit: 0 }), signals: MULTI_SIGNALS, module: 'rv32i_multi' };
  }
  const ext = PIPE_EXT_SIGNALS.filter((s) => o.early || !s.extension);
  return {
    model: new Pipeline(t6, { hazard: o.hazard, predictor: o.predictor, entries: o.entries, early: Boolean(o.early), historyLimit: 0 }),
    signals: [...PIPE_SIGNALS, ...ext], module: 'rv32i_pipe',
  };
}

function main(argv) {
  const o = parse(argv);
  const files = o.files.map((f) => ({ name: f, text: readFileSync(f, 'utf8') }));
  if (o.compare) {
    const data = { t6: content('data/ch06-tables.json'), delays6: content('data/ch06-delays.json'),
      t7: tables7(), timing8: content('data/ch08-timing.json') };
    const r = compare(files, data, { jalr: Boolean(o.jalr), predictor: o.predictor, entries: o.entries, limit: o.limit });
    process.stdout.write(`${JSON.stringify(r, null, 1)}\n`);
    return 0;
  }
  const prog = assemble(files, { profile: o.profile, subset: o.subset });
  const diagnostics = [...prog.errors.map((e) => ({ file: e.file, line: e.line, column: e.column, message: e.message })),
    ...prog.profileErrors.map((e) => ({ file: e.file, line: e.line, message: `${e.mnemonic}: not implemented by the ${PROFILES[e.profile].processor}` }))];
  if (diagnostics.length) {
    process.stdout.write(`${JSON.stringify({ ok: false, diagnostics }, null, 1)}\n`);
    return 2;
  }
  let report;
  let count;
  if (o.model) {
    const { model, signals, module } = makeModel(o);
    model.load(prog);
    let stop;
    try { stop = model.run(o.limit); } catch (e) { stop = 'limit'; }
    const n = o.profile === 'ch06' ? model.cycle : o.profile === 'ch07' ? model.retired : model.stats.retired;
    count = n;
    report = { ok: stop === 'halt', profile: o.profile, model: module, stop, error: model.error ?? null,
      cycles: model.cycle, instructions: n, cpi: n ? model.cycle / n : null, halt_pc: model.haltPc ?? model.pc,
      registers: Array.from(model.x) };
    if (o.golden) write(o.golden, goldenText(model.golden()));
    if (o.vcd) {
      const fresh = makeModel(o).model;
      fresh.load(prog);
      const { frames } = recordFrames(fresh, model.cycle);
      write(o.vcd, vcd(frames, signals, { module, comment: `${o.files.join(' ')}, profile ${o.profile}; one cycle = 10 ns of the time axis` }));
    }
  } else {
    const hart = new Hart(prog, { profile: o.profile, abiCheck: true });
    let error = null;
    try { run(hart, o.limit); } catch (e) { if (!(e instanceof SimError)) throw e; error = e.message; }
    count = hart.instret;
    report = { ok: !error, profile: o.profile, error, ...hart.report(), output: new TextDecoder().decode(new Uint8Array(hart.output)),
      abi_violations: hart.abiViolations };
  }
  if (o.traceJson || o.traceCsv) {
    const { records } = traceRecords(prog, o.profile, count);
    if (o.traceJson) write(o.traceJson, traceJsonLines(records));
    if (o.traceCsv) write(o.traceCsv, traceCsv(records));
  }
  if (![o.traceJson, o.traceCsv, o.golden, o.vcd].includes('-')) process.stdout.write(`${JSON.stringify(report, null, 1)}\n`);
  return report.ok ? 0 : 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`risc-vista-run: ${e.message}\n`);
  process.exitCode = 2;
}
