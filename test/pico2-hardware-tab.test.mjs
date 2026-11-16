// pico2-hardware-tab.test.mjs -- the Hardware tab of Pico Full (design docs/architecture/pico2-hardware-tab.md, 2026-11-15):
// Probe board, Run the board's program and Save the board's flash against the mock WebUSB (read-only commands and the allowed
// REBOOT2 only), the UART monitor's compare, hex and counters against the mock Web Serial, the contract's View.capability
// (v14), the view in the descriptor (Full only), and the Sample projects index grouped by topic. Mocks prove sequencing
// and the commands sent only; nothing here has touched a board.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MockPicobootDevice, MockUsb } from './fixtures/mock-picoboot.mjs';
import { MockSerial, MockSerialPort } from './fixtures/mock-serial.mjs';
import { flashArtifact, ramArtifact, programOf } from './fixtures/pico2-images.mjs';
import { HardwareSession } from '../src/arch/pico2/hw/session.js';
import { Records, memoryStore } from '../src/arch/pico2/hw/records.js';
import { SerialMonitor, compareOutputs, textLines, hexBytes } from '../src/arch/pico2/hw/serial.js';
import { readFlash, flashRangeOf, FLASH_BASE, FLASH_BYTES, SECTOR } from '../src/arch/pico2/hw/programmer.js';
import { validateDescriptor, withEdition } from '../src/arch/contract.js';
import { descriptor } from '../src/arch/pico2/index.js';

for (const k of ['log', 'warn', 'error']) console[k] = () => {};
const FAST = { endpoint: 200, commandStatus: 200, reset: 200 };
const tick = () => new Promise((r) => setTimeout(r, 5));
const WRITING = new Set(['erase', 'write', 'exclusive']);

function world({ program = programOf(flashArtifact()), faults = {} } = {}) {
  const mu = new MockUsb();
  const board = mu.plug(new MockPicobootDevice({ serialNumber: 'BOARD0', faults }), { granted: true });
  const s = new HardwareSession({ g: { navigator: { usb: mu }, isSecureContext: true }, records: new Records(memoryStore()), timeouts: FAST });
  s.attach({ project: () => ({ id: 'p1', name: 'Blink' }), program: () => program, build: async () => program, message: () => {} });
  s.confirmUi = async () => true;
  return { mu, board, s };
}
const names = (board) => board.log.map((c) => c.name);

test('Probe board: chip, ROM version, serial and boot partition, with read-only commands only', async () => {
  const w = world();
  const seen = [];
  w.s.on('board', (f) => seen.push(f));
  const r = await w.s.probe();
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.facts.serial, 'BOARD0');
  assert.equal(r.facts.romVersion, 4); assert.equal(r.facts.known, true);
  assert.equal(r.facts.partition, 0xff);
  assert.match(r.facts.chip.deviceId, /^[0-9A-F]{16}$/);
  assert.equal(seen.length, 1);
  assert.ok(!names(w.board).some((n) => WRITING.has(n) || n === 'reboot2'), names(w.board).join(','));
  assert.equal(w.s.state.phase, 'done');
});

test('Probe board reports what Load would refuse rather than refusing: an unknown ROM, a partition table', async () => {
  const w = world({ faults: { romVersion: 9, partition: 2 } });
  const r = await w.s.probe();
  assert.equal(r.ok, true);
  assert.equal(r.facts.romVersion, 9); assert.equal(r.facts.known, false); assert.equal(r.facts.partition, 2);
});

test('Run the board\'s program: one REBOOT2 of type normal, nothing written', async () => {
  const w = world();
  const r = await w.s.runBoard();
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(w.board.reboots.length, 1);
  assert.equal(w.board.reboots[0].flags & 0x0f, 0x0); // REBOOT2 normal
  assert.ok(!names(w.board).some((n) => WRITING.has(n)));
});

test('Save the board\'s flash: the program\'s sectors (or all 4 MiB), read only, the bytes the board holds', async () => {
  const w = world();
  const a = flashArtifact();
  // the board holds the program (as after a load and a return to BOOTSEL): its sectors in the mock's flash
  for (const p of a.pages) {
    const s = p.address - (p.address % SECTOR);
    if (!w.board.flash.has(s)) w.board.flash.set(s, new Uint8Array(SECTOR).fill(0xff));
    w.board.flash.get(s).set(p.bytes, p.address - s);
  }
  const r = await w.s.readBoardFlash();
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const range = flashRangeOf(a);
  assert.equal(r.start, range.start); assert.equal(r.bytes.length, range.length);
  for (const p of a.pages) assert.deepEqual(r.bytes.subarray(p.address - range.start, p.address - range.start + 256), p.bytes);
  assert.equal(r.name, 'board-flash-BOARD0.bin');
  assert.ok(names(w.board).every((n) => n === 'read' || n === 'getinfo'), names(w.board).join(','));
  assert.deepEqual(flashRangeOf(ramArtifact()), { start: FLASH_BASE, length: FLASH_BYTES });
});

test('readFlash refuses ranges outside the flash or not sector-aligned before any USB', async () => {
  const t = { interfaceReset: async () => assert.fail('no USB'), read: async () => assert.fail('no USB') };
  for (const [s, n] of [[FLASH_BASE - SECTOR, SECTOR], [FLASH_BASE + 1, SECTOR], [FLASH_BASE, 100], [FLASH_BASE + FLASH_BYTES - SECTOR, 2 * SECTOR], [0x20000000, SECTOR]]) {
    await assert.rejects(readFlash(t, s, n), (e) => e.code === 'not-permitted');
  }
});

test('Compare with the simulator: agreeing lines, the first difference, nothing to compare', () => {
  assert.deepEqual(textLines('a\r\nb\rc\nd'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(textLines('a\n'), ['a']);
  let r = compareOutputs('Hello 1\r\nHello 2\r\n', 'Hello 1\nHello 2\nHello 3\n');
  assert.deepEqual(r, { agree: 2, compared: 2, board: 2, sim: 3, first: null });
  r = compareOutputs('x = 3\ny = 4\n', 'x = 3\ny = 5\n');
  assert.deepEqual(r.first, { line: 2, board: 'y = 4', sim: 'y = 5' }); assert.equal(r.agree, 1);
  assert.equal(compareOutputs('', 'a\n').compared, 0);
  assert.equal(hexBytes(new Uint8Array([0, 0x0d, 0x0a, 0xff])), '00 0d 0a ff');
});

test('the monitor counts lines and bytes and hands each chunk to the hex view; Clear resets them', async () => {
  const serial = new MockSerial();
  const port = new MockSerialPort({ usbVendorId: 0x2e8a, usbProductId: 0x0009 });
  serial.add(port, { granted: true });
  const chunks = [];
  const m = new SerialMonitor({ serial, onBytes: (b) => chunks.push([...b]) });
  await m.open(port, 115200);
  port.feed('ab\r\ncd\n');
  await tick(); await tick();
  assert.deepEqual(m.counts, { lines: 2, bytes: 7 });
  assert.deepEqual(chunks.flat(), [...new TextEncoder().encode('ab\r\ncd\n')]);
  m.clear();
  assert.deepEqual(m.counts, { lines: 0, bytes: 0 });
  await m.close();
});

test('contract v14 View.capability: a known capability only, never on the instruction view; the shell hides the view where it is off', () => {
  assert.deepEqual(validateDescriptor(descriptor), []);
  const hv = descriptor.views.find((v) => v.id === 'hardware');
  assert.equal(hv.capability, 'hardware'); assert.equal(hv.engine, 'page'); assert.equal(hv.icon, 'usb');
  const bad = { ...descriptor, views: descriptor.views.map((v) => (v === hv ? { ...v, capability: 'nonsense' } : v)) };
  assert.ok(validateDescriptor(bad).some((m) => /capability nonsense/.test(m)));
  const bad2 = { ...descriptor, views: descriptor.views.map((v, i) => (i === 0 ? { ...v, capability: 'hardware' } : v)) };
  assert.ok(validateDescriptor(bad2).some((m) => /instruction view/.test(m)));
  // the shell's filter (src/main.js): shown where the edition's capability is true
  const shown = (d) => d.views.filter((v) => !v.capability || d.capabilities?.[v.capability] === true).map((v) => v.id);
  assert.ok(shown(withEdition(descriptor, 'full')).includes('hardware'));
  assert.ok(!shown(withEdition(descriptor, 'lite')).includes('hardware'));
  // the bottom pane no longer has the two real-board panels: they are in the tab
  assert.ok(!(descriptor.panels ?? []).some((p) => p.id === 'board-usb' || p.id === 'serial-board'));
});

test('Sample projects: thirteen topic groups in embedded-systems order; every sample in a group, each group used', () => {
  const ix = JSON.parse(readFileSync(new URL('../content/pico2/templates/index.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(ix.groups), ['start', 'demo', 'gpio', 'timers', 'uart', 'adc', 'pwm', 'i2c', 'spi', 'dma', 'pio', 'cores', 'cpu']);
  assert.equal(ix.groups.i2c, 'I2C');
  for (const g of Object.keys(ix.groups)) assert.ok(ix.templates.some((t) => t.group === g), g);
  assert.ok(ix.templates.find((t) => t.id === 'i2c-lcd').group === 'i2c');
  // the list's samples appear in group order (the menu shows them by group)
  const order = Object.keys(ix.groups);
  const seq = ix.templates.map((t) => order.indexOf(t.group));
  assert.deepEqual(seq, [...seq].sort((a, b) => a - b));
});


test('Copy report: version, features, masked serial, the last states and error codes, the log; no user agent', async () => {
  const { boardReport } = await import('../src/arch/pico2/hw/report.js');
  const w = world({ faults: { unplugAt: { cmd: 'write', n: 2 } } });
  const probe = await w.s.probe();
  assert.equal(probe.ok, true);
  const r = await w.s.load();
  assert.equal(r.ok, false);
  const text = boardReport({ version: '1.7.0-beta.1', caps: w.s.caps, facts: w.s.facts, state: w.s.state, history: w.s.history, log: ['Probe: serial BOARD0 ROM 4', 'left BOOTSEL'] });
  assert.match(text, /^MAVILERA Pico 2 board test report\nVersion: 1\.7\.0-beta\.1/);
  assert.match(text, /WebUSB yes/);
  assert.match(text, /serial …ARD0 /);
  assert.doesNotMatch(text, /BOARD0/);
  assert.match(text, /ROM version 4 \(known\)/);
  assert.match(text, /error disconnected/);
  assert.match(text, /probing/); assert.match(text, /choosing/);
  assert.match(text, /Probe: serial …ARD0 ROM 4/);
  assert.doesNotMatch(text, /Mozilla|Chrome\/|userAgent/);
  assert.ok(w.s.history.length <= 30);
  // nothing probed, nothing happened
  const empty = boardReport({});
  assert.match(empty, /not probed in this session/); assert.match(empty, /Session now: not started/); assert.match(empty, /development \(no release tag\)/);
});

test('the Board test report issue template exists, asks for what the report needs, and the public export carries it', async () => {
  const yml = readFileSync(new URL('../.github/ISSUE_TEMPLATE/board-test-report.yml', import.meta.url), 'utf8');
  for (const id of ['version', 'browser', 'os', 'board', 'pressed', 'happened', 'report']) assert.match(yml, new RegExp(`id: ${id}\\n`), id);
  for (const b of ['Pico 2\\n', 'Pico 2 W']) assert.match(yml, new RegExp(`- ${b}`));
  const exp = readFileSync(new URL('../tools/export-public.mjs', import.meta.url), 'utf8');
  assert.match(exp, /\.github\/ISSUE_TEMPLATE\/board-test-report\.yml/);
});
