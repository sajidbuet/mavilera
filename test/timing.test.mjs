// timing.test.mjs -- critical-path mode (WS-F-034, WS-V-024): the per-class
// critical paths of the chapter's table tab:sc-paths with its illustrative
// delays; the lw path and arrival times of FIG-0012; and, for random delay
// tables, the same class delays as the paths() function of the book's
// chapters/chapter06/verify_chapter06.py (skipped, saying so, without the
// book repository or Python).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { criticalPath, classControl, classTable, delayMap, PATH_CLASS } from '../src/uarch/timing.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const TABLES = read('content/data/ch06-tables.json');
const DELAYS = read('content/data/ch06-delays.json');
const GEOM = read('content/geometry/ch06.json');
const BOOK = process.env.MES_BOOK ?? join(ROOT, '..', 'book-MES');
const VERIFY = join(BOOK, 'chapters', 'chapter06', 'verify_chapter06.py');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

test('WS-V-024: every class gives the delay of tab:sc-paths; the largest sets T_c', () => {
  const t = classTable(delayMap(DELAYS), TABLES);
  const printed = Object.fromEntries(DELAYS.paths.map((p) => [p.class, p.ps]));
  for (const r of t.rows) assert.equal(r.delay, printed[r.label], r.label);
  assert.equal(t.rows.length, DELAYS.paths.length);
  assert.equal(t.tc, Math.max(...DELAYS.paths.map((p) => p.ps)));
  assert.deepEqual(t.setBy, DELAYS.paths.filter((p) => p.ps === t.tc).map((p) => Object.keys(PATH_CLASS).find((k) => PATH_CLASS[k] === p.class)));
});

test('WS-V-024: the lw path runs along the connections and arrival times of FIG-0012', () => {
  const lw = TABLES.main_decoder.columns.find((c) => c.class === 'lw');
  const r = criticalPath(delayMap(DELAYS), classControl(lw, TABLES));
  const wires = new Set(r.critical.path.flatMap((p) => p.wires));
  assert.deepEqual([...wires].sort(), GEOM.figures['FIG-0012'].highlight);
  const shown = r.critical.path.filter((p) => !['dec', 'ALUCtrl'].includes(p.node)).map((p) => p.t);
  assert.deepEqual(shown, GEOM.figures['FIG-0012'].arrivals.map((a) => a.ps).sort((a, b) => a - b));
});

const skip = !existsSync(VERIFY) ? 'book repository not found beside this one'
  : spawnSync(PYTHON, ['--version']).status !== 0 ? 'Python 3 not found' : false;

test('critical paths equal verify_chapter06.paths() for random delay tables', { skip }, () => {
  let seed = 6;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed; };
  const keys = Object.keys(delayMap(DELAYS));
  const sets = Array.from({ length: 200 }, () => Object.fromEntries(keys.map((k) => [k, 5 + (rnd() % 400)])));
  // The function is taken from the book's verification script as it stands, not copied here.
  const py = `
import json, re, sys
src = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r"^def paths\\(d\\):\\n(?:(?:    .*)?\\n)+", src, re.M)
ns = {}
exec(m.group(0), ns)
print(json.dumps([ns["paths"](d) for d in json.load(sys.stdin)]))
`;
  const r = spawnSync(PYTHON, ['-I', '-c', py, VERIFY], { input: JSON.stringify(sets), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const ref = JSON.parse(r.stdout);
  const key = { R: 'R', 'I-ALU': 'I', lw: 'lw', sw: 'sw', branch: 'branch', jal: 'jal', jalr: 'jalr', lui: 'lui', auipc: 'auipc' };
  sets.forEach((d, i) => {
    for (const row of classTable(d, TABLES).rows) assert.equal(row.delay, ref[i][key[row.cls]], `${row.cls} with ${JSON.stringify(d)}`);
  });
});
