// validate.js -- the strict validator of RP2350 RISC-V firmware, shared by the import of SDK-built programs (P1-C1) and, later,
// by writing a Pico 2 from the browser (P1-H1, ADR-0010): the bytes the simulator imports are the bytes that would be written.
// Checks 1-9 of the research study `research/browser-usb-flashing/rp2350-uf2-validation.md` §6 (file: UF2 blocks, family,
// numbering, address ranges, sector fill; image: block loop, IMAGE_DEF, no partition table), on a UF2 file, on an ELF file
// (its PT_LOAD segments' file bytes at their physical addresses, never BSS; as picotool) or on a .bin flash image.
// Sources of the formats: RP-001 §5.1.4-5.1.5, §5.5.2, §5.9 (UF2, block loop, IMAGE_DEF); pico-sdk `boot/uf2.h`,
// `boot/picobin.h` (constants). An imported image must pass every check (author's decision Q4, 2026-11-07); check 9's
// warnings are notes. Pure: no DOM, reads only, executes nothing. The simulator's own code (C4).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { parseElf } from '../core/elf.js';
import { PICO2_STRINGS as S } from '../strings.js';

export const FAMILY = Object.freeze({ RP2040: 0xe48bff56, ABSOLUTE: 0xe48bff57, DATA: 0xe48bff58, RP2350_ARM_S: 0xe48bff59, RP2350_RISCV: 0xe48bff5a, RP2350_ARM_NS: 0xe48bff5b });
const FAMILY_NAME = Object.freeze({ [FAMILY.RP2040]: 'the RP2040 (Pico)', [FAMILY.DATA]: 'data, not a program', [FAMILY.RP2350_ARM_S]: "the RP2350's Arm cores (secure)", [FAMILY.RP2350_ARM_NS]: "the RP2350's Arm cores (non-secure)", 0xe48bff55: 'the CYW43 wireless chip' });
const UF2 = Object.freeze({ MAGIC0: 0x0a324655, MAGIC1: 0x9e5d5157, MAGIC_END: 0x0ab16f30, NOT_MAIN_FLASH: 0x1, FILE_CONTAINER: 0x1000, FAMILY_PRESENT: 0x2000, MD5: 0x4000, EXTENSIONS: 0x8000, IGNORE_TAG: 0x9957e304 });
export const FLASH_BASE = 0x10000000;
export const PAGE = 256;
export const SECTOR = 4096;
/** The SRAM ranges a RAM image may use (RP-001 §5.5.3; study §3). */
export const RAM_RANGES = Object.freeze([[0x20000000, 0x20082000], [0x13ffc000, 0x14000000]]);
const E10_ADDRESS = 0x10ffff00;
const BLOCK = Object.freeze({ START: 0xffffded3, END: 0xab123579, IMAGE_TYPE: 0x42, VECTOR_TABLE: 0x03, ENTRY_POINT: 0x44, ROLLING_WINDOW_DELTA: 0x05, LOAD_MAP: 0x06, PARTITION_TABLE: 0x0a, LAST: 0xff });
const IMAGE_DEF_MAX = 384; // the bootrom ignores larger IMAGE_DEF blocks (RP-001 §5.9.5.2)

const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const inRam = (a, end) => RAM_RANGES.some(([lo, hi]) => a >= lo && end <= hi);

/**
 * @typedef {object} FirmwareArtifact     the single artifact of ADR-0010: what is simulated, written or downloaded
 * @property {'flash'|'ram'} kind
 * @property {'uf2'|'elf'|'bin'} source
 * @property {number} family               always rp2350-riscv
 * @property {{address: number, bytes: Uint8Array}[]} pages   256-byte pages in address order, the sector fill included
 * @property {number} filled               pages added to complete the touched 4 KiB sectors (flash; zeros)
 * @property {number} lowest               the lowest address the file supplies
 * @property {number} end                  one past the highest address the file supplies
 * @property {{pc: number, sp: number | null}} entry
 * @property {{block: number, flags: number, items: number[]}} imageDef  the RISC-V IMAGE_DEF used (block address, image-type flags)
 * @property {number} blocks               blocks in the block loop
 */

class Refused extends Error { constructor(code, message) { super(message); this.code = code; } }
const refuse = (code, message) => { throw new Refused(code, message); };

/**
 * Validate firmware bytes. `kind` 'bin' reads the bytes as a flash image at 0x10000000; otherwise an ELF is recognised by its
 * magic number and anything else is read as UF2.
 * @returns {{ok: boolean, source: string, errors: {code: string, message: string}[], notes: {code: string, message: string}[],
 *            artifact: FirmwareArtifact | null}}
 */
export function validateFirmware(bytes, { kind = null, flashSize = 4 << 20 } = {}) {
  const notes = [];
  const note = (code, message) => notes.push({ code, message });
  let source = 'uf2';
  try {
    let pages;
    if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) { source = 'elf'; pages = elfPages(bytes); }
    else if (kind === 'bin') { source = 'bin'; pages = binPages(bytes); }
    else pages = uf2Pages(bytes, note);
    const artifact = checkImage(pages, source, flashSize, note);
    return { ok: true, source, errors: [], notes, artifact };
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    return { ok: false, source, errors: [{ code: e.code, message: e.message }], notes, artifact: null };
  }
}

/** Checks 1-4 on a UF2 file: the pages it supplies (Map address -> bytes). */
function uf2Pages(bytes, note) {
  if (bytes.length === 0 || bytes.length % 512) refuse('length', S.firmware.length(bytes.length));
  const pages = new Map();
  const seen = new Set();
  let numBlocks = -1, e10 = 0, notMain = 0;
  for (let o = 0, b = 0; o < bytes.length; o += 512, b++) {
    if (u32(bytes, o) !== UF2.MAGIC0 || u32(bytes, o + 4) !== UF2.MAGIC1 || u32(bytes, o + 508) !== UF2.MAGIC_END) refuse('magic', S.firmware.magic(b));
    const flags = u32(bytes, o + 8), address = u32(bytes, o + 12), size = u32(bytes, o + 16);
    const blockNo = u32(bytes, o + 20), count = u32(bytes, o + 24), family = u32(bytes, o + 28);
    if (flags & UF2.NOT_MAIN_FLASH) { notMain++; continue; }                                         // check 2
    if ((flags & UF2.FAMILY_PRESENT) && family === FAMILY.ABSOLUTE) {
      if (e10 === 0 && isE10(bytes, o, flags, address, size)) { e10++; continue; }                     // check 2: the E10 block
      refuse('absoluteBlock', S.firmware.absoluteBlock(b));
    }
    if (!(flags & UF2.FAMILY_PRESENT)) refuse('noFamily', S.firmware.noFamily(b));                     // check 3
    if (family !== FAMILY.RP2350_RISCV) refuse('family', S.firmware.family(b, FAMILY_NAME[family] ?? `the family 0x${family.toString(16)}`));
    if (flags & UF2.FILE_CONTAINER) refuse('container', S.firmware.container(b));
    if (flags & UF2.MD5) refuse('md5', S.firmware.md5(b));
    if (size !== PAGE) refuse('payload', S.firmware.payload(b, size));
    if (address % PAGE) refuse('align', S.firmware.align(b, address));
    if (numBlocks < 0) numBlocks = count;                                                             // check 4
    else if (count !== numBlocks) refuse('numBlocks', S.firmware.numBlocks(b));
    if (blockNo >= numBlocks) refuse('blockNo', S.firmware.blockNo(b));
    if (seen.has(blockNo)) refuse('duplicateBlock', S.firmware.duplicateBlock(blockNo));
    seen.add(blockNo);
    if (pages.has(address)) refuse('duplicateAddress', S.firmware.duplicateAddress(address));
    pages.set(address, bytes.slice(o + 32, o + 32 + PAGE));
  }
  if (numBlocks < 0) refuse('empty', S.firmware.empty);
  for (let n = 0; n < numBlocks; n++) if (!seen.has(n)) refuse('missingBlock', S.firmware.missingBlock(n));
  if (e10) note('e10Skipped', S.firmware.e10Skipped);
  if (notMain) note('notMainSkipped', S.firmware.notMainSkipped(notMain));
  return pages;
}

/** The RP2350-E10 workaround block exactly (study §4): family absolute at 0x10ffff00, 256 bytes of 0xef, the ignore tag. */
function isE10(bytes, o, flags, address, size) {
  if (address !== E10_ADDRESS || size !== PAGE || !(flags & UF2.EXTENSIONS)) return false;
  for (let i = 0; i < PAGE; i++) if (bytes[o + 32 + i] !== 0xef) return false;
  return u32(bytes, o + 32 + PAGE) === UF2.IGNORE_TAG;
}

/**
 * An ELF's PT_LOAD file bytes at their physical addresses, as 256-byte pages (gaps within a page are zeros, as picotool);
 * Map address -> bytes, before the sector fill. Also used by the UF2 writer (uf2.js) after validation.
 */
export function elfPages(bytes) {
  let elf;
  try { elf = parseElf(bytes); } catch (e) { refuse('elf', S.firmware.elf(e.message.replace(/\.$/, ''))); }
  const pages = new Map();
  for (const s of elf.segments) {
    const n = s.data.length, base = s.paddr >>> 0;
    if (n === 0) continue; // BSS only: nothing is written
    if (base + n > 0x100000000) refuse('outside', S.firmware.outside(base));
    for (let i = 0; i < n;) {
      const a = base + i, pa = a - (a % PAGE);
      let p = pages.get(pa);
      if (!p) { p = new Uint8Array(PAGE); pages.set(pa, p); }
      const k = Math.min(PAGE - (a - pa), n - i);
      p.set(s.data.subarray(i, i + k), a - pa);
      i += k;
    }
  }
  if (!pages.size) refuse('empty', S.firmware.empty);
  return pages;
}

/** A .bin file: a flash image from 0x10000000. */
function binPages(bytes) {
  if (!bytes.length) refuse('empty', S.firmware.empty);
  const pages = new Map();
  for (let i = 0; i < bytes.length; i += PAGE) {
    const p = new Uint8Array(PAGE); p.set(bytes.subarray(i, i + PAGE));
    pages.set(FLASH_BASE + i, p);
  }
  return pages;
}

/** Checks 5-9 on the pages; returns the artifact. */
function checkImage(pages, source, flashSize, note) {
  const addrs = [...pages.keys()].sort((a, b) => a - b);
  const lowest = addrs[0], end = addrs[addrs.length - 1] + PAGE;
  // check 5: one binary type
  const flash = (a) => a >= FLASH_BASE && a < FLASH_BASE + 0x02000000;
  const anyFlash = addrs.some(flash), anyRam = addrs.some((a) => inRam(a, a + PAGE));
  for (const a of addrs) if (!flash(a) && !inRam(a, a + PAGE)) refuse('outside', S.firmware.outside(a));
  if (anyFlash && anyRam) refuse('mixed', S.firmware.mixed);
  const kind = anyFlash ? 'flash' : 'ram';
  if (kind === 'flash') {
    if (lowest !== FLASH_BASE) refuse('flashStart', S.firmware.flashStart(lowest));
    if (end > FLASH_BASE + flashSize) refuse('flashSize', S.firmware.flashSize(end, flashSize));
  } else if (!RAM_RANGES.some(([lo, hi]) => lowest >= lo && end <= hi)) refuse('outside', S.firmware.outside(lowest));
  const supplied = new Set(addrs);
  const word = (a) => { const p = pages.get(a - (a % PAGE)); const o = a % PAGE; return p && o <= PAGE - 4 && supplied.has(a - o) ? u32(p, o) : null; };

  // checks 7-9: the block loop, its IMAGE_DEF, no partition table
  const window = kind === 'flash' ? SECTOR : end - lowest;
  let first = -1;
  for (let o = 0; o + 4 <= window; o += 4) if (word(lowest + o) === BLOCK.START) { first = lowest + o; break; }
  if (first < 0) refuse('noBlockLoop', S.firmware.noBlockLoop);
  const blocks = [];
  for (let at = first, guard = 0; ; guard++) {
    if (guard >= 32) refuse('openLoop', S.firmware.openLoop(at));
    const blk = readBlock(word, at);
    if (!blk) refuse('openLoop', S.firmware.openLoop(at));
    blocks.push(blk);
    const next = (at + blk.link) >>> 0;
    if (next === first) break;
    if (blocks.some((x) => x.at === next) || next < lowest || next >= end) refuse('openLoop', S.firmware.openLoop(at));
    at = next;
  }
  let def = null, arm = false, chipOther = false;
  for (const blk of blocks) {
    if (blk.items.some((i) => i.type === BLOCK.PARTITION_TABLE)) refuse('partitionTable', S.firmware.partitionTable);
    const it = blk.items.find((i) => i.type === BLOCK.IMAGE_TYPE);
    if (!it) continue;
    const flags = (word(it.at) >>> 16) & 0xffff;
    if ((flags & 0xf) !== 1) continue;                          // not an executable image (PICOBIN_IMAGE_TYPE_IMAGE_TYPE_EXE)
    const cpu = (flags >>> 8) & 7, chip = (flags >>> 12) & 7;
    if (cpu === 0) { arm = true; continue; }                    // PICOBIN_IMAGE_TYPE_EXE_CPU_ARM
    if (cpu !== 1) continue;                                    // RISC-V is 1 (Varmulet 2: not for this chip's cores)
    if (chip !== 1) { chipOther = true; continue; }             // PICOBIN_IMAGE_TYPE_EXE_CHIP_RP2350
    if (blk.size > IMAGE_DEF_MAX) continue;
    if (!def) def = { blk, flags };
  }
  if (!def) refuse(arm ? 'notRiscv' : chipOther ? 'notRp2350' : 'noImageDef', arm ? S.firmware.notRiscv : chipOther ? S.firmware.notRp2350 : S.firmware.noImageDef);
  // the study's check 8 refused a VECTOR_TABLE item; RP-001 §5.9.3.3 (note to Table 496) says it is ignored on RISC-V, and the
  // SDK adds one to every no_flash binary (embedded_start_block.inc.S l.9-13): a note (correction recorded 2026-11-07)
  if (def.blk.items.some((i) => i.type === BLOCK.VECTOR_TABLE)) note('vectorTable', S.firmware.vectorTable);
  const ep = def.blk.items.find((i) => i.type === BLOCK.ENTRY_POINT);
  const entry = ep ? { pc: word(ep.at + 4), sp: ep.words >= 3 ? word(ep.at + 8) : null } : { pc: lowest, sp: null };
  if (entry.pc === null || !supplied.has(entry.pc - (entry.pc % PAGE))) refuse('entryOutside', S.firmware.entryOutside(entry.pc ?? 0));
  if (def.flags & 0x8000) note('tbyb', S.firmware.tbyb);
  const all = blocks.flatMap((b) => b.items.map((i) => i.type));
  if (all.includes(BLOCK.LOAD_MAP)) note('loadMap', S.firmware.loadMap);
  if (all.includes(BLOCK.ROLLING_WINDOW_DELTA)) note('rollingWindow', S.firmware.rollingWindow);

  // check 6: complete the touched flash sectors with zero pages
  let filled = 0;
  if (kind === 'flash') {
    const sectors = new Set(addrs.map((a) => a - (a % SECTOR)));
    for (const s of sectors) for (let a = s; a < s + SECTOR; a += PAGE) if (!pages.has(a)) { pages.set(a, new Uint8Array(PAGE)); filled++; }
    if (filled) note('filled', S.firmware.filled(filled));
  }
  const list = [...pages.keys()].sort((a, b) => a - b).map((address) => ({ address, bytes: pages.get(address) }));
  return { kind, source, family: FAMILY.RP2350_RISCV, pages: list, filled, lowest, end, entry, imageDef: { block: def.blk.at, flags: def.flags, items: def.blk.items.map((i) => i.type) }, blocks: blocks.length };
}

/** One block at `at`: its items up to LAST, the link and the end marker; null if it is not a well-formed block. */
function readBlock(word, at) {
  if (word(at) !== BLOCK.START) return null;
  const items = [];
  let p = at + 4;
  for (let guard = 0; guard < 128; guard++) {
    const w = word(p);
    if (w === null) return null;
    const type = w & 0xff;
    if (type === BLOCK.LAST) {
      const link = word(p + 4), endMark = word(p + 8);
      if (link === null || endMark !== BLOCK.END) return null;
      if (((w >>> 8) & 0xffff) !== (p - at - 4) / 4) return null; // LAST's size: the words of the items before it
      return { at, items, link: link | 0, size: p + 12 - at };
    }
    const words = type & 0x80 ? (w >>> 8) & 0xffff : (w >>> 8) & 0xff;
    if (words === 0) return null;
    items.push({ type, at: p, words });
    p += words * 4;
  }
  return null;
}

/** The build id of an artifact: the first 16 hexadecimal digits of the SHA-256 of its pages (addresses and bytes). */
export async function buildId(artifact) {
  const buf = new Uint8Array(artifact.pages.length * (4 + PAGE));
  artifact.pages.forEach((p, i) => {
    const o = i * (4 + PAGE);
    buf[o] = p.address & 0xff; buf[o + 1] = (p.address >>> 8) & 0xff; buf[o + 2] = (p.address >>> 16) & 0xff; buf[o + 3] = p.address >>> 24;
    buf.set(p.bytes, o + 4);
  });
  const h = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', buf));
  return [...h.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
