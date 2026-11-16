// programmer.js -- writes a validated firmware artifact to a Pico 2 in BOOTSEL over PICOBOOT (pico2 P1-F3; research ADR-0010,
// rp2350-uf2-validation.md checks 10-11, security-analysis.md S1, S3, S8, S10, S11). The artifact is the validator's
// (firmware/validate.js): what the simulator boots is what is written (ADR-0010 point 4).
//
// Order: preflight (interface reset; chip info: only an RP2350 answers; the ROM's 'M','u',2 and version byte; for a flash image
// the UF2 target partition must be "absolute", no partition table) -> the confirmation (S1; nothing is written before it) ->
// exclusive access -> per 4 KiB sector: erase, write, read back, compare -- the sector of the block loop (the image's first
// sector, where the bootrom looks for it) LAST, so that an interrupted load leaves no bootable half image (S10) -> REBOOT2
// FLASH_UPDATE (p0 = flash start, 500 ms as picotool). A RAM-only image (research D58 Q9 B: supported now, tested with mocks only):
// write and read back each 256-byte page run into SRAM, then REBOOT2 RAM_IMAGE (p0 base, p1 size). Every address is checked
// against the artifact before the transport is called (defence in depth). Progress counts acknowledged (written and verified) bytes.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { HardwareError, toHardwareError } from './errors.js';
import { REBOOT2, PARTITION_ABSOLUTE } from './transport.js';

export const FLASH_BASE = 0x10000000;
export const FLASH_BYTES = 4 << 20;            // Pico 2 and Pico 2 W: 4 MiB [RP-002; RP-003]; the validator's default
export const SRAM = Object.freeze([0x20000000, 0x20082000]);
export const SECTOR = 4096;
export const PAGE = 256;
export const RP2350_RISCV = 0xe48bff5a;
/** ROM version bytes MAVILERA knows (RP-001 §5.4.1: offset 0x13); others are refused until a board shows them (F3-5). */
export const KNOWN_ROM_VERSIONS = Object.freeze([2, 3, 4]);

/**
 * Checks an artifact before any USB traffic: kind, page alignment and size, the address range (flash 4 MiB from 0x10000000,
 * or SRAM), and for flash whole sectors. Throws HardwareError('invalid-firmware' | 'not-bootable').
 */
export function checkArtifact(a) {
  if (!a || !Array.isArray(a.pages) || !a.pages.length) throw new HardwareError('not-bootable', 'no validated image');
  if (a.kind !== 'flash' && a.kind !== 'ram') throw new HardwareError('not-bootable', `image kind ${a.kind}`);
  if (a.family !== undefined && a.family !== RP2350_RISCV) throw new HardwareError('invalid-firmware', 'not an RP2350 RISC-V image');
  let prev = -1;
  for (const p of a.pages) {
    if (p.address % PAGE || p.bytes?.length !== PAGE || p.address <= prev) throw new HardwareError('invalid-firmware', `page at 0x${(p.address >>> 0).toString(16)}`);
    prev = p.address;
    const ok = a.kind === 'flash' ? p.address >= FLASH_BASE && p.address + PAGE <= FLASH_BASE + FLASH_BYTES : p.address >= SRAM[0] && p.address + PAGE <= SRAM[1];
    if (!ok) throw new HardwareError('invalid-firmware', `address 0x${(p.address >>> 0).toString(16)} outside the ${a.kind === 'flash' ? 'flash' : 'SRAM'}`);
  }
  if (a.kind === 'flash') {
    if (a.pages[0].address !== FLASH_BASE) throw new HardwareError('invalid-firmware', 'a flash image starts at 0x10000000');
    for (const [s, pages] of sectorsOf(a)) if (pages.length !== SECTOR / PAGE) throw new HardwareError('invalid-firmware', `sector 0x${s.toString(16)} is not whole`);
  }
}

/** Map sector address -> its pages, in address order. */
export function sectorsOf(a) {
  const m = new Map();
  for (const p of a.pages) { const s = p.address - (p.address % SECTOR); if (!m.has(s)) m.set(s, []); m.get(s).push(p); }
  return m;
}

/** The sectors in write order: the block loop's sector (the first, at 0x10000000) last. */
export function writeOrder(a) {
  const all = [...sectorsOf(a).keys()];
  const loop = FLASH_BASE;
  return [...all.filter((s) => s !== loop), ...all.filter((s) => s === loop)];
}

/** Contiguous runs of pages: [{address, bytes}] (RAM images). */
export function runsOf(a) {
  const runs = [];
  for (const p of a.pages) {
    const last = runs[runs.length - 1];
    if (last && last.address + last.bytes.length === p.address) { const b = new Uint8Array(last.bytes.length + PAGE); b.set(last.bytes); b.set(p.bytes, last.bytes.length); last.bytes = b; }
    else runs.push({ address: p.address, bytes: p.bytes.slice() });
  }
  return runs;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const firstDiff = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return -1; };

/**
 * Preflight only (read-only): {chip: {packageSel, deviceId}, romVersion, partition}. Throws wrong-chip / not-permitted.
 */
export async function preflight(t, kind) {
  await t.interfaceReset();
  let chip;
  try { chip = await t.chipInfo(); } catch (e) { const h = toHardwareError(e, 'chip info'); throw h.code === 'disconnected' || h.code === 'timeout' ? h : new HardwareError('wrong-chip', 'the device did not answer as an RP2350'); }
  const rom = await t.read(0x10, 4);
  if (rom[0] !== 0x4d || rom[1] !== 0x75 || rom[2] !== 0x02) throw new HardwareError('wrong-chip', 'the ROM is not an RP2350 bootrom');
  if (!KNOWN_ROM_VERSIONS.includes(rom[3])) throw new HardwareError('wrong-chip', `unknown ROM version ${rom[3]}`, { romVersion: rom[3] });
  let partition = null;
  if (kind === 'flash') {
    partition = await t.uf2TargetPartition(RP2350_RISCV);
    if (partition !== PARTITION_ABSOLUTE) throw new HardwareError('not-permitted', partition < 0 ? 'the board accepts no RISC-V image' : `the flash has a partition table (partition ${partition})`, { partition });
  }
  const deviceId = ((BigInt(chip.deviceIdHigh >>> 0) << 32n) | BigInt(chip.deviceIdLow >>> 0)).toString(16).toUpperCase().padStart(16, '0');
  return { chip: { packageSel: chip.packageSel, deviceId }, romVersion: rom[3], partition };
}

/**
 * Probe (Hardware tab, design pico2-hardware-tab.md §4): the preflight's facts without refusing anything, read-only. Returns
 * {chip: {packageSel, deviceId}, romVersion, partition (number, or null where the board did not answer), known: boolean}.
 * Throws wrong-chip (not an RP2350 bootrom), disconnected, timeout.
 */
export async function probeBoard(t) {
  await t.interfaceReset();
  let chip;
  try { chip = await t.chipInfo(); } catch (e) { const h = toHardwareError(e, 'chip info'); throw h.code === 'disconnected' || h.code === 'timeout' ? h : new HardwareError('wrong-chip', 'the device did not answer as an RP2350'); }
  const rom = await t.read(0x10, 4);
  if (rom[0] !== 0x4d || rom[1] !== 0x75 || rom[2] !== 0x02) throw new HardwareError('wrong-chip', 'the ROM is not an RP2350 bootrom');
  let partition = null;
  try { partition = await t.uf2TargetPartition(RP2350_RISCV); } catch { partition = null; }
  const deviceId = ((BigInt(chip.deviceIdHigh >>> 0) << 32n) | BigInt(chip.deviceIdLow >>> 0)).toString(16).toUpperCase().padStart(16, '0');
  return { chip: { packageSel: chip.packageSel, deviceId }, romVersion: rom[3], partition, known: KNOWN_ROM_VERSIONS.includes(rom[3]) };
}

/**
 * Read a flash range of a board in BOOTSEL (Hardware tab §6, Save the board's flash): read-only, one sector at a time.
 * `start` and `length` are sector-aligned and inside the 4 MiB flash. onProgress({done, total}).
 */
export async function readFlash(t, start, length, { onProgress = () => {}, signal = null } = {}) {
  if (start % SECTOR || length % SECTOR || length <= 0 || start < FLASH_BASE || start + length > FLASH_BASE + FLASH_BYTES) {
    throw new HardwareError('not-permitted', 'outside the flash');
  }
  await t.interfaceReset();
  const out = new Uint8Array(length);
  for (let a = 0; a < length; a += SECTOR) {
    if (signal?.aborted) throw new HardwareError('cancelled', 'stopped while reading');
    out.set(await t.read(start + a, SECTOR), a);
    onProgress({ done: a + SECTOR, total: length });
  }
  return out;
}

/** The flash range a program's image occupies: {start, length} over its sectors (a whole 4 MiB without a flash image). */
export function flashRangeOf(artifact) {
  if (artifact?.kind !== 'flash' || !artifact.pages?.length) return { start: FLASH_BASE, length: FLASH_BYTES };
  const keys = [...sectorsOf(artifact).keys()];
  const lo = Math.min(...keys), hi = Math.max(...keys) + SECTOR;
  return { start: lo, length: hi - lo };
}

/**
 * Writes `artifact` through the open transport `t`. `confirm(summary)` is awaited after the preflight and before the first
 * erase; false cancels with nothing written. `signal` (AbortSignal): before the first erase it cancels at once; afterwards the
 * sector under way finishes and the load stops with the board left in BOOTSEL, not rebooted (S11). `onProgress({phase, done,
 * total, sector, index, count})`. Returns {ok: true, verified: true, sectors, bytes, ms, rebooted: true, preflight}; throws
 * HardwareError (verify-failed names the sector; nothing is rebooted after a failure).
 */
export async function writeArtifact(t, artifact, { confirm = async () => true, signal = null, onProgress = () => {}, now = () => performance.now(), rebootDelayMs = 500 } = {}) {
  checkArtifact(artifact);
  const t0 = now();
  const total = artifact.pages.length * PAGE;
  onProgress({ phase: 'preflight', done: 0, total });
  const pre = await preflight(t, artifact.kind);
  if (signal?.aborted) throw new HardwareError('cancelled', 'cancelled before writing');
  const summary = { kind: artifact.kind, bytes: total, sectors: artifact.kind === 'flash' ? sectorsOf(artifact).size : 0, ...pre };
  onProgress({ phase: 'confirm', done: 0, total });
  if (!(await confirm(summary))) throw new HardwareError('cancelled', 'not confirmed');
  if (signal?.aborted) throw new HardwareError('cancelled', 'cancelled before writing');
  await t.exclusiveAccess(true);
  let done = 0, started = false;
  const allowed = new Set(artifact.kind === 'flash' ? sectorsOf(artifact).keys() : []);
  if (artifact.kind === 'flash') {
    const order = writeOrder(artifact), sectors = sectorsOf(artifact);
    for (let i = 0; i < order.length; i++) {
      if (started && signal?.aborted) throw new HardwareError('cancelled', 'stopped; the board stays in BOOTSEL with an incomplete image', { written: i, of: order.length });
      const s = order[i];
      if (!allowed.has(s)) throw new HardwareError('not-permitted', `sector 0x${s.toString(16)} is not part of the image`);
      const data = new Uint8Array(SECTOR);
      for (const p of sectors.get(s)) data.set(p.bytes, p.address - s);
      onProgress({ phase: 'write', done, total, sector: s, index: i, count: order.length });
      started = true;
      await t.erase(s, SECTOR);
      await t.write(s, data);
      const back = await t.read(s, SECTOR);
      if (!same(back, data)) { const at = s + firstDiff(back, data); throw new HardwareError('verify-failed', `sector 0x${s.toString(16)} read back differently at 0x${at.toString(16)}`, { sector: s, address: at }); }
      done += SECTOR;
      onProgress({ phase: 'verified', done, total, sector: s, index: i, count: order.length });
    }
    onProgress({ phase: 'reboot', done, total });
    await t.reboot2(REBOOT2.flashUpdate, FLASH_BASE, 0, rebootDelayMs);
  } else {
    const runs = runsOf(artifact);
    for (let i = 0; i < runs.length; i++) {
      if (started && signal?.aborted) throw new HardwareError('cancelled', 'stopped before the image was complete', { written: i, of: runs.length });
      const r = runs[i];
      if (r.address < SRAM[0] || r.address + r.bytes.length > SRAM[1]) throw new HardwareError('not-permitted', 'outside the SRAM');
      onProgress({ phase: 'write', done, total, sector: r.address, index: i, count: runs.length });
      started = true;
      await t.write(r.address, r.bytes);
      const back = await t.read(r.address, r.bytes.length);
      if (!same(back, r.bytes)) { const at = r.address + firstDiff(back, r.bytes); throw new HardwareError('verify-failed', `RAM at 0x${at.toString(16)} read back differently`, { sector: r.address, address: at }); }
      done += r.bytes.length;
      onProgress({ phase: 'verified', done, total, sector: r.address, index: i, count: runs.length });
    }
    const lo = artifact.pages[0].address, hi = artifact.pages[artifact.pages.length - 1].address + PAGE;
    onProgress({ phase: 'reboot', done, total });
    await t.reboot2(REBOOT2.ramImage, lo, hi - lo, rebootDelayMs);
  }
  return { ok: true, verified: true, sectors: allowed.size, bytes: done, ms: Math.round(now() - t0), rebooted: true, preflight: pre };
}

/**
 * Check (research D58 Q7 A): read back the image's sectors (or RAM runs) of a board in BOOTSEL and compare; no write.
 * Returns {same: boolean, firstDifference: address | null}.
 */
export async function readBack(t, artifact) {
  checkArtifact(artifact);
  await t.interfaceReset();
  if (artifact.kind === 'flash') {
    for (const [s, pages] of sectorsOf(artifact)) {
      const data = new Uint8Array(SECTOR);
      for (const p of pages) data.set(p.bytes, p.address - s);
      const back = await t.read(s, SECTOR);
      if (!same(back, data)) return { same: false, firstDifference: s + firstDiff(back, data) };
    }
  } else {
    for (const r of runsOf(artifact)) {
      const back = await t.read(r.address, r.bytes.length);
      if (!same(back, r.bytes)) return { same: false, firstDifference: r.address + firstDiff(back, r.bytes) };
    }
  }
  return { same: true, firstDifference: null };
}
