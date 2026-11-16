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
export const RAM_RANGES = Object.freeze([[0x20000000, 0x20082000], [0x13ffc000, 0x14000000]]);
const E10_ADDRESS = 0x10ffff00;
const BLOCK = Object.freeze({ START: 0xffffded3, END: 0xab123579, IMAGE_TYPE: 0x42, VECTOR_TABLE: 0x03, ENTRY_POINT: 0x44, ROLLING_WINDOW_DELTA: 0x05, LOAD_MAP: 0x06, PARTITION_TABLE: 0x0a, LAST: 0xff });
const IMAGE_DEF_MAX = 384;
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const inRam = (a, end) => RAM_RANGES.some(([lo, hi]) => a >= lo && end <= hi);
class Refused extends Error { constructor(code, message) { super(message); this.code = code; } }
const refuse = (code, message) => { throw new Refused(code, message); };
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
function uf2Pages(bytes, note) {
 if (bytes.length === 0 || bytes.length % 512) refuse('length', S.firmware.length(bytes.length));
 const pages = new Map();
 const seen = new Set();
 let numBlocks = -1, e10 = 0, notMain = 0;
 for (let o = 0, b = 0; o < bytes.length; o += 512, b++) {
 if (u32(bytes, o) !== UF2.MAGIC0 || u32(bytes, o + 4) !== UF2.MAGIC1 || u32(bytes, o + 508) !== UF2.MAGIC_END) refuse('magic', S.firmware.magic(b));
 const flags = u32(bytes, o + 8), address = u32(bytes, o + 12), size = u32(bytes, o + 16);
 const blockNo = u32(bytes, o + 20), count = u32(bytes, o + 24), family = u32(bytes, o + 28);
 if (flags & UF2.NOT_MAIN_FLASH) { notMain++; continue; }
 if ((flags & UF2.FAMILY_PRESENT) && family === FAMILY.ABSOLUTE) {
 if (e10 === 0 && isE10(bytes, o, flags, address, size)) { e10++; continue; }
 refuse('absoluteBlock', S.firmware.absoluteBlock(b));
 }
 if (!(flags & UF2.FAMILY_PRESENT)) refuse('noFamily', S.firmware.noFamily(b));
 if (family !== FAMILY.RP2350_RISCV) refuse('family', S.firmware.family(b, FAMILY_NAME[family] ?? `the family 0x${family.toString(16)}`));
 if (flags & UF2.FILE_CONTAINER) refuse('container', S.firmware.container(b));
 if (flags & UF2.MD5) refuse('md5', S.firmware.md5(b));
 if (size !== PAGE) refuse('payload', S.firmware.payload(b, size));
 if (address % PAGE) refuse('align', S.firmware.align(b, address));
 if (numBlocks < 0) numBlocks = count;
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
function isE10(bytes, o, flags, address, size) {
 if (address !== E10_ADDRESS || size !== PAGE || !(flags & UF2.EXTENSIONS)) return false;
 for (let i = 0; i < PAGE; i++) if (bytes[o + 32 + i] !== 0xef) return false;
 return u32(bytes, o + 32 + PAGE) === UF2.IGNORE_TAG;
}
export function elfPages(bytes) {
 let elf;
 try { elf = parseElf(bytes); } catch (e) { refuse('elf', S.firmware.elf(e.message.replace(/\.$/, ''))); }
 const pages = new Map();
 for (const s of elf.segments) {
 const n = s.data.length, base = s.paddr >>> 0;
 if (n === 0) continue;
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
function binPages(bytes) {
 if (!bytes.length) refuse('empty', S.firmware.empty);
 const pages = new Map();
 for (let i = 0; i < bytes.length; i += PAGE) {
 const p = new Uint8Array(PAGE); p.set(bytes.subarray(i, i + PAGE));
 pages.set(FLASH_BASE + i, p);
 }
 return pages;
}
function checkImage(pages, source, flashSize, note) {
 const addrs = [...pages.keys()].sort((a, b) => a - b);
 const lowest = addrs[0], end = addrs[addrs.length - 1] + PAGE;
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
 if ((flags & 0xf) !== 1) continue;
 const cpu = (flags >>> 8) & 7, chip = (flags >>> 12) & 7;
 if (cpu === 0) { arm = true; continue; }
 if (cpu !== 1) continue;
 if (chip !== 1) { chipOther = true; continue; }
 if (blk.size > IMAGE_DEF_MAX) continue;
 if (!def) def = { blk, flags };
 }
 if (!def) refuse(arm ? 'notRiscv' : chipOther ? 'notRp2350' : 'noImageDef', arm ? S.firmware.notRiscv : chipOther ? S.firmware.notRp2350 : S.firmware.noImageDef);
 if (def.blk.items.some((i) => i.type === BLOCK.VECTOR_TABLE)) note('vectorTable', S.firmware.vectorTable);
 const ep = def.blk.items.find((i) => i.type === BLOCK.ENTRY_POINT);
 const entry = ep ? { pc: word(ep.at + 4), sp: ep.words >= 3 ? word(ep.at + 8) : null } : { pc: lowest, sp: null };
 if (entry.pc === null || !supplied.has(entry.pc - (entry.pc % PAGE))) refuse('entryOutside', S.firmware.entryOutside(entry.pc ?? 0));
 if (def.flags & 0x8000) note('tbyb', S.firmware.tbyb);
 const all = blocks.flatMap((b) => b.items.map((i) => i.type));
 if (all.includes(BLOCK.LOAD_MAP)) note('loadMap', S.firmware.loadMap);
 if (all.includes(BLOCK.ROLLING_WINDOW_DELTA)) note('rollingWindow', S.firmware.rollingWindow);
 let filled = 0;
 if (kind === 'flash') {
 const sectors = new Set(addrs.map((a) => a - (a % SECTOR)));
 for (const s of sectors) for (let a = s; a < s + SECTOR; a += PAGE) if (!pages.has(a)) { pages.set(a, new Uint8Array(PAGE)); filled++; }
 if (filled) note('filled', S.firmware.filled(filled));
 }
 const list = [...pages.keys()].sort((a, b) => a - b).map((address) => ({ address, bytes: pages.get(address) }));
 return { kind, source, family: FAMILY.RP2350_RISCV, pages: list, filled, lowest, end, entry, imageDef: { block: def.blk.at, flags: def.flags, items: def.blk.items.map((i) => i.type) }, blocks: blocks.length };
}
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
 if (((w >>> 8) & 0xffff) !== (p - at - 4) / 4) return null;
 return { at, items, link: link | 0, size: p + 12 - at };
 }
 const words = type & 0x80 ? (w >>> 8) & 0xffff : (w >>> 8) & 0xff;
 if (words === 0) return null;
 items.push({ type, at: p, words });
 p += words * 4;
 }
 return null;
}
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
