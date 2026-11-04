// data-io.js -- data import and export (WS-F-145): numbers from a CSV or
// text file, or the bytes of a binary file, loaded into a labelled data array
// of the program before a run, and a memory range saved as CSV or binary.
// An array's room runs from its label to the next data label or the end of
// the data; a file that does not fit is refused, never cut. The loads are
// kept by label and applied to the program image after each assembly, so the
// ISA engine and the datapath views all start from them. Files stay in the
// browser (WS-N-008). Pure JavaScript, no DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const SIZES = Object.freeze({ word: 4, half: 2, byte: 1 });

export class DataError extends Error {
  constructor(message, data = {}) {
    super(message);
    this.data = data;
  }
}

/**
 * Numbers of a CSV or text file: separated by commas, semicolons, white space or line
 * ends; decimal (signed), 0x… or 0b…. A first row with no number in it is a heading and is
 * skipped; under a heading of two fields, rows of two fields (address, value), as saveCsv
 * writes them, give their second.
 * Each value must fit `size` bytes, signed or unsigned. Returns little-endian bytes.
 */
export function parseNumbers(text, size = 4) {
  const lo = -(2 ** (8 * size - 1));
  const hi = 2 ** (8 * size) - 1;
  const rows = text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  const num = (t) => (/^[-+]?\d+$/.test(t) ? Number(t) : /^0x[0-9a-f]+$/i.test(t) ? parseInt(t.slice(2), 16) : /^0b[01]+$/i.test(t) ? parseInt(t.slice(2), 2) : null);
  const split = (l) => l.split(/[,;\s]+/).filter(Boolean);
  const heading = rows.length && split(rows[0]).every((t) => num(t) === null) ? split(rows.shift()) : null;
  const pairs = heading?.length === 2 && rows.every((l) => split(l).length === 2); // address, value
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

/**
 * Words of a .hex file as Verilog's $readmemh reads them (the book's data.hex): hexadecimal words without prefix,
 * separated by white space; `//` and `#` comments; no address markers. Returns little-endian bytes.
 */
export function parseHexWords(text, size = 4) {
  const values = [];
  text.split(/\r\n|\r|\n/).forEach((line, i) => {
    for (const t of line.replace(/(\/\/|#).*$/, '').split(/\s+/).filter(Boolean)) {
      if (!/^[0-9a-f_]+$/i.test(t)) throw new DataError(`line ${i + 1}: "${t}" is not a hexadecimal word`, { line: i + 1, token: t });
      const digits = t.replace(/_/g, '');
      if (digits.length > 2 * size) throw new DataError(`line ${i + 1}: ${t} does not fit ${8 * size} bits`, { line: i + 1, token: t });
      values.push(parseInt(digits, 16));
    }
  });
  const bytes = new Uint8Array(values.length * size);
  values.forEach((v, k) => { for (let b = 0; b < size; b++) bytes[k * size + b] = (v >>> (8 * b)) & 0xff; });
  return bytes;
}

/** The data segment holding `address` (a segment without code), or null. */
const segmentAt = (program, address) => (program?.segments ?? [])
  .find((s) => !s.executable && address >= s.address && address < s.address + s.bytes.length) ?? null;

/**
 * The data labels of a program, with their room: [{name, address, room}] in address order. A label's room runs to the
 * next data label or the end of its data segment (a program may have several, as SAP-1's DB runs).
 */
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

/**
 * Apply the loads [{label, bytes}] to a freshly assembled program (its data segments are
 * changed in place). Returns {applied: [{label, address, n}], dropped: [{label, why}]}.
 */
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

/** Check that `bytes` fit the array `label` of the program; throws DataError with the room. */
export function checkFits(program, label, bytes) {
  const a = dataArrays(program).find((x) => x.name === label);
  if (!a) throw new DataError(`no data label ${label}`);
  if (bytes.length > a.room) throw new DataError(`${bytes.length} bytes do not fit ${label}, which has room for ${a.room}`, { room: a.room });
  return a;
}

/** `count` elements of `size` bytes from `address` of a memory with read(addr, size). */
export function readRange(mem, address, count, size = 4) {
  const out = [];
  for (let k = 0; k < count; k++) out.push(mem.read((address + k * size) >>> 0, size) >>> 0);
  return out;
}

/** CSV of a range: a heading, then one row per element: address (hex), value (signed decimal). */
export function saveCsv(values, address, size = 4) {
  const sh = 32 - 8 * size;
  const rows = values.map((v, k) => `0x${((address + k * size) >>> 0).toString(16).padStart(8, '0')},${size === 4 ? v | 0 : (v << sh) >> sh}`);
  return `address,value\n${rows.join('\n')}\n`;
}

/** The bytes of a range, little-endian, for a .bin file. */
export function saveBin(values, size = 4) {
  const out = new Uint8Array(values.length * size);
  values.forEach((v, k) => { for (let b = 0; b < size; b++) out[k * size + b] = (v >>> (8 * b)) & 0xff; });
  return out;
}
