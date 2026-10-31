// capabilities.test.mjs -- the shell's capability handling (spec W-D29; docs/architecture/arch-contract.md phase 4):
// every capability is on or off with a reason worded in the strings, an item whose capability is off is disabled with
// that reason, and the shell handles every capability of the contract.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAPABILITIES } from '../src/arch/contract.js';
import { capabilityStates, gate, reasonText } from '../src/shell/capabilities.js';
import { STRINGS } from '../src/ui/strings.js';
import { RISCV_STRINGS } from '../src/arch/riscv/strings.js';
import { descriptor as riscv } from '../src/arch/riscv/index.js';

// the strings as the shell has them once RISC-V's are merged (mergeStrings freezes the module's, so not called here)
const S = { capability: { ...STRINGS.capability, ...RISCV_STRINGS.capability } };

test('RISC-V: every capability on but traps, which its profile with traps turns on (and the Worker off)', () => {
  const st = capabilityStates(riscv, S);
  assert.deepEqual(Object.keys(st), [...CAPABILITIES]);
  for (const k of CAPABILITIES) assert.equal(st[k].enabled, k !== 'traps', k);
  assert.equal(st.traps.text, RISCV_STRINGS.capability.trapsNeedPriv);
  const priv = riscv.engine.profiles.find((p) => p.id === 'iss-priv');
  const sp = capabilityStates(riscv, S, priv);
  assert.equal(sp.traps.enabled, true);
  assert.equal(sp.worker.enabled, false);
  assert.equal(sp.worker.text, RISCV_STRINGS.capability.privNoWorker);
});

test('every reason the RISC-V descriptor gives is worded in the strings', () => {
  const reasons = [riscv.capabilities, ...riscv.engine.profiles.map((p) => p.capabilities ?? {})]
    .flatMap((c) => Object.values(c)).filter((v) => v !== true).map((v) => v.reason);
  assert.ok(reasons.length >= 2);
  for (const r of reasons) assert.equal(typeof S.capability[r], 'string', r);
});

test('an architecture without capabilities: everything off, with the shell\'s generic reason', () => {
  const st = capabilityStates({ capabilities: {} }, S);
  for (const k of CAPABILITIES) {
    assert.equal(st[k].enabled, false, k);
    assert.equal(st[k].text, STRINGS.capability.notSupported, k);
  }
  assert.equal(reasonText('A reason in plain words.', S), 'A reason in plain words.', 'a reason without a key is its own text');
});

test('gate: an item whose capability is off is disabled, with the reason as its tooltip; one that is on is untouched', () => {
  const node = () => ({ attrs: {}, dataset: {}, title: 'Step back', disabled: false, setAttribute(k, v) { this.attrs[k] = v; } });
  const on = node();
  assert.equal(gate(on, { enabled: true, text: null }), on);
  assert.deepEqual([on.disabled, on.title, on.attrs], [false, 'Step back', {}]);
  const off = gate(node(), { enabled: false, text: 'Not available for this architecture.' });
  assert.deepEqual([off.disabled, off.title, off.attrs['aria-disabled'], 'capabilityOff' in off.dataset],
    [true, 'Not available for this architecture.', 'true', true]);
});

test('the shell handles every capability of the contract', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  // decided elsewhere: compare (the views are the architecture's, validateDescriptor ties kind compare to it),
  // traps and uninitCheck (the engine's), worker (read with the profile in startRun)
  const elsewhere = new Set(['compare', 'traps', 'uninitCheck']);
  for (const k of CAPABILITIES.filter((c) => !elsewhere.has(c))) {
    assert.ok(new RegExp(`CAP\\.${k}\\b|can\\('${k}'\\)|capability\\(arch, '${k}'`).test(main), `main.js does not handle ${k}`);
  }
});
