// Contract version 13 (docs/architecture/arch-contract.md §30, approved 2026-11-15, research D60): fields added for
// pico2 P1-R4 (ExtraLanguage.projectOptions) and P1-F3. The validator's checks; descriptors without the fields stay valid.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDescriptor } from '../src/arch/contract.js';

const { descriptor: pico2 } = await import('../src/arch/pico2/index.js');
const problems = (d) => validateDescriptor(d);
const has = (d, text) => problems(d).some((p) => p.includes(text));
const withSdk = (patch) => ({ ...pico2, language: { ...pico2.language,
  extraLanguages: pico2.language.extraLanguages.map((x) => (x.id === 'sdk-c' ? { ...x, ...patch } : x)) } });

test('v13: the pico2 descriptor with projectOptions is valid', () => {
  assert.deepEqual(problems(pico2), []);
  const sdk = pico2.language.extraLanguages.find((x) => x.id === 'sdk-c');
  assert.deepEqual(sdk.projectOptions.map((o) => [o.id, o.default, o.values.map((v) => v.id)]), [['stdio', 'uart', ['uart', 'usb']]]);
});

test('v13: projectOptions belong to an image language, with a default among two or more short values', () => {
  const opt = { id: 'stdio', label: 'Output', default: 'uart', values: [{ id: 'uart', label: 'UART' }, { id: 'usb', label: 'UART and USB' }] };
  assert.deepEqual(problems(withSdk({ projectOptions: [] })), []);
  assert.ok(has(withSdk({ projectOptions: [{ ...opt, default: 'radio' }] }), 'project option stdio'));
  assert.ok(has(withSdk({ projectOptions: [{ ...opt, values: [opt.values[0]] }] }), 'project option stdio'));
  assert.ok(has(withSdk({ projectOptions: [{ ...opt, id: 'Bad id' }] }), 'project option'));
  assert.ok(has(withSdk({ projectOptions: [{ ...opt, values: [...opt.values, { id: 'Upper', label: 'x' }] }] }), 'project option stdio'));
  assert.ok(has(withSdk({ projectOptions: Array.from({ length: 9 }, (_, i) => ({ ...opt, id: `o${i}` })) }), 'at most 8'));
  const c = pico2.language.extraLanguages.find((x) => x.id === 'c');
  const onC = { ...pico2, language: { ...pico2.language, extraLanguages: pico2.language.extraLanguages.map((x) => (x === c ? { ...x, projectOptions: [opt] } : x)) } };
  assert.ok(has(onC, 'belong to an image language'));
});

test('v13 (approved 2026-11-15, research D60), now 14 (D62): capability hardware is listed', async () => {
  const { CONTRACT_VERSION, CAPABILITIES } = await import('../src/arch/contract.js');
  assert.equal(CONTRACT_VERSION, 14); // v14: View.capability, ExtraLanguage.headersText (research D62)
  assert.ok(CAPABILITIES.includes('hardware'));
});
