// P1-B2 stage B2-1 (design docs/architecture/pico2-p1b2-user-circuits.md §2.12; contract v12 draft Language.companions, research
// D51 Q1 A): the circuit travels with a single program as a view companion (`companions` in links and settings files), as
// circuit.json in a project, and the run's inputs of kinds adc, env and part are kept by links (links refused adc and env before).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShare, ShareError } from '../src/shell/share.js';
import { shareSchema, projectExtensions } from '../src/shell/share-schema.js';
import { checkName, ProjectError } from '../src/shell/project.js';
import { descriptor as pico2 } from '../src/arch/pico2/index.js';
import { descriptor as riscv } from '../src/arch/riscv/index.js';
import { validateCircuit, FORMAT } from '../src/arch/pico2/circuit/format.js';

const share = createShare(shareSchema(pico2));
const CIRCUIT = JSON.stringify({ format: FORMAT, version: 1, parts: [{ id: 'B1', type: 'button', x: 0, y: 0 }], wires: [{ a: 'GP15', b: 'B1.1' }, { a: 'B1.2', b: 'GND' }] });
const single = { arch: 'pico2', view: 'isa', profile: pico2.engine.profiles[0].id, lang: 'c', name: 'main.c', source: 'int main(void) { return 0; }',
  companions: [{ name: 'main.circuit.json', text: CIRCUIT }],
  inputs: [{ cycle: 10, step: 3, kind: 'part', id: 'B1', value: 1 }, { cycle: 20, step: 5, kind: 'adc', channel: 0, volts: 1.65 }, { cycle: 30, step: 7, kind: 'env', key: 'temp', value: 30 }] };

test('a link and a settings file carry a single program\'s circuit and the inputs of kinds part, adc and env', async () => {
  const st = pico2.language.companions.find((c) => c.editor === 'view');
  assert.deepEqual([st.id, st.extension, st.option, st.projectFile], ['circuit', '.circuit.json', 'circuit', 'circuit.json']);
  const back = await share.decodeFragment(`#${await share.encodeFragment(single)}`);
  assert.deepEqual(back.companions, single.companions);
  assert.deepEqual(back.inputs, single.inputs);
  assert.deepEqual(validateCircuit(back.companions[0].text), validateCircuit(CIRCUIT));
  assert.deepEqual(share.readSettingsFile(share.settingsFile(single)).companions, single.companions);
  const refuse = (s) => assert.throws(() => share.normalise(s), ShareError);
  refuse({ ...single, companions: [{ name: 'main.json', text: CIRCUIT }] });
  refuse({ ...single, companions: [{ name: 'a.circuit.json', text: CIRCUIT }, { name: 'b.circuit.json', text: CIRCUIT }] });
  refuse({ ...single, inputs: [{ cycle: 1, step: 1, kind: 'part', id: '1bad', value: 1 }] });
  refuse({ ...single, inputs: [{ cycle: 1, step: 1, kind: 'adc', channel: 4, volts: 1 }] });
  // a module without view companions refuses the field
  const rv = createShare(shareSchema(riscv));
  assert.throws(() => rv.normalise({ ...single, arch: 'riscv', profile: riscv.engine.profiles[0].id, lang: 'asm', inputs: undefined }), ShareError);
});

test('a project holds its circuit as circuit.json (only by that name among .json files)', () => {
  const ext = projectExtensions(pico2);
  assert.equal(checkName('circuit.json', ext), 'circuit.json');
  assert.throws(() => checkName('other.json', ext), ProjectError);
  const proj = { arch: 'pico2', view: 'isa', profile: pico2.engine.profiles[0].id, project: 'P', entry: 'main.c',
    files: [{ name: 'main.c', text: 'int main(void) { return 0; }' }, { name: 'circuit.json', text: CIRCUIT }] };
  assert.equal(share.normalise(proj).files[1].name, 'circuit.json');
  assert.throws(() => share.normalise({ ...proj, files: [proj.files[0], { name: 'x.json', text: '{}' }] }), ShareError);
});
