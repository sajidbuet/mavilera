// make-template-circuits.mjs -- writes the circuit files of the pico2 circuit templates (P1-B2 stage B2-4, research D54 Q6 A):
// content/pico2/templates/<id>.circuit.json, each the demo circuit (circuit/demo.js) with the template's parts below the board,
// joined to the Pico 2's pins and the rails by net labels (GP16, GND, 3V3: the rails drawn as symbols) and to each other by
// wires. Validated and canonical; the templates' tests (test/pico2-circuit-templates.test.mjs) run them.
//
//   node tools/pico2/make-template-circuits.mjs [--check]     (--check: compare with the files, write nothing)
//
// Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { validateCircuit } from '../../src/arch/pico2/circuit/format.js';
import { demoCircuit } from '../../src/arch/pico2/circuit/netlist.js';
import { mergeInto } from '../../src/arch/pico2/circuit/presets.js';
import { partPins } from '../../src/arch/pico2/ui/circuit-sheet.js';

const dir = new URL('../../content/pico2/templates/', import.meta.url);
const COPYRIGHT = 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: content (Apache-2.0). A circuit of a Pico 2 template, written for the application (P1-B2, research D54 Q6 A); made by tools/pico2/make-template-circuits.mjs.';
const r1 = (v) => Math.round(v * 10) / 10 + 0;

/** A circuit builder: parts, wires between ends, labels placed beside pins or nodes. */
function sheet() {
  const parts = [], wires = [], labels = [], nodes = [];
  const pin = (ref) => { const [id, n] = ref.split('.'); const p = parts.find((x) => x.id === id); return partPins(p).find((q) => q.pin === n); };
  const api = {
    part(id, type, x, y, extra = {}) { parts.push({ id, type, x, y, ...extra }); return api; },
    node(id, x, y) { nodes.push({ id, x, y }); return api; },
    wire(a, b) { wires.push({ a, b }); return api; },
    /** A net label on a pin (beside it, outside the part) or a node; GND and 3V3 are drawn as symbols below and above. */
    label(net, at) {
      const n = nodes.find((x) => x.id === at);
      if (n) { labels.push({ net, at, x: r1(n.x + 12.7), y: r1(n.y - 12.7) }); return api; }
      const q = pin(at), [ox, oy] = q.out;
      if (net === 'GND') labels.push({ net, at, x: r1(q.x + ox * 25.4), y: r1(q.y + (oy || 1) * 25.4) });
      else if (net === '3V3') labels.push({ net, at, x: r1(q.x + ox * 25.4), y: r1(q.y + (oy || -1) * 25.4) });
      else labels.push({ net, at, x: r1(q.x + ox * 12.7), y: r1(q.y + (oy ? oy * 22 : -10)) });
      return api;
    },
    done() {
      return validateCircuit({ _copyright: COPYRIGHT, ...mergeInto(demoCircuit(), { parts, wires, labels, nodes }) });
    },
  };
  return api;
}

const Y = 889; // the first row of the templates' parts, below the board and the demo button
const CIRCUITS = {
  'circuit-led': () => sheet().part('R1', 'resistor', -254, Y, { value: '220' }).part('D1', 'led', 0, Y)
    .wire('R1.2', 'D1.A').label('GP16', 'R1.1').label('GND', 'D1.K').done(),
  'traffic-light': () => {
    const s = sheet();
    [['GP16', 'red'], ['GP17', 'yellow'], ['GP18', 'green']].forEach(([g, c], i) => {
      const y = Y + i * 76.2;
      s.part(`R${i + 1}`, 'resistor', -254, y, { value: '220' }).part(`D${i + 1}`, 'led', 0, y, { color: c })
        .wire(`R${i + 1}.2`, `D${i + 1}.A`).label(g, `R${i + 1}.1`).label('GND', `D${i + 1}.K`);
    });
    return s.done();
  },
  'divider-adc': () => sheet().part('R1', 'resistor', -254, Y, { value: '10k' }).part('R2', 'resistor', 0, Y, { value: '10k' })
    .wire('R1.2', 'R2.1').label('3V3', 'R1.1').label('GND', 'R2.2').node('J1', -127, Y).wire('R1.2', 'J1').label('GP27', 'J1').done(),
  'npn-switch': () => sheet().part('RB', 'resistor', -254, Y, { value: '1k' }).part('Q1', 'npn', -63.5, Y)
    .part('D1', 'led', -38.1, 749.3, { color: 'green', rot: 90 }).part('RC', 'resistor', -38.1, 596.9, { value: '330', rot: 90 })
    .wire('RB.2', 'Q1.B').wire('D1.K', 'Q1.C').wire('RC.2', 'D1.A').label('GP17', 'RB.1').label('GND', 'Q1.E').label('3V3', 'RC.1').done(),
  'rc-debounce': () => sheet().part('SW1', 'button', -254, Y).node('J1', -127, Y).part('R1', 'resistor', -127, 800.1, { value: '10k', rot: 90 })
    .part('C1', 'capacitor', -127, 977.9, { value: '100n', rot: 90 })
    .wire('SW1.2', 'J1').wire('R1.2', 'J1').wire('C1.1', 'J1').label('GND', 'SW1.1').label('3V3', 'R1.1').label('GND', 'C1.2').label('GP14', 'J1').done(),
  'pwm-rc-dac': () => sheet().part('R1', 'resistor', -254, Y, { value: '10k' }).node('J1', -127, Y).part('C1', 'capacitor', -127, 977.9, { value: '1u', rot: 90 })
    .wire('R1.2', 'J1').wire('C1.1', 'J1').label('GP16', 'R1.1').label('GND', 'C1.2').label('GP27', 'J1').done(),
  'ldr-night-light': () => sheet().part('L1', 'ldr', -254, Y).node('J1', -127, Y).part('R1', 'resistor', -127, 977.9, { value: '10k', rot: 90 })
    .part('R2', 'resistor', -254, 1092.2, { value: '220' }).part('D1', 'led', 0, 1092.2)
    .wire('L1.2', 'J1').wire('R1.1', 'J1').wire('R2.2', 'D1.A').label('3V3', 'L1.1').label('GND', 'R1.2').label('GP27', 'J1')
    .label('GP16', 'R2.1').label('GND', 'D1.K').done(),
  'ntc-thermometer': () => sheet().part('R1', 'resistor', -254, Y, { value: '10k' }).node('J1', -127, Y).part('T1', 'ntc', -127, 977.9, { rot: 90 })
    .wire('R1.2', 'J1').wire('T1.1', 'J1').label('3V3', 'R1.1').label('GND', 'T1.2').label('GP28', 'J1').done(),
};

const check = process.argv.includes('--check');
let bad = 0;
for (const [id, make] of Object.entries(CIRCUITS)) {
  const file = new URL(`${id}.circuit.json`, dir), text = `${JSON.stringify(make(), null, 1)}\n`;
  if (check) { const same = existsSync(file) && readFileSync(file, 'utf8') === text; if (!same) bad++; console.log(`${same ? 'same' : 'DIFFERS'} ${id}`); }
  else { writeFileSync(file, text); console.log(`wrote ${id}.circuit.json`); }
}
process.exit(bad ? 1 : 0);
