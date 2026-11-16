// pico2-headers.test.mjs -- the headers a Pico Full project includes from outside it, listed read-only in the file explorer
// (2026-11-15; contract v14 ExtraLanguage.headersText and the loaded part's headers): the #include parser, clang's search
// order over the compile command's directories, and, with the real SDK pack (PICO_FULL_WORK; skipped without it), which file
// each sample's includes resolve to. The headers are never copied into a project.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { includeNames, includeSearchDirs, resolveInclude } from '../src/arch/pico2/full/driver.js';
import { validateDescriptor, withEdition } from '../src/arch/contract.js';
import { descriptor } from '../src/arch/pico2/index.js';

test('includeNames: "..." and <...>, in order, once each; commented ones are not includes', () => {
  const t = '#include "pico/stdlib.h"\n// #include "hardware/pwm.h"\n/* #include <x.h> */\n  #  include <stdio.h>\n#include "pico/stdlib.h"\n#include "my.h"\n';
  assert.deepEqual(includeNames(t), [{ name: 'pico/stdlib.h', quoted: true }, { name: 'stdio.h', quoted: false }, { name: 'my.h', quoted: true }]);
});

test('search order: -iquote only for "...", then -I, -isystem and the toolchain\'s, whatever the command line\'s order', () => {
  const d = includeSearchDirs(['clang', '-isystem', '/s1', '-I', '/u1', '-internal-isystem', '/t1', '-iquote', '/q1', '-I/u2', '-isystem/s2']);
  assert.deepEqual(d, { quote: ['/q1'], user: ['/u1', '/u2'], system: ['/s1', '/s2'], internal: ['/t1'] });
  const files = new Set(['/q1/a.h', '/s1/a.h', '/u2/b.h', '/s2/b.h', '/t1/stdio.h']);
  const has = (p) => files.has(p);
  assert.equal(resolveInclude(has, d, 'a.h', true), '/q1/a.h');
  assert.equal(resolveInclude(has, d, 'a.h', false), '/s1/a.h', '<...> skips -iquote');
  assert.equal(resolveInclude(has, d, 'b.h', false), '/u2/b.h', '-I before -isystem');
  assert.equal(resolveInclude(has, d, 'stdio.h', false), '/t1/stdio.h');
  assert.equal(resolveInclude(has, d, 'none.h', true), null);
  assert.equal(resolveInclude(has, d, '../etc/a.h', true), null, 'never leaves the search dirs');
});

test('contract v14: Pico SDK C words the headers list; it is only for image languages', () => {
  const sdk = descriptor.language.extraLanguages.find((x) => x.id === 'sdk-c');
  assert.equal(typeof sdk.headersText.head, 'string');
  assert.deepEqual(validateDescriptor(withEdition(descriptor, 'full')), []);
  const bad = { ...descriptor, language: { ...descriptor.language, extraLanguages: descriptor.language.extraLanguages.map((x) => (x.id === 'c' ? { ...x, headersText: sdk.headersText } : x)) } };
  assert.ok(validateDescriptor(bad).some((m) => /headersText/.test(m)));
});

const W = process.env.PICO_FULL_WORK;
const manifest = W && existsSync(join(W, 'out', 'manifest.json')) ? JSON.parse(readFileSync(join(W, 'out', 'manifest.json'), 'utf8')) : null;
const SKIP = manifest && existsSync(join(W, 'out', manifest.sdkPack.file)) ? false : 'needs PICO_FULL_WORK with an SDK pack (tools/pico-full)';
const dir = new URL('../content/pico2/templates/', import.meta.url);
const src = (f) => ({ name: f, text: readFileSync(new URL(f, dir), 'utf8') });

test('with the SDK pack: each sample\'s includes resolve to the SDK or the C library; a project\'s own files and .pio.h are not listed', { skip: SKIP }, async () => {
  const { CompilerHost } = await import('../src/arch/pico2/full/host.js');
  // the headers need only the pack (no compiler module)
  const host = new CompilerHost({ module: null, pack: new Uint8Array(readFileSync(join(W, 'out', manifest.sdkPack.file))) });
  const adc = host.headers([src('sdk-adc-knob.c')]);
  assert.deepEqual(adc.map((h) => [h.name, h.kind, h.path]), [
    ['pico/stdlib.h', 'sdk', '/pico/sdk/src/common/pico_stdlib_headers/include/pico/stdlib.h'],
    ['hardware/adc.h', 'sdk', '/pico/sdk/src/rp2_common/hardware_adc/include/hardware/adc.h'],
    ['stdio.h', 'c-library', '/pico/sysroot/include/stdio.h']]);
  assert.match(adc[1].text, /adc_read/);
  const pio = host.headers([src('sdk-pio-led.c'), src('sdk-pio-led.pio')]);
  assert.deepEqual(pio.map((h) => h.name), ['pico/stdlib.h', 'hardware/pio.h', 'stdio.h'], 'sdk-pio-led.pio.h is the project\'s own');
  const own = host.headers([{ name: 'main.c', text: '#include "util.h"\n#include "nowhere.h"\n' }, { name: 'util.h', text: '' }]);
  assert.deepEqual(own, [{ name: 'nowhere.h', path: null }]);
  // every sample's includes are found
  const ix = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
  for (const t of ix.templates.filter((x) => x.lang === 'sdk-c')) {
    const files = [src(t.file), ...(t.companion ? [src(t.companion)] : [])];
    const missing = host.headers(files).filter((h) => !h.path).map((h) => h.name);
    assert.deepEqual(missing, [], t.id);
  }
  // the multicore set's command (a project including pico/multicore.h) finds it
  assert.equal(host.headers([src('sdk-two-cores.c')]).find((h) => h.name === 'pico/multicore.h')?.kind, 'sdk');
});
