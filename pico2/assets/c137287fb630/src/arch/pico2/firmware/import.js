// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { validateFirmware, FLASH_BASE } from './validate.js';
import { parseElf } from '../core/elf.js';
import { readLineTable, DwarfError } from '../debug/dwarf-line.js';
import { PICO2_STRINGS as S } from '../strings.js';
export const LISTING_MAX = 20000;
const DEFAULT_SP = 0x20082000;
function reader(chunks) {
 const sorted = [...chunks].sort((a, b) => a.address - b.address);
 const starts = sorted.map((c) => c.address);
 return (a) => {
 let lo = 0, hi = starts.length - 1, k = -1;
 while (lo <= hi) { const m = (lo + hi) >> 1; if (starts[m] <= a) { k = m; lo = m + 1; } else hi = m - 1; }
 if (k < 0) return -1;
 const c = sorted[k], o = a - c.address;
 return o < c.bytes.length ? c.bytes[o] : -1;
 };
}
function disassembleRange(byte, lo, hi, rows, max) {
 for (let a = lo; a + 2 <= hi && rows.length < max;) {
 const b0 = byte(a), b1 = byte(a + 1);
 if (b0 < 0 || b1 < 0) { a += 2; continue; }
 const half = b0 | (b1 << 8);
 if ((half & 3) === 3 && a + 4 <= hi) {
 const b2 = byte(a + 2), b3 = byte(a + 3);
 if (b2 < 0 || b3 < 0) { a += 2; continue; }
 rows.push({ address: a, size: 4, word: (half | (b2 << 16) | (b3 << 24)) >>> 0, text: '', part: -1 });
 a += 4;
 } else {
 rows.push({ address: a, size: 2, word: half, text: '', part: -1 });
 a += 2;
 }
 }
}
export function loadImage(content, kind, name) {
 const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(String(content));
 const v = validateFirmware(bytes, { kind: kind === 'bin' ? 'bin' : null });
 if (!v.ok) throw new Error(v.errors[0].message);
 const art = v.artifact;
 const diagnostics = v.notes.map((n) => ({ severity: 'warning', message: n.message }));
 const image = { kind: art.source, family: art.family, chunks: art.pages, entry: { pc: art.entry.pc, sp: art.entry.sp ?? DEFAULT_SP },
 imageDef: art.imageDef, symbols: new Map(), lowest: art.lowest };
 let functions = [], lineTable = null, elfChunks = null;
 if (v.source === 'elf') {
 const elf = parseElf(bytes);
 functions = elf.functions.filter((f) => f.size > 0);
 image.symbols = elf.symbols;
 elfChunks = elf.segments.filter((s) => s.data.length).map((s) => ({ address: s.vaddr >>> 0, bytes: s.data }));
 try { lineTable = readLineTable(elf.sections); } catch (e) {
 if (!(e instanceof DwarfError)) throw e;
 diagnostics.push({ severity: 'warning', message: S.importer.noLines(e.message) });
 }
 if (!lineTable) diagnostics.push({ severity: 'warning', message: S.importer.noDebug });
 } else diagnostics.push({ severity: 'warning', message: S.importer.noSymbols(v.source) });
 const rows = [];
 if (functions.length) {
 const byte = reader(elfChunks);
 let end = 0;
 for (const f of functions) {
 if (f.address < end) continue;
 disassembleRange(byte, f.address & ~1, f.address + f.size, rows, LISTING_MAX);
 end = f.address + f.size;
 if (rows.length >= LISTING_MAX) break;
 }
 } else {
 const byte = reader(art.pages);
 const hi = art.end;
 disassembleRange(byte, art.kind === 'flash' ? FLASH_BASE : art.lowest, hi, rows, LISTING_MAX);
 }
 if (rows.length >= LISTING_MAX) diagnostics.push({ severity: 'warning', message: S.importer.listingCapped(LISTING_MAX) });
 return {
 ok: true, imported: true, diagnostics, entry: image.entry.pc, image,
 segments: art.pages.map((p) => ({ address: p.address, bytes: p.bytes, executable: true })),
 listing: rows, data: [],
 symbols: Object.fromEntries(functions.map((f) => [f.name, f.address])),
 symbolTable: functions.map((f) => ({ name: f.name, address: f.address, section: 'text' })),
 debug: { name, source: v.source, lineTable, functions, artifact: art, notes: v.notes },
 };
}
