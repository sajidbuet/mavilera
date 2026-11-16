// pico2-hw.test.mjs -- Pico Full's board programmer against the mock PICOBOOT device (pico2 P1-F3 stage F3-1; research
// testing/usb-flashing-test-plan.md §1: U-01, U-05...U-08, U-10...U-13; D58 Q9 B: RAM-only images). Mocks prove sequencing and
// error handling only: nothing here shows that a real Pico 2 is written (that is F3-5, hardware-in-the-loop).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockPicobootDevice } from './fixtures/mock-picoboot.mjs';
import { PicobootTransport, findPicoboot, ALLOWED_COMMANDS, REBOOT2 } from '../src/arch/pico2/hw/transport.js';
import { writeArtifact, readBack, checkArtifact, writeOrder, FLASH_BASE } from '../src/arch/pico2/hw/programmer.js';
import { HardwareError, toHardwareError } from '../src/arch/pico2/hw/errors.js';
import { FAMILY } from '../src/arch/pico2/firmware/validate.js';
import { PicobootCmd } from '../src/arch/pico2/vendor/picoflash/commands.js';

// the vendored library logs every transfer to the console; quiet here (its logging is unchanged in the page)
for (const k of ['log', 'warn', 'error']) console[k] = () => {};

import { flashArtifact, ramArtifact } from './fixtures/pico2-images.mjs';

const FAST = { endpoint: 200, commandStatus: 200, reset: 200 };
async function open(faults = {}, o = {}) {
  const d = new MockPicobootDevice({ faults, ...o });
  const t = new PicobootTransport(d, { timeouts: FAST });
  await t.open();
  return { d, t };
}
const rejectsCode = async (p, code) => { try { await p; } catch (e) { assert.ok(e instanceof HardwareError, `${e}`); assert.equal(e.code, code, e.message); return e; } assert.fail(`expected ${code}`); };

test('U-01: the PICOBOOT interface is found by class 0xff/0/0 and its bulk endpoints, not by number', () => {
  assert.deepEqual(findPicoboot(new MockPicobootDevice()), { configurationValue: 1, ifNum: 1, alternate: 0, inEp: 4, outEp: 3, inSize: 64 });
  assert.equal(findPicoboot(new MockPicobootDevice({ msd: false })).ifNum, 0, 'drive disabled: interface 0');
  const reset = new MockPicobootDevice();
  reset.configurations[0].interfaces[1].alternates[0].interfaceProtocol = 1; reset.configurations[0].interfaces[1].alternates[0].endpoints = [];
  assert.equal(findPicoboot(reset), null, 'the SDK reset interface (protocol 1, no endpoints) is not PICOBOOT');
});

test('U-05/U-06: a flash image: preflight, confirmation, exclusive access, erase/write/read per sector with 0x10000000 last, REBOOT2 FLASH_UPDATE; progress monotonic to 100 % once', async () => {
  const a = flashArtifact();
  const { d, t } = await open();
  const progress = [];
  let summary = null;
  const r = await writeArtifact(t, a, { confirm: async (s) => { summary = s; assert.ok(!d.log.some((e) => e.name === 'erase' || e.name === 'write'), 'nothing written before the confirmation'); return true; }, onProgress: (p) => progress.push(p), rebootDelayMs: 500 });
  assert.equal(r.ok, true); assert.equal(r.verified, true); assert.equal(r.sectors, 3); assert.equal(r.bytes, 3 * 4096);
  assert.deepEqual(summary, { kind: 'flash', bytes: 3 * 4096, sectors: 3, chip: { packageSel: 0, deviceId: 'E0C9125B0D9B2F34' }, romVersion: 4, partition: 0xff });
  const n = d.names();
  assert.deepEqual(n.slice(0, 4), ['getinfo', 'read', 'getinfo', 'exclusive'], 'chip info, ROM header, target partition, exclusive');
  const body = n.slice(4, -1);
  assert.deepEqual(body, Array(3).fill(['erase', 'write', 'read']).flat());
  const erases = d.log.filter((e) => e.name === 'erase').map((e) => e.addr);
  assert.deepEqual(erases, [0x10001000, 0x10003000, 0x10000000], 'the block-loop sector last');
  assert.ok(d.log.filter((e) => e.name === 'erase').every((e) => e.size === 4096), 'one sector per erase');
  assert.equal(n.at(-1), 'reboot2');
  assert.deepEqual(d.reboots, [{ flags: REBOOT2.flashUpdate, delay: 500, p0: FLASH_BASE, p1: 0 }]);
  for (const p of a.pages) assert.deepEqual([...d.bytes(p.address, 256)], [...p.bytes], `page 0x${p.address.toString(16)}`);
  const done = progress.map((p) => p.done);
  assert.ok(done.every((x, i) => i === 0 || x >= done[i - 1]), 'monotonic');
  assert.equal(progress.filter((p) => p.done === p.total && p.phase === 'verified').length, 1, '100 % once');
  assert.deepEqual([...new Set(progress.map((p) => p.phase))], ['preflight', 'confirm', 'write', 'verified', 'reboot']);
  assert.deepEqual(writeOrder(a), [0x10001000, 0x10003000, 0x10000000]);
});

test('Q9 B: a RAM-only image is written to SRAM without erasing, read back, then REBOOT2 RAM_IMAGE with its base and size', async () => {
  const a = ramArtifact();
  const { d, t } = await open();
  const r = await writeArtifact(t, a, {});
  assert.equal(r.ok, true);
  assert.ok(!d.names().includes('erase'), 'SRAM is not erased');
  assert.ok(!d.log.some((e) => e.name === 'getinfo' && e.args[0] === 3), 'no flash partition query for a RAM image');
  const lo = a.pages[0].address, hi = a.pages.at(-1).address + 256;
  assert.deepEqual(d.reboots, [{ flags: REBOOT2.ramImage, delay: 500, p0: lo, p1: hi - lo }]);
  for (const p of a.pages) assert.deepEqual([...d.bytes(p.address, 256)], [...p.bytes]);
});

test('U-07: an artifact that is not a whole, aligned RP2350 image is refused before any USB traffic', async () => {
  const a = flashArtifact();
  const { d, t } = await open();
  const bad = [
    [{ ...a, kind: 'other' }, 'not-bootable'], [null, 'not-bootable'], [{ ...a, family: FAMILY.RP2040 }, 'invalid-firmware'],
    [{ ...a, pages: a.pages.slice(1) }, 'invalid-firmware'], [{ ...a, pages: [...a.pages, { address: 0x10400000, bytes: new Uint8Array(256) }] }, 'invalid-firmware'],
    [{ ...a, pages: a.pages.map((p, i) => (i === 3 ? { ...p, address: p.address + 1 } : p)) }, 'invalid-firmware'],
  ];
  for (const [x, code] of bad) await rejectsCode(writeArtifact(t, x, {}), code);
  assert.throws(() => checkArtifact({ ...a, pages: a.pages.slice(0, 5) }), /not whole/);
  assert.deepEqual(d.log, [], 'no command reached the device');
});

test('U-08: cancelling before the first erase writes nothing; stopping afterwards finishes the sector, leaves BOOTSEL, no reboot', async () => {
  const a = flashArtifact();
  let { d, t } = await open();
  await rejectsCode(writeArtifact(t, a, { confirm: async () => false }), 'cancelled');
  assert.ok(!d.names().some((x) => x === 'erase' || x === 'write' || x === 'reboot2'));
  const ac = new AbortController();
  ({ d, t } = await open());
  const e = await rejectsCode(writeArtifact(t, a, { signal: ac.signal, onProgress: (p) => { if (p.phase === 'verified' && p.index === 0) ac.abort(); } }), 'cancelled');
  assert.deepEqual(e.data, { written: 1, of: 3 });
  assert.equal(d.names().filter((x) => x === 'erase').length, 1, 'the sector under way finished, no further one');
  assert.deepEqual(d.reboots, [], 'not rebooted: the board stays in BOOTSEL');
  assert.equal(d.bytes(0x10000000, 4).every((b) => b === 0xff), true, 'the block-loop sector was never written');
});

test('U-10: failures become named errors: unplugged mid-write, a hung transfer, a busy or inaccessible interface, partition tables, wrong chips, NOT_PERMITTED', async () => {
  const a = flashArtifact();
  let x = await open({ unplugAt: { cmd: 'write', n: 2 } });
  await rejectsCode(writeArtifact(x.t, a, {}), 'disconnected');
  assert.equal(x.d.reboots.length, 0);
  x = await open({ hangAt: { cmd: 'erase', n: 1 } });
  const t0 = Date.now();
  await rejectsCode(writeArtifact(x.t, a, {}), 'timeout');
  assert.ok(Date.now() - t0 < 2000, 'within the endpoint timeout');
  assert.equal(x.d.opened, false, 'the timed-out device is closed (WebUSB transfers cannot be cancelled otherwise)');
  for (const [faults, code] of [[{ claimFails: 'busy' }, 'busy'], [{ claimFails: 'access' }, 'access'], [{ openFails: 'access' }, 'access']]) {
    const d = new MockPicobootDevice({ faults });
    await rejectsCode(new PicobootTransport(d).open(), code);
  }
  for (const [faults, code] of [[{ partition: 0 }, 'not-permitted'], [{ partition: -1 }, 'not-permitted'], [{ romVersion: 9 }, 'wrong-chip'], [{ noChipInfo: true }, 'wrong-chip']]) {
    x = await open(faults);
    await rejectsCode(writeArtifact(x.t, a, {}), code);
    assert.ok(!x.d.names().includes('erase'), `${JSON.stringify(faults)}: refused before any erase`);
  }
  x = await open({ statusNotPermitted: 'erase' });
  await rejectsCode(writeArtifact(x.t, a, {}), 'not-permitted');
  assert.equal(toHardwareError(Object.assign(new Error('No device selected.'), { name: 'NotFoundError' })).code, 'denied', 'a closed chooser');
  assert.equal(toHardwareError(Object.assign(new Error('Failed to open serial port.'), { name: 'NetworkError' })).code, 'busy');
});

test('U-11: after success, failure and disconnect the interface is released and the device closed', async () => {
  const a = flashArtifact();
  for (const faults of [{}, { corruptRead: 0x10001010 }, { unplugAt: { cmd: 'read', n: 3 } }]) {
    const { d, t } = await open(faults);
    try { await writeArtifact(t, a, {}); } catch { /* expected for the faults */ }
    await t.close();
    assert.equal(d.opened, false, JSON.stringify(faults));
    assert.equal(d.claimed.size, 0, JSON.stringify(faults));
  }
});

test('U-12: of all 256 command ids only the allow-list reaches the device; OTP_WRITE, PC_SP and EXEC cannot be sent', async () => {
  const { d, t } = await open();
  const reached = [];
  for (let id = 0; id < 256; id++) {
    d.log.length = 0; d.halted = false; d.phase = 'idle';
    const cmd = new PicobootCmd(id, 0, 0, new Uint8Array(16));
    try { await t.conn.sendCmd(cmd, null); } catch (e) { if (!ALLOWED_COMMANDS.has(id)) assert.equal(e.code, 'not-permitted', `0x${id.toString(16)}`); }
    if (d.log.length) reached.push(id);
    await t.interfaceReset().catch(() => {});
  }
  assert.deepEqual(reached.sort((x, y) => x - y), [...ALLOWED_COMMANDS].sort((x, y) => x - y));
  for (const id of [0x0d, 0x08, 0x09, 0x8c, 0x02]) assert.ok(!reached.includes(id), `0x${id.toString(16)} never sent`);
  d.log.length = 0;
  const pcsp = new PicobootCmd(0x0a, 0x10, 0, Uint8Array.from([0x0d, ...new Uint8Array(15)]));
  await rejectsCode(t.conn.sendCmd(pcsp, null).then(() => {}), 'not-permitted');
  await rejectsCode(t.reboot2(0x0d), 'not-permitted');
  assert.deepEqual(d.log, [], 'REBOOT2 PC_SP never reached the device');
  const methods = Object.getOwnPropertyNames(PicobootTransport.prototype).sort();
  assert.deepEqual(methods, ['chipInfo', 'close', 'commandStatus', 'constructor', 'erase', 'exclusiveAccess', 'interfaceReset', 'open', 'read', 'reboot2', 'uf2TargetPartition', 'write']);
});

test('U-13: a corrupted read-back is a verify failure naming the sector; nothing is rebooted; Check reads back without writing', async () => {
  const a = flashArtifact();
  let { d, t } = await open({ corruptRead: 0x10003f04 });
  const e = await rejectsCode(writeArtifact(t, a, {}), 'verify-failed');
  assert.equal(e.data.sector, 0x10003000);
  assert.equal(e.data.address, 0x10003f04);
  assert.deepEqual(d.reboots, []);
  ({ d, t } = await open());
  await writeArtifact(t, a, {});
  const d2 = new MockPicobootDevice(); d2.flash = d.flash; // the same board after a replug
  const t2 = new PicobootTransport(d2, { timeouts: FAST }); await t2.open();
  assert.deepEqual(await readBack(t2, a), { same: true, firstDifference: null });
  assert.ok(!d2.names().some((x) => x === 'erase' || x === 'write'), 'Check never writes');
  d2.faults.corruptRead = 0x10001004;
  assert.deepEqual(await readBack(t2, a), { same: false, firstDifference: 0x10001004 });
});
