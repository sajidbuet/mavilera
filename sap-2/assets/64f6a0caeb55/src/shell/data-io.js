// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const SIZES = Object.freeze({ word: 4, half: 2, byte: 1 });
export class DataError extends Error {
 constructor(message, data = {}) {
 super(message);
 this.data = data;
 }
}
export function parseNumbers(text, size = 4) {
 const lo = -(2 ** (8 * size - 1));
 const hi = 2 ** (8 * size) - 1;
 const rows = text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
 const num = (t) => (/^[-+]?\d+$/.test(t) ? Number(t) : /^0x[0-9a-f]+$/i.test(t) ? parseInt(t.slice(2), 16) : /^0b[01]+$/i.test(t) ? parseInt(t.slice(2), 2) : null);
 const split = (l) => l.split(/[,;\s]+/).filter(Boolean);
 const heading = rows.length && split(rows[0]).every((t) => num(t) === null) ? split(rows.shift()) : null;
 const pairs = heading?.length === 2 && rows.every((l) => split(l).length === 2);
 const values = [];
 rows.forEach((l, i) => {
 const toks = split(l);
 for (const t of pairs ? toks.slice(1) : toks) {
 const v = num(t);
 if (v === null) throw new DataError(`line ${i + 1}: "${t}" is not a number`, { line: i + 1, token: t });
 if (v < lo || v > hi) throw new DataError(`line ${i + 1}: ${t} does not fit ${8 * size} bits`, { line: i + 1, token: t });
 values.push(v);
 }
 });
 const bytes = new Uint8Array(values.length * size);
 values.forEach((v, k) => { for (let b = 0; b < size; b++) bytes[k * size + b] = (v >>> (8 * b)) & 0xff; });
 return bytes;
}
const segmentAt = (program, address) => (program?.segments ?? [])
 .find((s) => !s.executable && address >= s.address && address < s.address + s.bytes.length) ?? null;
export function dataArrays(program) {
 const labels = (program?.symbolTable ?? []).filter((s) => s.section === 'data' && segmentAt(program, s.address))
 .sort((a, b) => a.address - b.address);
 return labels.map((s, i) => {
 const seg = segmentAt(program, s.address);
 let next = seg.address + seg.bytes.length;
 for (let k = i + 1; k < labels.length; k++) if (labels[k].address > s.address) { next = Math.min(next, labels[k].address); break; }
 return { name: s.name, address: s.address, room: next - s.address };
 }).filter((a) => a.room > 0);
}
export function applyLoads(program, loads) {
 const applied = [];
 const dropped = [];
 if (!program?.ok) return { applied, dropped };
 const arrays = new Map(dataArrays(program).map((a) => [a.name, a]));
 for (const { label, bytes } of loads) {
 const a = arrays.get(label);
 if (!a) { dropped.push({ label, why: 'missing' }); continue; }
 if (bytes.length > a.room) { dropped.push({ label, why: 'room', room: a.room, n: bytes.length }); continue; }
 const seg = segmentAt(program, a.address);
 seg.bytes.set(bytes, a.address - seg.address);
 applied.push({ label, address: a.address, n: bytes.length });
 }
 return { applied, dropped };
}
export function checkFits(program, label, bytes) {
 const a = dataArrays(program).find((x) => x.name === label);
 if (!a) throw new DataError(`no data label ${label}`);
 if (bytes.length > a.room) throw new DataError(`${bytes.length} bytes do not fit ${label}, which has room for ${a.room}`, { room: a.room });
 return a;
}
export function readRange(mem, address, count, size = 4) {
 const out = [];
 for (let k = 0; k < count; k++) out.push(mem.read((address + k * size) >>> 0, size) >>> 0);
 return out;
}
export function saveCsv(values, address, size = 4) {
 const sh = 32 - 8 * size;
 const rows = values.map((v, k) => `0x${((address + k * size) >>> 0).toString(16).padStart(8, '0')},${size === 4 ? v | 0 : (v << sh) >> sh}`);
 return `address,value\n${rows.join('\n')}\n`;
}
export function saveBin(values, size = 4) {
 const out = new Uint8Array(values.length * size);
 values.forEach((v, k) => { for (let b = 0; b < size; b++) out[k * size + b] = (v >>> (8 * b)) & 0xff; });
 return out;
}
