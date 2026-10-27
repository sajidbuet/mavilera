// parser.js -- recursive-descent parser of the simulator's C subset (spec
// §10.1): declarations of variables (one-dimensional arrays, pointers,
// initialisers) and functions; the statements if/else, while, do-while, for,
// switch, break, continue, return; expressions with C's precedence. Every
// node carries the line and column of its first token. Constructs outside
// the subset are named as such (WS-F-084). Types are built here (types.js);
// names are resolved and types checked in check.js.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { CError, REFUSED } from './lexer.js';
import { T, STDINT, ptr, array, func, qualified } from './types.js';

const SUBSET = { subset: true };
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '^=', '|=']);
// binary operators by precedence, lowest first
const LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
const TYPE_WORDS = new Set(['int', 'unsigned', 'signed', 'char', 'short', '_Bool', 'void', 'static', 'const', 'volatile', 'inline']);

export class Parser {
  /**
   * @param {Array} tokens from preprocess.js
   * @param {{preprocessor?: boolean, stdint?: boolean}} opts preprocessor: an #if expression;
   *   stdint: <stdint.h> was included
   */
  constructor(tokens, { preprocessor = false, stdint = false } = {}) {
    this.t = tokens;
    this.i = 0;
    this.pp = preprocessor;
    this.stdint = stdint;
  }

  // --- tokens -----------------------------------------------------------------------------
  peek(k = 0) { return this.t[this.i + k] ?? null; }
  loc(tok = this.peek()) { return tok ? { line: tok.line, col: tok.col } : this.endLoc(); }
  endLoc() { const l = this.t[this.t.length - 1]; return l ? { line: l.line, col: l.col + 1 } : { line: 1, col: 1 }; }
  next() { const tok = this.t[this.i]; if (!tok) throw new CError('unexpected end of the program', this.endLoc()); this.i++; return tok; }
  is(v, k = 0) { const tok = this.peek(k); return Boolean(tok) && (tok.k === 'punct' || tok.k === 'kw') && tok.v === v; }
  accept(v) { if (this.is(v)) { this.i++; return true; } return false; }
  expect(v, what = null) {
    if (this.accept(v)) return;
    const tok = this.peek();
    if (v === ';' && tok?.v === ',') throw new CError('the comma operator is not in the simulator\'s C subset; write separate statements', this.loc(tok), SUBSET);
    throw new CError(`expected ${v}${what ? ` ${what}` : ''}${tok ? `, found ${show(tok)}` : ' before the end of the program'}`, this.loc(tok));
  }
  expectEnd(ctx) {
    const tok = this.peek();
    if (tok) throw new CError(`unexpected ${show(tok)} in ${ctx}`, this.loc(tok));
  }

  // --- expressions ------------------------------------------------------------------------
  expression() { return this.assignment(); }

  assignment() {
    const loc = this.loc();
    const l = this.conditional();
    const tok = this.peek();
    if (tok?.k === 'punct' && ASSIGN.has(tok.v)) {
      if (this.pp) throw new CError('assignment in #if', this.loc(tok));
      this.next();
      return { kind: 'assign', op: tok.v, l, r: this.assignment(), loc: { ...loc, opLoc: this.loc(tok) } };
    }
    return l;
  }

  conditional() {
    const loc = this.loc();
    const c = this.binary(0);
    if (!this.accept('?')) return c;
    const a = this.expression();
    this.expect(':', 'in the conditional expression');
    return { kind: 'cond', c, a, b: this.conditional(), loc };
  }

  binary(level) {
    if (level === LEVELS.length) return this.unary();
    const loc = this.loc();
    let l = this.binary(level + 1);
    for (;;) {
      const tok = this.peek();
      if (!(tok?.k === 'punct' && LEVELS[level].includes(tok.v))) return l;
      this.next();
      l = { kind: 'binary', op: tok.v, l, r: this.binary(level + 1), loc: { ...loc, opLoc: this.loc(tok) } };
    }
  }

  unary() {
    const tok = this.peek();
    const loc = this.loc(tok);
    if (!tok) throw new CError('expected an expression before the end of the program', this.endLoc());
    if (tok.k === 'punct') {
      if (tok.v === '++' || tok.v === '--') {
        this.next();
        return { kind: 'incdec', op: tok.v, prefix: true, e: this.unary(), loc };
      }
      if (['-', '+', '!', '~', '*', '&'].includes(tok.v)) {
        this.next();
        if (this.pp && (tok.v === '*' || tok.v === '&')) throw new CError(`${tok.v} in #if`, loc);
        return { kind: 'unary', op: tok.v, e: this.unary(), loc };
      }
      if (tok.v === '(' && !this.pp && this.startsType(1)) {
        this.next();
        const type = this.typeName();
        this.expect(')', 'after the type of the cast');
        return { kind: 'cast', type, e: this.unary(), loc };
      }
    }
    if (tok.k === 'kw' && tok.v === 'sizeof') {
      if (this.pp) throw new CError('sizeof in #if', loc);
      this.next();
      if (this.is('(') && this.startsType(1)) {
        this.next();
        const type = this.typeName();
        this.expect(')', 'after the type in sizeof');
        return { kind: 'sizeof', type, loc };
      }
      return { kind: 'sizeof', e: this.unary(), loc };
    }
    return this.postfix();
  }

  postfix() {
    let e = this.primary();
    for (;;) {
      const tok = this.peek();
      const loc = this.loc(tok);
      if (this.pp || tok?.k !== 'punct') return e;
      if (tok.v === '[') {
        this.next();
        const i = this.expression();
        this.expect(']', 'after the index');
        e = { kind: 'index', a: e, i, loc: e.loc };
      } else if (tok.v === '(') {
        this.next();
        const args = [];
        if (!this.accept(')')) {
          do args.push(this.assignment()); while (this.accept(','));
          this.expect(')', 'after the arguments');
        }
        if (e.kind !== 'id') throw new CError('only a function name can be called; function pointers are not in the simulator\'s C subset', e.loc, SUBSET);
        e = { kind: 'call', name: e.name, args, loc: e.loc };
      } else if (tok.v === '++' || tok.v === '--') {
        this.next();
        e = { kind: 'incdec', op: tok.v, prefix: false, e, loc: { ...e.loc, opLoc: loc } };
      } else if (tok.v === '.' || tok.v === '->') {
        throw new CError(`${tok.v}: structures are not in the simulator's C subset`, loc, SUBSET);
      } else return e;
    }
  }

  primary() {
    const tok = this.next();
    const loc = this.loc(tok);
    switch (tok.k) {
      case 'num': return { kind: 'num', value: tok.v, unsigned: tok.unsigned, loc };
      case 'char': return { kind: 'num', value: tok.v, unsigned: false, loc };
      case 'str': {
        if (this.pp) throw new CError('a string in #if', loc);
        const bytes = [...tok.v];
        while (this.peek()?.k === 'str') bytes.push(...this.next().v); // adjacent literals join
        return { kind: 'str', bytes, loc };
      }
      case 'id':
        if (STDINT[tok.v] && !this.stdint && !this.pp) throw new CError(`${tok.v} needs #include <stdint.h>`, loc);
        return { kind: 'id', name: tok.v, loc };
      case 'punct':
        if (tok.v === '(') {
          const e = this.expression();
          this.expect(')');
          return e;
        }
        break;
      default: break;
    }
    if (tok.k === 'id' && REFUSED.has(tok.v)) throw refused(tok);
    throw new CError(`expected an expression, found ${show(tok)}`, loc);
  }

  // --- types and declarations -----------------------------------------------------------
  /** Does the token at offset k start a type (cast, sizeof, declaration)? */
  startsType(k = 0) {
    const tok = this.peek(k);
    if (!tok) return false;
    if (tok.k === 'kw' && TYPE_WORDS.has(tok.v)) return true;
    if (tok.k === 'id' && REFUSED.has(tok.v)) return true;
    return tok.k === 'id' && Boolean(STDINT[tok.v]) && this.stdint;
  }

  /** Declaration specifiers: {type, storage, loc}. */
  specifiers() {
    const loc = this.loc();
    const words = [];
    let typedef = null;
    const q = { const: false, volatile: false };
    let storage = null;
    for (;;) {
      const tok = this.peek();
      if (!tok) break;
      if (tok.k === 'id' && REFUSED.has(tok.v)) throw refused(tok);
      if (tok.k === 'id' && STDINT[tok.v] && !typedef && !words.length) {
        if (!this.stdint) throw new CError(`${tok.v} needs #include <stdint.h>`, this.loc(tok));
        typedef = STDINT[tok.v];
        this.next();
        continue;
      }
      if (tok.k !== 'kw' || !TYPE_WORDS.has(tok.v)) break;
      this.next();
      if (tok.v === 'static') storage = 'static';
      else if (tok.v === 'const' || tok.v === 'volatile') q[tok.v] = true;
      else if (tok.v === 'inline') { /* accepted and ignored: no inlining */ } else words.push(tok);
    }
    let type;
    if (typedef) {
      if (words.length) throw new CError(`${words[0].v} cannot be combined with a typedef name`, this.loc(words[0]));
      type = typedef;
    } else type = baseType(words, loc);
    return { type: qualified(type, q), storage, loc };
  }

  /** A declarator over `base`: {name, type, loc}; `abstract` allows no name. */
  declarator(base, { abstract = false } = {}) {
    let type = base;
    while (this.accept('*')) {
      type = ptr(type);
      const q = { const: false, volatile: false };
      while (this.is('const') || this.is('volatile')) q[this.next().v] = true;
      type = qualified(type, q);
    }
    if (this.is('(')) throw new CError('declarators in parentheses (pointers to functions or arrays) are not in the simulator\'s C subset', this.loc(), SUBSET);
    const tok = this.peek();
    let name = null;
    const loc = this.loc(tok);
    if (tok?.k === 'id') {
      if (REFUSED.has(tok.v)) throw refused(tok);
      name = this.next().v;
    } else if (!abstract) throw new CError(`expected a name in the declaration${tok ? `, found ${show(tok)}` : ''}`, loc);
    if (this.accept('[')) {
      const size = this.is(']') ? null : this.expression();
      this.expect(']', 'after the array size');
      if (this.is('[')) throw new CError('arrays of more than one dimension are not in the simulator\'s C subset', this.loc(), SUBSET);
      type = { ...array(type, null), sizeExpr: size };
    } else if (this.accept('(')) {
      const params = this.params();
      type = { ...func(type, params.map((p) => p.type)), paramDecls: params };
      if (this.is('(') || this.is('[')) throw new CError('a function cannot return a function or an array', this.loc());
    }
    return { name, type, loc };
  }

  params() {
    const out = [];
    if (this.accept(')')) return out; // f(): no parameters
    if (this.is('void') && this.is(')', 1)) { this.next(); this.next(); return out; }
    do {
      if (this.is('...')) throw new CError('variadic functions are not in the simulator\'s C subset', this.loc(), SUBSET);
      const spec = this.specifiers();
      if (spec.storage) throw new CError('a parameter cannot be static', spec.loc);
      const d = this.declarator(spec.type, { abstract: true });
      if (d.type.kind === 'array') d.type = ptr(d.type.of); // int a[] is int *a
      if (d.type.kind === 'void') throw new CError('a parameter cannot have type void', d.loc);
      out.push(d);
    } while (this.accept(','));
    this.expect(')', 'after the parameters');
    return out;
  }

  typeName() {
    const spec = this.specifiers();
    if (spec.storage) throw new CError('static in a type name', spec.loc);
    const d = this.declarator(spec.type, { abstract: true });
    if (d.name) throw new CError(`unexpected name ${d.name} in a type`, d.loc);
    return d.type;
  }

  initializer() {
    const loc = this.loc();
    if (!this.accept('{')) return this.assignment();
    const items = [];
    while (!this.is('}')) {
      if (this.is('{')) throw new CError('nested initialiser lists (arrays of arrays, structures) are not in the simulator\'s C subset', this.loc(), SUBSET);
      items.push(this.assignment());
      if (!this.accept(',')) break;
    }
    this.expect('}', 'to close the initialiser list');
    return { kind: 'list', items, loc };
  }

  /** The whole program: {decls}. */
  program() {
    const decls = [];
    while (this.peek()) {
      if (this.accept(';')) continue;
      const tok = this.peek();
      if (tok.k === 'id' && !REFUSED.has(tok.v) && !STDINT[tok.v] && this.is('(', 1)) {
        throw new CError(`${tok.v}(…) needs a return type: write int ${tok.v}(…)`, this.loc(tok));
      }
      if (tok.k === 'id' && this.peek(1)?.k === 'id' && !this.startsType()) throw unknownType(tok);
      if (!this.startsType()) throw new CError(`expected a declaration, found ${show(tok)}`, this.loc(tok));
      const spec = this.specifiers();
      const first = this.declarator(spec.type);
      if (first.type.kind === 'func' && this.is('{')) {
        decls.push({ kind: 'func', name: first.name, type: first.type, params: first.type.paramDecls, storage: spec.storage,
          body: this.block(), loc: first.loc });
        continue;
      }
      decls.push(...this.declarationRest(spec, first));
    }
    return { decls };
  }

  /** The declarators of one declaration after the first, and its semicolon. */
  declarationRest(spec, first) {
    const out = [];
    let d = first;
    for (;;) {
      if (d.type.kind === 'void') throw new CError(`${d.name} cannot have type void`, d.loc);
      const init = this.accept('=') ? this.initializer() : null;
      if (d.type.kind === 'func') {
        if (init) throw new CError(`function ${d.name} cannot have an initialiser`, d.loc);
        out.push({ kind: 'proto', name: d.name, type: d.type, storage: spec.storage, loc: d.loc });
      } else out.push({ kind: 'var', name: d.name, type: d.type, init, storage: spec.storage, loc: d.loc });
      if (!this.accept(',')) break;
      d = this.declarator(spec.type);
    }
    this.expect(';', 'after the declaration');
    return out;
  }

  // --- statements --------------------------------------------------------------------------
  block() {
    const loc = this.loc();
    this.expect('{');
    const items = [];
    while (!this.is('}')) {
      if (!this.peek()) throw new CError('a { is never closed with }', loc);
      items.push(this.blockItem());
    }
    const end = this.loc();
    this.next();
    return { kind: 'block', items, loc, end };
  }

  blockItem() {
    if (!this.startsType()) return this.statement();
    const loc = this.loc();
    const spec = this.specifiers();
    const first = this.declarator(spec.type);
    if (first.type.kind === 'func') throw new CError(`function ${first.name} must be declared outside other functions`, first.loc);
    return { kind: 'decl', vars: this.declarationRest(spec, first), loc };
  }

  statement() {
    const tok = this.peek();
    const loc = this.loc(tok);
    if (!tok) throw new CError('expected a statement before the end of the program', loc);
    if (tok.k === 'kw') {
      switch (tok.v) {
        case 'if': {
          this.next();
          const c = this.paren('if');
          const then = this.statement();
          return { kind: 'if', c, then, else: this.accept('else') ? this.statement() : null, loc };
        }
        case 'while': {
          this.next();
          const c = this.paren('while');
          return { kind: 'while', c, body: this.statement(), loc };
        }
        case 'do': {
          this.next();
          const body = this.statement();
          if (!this.accept('while')) throw new CError('expected while after the body of do', this.loc());
          const c = this.paren('do … while');
          this.expect(';', 'after do … while (…)');
          return { kind: 'do', body, c, loc };
        }
        case 'for': {
          this.next();
          this.expect('(', 'after for');
          let init = null;
          if (this.startsType()) {
            const dl = this.loc();
            const spec = this.specifiers();
            init = { kind: 'decl', vars: this.declarationRest(spec, this.declarator(spec.type)), loc: dl };
          } else if (!this.accept(';')) {
            init = { kind: 'expr', e: this.expression(), loc: this.loc() };
            this.expect(';', 'after the first part of for');
          }
          const c = this.is(';') ? null : this.expression();
          this.expect(';', 'after the condition of for');
          const step = this.is(')') ? null : this.expression();
          if (this.is(',')) throw new CError('the comma operator is not in the simulator\'s C subset', this.loc(), SUBSET);
          this.expect(')', 'after the parts of for');
          return { kind: 'for', init, c, step, body: this.statement(), loc };
        }
        case 'switch': {
          this.next();
          const e = this.paren('switch');
          return { kind: 'switch', e, body: this.statement(), loc };
        }
        case 'case': {
          this.next();
          const value = this.conditional();
          this.expect(':', 'after the case value');
          return { kind: 'case', value, stmt: this.labelled(), loc };
        }
        case 'default':
          this.next();
          this.expect(':', 'after default');
          return { kind: 'default', stmt: this.labelled(), loc };
        case 'break': case 'continue':
          this.next();
          this.expect(';', `after ${tok.v}`);
          return { kind: tok.v, loc };
        case 'return': {
          this.next();
          const e = this.is(';') ? null : this.expression();
          this.expect(';', 'after return');
          return { kind: 'return', e, loc };
        }
        default: break;
      }
    }
    if (tok.k === 'id' && tok.v === 'goto') throw refused(tok);
    if (tok.k === 'id' && this.peek(1)?.k === 'id') throw unknownType(tok);
    if (tok.k === 'id' && this.is(':', 1)) throw new CError('labels and goto are not in the simulator\'s C subset', loc, SUBSET);
    if (this.is('{')) return this.block();
    if (this.accept(';')) return { kind: 'empty', loc };
    const e = this.expression();
    this.expect(';', 'after the expression');
    return { kind: 'expr', e, loc };
  }

  /** The statement after a case or default label (a declaration there is not C). */
  labelled() {
    if (this.is('}')) return { kind: 'empty', loc: this.loc() };
    return this.statement();
  }

  paren(what) {
    this.expect('(', `after ${what}`);
    const e = this.expression();
    this.expect(')', `after the condition of ${what}`);
    return e;
  }
}

function show(tok) {
  if (tok.k === 'str') return 'a string';
  if (tok.k === 'num') return tok.text ?? String(tok.v);
  if (tok.k === 'char') return 'a character constant';
  return tok.v;
}

/** A name used as a type that the subset does not know (int64_t, size_t, a typedef of another program). */
function unknownType(tok) {
  if (STDINT[tok.v]) return new CError(`${tok.v} needs #include <stdint.h>`, { line: tok.line, col: tok.col });
  const why = /64/.test(tok.v) ? '; 64-bit types are outside the subset' : '';
  return new CError(`${tok.v} is not a type of the simulator's C subset${why} (its types: int, unsigned, char, short, _Bool, `
    + 'and with #include <stdint.h> int8_t to uint32_t)', { line: tok.line, col: tok.col }, SUBSET);
}

function refused(tok) {
  const what = { long: 'long (and 64-bit types)', float: 'floating point', double: 'floating point', struct: 'structures', union: 'unions',
    enum: 'enumerations', typedef: 'typedef', goto: 'goto', extern: 'extern' }[tok.v] ?? tok.v;
  return new CError(`${what}: not in the simulator's C subset`, { line: tok.line, col: tok.col }, SUBSET);
}

/** The type named by the type words of a declaration (int, unsigned char, short int, ...). */
function baseType(words, loc) {
  if (!words.length) throw new CError('a declaration needs a type (int, unsigned, char, …)', loc);
  const count = {};
  for (const w of words) count[w.v] = (count[w.v] ?? 0) + 1;
  const has = (w) => Boolean(count[w]);
  const bad = () => new CError(`${words.map((w) => w.v).join(' ')} is not a type of the simulator's C subset`, loc);
  if (Object.values(count).some((n) => n > 1)) throw bad();
  if (has('signed') && has('unsigned')) throw bad();
  const others = Object.keys(count).filter((w) => !['signed', 'unsigned', 'int'].includes(w));
  if (others.length > 1) throw bad();
  const sign = has('unsigned') ? 'u' : has('signed') ? 's' : '';
  switch (others[0]) {
    case undefined: return sign === 'u' ? T.uint : T.int;
    case 'char': if (has('int')) throw bad(); return sign === 'u' ? T.uchar : sign === 's' ? T.schar : T.char;
    case 'short': return sign === 'u' ? T.ushort : T.short;
    case 'void': case '_Bool':
      if (sign || has('int')) throw bad();
      return others[0] === 'void' ? T.void : T.bool;
    default: throw bad();
  }
}
