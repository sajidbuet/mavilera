// pico2-pioasm-check.mjs -- the module's PIO assembler (src/arch/pico2/pio/asm.js) against the Pico SDK's pioasm (P1-M8, design §4 item 2):
// for every <name>.pio.h that pioasm made in a pico-examples build, assemble the matching .pio source and compare, program by
// program, the instruction words, wrap target, wrap, PIO version, public defines and labels, and the side-set settings of the
// default configuration. pioasm's default PIO version (its -v option) is taken from its header when the source has no .pio_version.
//
//   node tools/pico2-pioasm-check.mjs --build <pico-examples build> --src <pico-examples> [--sdk <pico-sdk>] [--json out.json]
//
// Development only (reads files outside the repository; they are not part of it).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import fs from 'node:fs';
import path from 'node:path';
import { assemblePio, disassemblePio } from '../src/arch/pico2/pio/asm.js';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const build = opt('--build'), src = opt('--src'), sdk = opt('--sdk');
if (!build || !src) { console.error('usage: node tools/pico2-pioasm-check.mjs --build <dir> --src <pico-examples> [--sdk <pico-sdk>]'); process.exit(2); }

const walk = (d, f, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, f, out); else if (f(e.name)) out.push(p); } return out; };
const sources = [...walk(src, (n) => n.endsWith('.pio')), ...(sdk ? walk(sdk, (n) => n.endsWith('.pio')) : [])];
const headers = walk(build, (n) => n.endsWith('.pio.h'));

/** pioasm's header, per program: words, wrap target, wrap, version, defines, offsets, side-set call. */
function readHeader(text) {
  const progs = new Map();
  const re = /^\/\/ -+ \/\/\n\/\/ (\w+) \/\/\n\/\/ -+ \/\/\n([\s\S]*?)(?=^\/\/ -+ \/\/\n\/\/ \w+ \/\/\n|(?![\s\S]))/gm;
  for (const m of text.matchAll(re)) {
    const name = m[1], body = m[2];
    const num = (k) => { const r = new RegExp(`#define ${name}_${k} (\\d+)`).exec(body); return r ? Number(r[1]) : null; };
    const arr = new RegExp(`${name}_program_instructions\\[\\] = \\{([\\s\\S]*?)\\};`).exec(body);
    if (!arr) continue;
    const words = [...arr[1].matchAll(/0x([0-9a-f]{4}),/g)].map((x) => parseInt(x[1], 16));
    const text = [...arr[1].matchAll(/0x[0-9a-f]{4}, \/\/ +\d+: (.*)$/gm)].map((x) => x[1].replace(/\s+$/, ''));
    const defs = [...body.matchAll(new RegExp(`#define ${name}_(\\w+) (-?\\d+)u?\\n`, 'g'))].map((x) => [x[1], Number(x[2])]).filter(([k]) => !['wrap_target', 'wrap', 'pio_version'].includes(k));
    const side = /sm_config_set_sideset\(&c, (\d+), (true|false), (true|false)\);\n    return c;/.exec(body) ?? /program_get_default_config[\s\S]*?sm_config_set_sideset\(&c, (\d+), (true|false), (true|false)\);/.exec(body);
    const inDefault = /program_get_default_config\(uint offset\) \{([\s\S]*?)return c;/.exec(body);
    const sideDefault = inDefault ? /sm_config_set_sideset\(&c, (\d+), (true|false), (true|false)\)/.exec(inDefault[1]) : null;
    progs.set(name, { words, text, wrapTarget: num('wrap_target'), wrap: num('wrap'), version: num('pio_version'), defs: new Map(defs),
      sideset: sideDefault ? { bits: Number(sideDefault[1]), opt: sideDefault[2] === 'true', pindirs: sideDefault[3] === 'true' } : null });
    void side;
  }
  return progs;
}

const results = [];
let failed = 0, programs = 0, words = 0;
for (const h of headers) {
  const base = path.basename(h, '.h');
  const cands = sources.filter((s) => path.basename(s) === base);
  const rel = path.relative(build, h);
  if (!cands.length) { results.push({ header: rel, error: 'no source found' }); failed++; console.log(`FAIL ${rel}: no source`); continue; }
  const want = readHeader(fs.readFileSync(h, 'utf8').replace(/\r\n/g, '\n'));
  const text = fs.readFileSync(cands[0], 'utf8');
  const v0 = [...want.values()].some((p) => p.version === 1) && !/\.pio_version/.test(text) ? 1 : 0;
  const got = assemblePio(text, { defaultVersion: v0 });
  const diffs = [];
  if (!got.ok) diffs.push(`assembler errors: ${got.diagnostics.map((d) => `${d.line}: ${d.message}`).join('; ')}`);
  for (const [name, w] of want) {
    programs++; words += w.words.length;
    const g = got.programs.find((p) => p.name === name);
    if (!g) { diffs.push(`${name}: missing`); continue; }
    if (g.words.length !== w.words.length || g.words.some((x, i) => x !== w.words[i])) {
      const i = g.words.findIndex((x, k) => x !== w.words[k]);
      diffs.push(`${name}: word ${i}: 0x${(g.words[i] ?? 0).toString(16)} vs pioasm 0x${(w.words[i] ?? 0).toString(16)} (lengths ${g.words.length}/${w.words.length})`);
    }
    const bits = g.sideset ? g.sideset.bits + (g.sideset.opt ? 1 : 0) : 0;
    w.text.forEach((t, i) => { const d = disassemblePio(w.words[i], bits, g.sideset?.opt ?? false); if (d !== t) diffs.push(`${name}: word ${i} disassembles as "${d}", pioasm "${t}"`); });
    if (g.wrapTarget !== w.wrapTarget || g.wrap !== w.wrap) diffs.push(`${name}: wrap ${g.wrapTarget}-${g.wrap} vs ${w.wrapTarget}-${w.wrap}`);
    if (g.version !== w.version) diffs.push(`${name}: pio_version ${g.version} vs ${w.version}`);
    const gs = g.sideset ? { bits: g.sideset.bits + (g.sideset.opt ? 1 : 0), opt: g.sideset.opt, pindirs: g.sideset.pindirs } : null;
    if (JSON.stringify(gs) !== JSON.stringify(w.sideset)) diffs.push(`${name}: sideset ${JSON.stringify(gs)} vs ${JSON.stringify(w.sideset)}`);
    for (const [k, v] of w.defs) {
      const isOff = k.startsWith('offset_'), nm = isOff ? k.slice(7) : k;
      const s = g.publics.find((x) => x.name === nm && x.label === isOff);
      if (!s || s.value !== v) diffs.push(`${name}: ${k} ${s?.value} vs ${v}`);
    }
  }
  const ok = diffs.length === 0;
  if (!ok) failed++;
  results.push({ header: rel, source: cands[0], programs: [...want.keys()], ok, diffs });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${rel} (${[...want.keys()].join(', ')})${ok ? '' : `\n     ${diffs.join('\n     ')}`}`);
}
console.log(`${headers.length} headers, ${programs} programs, ${words} instructions (words and their disassembly): ${failed ? `${failed} header(s) differ` : 'all identical'}`);
if (opt('--json')) fs.writeFileSync(opt('--json'), `${JSON.stringify({ date: new Date().toISOString(), headers: headers.length, programs, failed, results }, null, 1)}\n`);
process.exit(failed ? 1 : 0);
