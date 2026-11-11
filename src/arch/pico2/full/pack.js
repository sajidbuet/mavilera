// pack.js -- the Pico Full SDK pack file (pico2 P1-F2, research D33): headers, prebuilt SDK objects and archive, C library,
// builtins, linker scripts, a precompiled header and the recorded compiler job templates, in one file that is loaded
// into the compiler's in-memory file system. Written by tools/pico-full/build-pack.mjs, read by the compiler Worker.
//
// Format: "MVFP" | u32 LE format (1) | u32 LE header length | header (UTF-8 JSON {meta, files: [{p, o, n}]}) | data.
// `p` is the absolute guest path, `o`/`n` the offset and length in the data that follows the header.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const PACK_MAGIC = 'MVFP';
export const PACK_FORMAT = 1;

export class PackError extends Error {}

/** Bytes of a pack from `meta` (JSON-able) and `files` ([[path, Uint8Array]] in the order to store). */
export function writePack(meta, files) {
  const index = [];
  let o = 0;
  for (const [p, d] of files) { index.push({ p, o, n: d.length }); o += d.length; }
  const head = new TextEncoder().encode(JSON.stringify({ meta, files: index }));
  const out = new Uint8Array(12 + head.length + o);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode(PACK_MAGIC), 0);
  dv.setUint32(4, PACK_FORMAT, true);
  dv.setUint32(8, head.length, true);
  out.set(head, 12);
  let at = 12 + head.length;
  for (const [, d] of files) { out.set(d, at); at += d.length; }
  return out;
}

/** {meta, files: Map(path -> Uint8Array view into `bytes`)}; throws PackError for anything that is not a pack. */
export function readPack(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 12 || new TextDecoder().decode(u8.subarray(0, 4)) !== PACK_MAGIC) throw new PackError('not a Pico Full SDK pack');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const format = dv.getUint32(4, true), n = dv.getUint32(8, true);
  if (format !== PACK_FORMAT) throw new PackError(`SDK pack format ${format} is not supported`);
  if (12 + n > u8.length) throw new PackError('the SDK pack is damaged');
  const { meta, files } = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + n)));
  const base = 12 + n;
  const map = new Map();
  for (const f of files) {
    if (base + f.o + f.n > u8.length) throw new PackError('the SDK pack is damaged');
    map.set(f.p, u8.subarray(base + f.o, base + f.o + f.n));
  }
  return { meta, files: map };
}
