// P1-B2 stage B2-5 (design docs/architecture/pico2-p1b2-user-circuits.md §5.7): the circuit file's validator under mutated input.
// Every template circuit and the presets' circuits, mutated many ways (fields removed, replaced by wrong types, numbers made huge
// or NaN-like, ends renamed, lists duplicated, text cut): the validator either accepts a file, which then compiles (or is refused
// by the netlist as a short, naming the rails), or refuses it with a CircuitError naming a field; nothing else is thrown.
// Deterministic (a fixed pseudo-random sequence).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCircuit, CircuitError } from '../src/arch/pico2/circuit/format.js';
import { compile, NetlistError } from '../src/arch/pico2/circuit/netlist.js';
import { effectiveCircuit } from '../src/arch/pico2/circuit/presets.js';

const dir = new URL('../content/pico2/templates/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
const seeds = [...index.templates.filter((t) => t.circuit).map((t) => readFileSync(new URL(t.circuit, dir), 'utf8')),
  JSON.stringify(effectiveCircuit(null, { kit: true, speaker: 14 }))];

let state = 0x2545f491;
const rnd = (n) => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) % n; };
const WRONG = [null, 0, -1, 1e300, '', 'x', '4k7', [], {}, true, '__proto__', 'GND', 'RUN', 'J0', 'R1.9', Number.MAX_SAFE_INTEGER, 'A'.repeat(300)];

/** Every path to a value inside `o`: [[key, …], …]. */
function paths(o, at = [], out = []) {
  if (o && typeof o === 'object') for (const k of Object.keys(o)) { out.push([...at, k]); paths(o[k], [...at, k], out); }
  return out;
}
function mutate(text) {
  if (rnd(10) === 0) return text.slice(0, rnd(text.length)); // cut
  const o = JSON.parse(text), all = paths(o), p = all[rnd(all.length)];
  let parent = o; for (const k of p.slice(0, -1)) parent = parent[k];
  const k = p[p.length - 1];
  switch (rnd(4)) {
    case 0: if (Array.isArray(parent)) parent.splice(Number(k), 1); else delete parent[k]; break;
    case 1: parent[k] = WRONG[rnd(WRONG.length)]; break;
    case 2: if (Array.isArray(parent[k])) parent[k] = [...parent[k], ...parent[k]]; else parent[k] = WRONG[rnd(WRONG.length)]; break;
    default: parent[`${k}_extra`] = 1;
  }
  return JSON.stringify(o);
}

test('the circuit validator under 3000 mutated files: accepted and compiled, or refused naming a field', () => {
  let accepted = 0, refused = 0;
  for (let i = 0; i < 3000; i++) {
    const text = mutate(seeds[i % seeds.length]);
    let c;
    try { c = validateCircuit(text); } catch (e) {
      assert.ok(e instanceof CircuitError, `not a CircuitError: ${e?.stack ?? e} for ${text.slice(0, 200)}`);
      assert.ok(typeof e.field === 'string' && e.field.length > 0, 'the refusal names a field');
      refused++; continue;
    }
    try { compile(c); compile(effectiveCircuit(c, { kit: true, speaker: 14 })); } catch (e) {
      assert.ok(e instanceof NetlistError || e instanceof CircuitError, `compile threw ${e?.stack ?? e} for ${text.slice(0, 200)}`);
    }
    accepted++;
  }
  assert.ok(accepted > 100 && refused > 1000, `${accepted} accepted, ${refused} refused`);
});
