// pico2-hw-session.test.mjs -- Load to Pico's session, records and badge, and the "Serial (board)" monitor, against the mock
// WebUSB and Web Serial (pico2 P1-F3 stages F3-1 to F3-3; research testing/usb-flashing-test-plan.md §1: U-02, U-03, U-14 and
// the serial cases; D58 Q4-Q8 A, Q9 B). Mocks prove sequencing and error handling only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockPicobootDevice, MockUsb } from './fixtures/mock-picoboot.mjs';
import { MockSerial, MockSerialPort } from './fixtures/mock-serial.mjs';
import { flashArtifact, ramArtifact, programOf } from './fixtures/pico2-images.mjs';
import { HardwareSession, canLoad } from '../src/arch/pico2/hw/session.js';
import { Records, memoryStore, badgeOf } from '../src/arch/pico2/hw/records.js';
import { SerialMonitor, LineSplitter, DEFAULT_BAUD } from '../src/arch/pico2/hw/serial.js';
import { hwCapabilities } from '../src/arch/pico2/hw/capabilities.js';

for (const k of ['log', 'warn', 'error']) console[k] = () => {};
const FAST = { endpoint: 200, commandStatus: 200, reset: 200 };
const tick = () => new Promise((r) => setTimeout(r, 5));

/** A page-like world: navigator.usb (mock), a shell context whose build gives `program`, and a session. */
function world({ program = programOf(flashArtifact()), granted = true, devices = 1, choose, secure = true, usb = true } = {}) {
  const mu = new MockUsb(choose ? { choose } : {});
  const boards = Array.from({ length: devices }, (_, i) => mu.plug(new MockPicobootDevice({ serialNumber: `BOARD${i}` }), { granted }));
  const calls = [];
  let current = program;
  const g = { navigator: usb ? { usb: mu } : {}, isSecureContext: secure };
  const s = new HardwareSession({ g, records: new Records(memoryStore()), timeouts: FAST });
  s.attach({ project: () => ({ id: 'p1', name: 'Blink' }), program: () => current, build: async () => { calls.push('build'); return current; }, message: () => {} });
  const confirms = [];
  s.confirmUi = async (summary) => { calls.push('confirm'); confirms.push(summary); return true; };
  const origRequest = mu.requestDevice.bind(mu);
  mu.requestDevice = (o) => { calls.push('chooser'); return origRequest(o); };
  return { mu, boards, s, calls, confirms, setProgram: (p) => { current = p; } };
}

test('capabilities: feature tests only (WebUSB, Web Serial, secure context, folder picker)', () => {
  assert.deepEqual(hwCapabilities({ navigator: {}, isSecureContext: true }), { webusb: false, webserial: false, secure: true, folderPicker: false });
  assert.deepEqual(hwCapabilities({ navigator: { usb: { requestDevice() {} }, serial: { requestPort() {} } }, isSecureContext: false, showDirectoryPicker() {} }), { webusb: true, webserial: true, secure: false, folderPicker: true });
});

test('U-02/Q4/Q5: a granted board loads without the chooser; the build runs after it is chosen; the confirmation names board and build n', async () => {
  const w = world();
  const states = [];
  w.s.on('state', (st) => states.push(st.phase));
  const r = await w.s.load();
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(w.calls, ['build', 'confirm'], 'no chooser for the one granted board');
  assert.equal(w.confirms[0].serial, 'BOARD0'); assert.equal(w.confirms[0].n, 1); assert.equal(w.confirms[0].project, 'Blink');
  assert.deepEqual([...new Set(states)], ['choosing', 'building', 'preflight', 'confirm', 'writing', 'rebooting', 'done']);
  assert.deepEqual(await w.s.badge(), { state: 'same', serial: 'BOARD0', n: 1, checked: null });
});

test('the chooser comes first (the click\'s activation), filtered to 2E8A:000F; closing it is "denied" with nothing built (U-03)', async () => {
  let w = world({ granted: false });
  assert.equal((await w.s.load()).ok, true);
  assert.deepEqual(w.calls, ['chooser', 'build', 'confirm']);
  assert.deepEqual(w.mu.requests[0], [{ vendorId: 0x2e8a, productId: 0x000f }]);
  w = world({ granted: false, choose: () => null });
  const r = await w.s.load();
  assert.equal(r.error.code, 'denied');
  assert.deepEqual(w.calls, ['chooser'], 'not built, nothing sent');
  assert.equal(w.s.state.phase, 'failed');
});

test('U-14: two granted boards: the student is asked; the chosen one is written', async () => {
  const w = world({ devices: 2, choose: (list) => list[1] });
  assert.equal((await w.s.load()).ok, true);
  assert.deepEqual(w.calls[0], 'chooser');
  assert.equal(w.confirms[0].serial, 'BOARD1');
  assert.ok(w.boards[1].names().includes('write') && !w.boards[0].names().length);
});

test('Q6: build n counts distinct builds per project; an unchanged rebuild keeps n; Q7: the badge follows; Check reads back', async () => {
  const w = world();
  await w.s.load();
  w.setProgram(programOf(flashArtifact(1)));
  assert.deepEqual(await w.s.badge(), { state: 'other', serial: 'BOARD0', n: null, m: 1, checked: null }, 'a new build not yet loaded');
  // the board rebooted after the load (left the bus): plug it back in BOOTSEL with the same flash
  const back = () => { const d = new MockPicobootDevice({ serialNumber: 'BOARD0' }); d.flash = w.boards[0].flash; w.mu.plug(d, { granted: true }); return d; };
  back();
  assert.equal((await w.s.load()).n, 2);
  w.setProgram(programOf(flashArtifact(1)));
  const d3 = back();
  assert.equal((await w.s.load()).n, 2, 'same sources, same build id, same n');
  assert.deepEqual(await w.s.badge(), { state: 'same', serial: 'BOARD0', n: 2, checked: null });
  w.setProgram(programOf(flashArtifact(0)));
  const d4 = new MockPicobootDevice({ serialNumber: 'BOARD0' }); d4.flash = d3.flash; w.mu.plug(d4, { granted: true });
  const c = await w.s.check();
  assert.equal(c.same, false, 'the board holds build 2, the program is build 1');
  assert.ok(!d4.names().some((x) => x === 'erase' || x === 'write'), 'Check never writes');
  assert.equal((await w.s.badge()).checked, false);
});

test('Q9 B: a RAM-only image loads (no erase); a program without an artifact is not bootable and nothing reaches the board', async () => {
  let w = world({ program: programOf(ramArtifact()) });
  const r = await w.s.load();
  assert.equal(r.ok, true);
  assert.ok(!w.boards[0].names().includes('erase'));
  assert.equal(w.boards[0].reboots[0].flags, 3);
  w = world({ program: { ok: true, segments: [] } });
  const r2 = await w.s.load();
  assert.equal(r2.error.code, 'not-bootable');
  assert.deepEqual(w.boards[0].log, []);
  assert.deepEqual(canLoad(null), { ok: false, reason: 'noProgram' });
  assert.deepEqual(canLoad({ debug: {} }), { ok: false, reason: 'notBootable' });
  assert.deepEqual(canLoad(programOf(flashArtifact())), { ok: true, kind: 'flash' });
});

test('without WebUSB the answer is the download; outside a secure context nothing is tried; a failed build stops before USB', async () => {
  let w = world({ usb: false });
  assert.deepEqual(await w.s.load(), { ok: false, error: { code: 'unsupported', message: 'no WebUSB', data: {} }, fallback: 'download' });
  w = world({ secure: false });
  assert.equal((await w.s.load()).error.code, 'insecure');
  w = world();
  w.s.ctx.build = async () => null;
  assert.equal((await w.s.load()).error.code, 'failed');
  assert.deepEqual(w.boards[0].log, []);
});

test('unplugged during the write: "disconnected", no record of a load; Stop before the confirmation cancels with nothing written', async () => {
  let w = world();
  w.boards[0].faults.unplugAt = { cmd: 'write', n: 1 };
  assert.equal((await w.s.load()).error.code, 'disconnected');
  assert.equal((await w.s.badge()).state, 'none');
  w = world();
  w.s.confirmUi = async () => { w.s.stop(); return true; };
  assert.equal((await w.s.load()).error.code, 'cancelled');
  assert.ok(!w.boards[0].names().includes('erase'));
  assert.equal(w.s.state.phase, 'cancelled');
});

test('Forget this board (S13): its record and the browser\'s permission', async () => {
  const w = world();
  await w.s.load();
  let forgot = 0;
  const d = new MockPicobootDevice({ serialNumber: 'BOARD0' }); d.forget = async () => { forgot++; };
  w.mu.plug(d, { granted: true });
  assert.equal(await w.s.forget(), true);
  assert.equal((await w.s.badge()).state, 'none');
  assert.equal(forgot, 1);
});

test('badge: text states from the record (none, same, other, foreign)', () => {
  const board = { buildId: 'aa', n: 3, project: 'p1' };
  assert.equal(badgeOf({ board: null, current: null, project: 'p1', serial: null }).state, 'none');
  assert.deepEqual(badgeOf({ board, current: { buildId: 'aa', n: 3 }, project: 'p1', serial: 'S' }), { state: 'same', serial: 'S', n: 3, checked: null });
  assert.deepEqual(badgeOf({ board, current: { buildId: 'bb', n: 4 }, project: 'p1', serial: 'S' }), { state: 'other', serial: 'S', n: 4, m: 3, checked: null });
  assert.equal(badgeOf({ board, current: { buildId: 'aa', n: 3 }, project: 'p2', serial: 'S' }).state, 'foreign');
});

// ---- the serial monitor (F3-3, Q8 A) ----
test('serial: lines end at CRLF, LF or a lone CR, also split across chunks; invalid UTF-8 shows U+FFFD', () => {
  const s = new LineSplitter();
  assert.deepEqual(s.push('a\r\nb\nc\rd'), { lines: ['a', 'b', 'c'], partial: 'd' });
  assert.deepEqual(s.push('e\r'), { lines: ['de'], partial: '' });
  assert.deepEqual(s.push('\nf\n'), { lines: ['f'], partial: '' }, 'the LF after a CR that ended a chunk is not a second line');
  assert.equal(new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from([0x61, 0xff, 0x62])), 'a�b');
});

test('serial: opens 8N1 at 115200 with DTR on, never at 1200; receives lines (multibyte split across chunks); sends with CR by default', async () => {
  const ms = new MockSerial();
  const port = ms.add(new MockSerialPort(), { granted: false });
  const lines = [];
  const m = new SerialMonitor({ serial: ms, onLine: (l) => lines.push(l) });
  const p = await m.choose({ pico: true });
  assert.deepEqual(ms.requests[0], { filters: [{ usbVendorId: 0x2e8a, usbProductId: 0x0009 }] });
  await assert.rejects(m.open(p, 1200), (e) => e.code === 'not-permitted');
  assert.equal(port.opened, null, '1200 bit/s never reaches the port');
  await m.open(p);
  assert.deepEqual(port.opened, { baudRate: DEFAULT_BAUD, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
  assert.deepEqual(port.signals, [{ dataTerminalReady: true }]);
  port.feed('Hello from the Pico 2: 0\r\n'); port.feed(Uint8Array.from([0x63, 0xc3])); port.feed(Uint8Array.from([0xa9, 0x0a]));
  await tick();
  assert.deepEqual(lines, ['Hello from the Pico 2: 0', 'cé']);
  await m.send('on'); await m.send('x', 'crlf'); await m.send('y', 'none');
  assert.equal(port.sent(), 'on\rx\r\ny');
  await m.close();
  assert.equal(port.opened, null);
});

test('serial: after an unplug the monitor waits and reopens the same port when it comes back; a busy port is named; two candidates: it asks', async () => {
  const ms = new MockSerial();
  const port = ms.add(new MockSerialPort(), { granted: true });
  const states = [], lines = [];
  const m = new SerialMonitor({ serial: ms, onLine: (l) => lines.push(l), onState: (s) => states.push(s.state) });
  await m.open(port, 115200);
  port.unplug();
  await tick();
  assert.equal(m.state, 'waiting');
  port.replug();
  await tick();
  assert.equal(m.state, 'open', states.join());
  port.feed('again\n'); await tick();
  assert.deepEqual(lines, ['again']);
  assert.equal(port.signals.length, 2, 'DTR set again after reopening');
  const busy = ms.add(new MockSerialPort({ busy: true }), { granted: true });
  await assert.rejects(new SerialMonitor({ serial: ms }).open(busy), (e) => e.code === 'busy');
  // two granted ports with the same IDs: which one is the board is not known (no serial number in SerialPortInfo)
  const m2 = new SerialMonitor({ serial: ms, onState: (s) => states.push(`m2:${s.state}`) });
  const a = ms.add(new MockSerialPort({ usbProductId: 0x000a }), { granted: true }), b = ms.add(new MockSerialPort({ usbProductId: 0x000a }), { granted: true });
  await m2.open(a);
  a.unplug(); await tick();
  a.replug(); await tick();
  assert.equal(m2.state, 'ask');
  await m.close();
});

test('serial: the kept text is capped as the console; Clear empties it', async () => {
  const ms = new MockSerial();
  const port = ms.add(new MockSerialPort(), { granted: true });
  const m = new SerialMonitor({ serial: ms });
  await m.open(port);
  const line = 'x'.repeat(1023) + '\n';
  for (let i = 0; i < 2100; i++) port.feed(line);
  await tick(); await tick();
  assert.ok(m.text.length <= 2 * (1 << 20) && m.dropped > 0, `${m.text.length} kept, ${m.dropped} dropped`);
  m.clear();
  assert.equal(m.text, '');
  await m.close();
});
