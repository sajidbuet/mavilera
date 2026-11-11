// zip.js -- project export and import as .zip in the browser (pico2 P1-F1, Q7 of research decision D31): a writer and a
// reader of the PKWARE APPNOTE 6.3 basics (local headers, store or deflate, central directory, end record; no ZIP64, no
// encryption). Deflate comes from the platform (CompressionStream / DecompressionStream 'deflate-raw', as share.js);
// CRC-32 is computed here. The writer is deterministic (fixed time, given order) like tools/zip.mjs, which stays the
// release tool. The reader is strict: names must be flat and safe (one common top folder, as archivers make, is
// removed), text in UTF-8, extensions from the module's list, and the limits of project.js; anything else is refused
// with a reason, nothing is guessed.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { FILE_NAME, LIMITS } from './project.js';

export class ZipError extends Error {
  /** @param {string} code 'format' | 'unsupported' | 'name' | 'extension' | 'text' | 'limit' | 'crc'  @param {object} data */
  constructor(code, message, data = {}) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

let TABLE = null;
/** CRC-32 (IEEE 802.3, reflected, as zip uses). */
export function crc32(bytes) {
  if (!TABLE) {
    TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function through(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

// 2026-01-01 00:00:00 in MS-DOS form, the same fixed time as tools/zip.mjs
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const FLAG_UTF8 = 0x0800;

/**
 * A .zip of [{name, text}] (flat names checked against FILE_NAME). Each entry is deflated only when that is smaller.
 * `comment` (optional, printable ASCII, at most 1,024 characters) is written as the archive comment of the end record
 * (APPNOTE 4.3.16); archivers show or ignore it, the files are unaffected.
 */
export async function writeZip(files, { comment = '' } = {}) {
  if (!/^[\x20-\x7e]{0,1024}$/.test(comment)) throw new ZipError('format', 'the archive comment must be printable ASCII, at most 1,024 characters');
  const te = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    if (!FILE_NAME.test(f.name)) throw new ZipError('name', `not a valid file name: ${f.name}`, { name: f.name });
    const name = te.encode(f.name), data = te.encode(f.text);
    const crc = crc32(data);
    let method = 0, body = data;
    if (data.length > 0 && typeof CompressionStream === 'function') {
      const d = await through(data, new CompressionStream('deflate-raw'));
      if (d.length < data.length) { method = 8; body = d; }
    }
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, FLAG_UTF8, true);
    local.setUint16(8, method, true); local.setUint16(10, DOS_TIME, true); local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true); local.setUint32(18, body.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, FLAG_UTF8, true);
    cen.setUint16(10, method, true); cen.setUint16(12, DOS_TIME, true); cen.setUint16(14, DOS_DATE, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, body.length, true); cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, body);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cenSize = central.reduce((n, b) => n + b.length, 0);
  const note = te.encode(comment);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true); end.setUint32(16, offset, true); end.setUint16(20, note.length, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer), note];
  const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of all) { out.set(b, o); o += b.length; }
  return out;
}

function endRecord(u8, dv) {
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50 && i + 22 + dv.getUint16(i + 20, true) === u8.length) return i;
  }
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 0xffff); i--) if (dv.getUint32(i, true) === 0x06054b50) return i;
  return -1;
}

/** The archive comment of a .zip as text (Latin-1, as the end record has no encoding flag); '' when none or not a zip. */
export function readZipComment(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const eocd = u8.length >= 22 ? endRecord(u8, dv) : -1;
  if (eocd < 0) return '';
  const n = Math.min(dv.getUint16(eocd + 20, true), u8.length - eocd - 22);
  return new TextDecoder('latin1').decode(u8.subarray(eocd + 22, eocd + 22 + n));
}

/**
 * The files of a .zip: [{name, text}] in archive order. Folder entries are skipped; one folder common to every file is
 * removed; any other '/' is refused (projects are flat). `extensions`: allowed extensions in lower case with the dot.
 */
export async function readZip(bytes, { extensions, maxFiles = LIMITS.files, maxBytes = LIMITS.bytes } = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const eocd = u8.length >= 22 ? endRecord(u8, dv) : -1;
  if (eocd < 0) throw new ZipError('format', 'not a zip file (no end record)');
  const count = dv.getUint16(eocd + 10, true), cenSize = dv.getUint32(eocd + 12, true), cenOff = dv.getUint32(eocd + 16, true);
  if (dv.getUint16(eocd + 4, true) !== 0 || cenOff === 0xffffffff || count === 0xffff) throw new ZipError('unsupported', 'multi-part or ZIP64 archives are not supported');
  if (cenOff + cenSize > eocd) throw new ZipError('format', 'the central directory is damaged');
  const dec = new TextDecoder('utf-8', { fatal: true });
  const latin = new TextDecoder('latin1');
  const entries = [];
  let p = cenOff;
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new ZipError('format', 'the central directory is damaged');
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const loc = dv.getUint32(p + 42, true);
    const rawName = u8.subarray(p + 46, p + 46 + nlen);
    let name;
    try { name = flags & FLAG_UTF8 ? dec.decode(rawName) : latin.decode(rawName); } catch { throw new ZipError('name', 'a file name is not valid UTF-8'); }
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue; // a folder entry
    if (flags & 1) throw new ZipError('unsupported', `${name}: encrypted entries are not supported`, { name });
    if (method !== 0 && method !== 8) throw new ZipError('unsupported', `${name}: compression method ${method} is not supported`, { name });
    if (name.includes('\\') || name.startsWith('/') || name.split('/').some((s) => s === '..' || s === '.')) throw new ZipError('name', `unsafe name in the archive: ${name}`, { name });
    entries.push({ name, method, crc, csize, usize, loc });
  }
  // one common top folder is removed (an archiver's "project/main.c"); any deeper path is refused (projects are flat)
  const tops = new Set(entries.map((e) => (e.name.includes('/') ? e.name.split('/')[0] : '')));
  const strip = tops.size === 1 && !tops.has('') ? `${[...tops][0]}/` : '';
  if (entries.length > maxFiles) throw new ZipError('limit', `more than ${maxFiles} files`, { limit: 'files' });
  let total = 0;
  const out = [], seen = new Set();
  for (const e of entries) {
    const name = e.name.slice(strip.length);
    if (name.includes('/') || !FILE_NAME.test(name)) throw new ZipError('name', `${e.name}: projects hold flat file names (letters, digits, _ . -)`, { name: e.name });
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
    if (extensions?.length && !extensions.includes(ext)) throw new ZipError('extension', `${name}: only ${extensions.join(', ')} files`, { name });
    if (seen.has(name)) throw new ZipError('name', `two files named ${name}`, { name });
    seen.add(name);
    total += e.usize;
    if (total > maxBytes) throw new ZipError('limit', `more than ${maxBytes / 1024 / 1024} MiB unpacked`, { limit: 'bytes' });
    if (dv.getUint32(e.loc, true) !== 0x04034b50) throw new ZipError('format', `${name}: damaged local header`, { name });
    const start = e.loc + 30 + dv.getUint16(e.loc + 26, true) + dv.getUint16(e.loc + 28, true);
    const body = u8.subarray(start, start + e.csize);
    let data = body;
    if (e.method === 8) {
      if (typeof DecompressionStream !== 'function') throw new ZipError('unsupported', 'this browser cannot decompress zip entries');
      try { data = await through(body, new DecompressionStream('deflate-raw')); } catch { throw new ZipError('format', `${name}: damaged compressed data`, { name }); }
    }
    if (data.length !== e.usize || crc32(data) !== e.crc) throw new ZipError('crc', `${name}: the data does not match its checksum`, { name });
    let text;
    try { text = dec.decode(data); } catch { throw new ZipError('text', `${name}: not a UTF-8 text file`, { name }); }
    out.push({ name, text });
  }
  return out;
}
