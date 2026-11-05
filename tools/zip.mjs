// zip.mjs -- a small ZIP writer (PKWARE APPNOTE 6.3: local headers, deflate or store, central directory) for the
// release downloads (tools/release-zips.mjs). Deterministic: entries in the given order, one fixed timestamp, no extra
// fields, so the same files give the same archive. No ZIP64: refuses an archive of 4 GiB or more, or 65535 entries.
// Development only; nothing here is part of the site.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { crc32, deflateRawSync } from 'node:zlib';

/** The MS-DOS time and date of `when` (a Date, read in UTC; two-second resolution). */
function dosTime(when) {
  const t = (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1);
  const d = ((when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate();
  return [t, d];
}

/**
 * The archive of `entries` ([{ name, data }], name with forward slashes, data a Buffer) as a Buffer.
 * `when` stamps every entry (default 2026-01-01 00:00 UTC).
 */
export function zip(entries, { when = new Date(Date.UTC(2026, 0, 1)) } = {}) {
  if (entries.length >= 0xffff) throw new Error('zip: too many entries (no ZIP64)');
  const [time, date] = dosTime(when);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new Error(`zip: unsafe name ${name}`);
    const fname = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const packed = deflateRawSync(data, { level: 9 });
    const deflate = packed.length < data.length;
    const body = deflate ? packed : data;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4); // version needed: 2.0
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(deflate ? 8 : 0, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(fname.length, 26);
    head.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0 (so the attributes below are read as Unix modes)
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(deflate ? 8 : 0, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(fname.length, 28);
    cen.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a regular file, rw-r--r--
    cen.writeUInt32LE(offset, 42);
    locals.push(head, fname, body);
    centrals.push(cen, fname);
    offset += head.length + fname.length + body.length;
    if (offset >= 0xffffffff) throw new Error('zip: archive too large (no ZIP64)');
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
