// types.js -- the types of the simulator's C subset (spec §10.1) on the
// RISC-V ilp32 ABI: _Bool and char 1 byte (char is unsigned, as the psABI
// fixes it), short 2 bytes, int, unsigned and pointers 4 bytes; arrays of
// one dimension; functions. Integer promotions and the usual arithmetic
// conversions of the C standard (6.3.1). Qualifiers are kept as flags.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const int = (name, size, signed, extra = {}) => Object.freeze({ kind: 'int', name, size, signed, ...extra });

export const T = Object.freeze({
  void: Object.freeze({ kind: 'void', name: 'void' }),
  bool: int('_Bool', 1, false, { bool: true }),
  char: int('char', 1, false),
  schar: int('signed char', 1, true),
  uchar: int('unsigned char', 1, false),
  short: int('short', 2, true),
  ushort: int('unsigned short', 2, false),
  int: int('int', 4, true),
  uint: int('unsigned int', 4, false),
});

/** The typedef names that `#include <stdint.h>` makes known (extension of 2026-10-27). */
export const STDINT = Object.freeze({
  int8_t: T.schar, uint8_t: T.uchar, int16_t: T.short, uint16_t: T.ushort, int32_t: T.int, uint32_t: T.uint,
});

export const ptr = (to) => ({ kind: 'ptr', to });
export const array = (of, len) => ({ kind: 'array', of, len });
export const func = (ret, params) => ({ kind: 'func', ret, params });
export const qualified = (t, q) => (q.const || q.volatile ? { ...t, const: Boolean(q.const || t.const), volatile: Boolean(q.volatile || t.volatile) } : t);

export const isInt = (t) => t.kind === 'int';
export const isPtr = (t) => t.kind === 'ptr';
export const isScalar = (t) => t.kind === 'int' || t.kind === 'ptr';

export function sizeOf(t) {
  switch (t.kind) {
    case 'int': return t.size;
    case 'ptr': return 4;
    case 'array': return t.len * sizeOf(t.of);
    default: return 0;
  }
}

export const alignOf = (t) => (t.kind === 'array' ? alignOf(t.of) : Math.max(1, sizeOf(t)));

/** Integer promotion: types narrower than int become int. */
export const promote = (t) => (t.kind === 'int' && t.size < 4 ? T.int : t);

/** The usual arithmetic conversions of two integer types. */
export function common(a, b) {
  const x = promote(a);
  const y = promote(b);
  return !x.signed || !y.signed ? T.uint : T.int;
}

/** Same type, qualifiers ignored. */
export function same(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'int') return a.size === b.size && a.signed === b.signed && Boolean(a.bool) === Boolean(b.bool);
  if (a.kind === 'ptr') return a.to.kind === 'void' || b.to.kind === 'void' || same(a.to, b.to);
  if (a.kind === 'array') return a.len === b.len && same(a.of, b.of);
  return a.kind === 'void';
}

/** The type as C writes it, for messages. */
export function typeName(t) {
  const q = `${t.const ? 'const ' : ''}${t.volatile ? 'volatile ' : ''}`;
  switch (t.kind) {
    case 'ptr': return `${typeName(t.to)} *`;
    case 'array': return `${typeName(t.of)} [${t.len}]`;
    case 'func': return `${typeName(t.ret)} (${t.params.map(typeName).join(', ') || 'void'})`;
    default: return `${q}${t.name}`;
  }
}
