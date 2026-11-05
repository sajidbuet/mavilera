// Contract version 9 (docs/architecture/arch-contract.md §26): profile variants with their own language,
// registers and address space. The validator's checks, withVariant's merge, share links of another variant and the
// storage keys kept per variant. The modules with variants also run the whole conformance suite per variant
// (test/arch-contract.test.mjs).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDescriptor, withVariant, variantOf, variantProfiles, CONTRACT_VERSION } from '../src/arch/contract.js';
import { createShare, ShareError } from '../src/shell/share.js';
import { shareSchema } from '../src/shell/share-schema.js';
import { scoped, setStorageVariant } from '../src/ui/dom.js';

const { descriptor: acc4 } = await import('./fixtures/arch/acc4/index.js');
const OWN = acc4.engine.profiles ?? [{ id: 'one', label: 'One' }]; // acc4 declares none

/** acc4 with a second variant `alt`: another language extension, register set, view and a capability. */
function twoVariants() {
  const altLanguage = { ...acc4.language, extension: '.alt', comment: '#' };
  const altRegisters = { groups: [{ id: 'cpu', label: 'CPU', registers: [{ id: 'B', name: 'B', width: 16 }, { id: 'PC', name: 'PC', width: 4 }] }], pc: 'PC' };
  return {
    ...acc4,
    strings: { ...acc4.strings, nested: { a: 1, b: 2 } },
    engine: { ...acc4.engine, profiles: [...OWN, { id: 'alt-one', label: 'Alt one', variant: 'alt' }, { id: 'alt-two', label: 'Alt two', variant: 'alt' }] },
    variants: {
      alt: {
        label: 'Alternative',
        load: async () => ({
          language: altLanguage, registers: altRegisters,
          views: [{ id: 'isa', label: 'Instructions', icon: 'chip', kind: 'isa' }, { id: 'alt-view', label: 'Alt', icon: 'chip', kind: 'datapath', profile: 'alt-two', load: async () => ({}) }],
          capabilities: { breakpoints: { enabled: false, reason: 'not in alt' } },
          strings: { nested: { b: 3 } },
          content: { templates: 'content/alt/templates/index.json' },
        }),
      },
    },
  };
}

test('v9: the version is 9', () => assert.equal(CONTRACT_VERSION, 9));

test('v9: a descriptor with variants validates, in its own variant and in the other', async () => {
  const d = twoVariants();
  assert.deepEqual(validateDescriptor(d), []);
  const alt = await withVariant(d, 'alt');
  assert.deepEqual(validateDescriptor(alt), []);
  assert.equal(alt.activeVariant, 'alt');
  assert.equal(alt.language.extension, '.alt');
  assert.equal(alt.registers.groups[0].registers[0].id, 'B');
  assert.equal(alt.id, 'acc4', 'the id stays the module\'s');
  assert.equal(alt.engine, d.engine, 'the engine stays the module\'s');
  assert.deepEqual(alt.strings.nested, { a: 1, b: 3 }, 'strings merged key by key');
  assert.equal(alt.capabilities.breakpoints.reason, 'not in alt');
  assert.equal(alt.capabilities.backStep, d.capabilities.backStep, 'other capabilities kept');
  assert.equal(alt.content.templates, 'content/alt/templates/index.json');
  const own = await withVariant(d, null);
  assert.equal(own.activeVariant, null);
  assert.equal(own.language, d.language);
  assert.equal((await withVariant(acc4, null)).language, acc4.language, 'a module without variants is unchanged');
});

test('v9: variantOf and variantProfiles', () => {
  const d = twoVariants();
  assert.equal(variantOf(d, OWN[0].id), null);
  assert.equal(variantOf(d, 'alt-two'), 'alt');
  assert.equal(variantOf(d, 'nothing'), undefined);
  assert.deepEqual(variantProfiles(d, 'alt').map((p) => p.id), ['alt-one', 'alt-two']);
});

test('v9: the validator reports bad variants', async () => {
  const d = twoVariants();
  const bad = validateDescriptor({ ...d, engine: { ...d.engine, profiles: [...d.engine.profiles, { id: 'lost', label: 'Lost', variant: 'nowhere' }] },
    variants: { ...d.variants, Empty: { label: '', load: 1 } } });
  for (const want of ['profile lost: variant nowhere is not in variants', 'variant Empty: id, label, load', 'variant Empty: no profile belongs to it']) {
    assert.ok(bad.includes(want), `${want} in ${bad.join('; ')}`);
  }
  // a view bound to a profile of another variant
  const own = await withVariant(d, null);
  const wrong = validateDescriptor({ ...own, views: [...own.views, { id: 'x', label: 'X', icon: 'chip', kind: 'datapath', profile: 'alt-one', load: async () => ({}) }] });
  assert.ok(wrong.includes('view x: profile alt-one is of another variant'), wrong.join('; '));
});

test('v9: withVariant refuses keys a variant may not replace', async () => {
  const d = twoVariants();
  await assert.rejects(withVariant({ ...d, variants: { alt: { label: 'A', load: async () => ({ engine: {} }) } } }, 'alt'), /engine cannot be replaced/);
  await assert.rejects(withVariant({ ...d, variants: { alt: { label: 'A', load: async () => ({ content: { logo: 'x.svg' } }) } } }, 'alt'), /content\.logo cannot be replaced/);
});

test('v9: a link of another variant is refused with code variant before its view is checked', async () => {
  const d = twoVariants();
  const own = createShare(shareSchema(await withVariant(d, null)));
  const alt = createShare(shareSchema(await withVariant(d, 'alt')));
  const state = { arch: 'acc4', view: 'alt-view', profile: 'alt-two', lang: 'asm', source: 'nop' };
  const frag = await alt.encodeFragment(state);
  await assert.rejects(own.decodeFragment(frag), (e) => e instanceof ShareError && e.code === 'variant' && e.data.profile === 'alt-two');
  assert.equal((await alt.decodeFragment(frag)).view, 'alt-view');
  // without a profile, a link takes the first profile of the page's variant
  assert.equal(alt.normalise({ arch: 'acc4', source: 'x' }).profile, 'alt-one');
  assert.equal(own.normalise({ arch: 'acc4', source: 'x' }).profile, OWN[0].id);
});

test('v9: storage keys of a variant other than the descriptor\'s own get @variant; the profile and layout do not', () => {
  try {
    setStorageVariant(null);
    assert.equal(scoped('pips.source'), 'pips.source');
    setStorageVariant('microisa');
    for (const k of ['pips.source', 'pips.source.c', 'pips.workspace', 'pips.view', 'pips.subset', 'pips.lang', 'pips.exercise', 'pips.source.before']) {
      assert.equal(scoped(k), `${k}@microisa`, k);
    }
    for (const k of ['pips.profile', 'pips.layout.main', 'pips.theme', 'pips.variantNote', 'pips.sourcery']) assert.equal(scoped(k), k, k);
  } finally {
    setStorageVariant(null);
  }
});

test('v9: the validator checks legacy and that the own variant has a profile', () => {
  const d = twoVariants();
  const two = { ...d, variants: { alt: { ...d.variants.alt, legacy: true }, beta: { label: 'B', load: async () => ({}), legacy: true } },
    engine: { ...d.engine, profiles: [...d.engine.profiles, { id: 'b1', label: 'B1', variant: 'beta' }] } };
  assert.ok(validateDescriptor(two).includes('variants: at most one is legacy'));
  const noOwn = { ...d, engine: { ...d.engine, profiles: d.engine.profiles.filter((p) => p.variant) } };
  assert.ok(validateDescriptor(noOwn).includes("variants: the descriptor's own variant has no profile"));
});
