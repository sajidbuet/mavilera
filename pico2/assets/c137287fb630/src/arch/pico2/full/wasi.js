// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const ERRNO = Object.freeze({ SUCCESS: 0, ACCES: 2, BADF: 8, EXIST: 20, INVAL: 28, IO: 29, ISDIR: 31, NOENT: 44,
 NOSYS: 52, NOTDIR: 54, NOTEMPTY: 55, NOTSUP: 58, SPIPE: 70 });
const E = ERRNO;
const FT = { CHAR: 2, DIR: 3, FILE: 4 };
class Exit {
 constructor(code) { this.code = code; }
}
export function normalise(p) {
 const out = [];
 for (const s of p.split('/')) {
 if (s === '' || s === '.') continue;
 if (s === '..') out.pop(); else out.push(s);
 }
 return '/' + out.join('/');
}
export class MemFS {
 constructor() {
 this.files = new Map();
 this.dirs = new Set(['/']);
 }
 addFile(p, data) {
 p = normalise(p);
 this.files.set(p, data);
 for (let d = p.slice(0, p.lastIndexOf('/')) || '/'; !this.dirs.has(d); d = d.slice(0, d.lastIndexOf('/')) || '/') this.dirs.add(d);
 }
 stat(p) {
 if (this.files.has(p)) return { type: 'file', size: this.files.get(p).length };
 if (this.dirs.has(p)) return { type: 'dir', size: 0 };
 return null;
 }
 read(p) { return this.files.get(p); }
 write(p, data) { this.addFile(p, data); }
 list(p) {
 const pre = p === '/' ? '/' : p + '/';
 const names = new Set();
 for (const k of [...this.files.keys(), ...this.dirs]) if (k.startsWith(pre) && k !== p) names.add(k.slice(pre.length).split('/')[0]);
 return [...names];
 }
 mkdir(p) { this.dirs.add(p); }
 unlink(p) { return this.files.delete(p); }
 rmdir(p) { return this.dirs.delete(p); }
 rename(a, b) {
 if (!this.files.has(a)) return false;
 this.files.set(b, this.files.get(a));
 this.files.delete(a);
 return true;
 }
}
const inodeTables = new WeakMap();
function inodesOf(fs) {
 let t = inodeTables.get(fs);
 if (!t) { t = new Map(); inodeTables.set(fs, t); }
 return t;
}
export class Wasi {
 constructor({ args, env = {}, fs }) {
 this.args = args;
 this.env = Object.entries(env).map(([k, v]) => `${k}=${v}`);
 this.fs = fs;
 this.stdout = [];
 this.stderr = [];
 this.mem = null;
 this.fds = new Map([[0, { kind: 'std' }], [1, { kind: 'std', sink: this.stdout }], [2, { kind: 'std', sink: this.stderr }],
 [3, { kind: 'dir', path: '/', preopen: '/' }]]);
 this.nextFd = 4;
 this.enc = new TextEncoder();
 this.dec = new TextDecoder();
 this.inodes = inodesOf(fs);
 }
 get dv() { return new DataView(this.mem.buffer); }
 get u8() { return new Uint8Array(this.mem.buffer); }
 str(ptr, len) { return this.dec.decode(this.u8.subarray(ptr, ptr + len)); }
 resolve(dirfd, ptr, len) {
 const d = this.fds.get(dirfd);
 if (!d || d.kind !== 'dir') return null;
 return normalise(d.path + '/' + this.str(ptr, len));
 }
 ino(p) {
 let n = this.inodes.get(p);
 if (!n) { n = BigInt(this.inodes.size + 1); this.inodes.set(p, n); }
 return n;
 }
 filestat(ptr, st, p) {
 const dv = this.dv;
 for (let i = 0; i < 64; i += 8) dv.setBigUint64(ptr + i, 0n, true);
 dv.setBigUint64(ptr, 1n, true);
 dv.setBigUint64(ptr + 8, this.ino(p ?? ''), true);
 dv.setUint8(ptr + 16, st.type === 'dir' ? FT.DIR : st.type === 'file' ? FT.FILE : FT.CHAR);
 dv.setBigUint64(ptr + 24, 1n, true);
 dv.setBigUint64(ptr + 32, BigInt(st.size || 0), true);
 }
 fileData(f) {
 if (!f.data) f.data = this.fs.read(f.path) || new Uint8Array(0);
 return f.data;
 }
 flush(f) {
 if (f.dirty) { this.fs.write(f.path, f.data.slice(0, f.size)); f.dirty = false; }
 }
 start(instance) {
 this.mem = instance.exports.memory;
 try {
 instance.exports._start();
 return 0;
 } catch (e) {
 if (e instanceof Exit) return e.code;
 throw e;
 } finally {
 for (const f of this.fds.values()) if (f.kind === 'file') this.flush(f);
 }
 }
 text(which = 'stderr') {
 const chunks = this[which];
 const b = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
 let o = 0;
 for (const c of chunks) { b.set(c, o); o += c.length; }
 return this.dec.decode(b);
 }
 writeAt(f, pos, bytes) {
 const end = pos + bytes.length;
 if (end > f.data.length) {
 const d = new Uint8Array(Math.max(end, f.data.length * 2, 4096));
 d.set(f.data.subarray(0, f.size));
 f.data = d;
 }
 f.data.set(bytes, pos);
 if (end > f.size) f.size = end;
 f.dirty = true;
 }
 imports() {
 const S = this;
 const iov = (iovs, i) => [S.dv.getUint32(iovs + 8 * i, true), S.dv.getUint32(iovs + 8 * i + 4, true)];
 const putStrings = (list, ptrs, buf) => {
 let o = buf;
 list.forEach((a, i) => { S.dv.setUint32(ptrs + 4 * i, o, true); const b = S.enc.encode(a); S.u8.set(b, o); S.u8[o + b.length] = 0; o += b.length + 1; });
 return 0;
 };
 const sizes = (list, count, size) => {
 S.dv.setUint32(count, list.length, true);
 S.dv.setUint32(size, list.reduce((n, a) => n + S.enc.encode(a).length + 1, 0), true);
 return 0;
 };
 const w = {
 args_sizes_get: (c, s) => sizes(S.args, c, s),
 args_get: (argv, buf) => putStrings(S.args, argv, buf),
 environ_sizes_get: (c, s) => sizes(S.env, c, s),
 environ_get: (envp, buf) => putStrings(S.env, envp, buf),
 fd_prestat_get(fd, p) {
 const f = S.fds.get(fd);
 if (!f || !f.preopen) return E.BADF;
 S.dv.setUint8(p, 0);
 S.dv.setUint32(p + 4, S.enc.encode(f.preopen).length, true);
 return 0;
 },
 fd_prestat_dir_name(fd, p, len) {
 const f = S.fds.get(fd);
 if (!f || !f.preopen) return E.BADF;
 S.u8.set(S.enc.encode(f.preopen).subarray(0, len), p);
 return 0;
 },
 fd_fdstat_get(fd, p) {
 const f = S.fds.get(fd);
 if (!f) return E.BADF;
 const dv = S.dv;
 dv.setUint8(p, f.kind === 'dir' ? FT.DIR : f.kind === 'file' ? FT.FILE : FT.CHAR);
 dv.setUint16(p + 2, f.append ? 1 : 0, true);
 dv.setBigUint64(p + 8, 0xffffffffn, true);
 dv.setBigUint64(p + 16, 0xffffffffn, true);
 return 0;
 },
 fd_fdstat_set_flags: () => 0,
 path_open(dirfd, _lookup, pp, pl, oflags, _rightsBase, _rightsInh, fdflags, outFd) {
 const p = S.resolve(dirfd, pp, pl);
 if (!p) return E.BADF;
 let st = S.fs.stat(p);
 if (st && (oflags & 4) && (oflags & 1)) return E.EXIST;
 if (!st) {
 if (!(oflags & 1)) return E.NOENT;
 const parent = S.fs.stat(p.slice(0, p.lastIndexOf('/')) || '/');
 if (!parent || parent.type !== 'dir') return E.NOENT;
 S.fs.write(p, new Uint8Array(0));
 st = { type: 'file', size: 0 };
 }
 if ((oflags & 2) && st.type !== 'dir') return E.NOTDIR;
 const fd = S.nextFd++;
 if (st.type === 'dir') S.fds.set(fd, { kind: 'dir', path: p });
 else {
 const f = { kind: 'file', path: p, pos: 0, append: Boolean(fdflags & 1) };
 if (oflags & 8) { f.data = new Uint8Array(0); f.size = 0; f.dirty = true; }
 else { f.data = null; f.size = st.size; }
 S.fds.set(fd, f);
 }
 S.dv.setUint32(outFd, fd, true);
 return 0;
 },
 fd_close(fd) {
 const f = S.fds.get(fd);
 if (!f) return E.BADF;
 if (f.kind === 'file') S.flush(f);
 S.fds.delete(fd);
 return 0;
 },
 fd_read(fd, iovs, n, outN) {
 const f = S.fds.get(fd);
 if (!f) return E.BADF;
 if (f.kind === 'std') { S.dv.setUint32(outN, 0, true); return 0; }
 if (f.kind !== 'file') return E.ISDIR;
 const d = S.fileData(f);
 let total = 0;
 for (let i = 0; i < n; i++) {
 const [b, l] = iov(iovs, i);
 const c = Math.max(0, Math.min(l, f.size - f.pos));
 S.u8.set(d.subarray(f.pos, f.pos + c), b);
 f.pos += c; total += c;
 if (c < l) break;
 }
 S.dv.setUint32(outN, total, true);
 return 0;
 },
 fd_pread(fd, iovs, n, off, outN) {
 const f = S.fds.get(fd);
 if (!f || f.kind !== 'file') return E.BADF;
 const d = S.fileData(f);
 let pos = Number(off), total = 0;
 for (let i = 0; i < n; i++) {
 const [b, l] = iov(iovs, i);
 const c = Math.max(0, Math.min(l, f.size - pos));
 S.u8.set(d.subarray(pos, pos + c), b);
 pos += c; total += c;
 if (c < l) break;
 }
 S.dv.setUint32(outN, total, true);
 return 0;
 },
 fd_write(fd, iovs, n, outN) {
 const f = S.fds.get(fd);
 if (!f) return E.BADF;
 let total = 0;
 if (f.kind === 'std') {
 for (let i = 0; i < n; i++) { const [b, l] = iov(iovs, i); if (f.sink) f.sink.push(S.u8.slice(b, b + l)); total += l; }
 S.dv.setUint32(outN, total, true);
 return 0;
 }
 if (f.kind !== 'file') return E.ISDIR;
 S.fileData(f);
 if (f.append) f.pos = f.size;
 for (let i = 0; i < n; i++) { const [b, l] = iov(iovs, i); S.writeAt(f, f.pos, S.u8.subarray(b, b + l)); f.pos += l; total += l; }
 S.dv.setUint32(outN, total, true);
 return 0;
 },
 fd_pwrite(fd, iovs, n, off, outN) {
 const f = S.fds.get(fd);
 if (!f || f.kind !== 'file') return E.BADF;
 S.fileData(f);
 let pos = Number(off), total = 0;
 for (let i = 0; i < n; i++) { const [b, l] = iov(iovs, i); S.writeAt(f, pos, S.u8.subarray(b, b + l)); pos += l; total += l; }
 S.dv.setUint32(outN, total, true);
 return 0;
 },
 fd_seek(fd, off, whence, outPos) {
 const f = S.fds.get(fd);
 if (!f) return E.BADF;
 if (f.kind !== 'file') return E.SPIPE;
 const o = Number(off);
 const np = whence === 0 ? o : whence === 1 ? f.pos + o : f.size + o;
 if (np < 0) return E.INVAL;
 f.pos = np;
 S.dv.setBigUint64(outPos, BigInt(np), true);
 return 0;
 },
 fd_tell(fd, outPos) {
 const f = S.fds.get(fd);
 if (!f || f.kind !== 'file') return E.BADF;
 S.dv.setBigUint64(outPos, BigInt(f.pos), true);
 return 0;
 },
 fd_filestat_get(fd, p) {
 const f = S.fds.get(fd);
 if (!f) return E.BADF;
 S.filestat(p, f.kind === 'file' ? { type: 'file', size: f.size } : { type: f.kind === 'dir' ? 'dir' : 'char', size: 0 }, f.path ?? `<fd${fd}>`);
 return 0;
 },
 fd_filestat_set_size(fd, size) {
 const f = S.fds.get(fd);
 if (!f || f.kind !== 'file') return E.BADF;
 S.fileData(f);
 const n = Number(size);
 if (n > f.data.length) { const d = new Uint8Array(n); d.set(f.data.subarray(0, f.size)); f.data = d; }
 f.size = n;
 f.dirty = true;
 return 0;
 },
 fd_filestat_set_times: () => 0,
 path_filestat_set_times: () => 0,
 fd_sync: () => 0, fd_datasync: () => 0, fd_advise: () => 0, fd_allocate: () => 0,
 path_filestat_get(dirfd, _flags, pp, pl, out) {
 const p = S.resolve(dirfd, pp, pl);
 if (!p) return E.BADF;
 const st = S.fs.stat(p);
 if (!st) return E.NOENT;
 S.filestat(out, st, p);
 return 0;
 },
 fd_readdir(fd, buf, len, cookie, outUsed) {
 const f = S.fds.get(fd);
 if (!f || f.kind !== 'dir') return E.BADF;
 const names = ['.', '..', ...S.fs.list(f.path)];
 let o = buf, used = 0;
 for (let i = Number(cookie); i < names.length; i++) {
 const nb = S.enc.encode(names[i]);
 const st = i < 2 ? { type: 'dir' } : S.fs.stat(normalise(f.path + '/' + names[i]));
 const rec = new Uint8Array(24 + nb.length);
 const dv = new DataView(rec.buffer);
 dv.setBigUint64(0, BigInt(i + 1), true);
 dv.setBigUint64(8, BigInt(i + 1), true);
 dv.setUint32(16, nb.length, true);
 dv.setUint8(20, st && st.type === 'dir' ? FT.DIR : FT.FILE);
 rec.set(nb, 24);
 const c = Math.min(rec.length, len - used);
 S.u8.set(rec.subarray(0, c), o);
 o += c; used += c;
 if (used >= len) break;
 }
 S.dv.setUint32(outUsed, used, true);
 return 0;
 },
 path_create_directory(dirfd, pp, pl) {
 const p = S.resolve(dirfd, pp, pl);
 if (S.fs.stat(p)) return E.EXIST;
 S.fs.mkdir(p);
 return 0;
 },
 path_remove_directory: (dirfd, pp, pl) => (S.fs.rmdir(S.resolve(dirfd, pp, pl)) ? 0 : E.NOENT),
 path_unlink_file: (dirfd, pp, pl) => (S.fs.unlink(S.resolve(dirfd, pp, pl)) ? 0 : E.NOENT),
 path_rename(fd1, p1, l1, fd2, p2, l2) {
 const a = S.resolve(fd1, p1, l1), b = S.resolve(fd2, p2, l2);
 for (const f of S.fds.values()) if (f.kind === 'file' && f.path === a) S.flush(f);
 return S.fs.rename(a, b) ? 0 : E.NOENT;
 },
 path_readlink: () => E.INVAL, path_symlink: () => E.NOTSUP, path_link: () => E.NOTSUP,
 clock_time_get(_id, _precision, out) {
 S.dv.setBigUint64(out, BigInt(Math.round((performance.timeOrigin + performance.now()) * 1e6)), true);
 return 0;
 },
 clock_res_get(_id, out) { S.dv.setBigUint64(out, 1000n, true); return 0; },
 random_get(buf, len) { crypto.getRandomValues(S.u8.subarray(buf, buf + len)); return 0; },
 proc_exit(code) { throw new Exit(code); },
 sched_yield: () => 0, poll_oneoff: () => E.NOTSUP, proc_raise: () => E.NOSYS,
 sock_accept: () => E.NOSYS, sock_recv: () => E.NOSYS, sock_send: () => E.NOSYS, sock_shutdown: () => E.NOSYS,
 };
 return { wasi_snapshot_preview1: new Proxy(w, { get: (t, k) => t[k] ?? (() => E.NOSYS) }) };
 }
}
