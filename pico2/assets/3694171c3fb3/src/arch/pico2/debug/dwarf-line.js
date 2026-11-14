// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export class DwarfError extends Error {}
const FORM = Object.freeze({ block: 0x09, data1: 0x0b, data2: 0x05, data4: 0x06, data8: 0x07, data16: 0x1e, string: 0x08, strp: 0x0e, udata: 0x0f, line_strp: 0x1f });
const LNCT = Object.freeze({ path: 1, directory_index: 2 });
export const ROW_STMT = 1;
export const ROW_END = 2;
class Reader {
 constructor(bytes, at = 0, end = bytes.length) { this.b = bytes; this.p = at; this.end = end; }
 need(n) { if (this.p + n > this.end) throw new DwarfError('the line table is truncated'); }
 u8() { this.need(1); return this.b[this.p++]; }
 s8() { const v = this.u8(); return v > 127 ? v - 256 : v; }
 u16() { this.need(2); const v = this.b[this.p] | (this.b[this.p + 1] << 8); this.p += 2; return v; }
 u32() { this.need(4); const b = this.b, p = this.p; this.p += 4; return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0; }
 uleb() {
 let v = 0, mul = 1, byte;
 do { byte = this.u8(); v += (byte & 0x7f) * mul; mul *= 128; } while (byte & 0x80);
 return v;
 }
 sleb() {
 let v = 0, mul = 1, byte;
 do { byte = this.u8(); v += (byte & 0x7f) * mul; mul *= 128; } while (byte & 0x80);
 return byte & 0x40 ? v - mul : v;
 }
 cstr() {
 let e = this.p; while (e < this.end && this.b[e] !== 0) e++;
 if (e >= this.end) throw new DwarfError('the line table is truncated (string)');
 const s = new TextDecoder().decode(this.b.subarray(this.p, e)); this.p = e + 1; return s;
 }
 skip(n) { this.need(n); this.p += n; }
}
function strAt(section, off, what) {
 if (!section || off >= section.length) throw new DwarfError(`a ${what} offset lies outside its section`);
 let e = off; while (e < section.length && section[e] !== 0) e++;
 return new TextDecoder().decode(section.subarray(off, e));
}
const isAbsolute = (p) => p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(p);
const join = (dir, name) => (!dir || isAbsolute(name) ? name : dir.endsWith('/') || dir.endsWith('\\') ? dir + name : `${dir}/${name}`);
function formValue(r, form, sections) {
 switch (form) {
 case FORM.string: return r.cstr();
 case FORM.line_strp: return strAt(sections.lineStr, r.u32(), '.debug_line_str');
 case FORM.strp: return strAt(sections.str, r.u32(), '.debug_str');
 case FORM.udata: return r.uleb();
 case FORM.data1: return r.u8();
 case FORM.data2: return r.u16();
 case FORM.data4: return r.u32();
 case FORM.data8: r.skip(8); return 0;
 case FORM.data16: r.skip(16); return 0;
 case FORM.block: r.skip(r.uleb()); return 0;
 default: throw new DwarfError(`unsupported form 0x${form.toString(16)} in a line table header`);
 }
}
function entries5(r, sections) {
 const n = r.u8(), formats = [];
 for (let i = 0; i < n; i++) formats.push([r.uleb(), r.uleb()]);
 const count = r.uleb(), out = [];
 for (let i = 0; i < count; i++) {
 const e = { path: '', dir: 0 };
 for (const [type, form] of formats) {
 const v = formValue(r, form, sections);
 if (type === LNCT.path) e.path = String(v);
 else if (type === LNCT.directory_index) e.dir = Number(v);
 }
 out.push(e);
 }
 return out;
}
export function readLineTable(elfSections) {
 const line = elfSections.get('.debug_line')?.bytes;
 if (!line || !line.length) return null;
 return parseLineTable(line, { lineStr: elfSections.get('.debug_line_str')?.bytes ?? null, str: elfSections.get('.debug_str')?.bytes ?? null });
}
export function parseLineTable(bytes, strings = {}) {
 const sections = { lineStr: strings.lineStr ?? null, str: strings.str ?? null };
 const files = [], fileIndex = new Map();
 const internFile = (path) => { let i = fileIndex.get(path); if (i === undefined) { i = files.length; files.push(path); fileIndex.set(path, i); } return i; };
 let addr = [], fil = [], lin = [], col = [], flg = [];
 let units = 0;
 let p = 0;
 while (p < bytes.length) {
 const r = new Reader(bytes, p);
 const unitLength = r.u32();
 if (unitLength === 0xffffffff) throw new DwarfError('64-bit DWARF line tables are not supported');
 if (unitLength >= 0xfffffff0) throw new DwarfError(`reserved unit length 0x${unitLength.toString(16)}`);
 const unitEnd = r.p + unitLength;
 if (unitEnd > bytes.length) throw new DwarfError('a line table unit runs past the end of .debug_line');
 r.end = unitEnd;
 const version = r.u16();
 if (version < 2 || version > 5) throw new DwarfError(`line table version ${version} is not supported`);
 let addressSize = 4;
 if (version >= 5) {
 addressSize = r.u8();
 if (r.u8() !== 0) throw new DwarfError('segmented addresses are not supported');
 }
 const headerLength = r.u32();
 const programStart = r.p + headerLength;
 if (programStart > unitEnd) throw new DwarfError('a line table header runs past its unit');
 const minInst = r.u8();
 const maxOps = version >= 4 ? r.u8() : 1;
 if (maxOps !== 1) throw new DwarfError('VLIW line tables (maximum_operations_per_instruction > 1) are not supported');
 const defaultStmt = r.u8() !== 0;
 const lineBase = r.s8(), lineRange = r.u8(), opcodeBase = r.u8();
 if (lineRange === 0) throw new DwarfError('line_range is zero');
 if (opcodeBase === 0) throw new DwarfError('opcode_base is zero');
 const stdLengths = [0];
 for (let i = 1; i < opcodeBase; i++) stdLengths.push(r.u8());
 const unitFiles = [];
 let dirs;
 if (version >= 5) {
 dirs = entries5(r, sections).map((d) => d.path);
 const comp = dirs[0] ?? '';
 const dirPath = (i) => (i === 0 ? comp : join(comp, dirs[i] ?? ''));
 for (const f of entries5(r, sections)) unitFiles.push(internFile(join(dirPath(f.dir), f.path)));
 } else {
 dirs = [''];
 for (let s = r.cstr(); s !== ''; s = r.cstr()) dirs.push(s);
 unitFiles.push(-1);
 for (let s = r.cstr(); s !== ''; s = r.cstr()) {
 const d = r.uleb(); r.uleb(); r.uleb();
 unitFiles.push(internFile(join(dirs[d] ?? '', s)));
 }
 }
 const fileOf = (n) => { const g = unitFiles[n]; if (g === undefined || g < 0) throw new DwarfError(`file number ${n} is not in the unit's file table`); return g; };
 r.p = programStart;
 let a = 0, file = 1, ln = 1, cl = 0, stmt = defaultStmt;
 const resetState = () => { a = 0; file = 1; ln = 1; cl = 0; stmt = defaultStmt; };
 const emit = (end) => { addr.push(a >>> 0); fil.push(fileOf(file)); lin.push(ln); col.push(cl); flg.push((stmt ? ROW_STMT : 0) | (end ? ROW_END : 0)); };
 const constAddPc = minInst * Math.floor((255 - opcodeBase) / lineRange);
 while (r.p < unitEnd) {
 const op = r.u8();
 if (op >= opcodeBase) {
 const adj = op - opcodeBase;
 a += minInst * Math.floor(adj / lineRange);
 ln += lineBase + (adj % lineRange);
 emit(false);
 continue;
 }
 switch (op) {
 case 0: {
 const len = r.uleb(), at = r.p;
 if (len === 0) break;
 const sub = r.u8();
 if (sub === 1) { emit(true); resetState(); }
 else if (sub === 2) {
 if (len - 1 !== addressSize || addressSize !== 4) throw new DwarfError(`DW_LNE_set_address with a ${len - 1}-byte address`);
 a = r.u32();
 } else if (sub === 3 && version <= 4) {
 const s = r.cstr(), d = r.uleb(); r.uleb(); r.uleb();
 unitFiles.push(internFile(join(dirs[d] ?? '', s)));
 }
 r.p = at; r.skip(len);
 break;
 }
 case 1: emit(false); break;
 case 2: a += minInst * r.uleb(); break;
 case 3: ln += r.sleb(); break;
 case 4: file = r.uleb(); break;
 case 5: cl = r.uleb(); break;
 case 6: stmt = !stmt; break;
 case 7: break;
 case 8: a += constAddPc; break;
 case 9: a += r.u16(); break;
 case 10: case 11: break;
 case 12: r.uleb(); break;
 default: for (let i = 0; i < stdLengths[op]; i++) r.uleb();
 }
 }
 units++;
 p = unitEnd;
 }
 return new LineTable(files, addr, fil, lin, col, flg, units);
}
export class LineTable {
 constructor(files, addr, fil, lin, col, flg, units) {
 this.files = files;
 this.units = units;
 const seqs = [];
 let start = 0;
 for (let i = 0; i < addr.length; i++) {
 if (!(flg[i] & ROW_END)) continue;
 const rows = [];
 for (let j = start; j < i; j++) {
 if (rows.length && addr[rows[rows.length - 1]] === addr[j]) rows[rows.length - 1] = j; else rows.push(j);
 }
 if (rows.length && addr[i] > addr[rows[0]]) seqs.push({ lo: addr[rows[0]], hi: addr[i], rows });
 start = i + 1;
 }
 seqs.sort((x, y) => x.lo - y.lo || x.hi - y.hi);
 let n = 0; for (const s of seqs) n += s.rows.length;
 this.address = new Uint32Array(n); this.file = new Uint32Array(n); this.line = new Uint32Array(n);
 this.column = new Uint32Array(n); this.stmt = new Uint8Array(n);
 this.seqLo = new Uint32Array(seqs.length); this.seqHi = new Uint32Array(seqs.length); this.seqStart = new Uint32Array(seqs.length + 1);
 let k = 0;
 seqs.forEach((s, q) => {
 this.seqLo[q] = s.lo; this.seqHi[q] = s.hi; this.seqStart[q] = k;
 for (const j of s.rows) { this.address[k] = addr[j]; this.file[k] = fil[j]; this.line[k] = lin[j]; this.column[k] = col[j]; this.stmt[k] = flg[j] & ROW_STMT; k++; }
 });
 this.seqStart[seqs.length] = k;
 }
 rowAt(address) {
 const x = address >>> 0, lo = this.seqLo, hi = this.seqHi;
 let a = 0, b = lo.length - 1, q = -1;
 while (a <= b) { const m = (a + b) >> 1; if (lo[m] <= x) { q = m; a = m + 1; } else b = m - 1; }
 if (q < 0 || x >= hi[q]) return -1;
 let i = this.seqStart[q], j = this.seqStart[q + 1] - 1, best = i;
 while (i <= j) { const m = (i + j) >> 1; if (this.address[m] <= x) { best = m; i = m + 1; } else j = m - 1; }
 return best;
 }
 lineAt(address) {
 const i = this.rowAt(address);
 return i < 0 ? null : { file: this.files[this.file[i]], fileIndex: this.file[i], line: this.line[i], column: this.column[i], stmt: this.stmt[i] === 1, row: i };
 }
 rowRange(i) {
 let q = 0; while (this.seqStart[q + 1] <= i) q++;
 const end = i + 1 < this.seqStart[q + 1] ? this.address[i + 1] : this.seqHi[q];
 return [this.address[i], end];
 }
 addressesOf(fileIndex, line) {
 const out = [];
 for (let i = 0; i < this.address.length; i++) if (this.file[i] === fileIndex && this.line[i] === line && this.stmt[i]) out.push(this.address[i]);
 return out.sort((x, y) => x - y);
 }
 linesOf(fileIndex) {
 const s = new Set();
 for (let i = 0; i < this.address.length; i++) if (this.file[i] === fileIndex && this.line[i] > 0 && this.stmt[i]) s.add(this.line[i]);
 return [...s].sort((x, y) => x - y);
 }
}
