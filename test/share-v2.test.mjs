// share-v2.test.mjs -- share links and settings files of version 2 (pico2 P1-F1, research decision D31 Q5): a project
// goes through a link and a settings file unchanged; a single program is still written as version 1 and version-1
// links still open; a project is refused where the architecture has no projects; names, extensions, duplicates, the
// entry and the limits are checked; a three-file project fits in a link.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createShare, ShareError, LINK_LIMIT, SHARE_VERSION, SHARE_VERSION_PROJECT, isShareFragment } from '../src/shell/share.js';
import { shareSchema, projectExtensions } from '../src/shell/share-schema.js';
import { descriptor as pico2 } from '../src/arch/pico2/index.js';
import { descriptor as riscv } from '../src/arch/riscv/index.js';

// pico2 declares `projects` (P1-F1 stage 2); a schema without it stands for every other module
const S = shareSchema(pico2);
const share = createShare(S);
const plain = createShare({ ...shareSchema(pico2), projects: false }); // as every module without projects

const PROJECT = {
  arch: 'pico2', lang: 'asm', project: 'Blink ✓',
  files: [
    { name: 'main.s', text: '    call blink\n    ebreak\n' },
    { name: 'blink.s', text: 'blink:\n    li a0, 25   # LED ünïcode\n    ret\n' },
    { name: 'delay.s', text: 'delay:\n    ret\n' },
  ],
  entry: 'main.s',
};
const code = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof ShareError, `not a ShareError: ${e}`); return e.code; } return null; };

test('the extensions of a pico2 project: assembly, C, headers and (P1-M8, design Q5) PIO programs', () => {
  assert.deepEqual(projectExtensions(pico2), ['.s', '.c', '.h', '.pio']);
  assert.equal(S.extensions.join(), '.s,.c,.h,.pio');
  assert.equal(shareSchema(riscv).projects, false, 'a released module has no projects');
});

test('Q5 (D31): a project goes through a link (version 2) and a settings file unchanged; source = the entry', async () => {
  for (const compress of [true, false]) {
    const f = await share.encodeFragment(PROJECT, { compress });
    assert.match(f, compress ? /^rv2z\./ : /^rv2\./);
    assert.ok(isShareFragment(f));
    const back = await share.decodeFragment(`#${f}`);
    assert.deepEqual(back.files, PROJECT.files);
    assert.equal(back.entry, 'main.s');
    assert.equal(back.project, 'Blink ✓');
    assert.equal(back.source, PROJECT.files[0].text);
    assert.equal(back.name, 'main.s');
    assert.deepEqual(back, share.normalise(PROJECT));
  }
  const file = share.settingsFile(PROJECT);
  assert.equal(JSON.parse(file).version, SHARE_VERSION_PROJECT);
  assert.equal(JSON.parse(file).source, undefined, 'the entry text is written once, in files');
  assert.deepEqual(share.readSettingsFile(file), share.normalise(PROJECT));
});

test('Q5 (D31): a single program is still written as version 1, and version-1 links open where projects are on', async () => {
  const single = { arch: 'pico2', lang: 'asm', name: 'main.s', source: 'nop\n' };
  const f = await share.encodeFragment(single);
  assert.match(f, new RegExp(`^rv${SHARE_VERSION}z\\.`));
  const back = await share.decodeFragment(f);
  assert.equal(back.source, 'nop\n');
  assert.equal(back.files, undefined);
  assert.equal(JSON.parse(share.settingsFile(single)).version, 1);
  // the same link through the schema without projects: identical (released modules unchanged)
  assert.equal(await plain.encodeFragment(single), f);
});

test('research D43 (contract v10 draft Language.companion): a single program carries its .pio file through a link and a settings file; checked', async () => {
  const pair = { arch: 'pico2', lang: 'asm', name: 'blink.s', source: 'nop\n', companion: { name: 'blink.pio', text: '.program p\n    nop\n' } };
  const back = await share.decodeFragment(await share.encodeFragment(pair));
  assert.deepEqual(back.companion, pair.companion);
  assert.equal(back.files, undefined); // still a version-1 single program
  assert.deepEqual(share.readSettingsFile(share.settingsFile(pair)).companion, pair.companion);
  const bad = (companion) => code(Promise.resolve().then(() => share.normalise({ ...pair, companion })));
  assert.equal(await bad({ name: 'blink.txt', text: '' }), 'field');
  assert.equal(await bad({ name: 'dir/blink.pio', text: '' }), 'field');
  assert.equal(await bad({ name: 'blink.pio' }), 'field');
  assert.equal(await code(Promise.resolve().then(() => createShare(shareSchema(riscv)).normalise({ ...pair, arch: 'riscv' }))), 'field'); // no companion there
  assert.equal((await share.decodeFragment(await share.encodeFragment({ ...pair, companion: undefined }))).companion, undefined);
});

test('Q5 (D31): a project is refused where the architecture has no projects; a later version is refused', async () => {
  const f = await share.encodeFragment(PROJECT);
  assert.equal(await code(plain.decodeFragment(f)), 'field');
  assert.equal(await code(plain.encodeFragment(PROJECT)), 'field');
  const v3 = f.replace(/^rv2/, 'rv3');
  assert.equal(await code(share.decodeFragment(v3)), 'version');
  assert.equal(await code(Promise.resolve().then(() => share.readSettingsFile(JSON.stringify({ format: 'risc-vista-settings', version: 3, ...PROJECT })))), 'version');
});

test('Q5 (D31): names, extensions, duplicates, the entry and the limits of a project are checked', async () => {
  const bad = (files, extra = {}) => code(Promise.resolve().then(() => share.normalise({ ...PROJECT, files, ...extra })));
  assert.equal(await bad([{ name: 'dir/a.s', text: '' }]), 'field');
  assert.equal(await bad([{ name: 'notes.txt', text: '' }]), 'field');
  assert.equal(await bad([{ name: 'a.s', text: '' }, { name: 'a.s', text: '' }]), 'field');
  assert.equal(await bad([{ name: 'a.s' }]), 'field');
  assert.equal(await bad([]), 'field');
  assert.equal(await bad([{ name: 'a.s', text: '' }], { entry: 'b.s' }), 'field');
  assert.equal(await bad(Array.from({ length: 65 }, (_, i) => ({ name: `f${i}.s`, text: '' }))), 'field');
  assert.equal(await bad([{ name: 'a.s', text: 'x'.repeat(2 * 1024 * 1024 + 1) }]), 'field');
  const noEntry = share.normalise({ ...PROJECT, entry: undefined });
  assert.equal(noEntry.entry, 'main.s', 'the entry defaults to the first file');
});

test('WS-N-013: a three-file project fits in a link', async () => {
  const f = await share.encodeFragment(PROJECT);
  assert.ok(f.length < LINK_LIMIT, `${f.length} characters`);
});
