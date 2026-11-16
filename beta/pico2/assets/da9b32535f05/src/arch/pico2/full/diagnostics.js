// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { PROJECT_DIR } from './driver.js';
const CLANG = /^(.+?):(\d+):(\d+): (fatal error|error|warning|note|remark): (.*)$/;
const CLANG_NOLINE = /^(.+?): (fatal error|error|warning|note): (.*)$/;
const LLD = /^ld\.lld: (error|warning): (.*)$/;
const REF = /^>>> referenced by .*?\((\/[^:)]+):(\d+)\)\s*$/;
const REF_PLAIN = /^>>> referenced by ([^\s(]+):(\d+)\s*$/;
const SEVERITY = { 'fatal error': 'error', error: 'error', warning: 'warning', note: 'note', remark: 'note' };
export function locate(p) {
 if (p.startsWith(`${PROJECT_DIR}/`)) return { file: p.slice(PROJECT_DIR.length + 1), path: p.slice(PROJECT_DIR.length + 1) };
 const m = p.match(/^\/pico\/(?:sdk\/src\/[^/]+\/[^/]+\/include|sdk\/src\/[^/]+\/include|sysroot\/include|clang\/include|build\/generated\/[^/]+)\/(.+)$/);
 if (m) return { file: null, path: m[1] };
 return { file: null, path: p };
}
export function parseDiagnostics(text) {
 const out = [];
 const lines = text.split(/\r?\n/);
 for (let i = 0; i < lines.length; i++) {
 const l = lines[i];
 let m = l.match(CLANG);
 if (m && !l.startsWith('ld.lld:')) {
 const where = locate(m[1]);
 out.push({ ...where, line: Number(m[2]), col: Number(m[3]), severity: SEVERITY[m[4]], message: m[5] });
 continue;
 }
 m = l.match(LLD);
 if (m) {
 const d = { file: null, path: null, line: null, col: null, severity: SEVERITY[m[1]], message: m[2] };
 for (let k = i + 1; k < lines.length && lines[k].startsWith('>>>'); k++) {
 const r = lines[k].match(REF) ?? lines[k].match(REF_PLAIN);
 if (r) {
 const where = r[1].startsWith('/') ? locate(r[1]) : { file: r[1], path: r[1] };
 Object.assign(d, where, { line: Number(r[2]) });
 break;
 }
 }
 out.push(d);
 continue;
 }
 m = l.match(CLANG_NOLINE);
 if (m && /^\//.test(m[1])) out.push({ ...locate(m[1]), line: null, col: null, severity: SEVERITY[m[2]], message: m[3] });
 }
 return out;
}
