// minify.mjs -- the release copy of a text file without what only a reader needs (WS-N-004: the site without
// examples under 2 MB, W-D38): JavaScript and CSS lose their comments, the indentation of their lines and blank lines;
// JSON is written without spaces. Nothing else changes: no renaming, no joining of lines (a line break may end a
// JavaScript statement), strings, template literals and regular expressions are kept byte for byte. The copyright
// line of a comment stays. The repository's sources are not touched; tools/release.mjs applies this to the files
// it publishes, and test/minify.test.mjs runs the whole test suite on a minified copy of the sources.
//   minify(path, text) -> text   (other files unchanged)
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

// kept from a comment: the copyright line and the rights class (the file's header, CLAUDE.md rule 4)
const COPYRIGHT = /Copyright \(c\)[^\n*]*|Rights class:[^\n*]*/g;
const kept = (text) => text.match(COPYRIGHT) ?? [];

// After these tokens a `/` starts a regular expression; after others (a name, a number, `)`, `]`) it divides.
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await']);

/** JavaScript without comments, indentation and blank lines. Throws on an unterminated string, comment or literal. */
export function stripJs(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  // the last significant token, for the regular-expression rule: 'word:<name>', 'num', or the punctuator
  let last = '';
  // template literal nesting: each entry is the brace depth at which a `${` opened
  const tpl = [];
  let depth = 0;
  let lineStart = true; // nothing written on this output line so far
  let pending = false; // a space to write before the next token

  const emit = (s) => {
    if (!s) return;
    if (pending) out += ' ';
    pending = false;
    out += s;
    lineStart = false;
  };
  const newline = () => {
    if (!lineStart) out += '\n';
    lineStart = true;
    pending = false;
  };

  const readTemplate = () => { // from after a backtick (or a `}` closing a substitution) to the next backtick or `${`
    while (i < n) {
      const c = src[i];
      if (c === '\\') { emit(src.slice(i, i + 2)); i += 2; continue; }
      if (c === '`') { emit(c); i++; return 'end'; }
      if (c === '$' && src[i + 1] === '{') { emit('${'); i += 2; return 'expr'; }
      if (c === '\n') { out += c; lineStart = false; i++; continue; } // a line of the literal: kept as is (its spaces too)
      emit(c);
      i++;
    }
    throw new Error('unterminated template literal');
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '\n') { newline(); i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') {
      let j = i;
      while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\r')) j++;
      // one space between tokens, none at a line's end; an indented line keeps one space of its indentation, so
      // that nothing indented comes to stand at the start of a line (tools/offline.mjs reads statements there)
      if (src[j] !== '\n' && j < n && (!lineStart || /[ \t]/.test(src.slice(i, j)))) pending = true;
      i = j;
      continue;
    }
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      const keep = kept(src.slice(i, end < 0 ? n : end));
      if (keep.length) emit(`// ${keep.map((k) => k.trim()).join(' ')}`);
      i = end < 0 ? n : end;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error('unterminated comment');
      const text = src.slice(i, end + 2);
      const keep = kept(text);
      if (keep.length) emit(`/* ${keep.map((k) => k.trim()).join(' ')} */`);
      else if (text.includes('\n')) newline(); // a comment with a line break separates as a line break does
      else pending = true;
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        else if (src[j] === '\n') throw new Error('unterminated string');
        j++;
      }
      if (j >= n) throw new Error('unterminated string');
      emit(src.slice(i, j + 1));
      i = j + 1;
      last = 'str';
      continue;
    }
    if (c === '`') {
      emit(c);
      i++;
      if (readTemplate() === 'expr') { tpl.push(depth); depth++; last = '{'; } else last = 'str';
      continue;
    }
    if (c === '/') {
      const regex = last === '' || (!last.startsWith('word:') && last !== 'num' && last !== 'str' && last !== ')' && last !== ']' && last !== '}')
        || (last.startsWith('word:') && REGEX_AFTER_WORD.has(last.slice(5)));
      if (regex) {
        let j = i + 1;
        let cls = false;
        while (j < n) {
          const x = src[j];
          if (x === '\\') { j += 2; continue; }
          if (x === '\n') throw new Error(`unterminated regular expression at ${i}`);
          if (cls) { if (x === ']') cls = false; } else if (x === '[') cls = true; else if (x === '/') break;
          j++;
        }
        j++;
        while (j < n && /[a-z]/i.test(src[j])) j++; // flags
        emit(src.slice(i, j));
        i = j;
        last = 'str';
        continue;
      }
    }
    if (c === '}' && tpl.length && depth - 1 === tpl[tpl.length - 1]) { // the end of a substitution: back into the literal
      tpl.pop();
      depth--;
      emit(c);
      i++;
      if (readTemplate() === 'expr') { tpl.push(depth); depth++; last = '{'; } else last = 'str';
      continue;
    }
    if (/[A-Za-z_$\u0080-￿]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$\u0080-￿]/.test(src[j])) j++;
      const w = src.slice(i, j);
      emit(w);
      last = `word:${w}`;
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(d))) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j])) j++;
      emit(src.slice(i, j));
      last = 'num';
      i = j;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    emit(c);
    last = c;
    i++;
  }
  if (tpl.length) throw new Error('unterminated template substitution');
  return out.endsWith('\n') ? out : `${out}\n`;
}

/**
 * CSS without comments (the copyright line kept) and without the spaces it does not need: runs of white space
 * become one space, and none is kept around `{ } ; , >` or after a colon. A space before a colon stays
 * (`a :hover` is not `a:hover`), and strings are kept as they are. One rule per line.
 */
export function stripCss(src) {
  const parts = []; // [code?, text]
  let code = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error('unterminated comment');
      const keep = kept(src.slice(i, end + 2));
      code += ' ';
      if (keep.length) { parts.push([true, code], [false, `\n/* ${keep.map((k) => k.trim()).join(' ')} */\n`]); code = ''; }
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      parts.push([true, code], [false, src.slice(i, j + 1)]);
      code = '';
      i = j + 1;
      continue;
    }
    code += c;
    i++;
  }
  parts.push([true, code]);
  const tight = (s) => s.replace(/\s+/g, ' ').replace(/ ?([{};,>]) ?/g, '$1').replace(/: /g, ':').replace(/}/g, '}\n');
  const out = parts.map(([isCode, s]) => (isCode ? tight(s) : s)).join('');
  return `${out.split('\n').map((l) => l.trim()).filter(Boolean).join('\n')}\n`;
}

/** The release copy of a file: minified JavaScript, CSS and JSON; anything else as it is. */
export function minify(path, text) {
  if (/\.m?js$/.test(path)) return stripJs(text);
  if (/\.css$/.test(path)) return stripCss(text);
  if (/\.json$/.test(path)) return `${JSON.stringify(JSON.parse(text))}\n`;
  return text;
}

/**
 * The release copy against the sources, in two parts. (1) The whole test suite on a copy of the repository in a
 * temporary folder with every JavaScript file of src/ minified, `node --test` run in it, the book repository named
 * by MES_BOOK and MES_BOOK_SIM (no link to it is made, so removing the copy cannot reach it). (2) Each style sheet
 * of src/ parsed by the browser as it is and minified: every rule's text must be equal (spaces after commas apart,
 * which the browser keeps in custom properties and in values with var() as written). The suite's copy keeps its
 * CSS and JSON as they are, since tests read the style sheet's text and compare content files byte for byte with
 * the book's; JSON.parse of a minified file gives the same value by construction. Returns {status, summary}.
 */
export async function checkSuite({ root, book }) {
  const { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'mavilera-minified-'));
  try {
    const copy = join(dir, 'repo');
    cpSync(root, copy, { recursive: true, filter: (p) => !/[\\/](\.git|node_modules|dist)$/.test(p) });
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    for (const f of walk(join(copy, 'src')).filter((p) => p.endsWith('.js'))) writeFileSync(f, minify(f, readFileSync(f, 'utf8')));
    const r = spawnSync(process.execPath, ['--test'], { cwd: copy, encoding: 'utf8', maxBuffer: 1 << 28,
      env: { ...process.env, MES_BOOK: book, MES_BOOK_SIM: join(book, 'code', 'sim') } });
    const count = (k) => Number(r.stdout.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm'))?.[1] ?? NaN);
    const failed = [...new Set(r.stdout.split('\n').filter((l) => /^✖ /.test(l) && !/failing tests:/.test(l))
      .map((l) => l.slice(2).replace(/ \([\d.]+m?s\)$/, '').trim()))];
    const css = await compareCss(walk(join(root, 'src')).filter((p) => p.endsWith('.css')));
    const summary = { tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped'), failed, css };
    return { status: r.status === 0 && css.differ === 0 && css.rules > 0 ? 0 : 1, summary };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Style sheets parsed by a local Chrome or Edge, as they are and minified: {rules, differ, first}. */
async function compareCss(files) {
  const { readFileSync } = await import('node:fs');
  const { launch } = await import('./browser.mjs');
  const b = await launch('chrome').catch(() => launch('edge'));
  try {
    const p = await b.newPage();
    await p.goto('about:blank');
    const rules = (t) => p.eval(`(() => { const s = new CSSStyleSheet(); s.replaceSync(${JSON.stringify(t)}); return [...s.cssRules].map((r) => r.cssText); })()`);
    const norm = (r) => r.replace(/,\s+/g, ',');
    let total = 0;
    const differ = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const [a, m] = [await rules(src), await rules(stripCss(src))];
      total += a.length;
      if (a.length !== m.length) differ.push(`${f}: ${a.length} rules, minified ${m.length}`);
      else a.forEach((r, i) => { if (norm(r) !== norm(m[i])) differ.push(`${f}: ${r.slice(0, 80)}`); });
    }
    return { rules: total, differ: differ.length, first: differ[0] ?? null };
  } finally {
    await b.close();
  }
}

// node tools/minify.mjs --check-suite [--book ../book-MES]
const { fileURLToPath } = await import('node:url');
const { join, resolve } = await import('node:path');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--check-suite')) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const i = process.argv.indexOf('--book');
  const r = await checkSuite({ root, book: i > 0 ? process.argv[i + 1] : join(root, '..', 'book-MES') });
  console.log(JSON.stringify(r.summary));
  process.exitCode = r.status === 0 ? 0 : 1;
}
