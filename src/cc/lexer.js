// lexer.js -- tokens of the simulator's C subset (spec §10.1): identifiers,
// keywords, integer and character constants, string literals and
// punctuators, each with its line and column. Comments are removed by the
// preprocessor (preprocess.js) before a line is split into tokens.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/** A compile error at a source position (WS-F-084). `subset`: the construct is outside the subset. */
export class CError extends Error {
  constructor(message, loc = null, { subset = false } = {}) {
    super(message);
    this.line = loc?.line ?? 0;
    this.column = loc?.col ?? 0;
    this.subset = subset;
  }
}

/** Words of the subset, and C keywords that are recognised only to be refused. */
export const KEYWORDS = new Set(['int', 'unsigned', 'signed', 'char', 'short', '_Bool', 'void', 'static', 'const', 'volatile',
  'inline', 'if', 'else', 'while', 'do', 'for', 'break', 'continue', 'return', 'switch', 'case', 'default', 'sizeof']);
export const REFUSED = new Set(['long', 'float', 'double', 'struct', 'union', 'enum', 'typedef', 'goto', 'extern', 'register',
  'auto', 'restrict', '_Complex', '_Atomic', '_Alignas', '_Alignof', '_Generic', '_Noreturn', '_Static_assert', '_Thread_local']);

const PUNCT = ['<<=', '>>=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=',
  '&=', '^=', '|=', '+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '<', '>', '=', '?', ':', ';', ',', '.', '(', ')', '[', ']',
  '{', '}', '#'];

const ESC = { n: 10, t: 9, r: 13, 0: 0, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11, '?': 63 };

/** One escape sequence at s[i] (after the backslash): [value, next index]. */
function escape(s, i, loc) {
  const c = s[i];
  if (c === 'x') {
    const m = /^[0-9a-fA-F]+/.exec(s.slice(i + 1));
    if (!m) throw new CError('\\x needs hexadecimal digits', loc);
    return [parseInt(m[0], 16) & 0xff, i + 1 + m[0].length];
  }
  if (/[0-7]/.test(c)) {
    const m = /^[0-7]{1,3}/.exec(s.slice(i));
    return [parseInt(m[0], 8) & 0xff, i + m[0].length];
  }
  if (c in ESC) return [ESC[c], i + 1];
  throw new CError(`unknown escape sequence \\${c}`, loc);
}

/**
 * Tokens of one line of preprocessed source. Each token: {k, v, line, col}
 * with k = 'id' | 'kw' | 'num' | 'char' | 'str' | 'punct'; numbers carry
 * `unsigned` (a u suffix, or a hexadecimal or octal value above INT_MAX).
 */
export function tokenize(text, line) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
    const loc = { line, col: i + 1 };
    let m;
    if ((m = /^[A-Za-z_]\w*/.exec(text.slice(i)))) {
      const w = m[0];
      out.push({ k: KEYWORDS.has(w) ? 'kw' : 'id', v: w, ...loc });
      i += w.length;
    } else if ((m = /^(?:0[xX][0-9a-fA-F]+|[0-9]+)[A-Za-z_0-9]*/.exec(text.slice(i)))) {
      const raw = m[0];
      const p = /^(0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)([uU]?)$/.exec(raw);
      if (!p) {
        if (/[lL]/.test(raw)) throw new CError(`${raw}: long constants are not in the simulator's C subset`, loc, { subset: true });
        throw new CError(`${raw} is not a valid integer constant`, loc);
      }
      const body = p[1];
      const big = body.startsWith('0x') || body.startsWith('0X') ? BigInt(body) : body.length > 1 && body[0] === '0' ? BigInt(`0o${body.slice(1)}`) : BigInt(body);
      const decimal = /^[1-9]/.test(body);
      let unsigned = p[2] !== '';
      if (big > 0xffffffffn) throw new CError(`${raw} does not fit in 32 bits; 64-bit types are not in the simulator's C subset`, loc, { subset: true });
      if (big > 0x7fffffffn && !unsigned) {
        if (decimal) throw new CError(`${raw} does not fit in int; write ${raw}u for an unsigned constant (64-bit types are not in the subset)`, loc, { subset: true });
        unsigned = true;
      }
      out.push({ k: 'num', v: Number(big), unsigned, text: raw, ...loc });
      i += raw.length;
    } else if (c === "'") {
      let j = i + 1;
      let v;
      if (text[j] === '\\') [v, j] = escape(text, j + 1, loc);
      else if (text[j] !== undefined && text[j] !== "'") { v = text.charCodeAt(j) & 0xff; j++; } else throw new CError('empty character constant', loc);
      if (text[j] !== "'") throw new CError('a character constant holds one character; close it with \'', loc);
      out.push({ k: 'char', v, ...loc });
      i = j + 1;
    } else if (c === '"') {
      let j = i + 1;
      const bytes = [];
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') { let v; [v, j] = escape(text, j + 1, loc); bytes.push(v); } else { bytes.push(text.charCodeAt(j) & 0xff); j++; }
      }
      if (j >= text.length) throw new CError('string literal not closed on its line', loc);
      out.push({ k: 'str', v: bytes, ...loc });
      i = j + 1;
    } else {
      const p = PUNCT.find((q) => text.startsWith(q, i));
      if (!p) throw new CError(`unexpected character ${JSON.stringify(c)}`, loc);
      out.push({ k: 'punct', v: p, ...loc });
      i += p.length;
    }
  }
  return out;
}
