// Conformance suite of the architecture contract (spec W-D29; docs/architecture/arch-contract.md §3): every
// architecture of src/arch/registry.js, and the test fixture acc4, must pass it. Static shape
// (validateDescriptor), then behaviour on the architecture's default program: assemble and disassemble, the
// engine's state, step records against the state, step back, run with a breakpoint and to the end, snapshot and
// restore, side-effect-free peek, capabilities with reasons.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHITECTURES } from '../src/arch/registry.js';
import { validateDescriptor, capability, CAPABILITIES, STOP, ENGINE_HOOKS, STEP_OVER_HOOKS, withVariant } from '../src/arch/contract.js';

const MODULES = { ...ARCHITECTURES, acc4: () => import('./fixtures/arch/acc4/index.js') };
const BUDGET = 1_000_000;

// contract v9: every variant of a module runs the suite as a descriptor of its own (`gpu@microisa`)
const ENTRIES = {};
for (const [key, load] of Object.entries(MODULES)) {
  const { descriptor } = await load();
  ENTRIES[key] = { arch: key, get: () => withVariant(descriptor, null) };
  for (const v of Object.keys(descriptor.variants ?? {})) ENTRIES[`${key}@${v}`] = { arch: key, get: () => withVariant(descriptor, v) };
}

const regIds = (d) => d.registers.groups.flatMap((g) => g.registers.map((r) => r.id));
/** The default program, for the variant's first profile when the module has variants (unchanged otherwise). */
const program = (d) => d.language.assemble([{ name: `main${d.language.extension}`, text: d.language.defaultSource }],
  d.variants ? { profile: d.engine.profiles.find((p) => (p.variant ?? null) === d.activeVariant).id } : undefined);
const memory = (d, e) => d.addressSpace.regions.filter((r) => r.kind !== 'device').map((r) => [...e.peek(r.base, Math.min(r.size, 4096))]);

for (const [key, { arch, get }] of Object.entries(ENTRIES)) {
  test(`${key}: the descriptor has the contract's shape`, async () => {
    const d = await get();
    assert.deepEqual(validateDescriptor(d), []);
    assert.equal(d.id, arch);
  });

  test(`${key}: the default program assembles; the listing disassembles`, async () => {
    const d = await get();
    const p = program(d);
    assert.ok(p.ok, JSON.stringify(p.diagnostics));
    assert.ok(p.listing.length > 0);
    assert.ok(p.symbols && typeof p.symbols === 'object' && !(p.symbols instanceof Map), 'symbols: a plain record');
    assert.ok(Array.isArray(p.diagnostics) && Array.isArray(p.segments) && Number.isInteger(p.entry));
    for (const row of p.listing) {
      assert.equal(typeof d.language.disassemble(row.word, row.address), 'string');
      assert.ok(row.size >= 1 && row.address >= 0);
      if (d.language.fields) {
        for (const f of d.language.fields(row.word, row.address)) {
          assert.ok(typeof f.name === 'string' && /^\d+(:\d+)?$/.test(f.bits) && Number.isInteger(f.value), JSON.stringify(f));
        }
      }
    }
  });

  test(`${key}: engine state after a reset and each step agrees with the step record`, async () => {
    const d = await get();
    const p = program(d);
    const e = d.engine.create(p);
    const ids = regIds(d);
    let s = e.state();
    assert.equal(s.pc, p.entry);
    assert.equal(s.retired, 0);
    assert.equal(s.halted, false);
    assert.deepEqual(Object.keys(s.registers).sort(), [...ids].sort());
    for (let i = 0; i < 50 && !s.halted; i++) {
      const r = e.step();
      if (!r) break;
      s = e.state();
      for (const k of ['pc', 'word', 'size', 'nextPc']) assert.equal(typeof r[k], 'number', k);
      assert.ok(Array.isArray(r.registers) && Array.isArray(r.memory));
      for (const w of r.registers) {
        assert.ok(ids.includes(w.id), `unknown register ${w.id}`);
        if (w.id !== d.registers.pc) assert.equal(s.registers[w.id], w.value, `register ${w.id}`);
      }
      for (const m of r.memory) {
        const got = e.peek(m.address, m.size);
        const v = d.addressSpace.endianness === 'little' ? got.reduceRight((a, b) => a * 256 + b, 0) : got.reduce((a, b) => a * 256 + b, 0);
        assert.equal(v >>> 0, m.value >>> 0, `memory ${m.address}`);
      }
      assert.equal(s.pc, r.nextPc);
      const last = e.last(); // v2: the newest record, without what only step() reports (halt, output, trap)
      for (const k of ['pc', 'word', 'size', 'nextPc', 'registers', 'memory']) assert.deepEqual(last[k], r[k], `last().${k}`);
    }
    if (s.steps !== undefined) assert.ok(Number.isInteger(s.steps) && s.steps >= s.retired, 'v3: steps'); // a trap may retire nothing
    e.reset();
    assert.equal(e.last(), null, 'last() after a reset');
  });

  test(`${key}: v4: scratch, importers and exports are functions; an exported image loads back`, async () => {
    const d = await get();
    const p = program(d);
    if (d.language.scratch) assert.equal(d.language.scratch('').kind, 'empty');
    if (d.language.importers) for (const i of await d.language.importers()) assert.ok(typeof i.test === 'function' && typeof i.convert === 'function', i.id);
    if (d.exports?.image && d.language.loadImage) {
      const back = d.language.loadImage(d.exports.image(p).hex, 'hex', 'image.hex');
      const text = p.listing.filter((r) => r.address < back.listing.length * back.listing[0].size);
      assert.deepEqual(back.listing.slice(0, text.length).map((r) => r.word), text.map((r) => r.word));
      assert.ok(back.ok && Array.isArray(back.diagnostics));
    }
    if (d.exports?.trace) {
      const { records } = d.exports.trace(p, { profile: d.engine.profiles?.[0]?.id, cap: 100 });
      assert.ok(records.length > 0 && typeof d.exports.traceJsonLines(records) === 'string' && typeof d.exports.traceCsv(records) === 'string');
    }
  });

  test(`${key}: v5: editor help for every mnemonic; reads, platform and assembled have their shape`, async () => {
    const d = await get();
    const E = d.language.editor;
    if (E.help) for (const m of E.mnemonics) assert.ok(['instruction', 'pseudo'].includes(E.help(m)?.kind), `help(${m})`);
    if (E.detail) for (const m of E.mnemonics) assert.equal(typeof E.detail(m, 'mnemonic'), 'string', m);
    const p = program(d);
    if (p.assembled !== undefined) assert.equal(typeof p.assembled, 'boolean');
    const e = d.engine.create(p);
    for (let i = 0; i < 50; i++) {
      const r = e.step();
      if (!r) break;
      for (const x of r.reads ?? []) assert.ok(Number.isInteger(x.address) && x.size >= 1, JSON.stringify(x));
    }
    if (e.platform) { const pl = e.platform(); assert.ok(pl === null || (typeof pl === 'object' && 'platform' in pl)); }
  });

  test(`${key}: a source that does not assemble gives error diagnostics (v3: length and note optional)`, async () => {
    const d = await get();
    const p = d.language.assemble([{ name: `bad${d.language.extension}`, text: '@@@ 1 2 3\n' }]);
    assert.equal(p.ok, false);
    const errs = p.diagnostics.filter((x) => x.severity === 'error');
    assert.ok(errs.length > 0);
    for (const x of errs) {
      assert.equal(typeof x.message, 'string');
      if (x.length !== undefined) assert.ok(Number.isInteger(x.length) && x.length >= 0);
      if (x.note !== undefined) assert.equal(typeof x.note, 'string');
    }
  });

  // A capability an architecture lacks is checked too, not skipped (a skipped check is no evidence, WS-V-040):
  // it must resolve to a reason the shell can show.
  const lacks = (d, cap) => {
    const c = capability(d, cap);
    if (c.enabled) return false;
    assert.ok(typeof c.reason === 'string' && c.reason.length > 0, `${cap}: a disabled capability has a reason`);
    return true;
  };

  test(`${key}: v2 engine hooks are functions; stepOver has its three; a watched register stops a run (or watchpoints have a reason)`, async () => {
    const d = await get();
    const p = program(d);
    const e = d.engine.create(p);
    for (const k of ENGINE_HOOKS) if (e[k] !== undefined) assert.equal(typeof e[k], 'function', k);
    if (capability(d, 'stepOver').enabled) for (const k of STEP_OVER_HOOKS) assert.equal(typeof e[k], 'function', k);
    if (lacks(d, 'watchpoints')) return;
    let w = null;
    for (let i = 0; i < 50 && !w; i++) w = e.step()?.registers.find((x) => x.id !== d.registers.pc) ?? null;
    assert.ok(w, 'the default program writes a register');
    e.reset();
    assert.equal(e.run({ chunk: BUDGET, watch: { registers: new Set([w.id]) } }), STOP.WATCH);
    assert.ok(e.last().registers.some((x) => x.id === w.id), 'the stopping step wrote the watched register'); // a step may write several (SAP-1, ARM LDM)
  });

  test(`${key}: step back restores registers, memory and the PC (or backStep has a reason)`, async () => {
    const d = await get();
    if (lacks(d, 'backStep')) return;
    const e = d.engine.create(program(d));
    const before = [];
    for (let i = 0; i < 20; i++) {
      before.push([e.state(), memory(d, e)]);
      if (!e.step()) { before.pop(); break; }
    }
    for (let i = before.length - 1; i >= 0; i--) {
      assert.ok(e.back());
      assert.deepEqual([e.state(), memory(d, e)], before[i], `after ${i} steps`);
    }
    assert.equal(e.back(), false);
  });

  test(`${key}: run stops at a breakpoint, then runs to the halt`, async () => {
    const d = await get();
    const p = program(d);
    const e = d.engine.create(p);
    const second = (() => { e.step(); const pc = e.state().pc; e.reset(); return pc; })();
    assert.equal(e.state().retired, 0, 'reset');
    if (capability(d, 'breakpoints').enabled) {
      assert.equal(e.run({ chunk: BUDGET, breakpoints: new Set([second]) }), STOP.BREAK);
      assert.equal(e.state().pc, second);
    }
    let stop;
    do stop = e.run({ chunk: BUDGET }); while (stop === STOP.CHUNK);
    assert.equal(stop, STOP.HALT);
    assert.ok(Object.values(STOP).includes(stop));
    assert.equal(e.state().halted, true);
  });

  test(`${key}: snapshot and restore; peek has no side effects`, async () => {
    const d = await get();
    const e = d.engine.create(program(d));
    for (let i = 0; i < 3; i++) e.step();
    const snap = structuredClone(e.snapshot());
    const at = [e.state(), memory(d, e)];
    assert.deepEqual(memory(d, e), at[1], 'peek twice');
    assert.deepEqual(e.state(), at[0], 'peek changes no state');
    for (let i = 0; i < 5; i++) e.step();
    e.restore(snap);
    assert.deepEqual([e.state(), memory(d, e)], at);
  });

  test(`${key}: capabilities are known and every disabled one has a reason`, async () => {
    const d = await get();
    for (const k of CAPABILITIES) {
      const c = capability(d, k);
      assert.ok(c.enabled || (typeof c.reason === 'string' && c.reason), k);
    }
  });
}

test('the validator reports a malformed descriptor', () => {
  const bad = validateDescriptor({ contract: 1, id: 'X', name: '', strings: {}, capabilities: { teleport: true },
    language: { describe: 1 }, registers: { groups: [], pc: 'pc', roles: { sp: 'x2' } }, addressSpace: {},
    engine: { profiles: [{ id: 'p', memory: 'flat' }] }, views: [{ id: 'dp', kind: 'datapath', profile: 'q', settings: { key: 'dp', defaults: { a: 'z' }, values: { a: ['y'] } } }] });
  for (const want of ['contract 1, expected 9','id "X"', 'name', 'capability teleport is not in CAPABILITIES', 'language.assemble and language.disassemble',
    'language.describe is a function', 'registers.groups', 'registers.roles.sp x2 is no register', 'profile p: memory flat',
    'engine.create', 'views: the first is of kind isa', 'view dp: profile q is not in engine.profiles',
    'view dp: setting a: default among values']) assert.ok(bad.includes(want), `${want} in ${bad.join('; ')}`);
});
