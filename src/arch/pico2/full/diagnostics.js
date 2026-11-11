// diagnostics.js -- clang and lld messages of a Pico Full build as the shell's diagnostics (pico2 P1-F2, research D33):
// [{file, line, col, severity: 'error'|'warning'|'note', message, path}] in the order printed. `file` is the project file
// name for files in /project (the editor shows them); for SDK headers `file` is null and `path` names the header, so the
// console can show "pico/stdlib.h" without the editor jumping. Source excerpts and carets that clang prints are skipped.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { PROJECT_DIR } from './driver.js';

const CLANG = /^(.+?):(\d+):(\d+): (fatal error|error|warning|note|remark): (.*)$/;
const CLANG_NOLINE = /^(.+?): (fatal error|error|warning|note): (.*)$/;
const LLD = /^ld\.lld: (error|warning): (.*)$/;
const REF = /^>>> referenced by .*?\((\/[^:)]+):(\d+)\)\s*$/;
const REF_PLAIN = /^>>> referenced by ([^\s(]+):(\d+)\s*$/;
const SEVERITY = { 'fatal error': 'error', error: 'error', warning: 'warning', note: 'note', remark: 'note' };

/** A guest path as {file, path}: project files by name; pack files by their path below the pack folders. */
export function locate(p) {
  if (p.startsWith(`${PROJECT_DIR}/`)) return { file: p.slice(PROJECT_DIR.length + 1), path: p.slice(PROJECT_DIR.length + 1) };
  const m = p.match(/^\/pico\/(?:sdk\/src\/[^/]+\/[^/]+\/include|sdk\/src\/[^/]+\/include|sysroot\/include|clang\/include|build\/generated\/[^/]+)\/(.+)$/);
  if (m) return { file: null, path: m[1] };
  return { file: null, path: p };
}

/** Parses the text clang or ld.lld wrote to stderr. */
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
      // the first ">>> referenced by" line names where the symbol is used
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
