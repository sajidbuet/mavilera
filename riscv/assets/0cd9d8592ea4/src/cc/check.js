// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { CError } from './lexer.js';
import { T, ptr, array, isInt, isPtr, isScalar, sizeOf, promote, common, same, typeName } from './types.js';
const REGISTER_NAMES = new Set(['zero', 'ra', 'sp', 'gp', 'tp', 'fp', 'pc', ...Array.from({ length: 32 }, (_, i) => `x${i}`),
 ...[0, 1, 2, 3, 4, 5, 6].map((i) => `t${i}`), ...Array.from({ length: 12 }, (_, i) => `s${i}`), ...Array.from({ length: 8 }, (_, i) => `a${i}`)]);
const BUILTINS = {
 putchar: { type: { kind: 'func', ret: T.int, params: [T.int] }, note: 'writes one character to the console (ecall 64)' },
 exit: { type: { kind: 'func', ret: T.void, params: [T.int] }, note: 'ends the program with an exit code (ecall 93)' },
};
export const valueType = (t) => (t.kind === 'array' ? ptr(t.of) : t);
export function toType(v, t) {
 if (t.bool) return v ? 1 : 0;
 if (t.kind !== 'int' || t.size === 4) return v >>> 0;
 const sh = 32 - 8 * t.size;
 return (t.signed ? (v << sh) >> sh : (v << sh) >>> sh) >>> 0;
}
const signedOf = (v) => v | 0;
export function check(ast) {
 const globals = new Map();
 const funcs = [];
 const data = [];
 const strings = [];
 const used = new Set();
 let fn = null;
 const scopes = [];
 let loops = 0;
 const switches = [];
 const err = (msg, loc, subset = false) => new CError(msg, loc, { subset });
 const lookup = (name) => {
 for (let k = scopes.length - 1; k >= 0; k--) if (scopes[k].has(name)) return scopes[k].get(name);
 if (globals.has(name)) return globals.get(name);
 if (BUILTINS[name]) {
 const sym = { kind: 'func', name, type: BUILTINS[name].type, builtin: true, defined: true, label: name };
 globals.set(name, sym);
 return sym;
 }
 return null;
 };
 const claimLabel = (name, loc) => {
 if (REGISTER_NAMES.has(name)) throw err(`the name ${name} is also a register name in assembly; choose another name`, loc);
 };
 function fold(e) {
 const c = (x) => x.cv !== undefined;
 switch (e.kind) {
 case 'num': return;
 case 'sizeof': return;
 case 'cast':
 if (c(e.e) && isInt(e.type)) e.cv = toType(e.e.cv, e.type);
 return;
 case 'unary': {
 if (!c(e.e) || !isInt(e.type)) return;
 const v = e.e.cv;
 if (e.op === '-') e.cv = toType(-v, e.type);
 else if (e.op === '+') e.cv = toType(v, e.type);
 else if (e.op === '~') e.cv = toType(~v, e.type);
 else if (e.op === '!') e.cv = v ? 0 : 1;
 return;
 }
 case 'cond':
 if (c(e.c) && c(e.a) && c(e.b) && isInt(e.type)) e.cv = toType(e.c.cv ? e.a.cv : e.b.cv, e.type);
 return;
 case 'binary': {
 if (e.op === '&&' && c(e.l) && c(e.r)) { e.cv = e.l.cv && e.r.cv ? 1 : 0; return; }
 if (e.op === '||' && c(e.l) && c(e.r)) { e.cv = e.l.cv || e.r.cv ? 1 : 0; return; }
 if (!c(e.l) || !c(e.r) || !e.ctype || !isInt(e.ctype)) return;
 const s = e.ctype.signed;
 const a = e.l.cv;
 const b = e.r.cv;
 let v;
 switch (e.op) {
 case '+': v = a + b; break;
 case '-': v = a - b; break;
 case '*': v = Math.imul(a, b); break;
 case '/': case '%':
 if (b === 0 || (s && signedOf(a) === -0x80000000 && signedOf(b) === -1)) return;
 if (s) v = e.op === '/' ? Math.trunc(signedOf(a) / signedOf(b)) : signedOf(a) % signedOf(b);
 else v = e.op === '/' ? Math.floor(a / b) : a % b;
 break;
 case '<<': if (b >= 32) return; v = a << b; break;
 case '>>': if (b >= 32) return; v = s ? signedOf(a) >> b : a >>> b; break;
 case '&': v = a & b; break;
 case '|': v = a | b; break;
 case '^': v = a ^ b; break;
 case '<': v = s ? signedOf(a) < signedOf(b) : a < b; break;
 case '>': v = s ? signedOf(a) > signedOf(b) : a > b; break;
 case '<=': v = s ? signedOf(a) <= signedOf(b) : a <= b; break;
 case '>=': v = s ? signedOf(a) >= signedOf(b) : a >= b; break;
 case '==': v = a === b; break;
 case '!=': v = a !== b; break;
 default: return;
 }
 e.cv = toType(typeof v === 'boolean' ? Number(v) : v, e.type);
 break;
 }
 default: break;
 }
 }
 const constInt = (e, what) => {
 expr(e);
 if (e.cv === undefined || !isInt(e.type)) throw err(`${what} must be an integer constant expression`, e.loc);
 return e.cv;
 };
 const isNull = (e) => isInt(e.type) && e.cv === 0;
 function assignable(to, e, what) {
 const from = valueType(e.type);
 if (to.kind === 'int') {
 if (isInt(from)) return;
 if (isPtr(from) && to.bool) return;
 if (isPtr(from)) throw err(`${what}: a pointer (${typeName(from)}) given where ${typeName(to)} is needed; use a cast if this is intended`, e.loc);
 } else if (to.kind === 'ptr') {
 if (isPtr(from) && same(to, from)) return;
 if (isNull(e)) return;
 if (isPtr(from)) throw err(`${what}: ${typeName(from)} given where ${typeName(to)} is needed`, e.loc);
 if (isInt(from)) throw err(`${what}: an integer given where the pointer ${typeName(to)} is needed; use a cast if this is intended`, e.loc);
 }
 throw err(`${what}: ${typeName(from)} cannot be converted to ${typeName(to)}`, e.loc);
 }
 const modifiable = (e, what) => {
 if (!e.lvalue) throw err(`${what} needs a variable, an array element or *pointer on its left`, e.loc);
 if (e.type.kind === 'array') throw err(`${what}: an array cannot be assigned as a whole; assign its elements`, e.loc);
 if (e.type.const) throw err(`${what}: ${e.kind === 'id' ? e.name : 'the object'} is const`, e.loc);
 };
 function expr(e) {
 switch (e.kind) {
 case 'num':
 e.type = e.unsigned ? T.uint : T.int;
 e.cv = e.value >>> 0;
 break;
 case 'str': {
 e.label = `.Lstr${strings.length}`;
 strings.push(e);
 e.type = array(T.char, e.bytes.length + 1);
 e.lvalue = true;
 break;
 }
 case 'id': {
 const sym = lookup(e.name);
 if (!sym) throw err(`${e.name} is not declared`, e.loc);
 if (sym.kind === 'func') throw err(`${e.name} is a function; call it with ${e.name}(…)`, e.loc);
 e.sym = sym;
 e.type = sym.type;
 e.lvalue = true;
 break;
 }
 case 'sizeof': {
 let t = e.type ?? null;
 if (!t) { expr(e.e); t = e.e.type; }
 if (t.kind === 'array' && t.len === null) throw err('sizeof of an array of unknown size', e.loc);
 if (t.kind === 'void' || t.kind === 'func') throw err(`sizeof (${typeName(t)}) is not defined`, e.loc);
 e.cv = sizeOf(t);
 e.type = T.uint;
 break;
 }
 case 'cast': {
 e.type = resolveType(e.type, e.loc);
 expr(e.e);
 const from = valueType(e.e.type);
 if (e.type.kind !== 'void' && !(isScalar(e.type) && isScalar(from))) {
 throw err(`cannot convert ${typeName(from)} to ${typeName(e.type)}`, e.loc);
 }
 break;
 }
 case 'unary': {
 expr(e.e);
 const t = valueType(e.e.type);
 switch (e.op) {
 case '-': case '+': case '~':
 if (!isInt(t)) throw err(`unary ${e.op} needs an integer, not ${typeName(t)}`, e.loc);
 e.type = promote(t);
 break;
 case '!':
 if (!isScalar(t)) throw err(`! needs an integer or a pointer, not ${typeName(t)}`, e.loc);
 e.type = T.int;
 break;
 case '*':
 if (!isPtr(t)) throw err(`* needs a pointer, not ${typeName(t)}`, e.loc);
 if (t.to.kind === 'void') throw err('a void * cannot be dereferenced; cast it to a pointer to a type first', e.loc);
 e.type = t.to;
 e.lvalue = true;
 break;
 case '&':
 if (!e.e.lvalue) throw err('& needs a variable, an array element or *pointer', e.loc);
 if (e.e.type.kind === 'array') throw err('& of a whole array (a pointer to an array) is not in the simulator\'s C subset; use the array name, which is a pointer to its first element', e.loc, true);
 if (e.e.kind === 'id') e.e.sym.addrTaken = true;
 e.type = ptr(e.e.type);
 break;
 default: break;
 }
 break;
 }
 case 'incdec': {
 expr(e.e);
 modifiable(e.e, e.op);
 if (!isScalar(e.e.type)) throw err(`${e.op} needs an integer or a pointer`, e.loc);
 if (isPtr(e.e.type) && e.e.type.to.kind === 'void') throw err(`${e.op} on a void *`, e.loc);
 e.type = e.e.type;
 break;
 }
 case 'binary': binary(e); break;
 case 'assign': assign(e); break;
 case 'cond': {
 expr(e.c); expr(e.a); expr(e.b);
 if (!isScalar(valueType(e.c.type))) throw err('the condition of ?: must be an integer or a pointer', e.c.loc);
 const a = valueType(e.a.type);
 const b = valueType(e.b.type);
 if (isInt(a) && isInt(b)) e.type = common(a, b);
 else if (isPtr(a) && isPtr(b) && same(a, b)) e.type = a;
 else if (isPtr(a) && isNull(e.b)) e.type = a;
 else if (isPtr(b) && isNull(e.a)) e.type = b;
 else if (a.kind === 'void' && b.kind === 'void') e.type = T.void;
 else throw err(`the two results of ?: have different types (${typeName(a)} and ${typeName(b)})`, e.loc);
 break;
 }
 case 'index': {
 expr(e.a); expr(e.i);
 let p = valueType(e.a.type);
 let i = valueType(e.i.type);
 if (isInt(p) && isPtr(i)) { [e.a, e.i] = [e.i, e.a]; [p, i] = [i, p]; }
 if (!isPtr(p)) throw err(`[ ] needs an array or a pointer, not ${typeName(p)}`, e.loc);
 if (!isInt(i)) throw err('an array index must be an integer', e.i.loc);
 if (p.to.kind === 'void') throw err('a void * cannot be indexed', e.loc);
 e.type = p.to;
 e.lvalue = true;
 break;
 }
 case 'call': {
 const sym = lookup(e.name);
 if (!sym) throw err(`function ${e.name} is not declared; declare or define it before this call`, e.loc);
 if (sym.kind !== 'func') throw err(`${e.name} is not a function`, e.loc);
 e.sym = sym;
 used.add(sym);
 const params = sym.type.params;
 if (e.args.length !== params.length) {
 throw err(`${e.name} takes ${params.length} argument${params.length === 1 ? '' : 's'}, not ${e.args.length}`, e.loc);
 }
 e.args.forEach((a, k) => { expr(a); assignable(params[k], a, `argument ${k + 1} of ${e.name}`); });
 e.type = sym.type.ret;
 if (fn) fn.calls = true;
 break;
 }
 case 'list': throw err('an initialiser list { … } can only initialise an array', e.loc);
 default: throw err(`unexpected ${e.kind}`, e.loc);
 }
 fold(e);
 return e;
 }
 function binary(e) {
 expr(e.l); expr(e.r);
 const a = valueType(e.l.type);
 const b = valueType(e.r.type);
 const op = e.op;
 const ints = isInt(a) && isInt(b);
 const bad = () => err(`${op} cannot combine ${typeName(a)} and ${typeName(b)}`, e.loc.opLoc ?? e.loc);
 switch (op) {
 case '*': case '/': case '%': case '&': case '|': case '^':
 if (!ints) throw bad();
 e.ctype = common(a, b);
 e.type = e.ctype;
 break;
 case '<<': case '>>':
 if (!ints) throw bad();
 e.ctype = promote(a);
 e.type = e.ctype;
 break;
 case '+':
 if (ints) { e.ctype = common(a, b); e.type = e.ctype; } else if (isPtr(a) && isInt(b)) { e.type = a; e.scale = elem(a, e); } else if (isInt(a) && isPtr(b)) {
 [e.l, e.r] = [e.r, e.l];
 e.type = b;
 e.scale = elem(b, e);
 } else throw bad();
 break;
 case '-':
 if (ints) { e.ctype = common(a, b); e.type = e.ctype; } else if (isPtr(a) && isInt(b)) { e.type = a; e.scale = elem(a, e); } else if (isPtr(a) && isPtr(b) && same(a, b)) {
 e.type = T.int;
 e.diff = elem(a, e);
 } else throw bad();
 break;
 case '<': case '>': case '<=': case '>=': case '==': case '!=':
 if (ints) e.ctype = common(a, b);
 else if (isPtr(a) && isPtr(b) && same(a, b)) e.ctype = T.uint;
 else if ((isPtr(a) && isNull(e.r)) || (isPtr(b) && isNull(e.l))) {
 if (op !== '==' && op !== '!=') throw bad();
 e.ctype = T.uint;
 } else throw bad();
 e.type = T.int;
 break;
 case '&&': case '||':
 if (!isScalar(a) || !isScalar(b)) throw bad();
 e.type = T.int;
 break;
 default: throw bad();
 }
 }
 function elem(p, e) {
 if (p.to.kind === 'void') throw err('arithmetic on a void * pointer', e.loc);
 return sizeOf(p.to);
 }
 function assign(e) {
 expr(e.l); expr(e.r);
 const what = e.op;
 modifiable(e.l, what);
 const t = e.l.type;
 if (e.op === '=') {
 assignable(t, e.r, 'assignment');
 } else {
 const op = e.op.slice(0, -1);
 const b = valueType(e.r.type);
 if (isPtr(t) && (op === '+' || op === '-') && isInt(b)) e.scale = elem(t, e);
 else if (isInt(t) && isInt(b)) e.ctype = op === '<<' || op === '>>' ? promote(t) : common(t, b);
 else throw err(`${e.op} cannot combine ${typeName(t)} and ${typeName(b)}`, e.loc.opLoc ?? e.loc);
 }
 e.type = t;
 }
 function resolveType(t, loc) {
 if (t.kind === 'array') {
 const of = resolveType(t.of, loc);
 if (of.kind === 'void') throw err('an array of void', loc);
 let len = t.len;
 if (t.sizeExpr) {
 len = constInt(t.sizeExpr, 'the array size');
 if (signedOf(len) <= 0) throw err('the array size must be positive', t.sizeExpr.loc);
 }
 return { kind: 'array', of, len, const: t.const, volatile: t.volatile };
 }
 if (t.kind === 'ptr') return { ...t, to: resolveType(t.to, loc) };
 if (t.kind === 'func') return { ...t, ret: resolveType(t.ret, loc), params: t.params.map((p) => resolveType(p, loc)) };
 return t;
 }
 function staticInit(sym, init) {
 const t = sym.type;
 const item = (e, et) => {
 expr(e);
 assignable(et, e, `initialiser of ${sym.name}`);
 if (e.cv !== undefined && isInt(et)) return { value: toType(e.cv, et) };
 if (e.cv !== undefined && isPtr(et)) return { value: e.cv >>> 0 };
 const addr = addressConst(e);
 if (addr && isPtr(et)) return addr;
 throw err(`the initialiser of ${sym.name} must be a constant (a number, or the address of a global or static object)`, e.loc);
 };
 if (t.kind === 'array') {
 if (init.kind === 'str') {
 if (!(isInt(t.of) && t.of.size === 1)) throw err(`a string can initialise only a char array, not ${sym.name}`, init.loc);
 const bytes = [...init.bytes, 0];
 if (t.len === null) t.len = bytes.length;
 if (bytes.length - 1 > t.len) throw err(`the string is longer than ${sym.name}[${t.len}]`, init.loc);
 return bytes.slice(0, t.len).map((b) => ({ value: b }));
 }
 if (init.kind !== 'list') throw err(`array ${sym.name} needs an initialiser list { … } or a string`, init.loc);
 if (t.len === null) t.len = init.items.length;
 if (init.items.length > t.len) throw err(`too many initialisers for ${sym.name}[${t.len}]`, init.items[t.len].loc);
 return init.items.map((x) => item(x, t.of));
 }
 if (init.kind === 'list') {
 if (init.items.length !== 1) throw err(`${sym.name} is not an array; give one value`, init.loc);
 return [item(init.items[0], t)];
 }
 return [item(init, t)];
 }
 function addressConst(e) {
 if (e.kind === 'str') return { label: e.label, offset: 0 };
 if (e.kind === 'id' && e.type.kind === 'array' && e.sym.label) return { label: e.sym.label, offset: 0 };
 if (e.kind === 'unary' && e.op === '&' && e.e.kind === 'id' && e.e.sym.label) return { label: e.e.sym.label, offset: 0 };
 if (e.kind === 'cast' && isPtr(e.type)) return addressConst(e.e);
 return null;
 }
 function declareGlobal(d) {
 claimLabel(d.name, d.loc);
 const type = resolveType(d.type, d.loc);
 if (BUILTINS[d.name]) {
 if (d.kind === 'proto' && sameFunc(type, BUILTINS[d.name].type)) return lookup(d.name);
 throw err(`${d.name} is built in (it ${BUILTINS[d.name].note}); choose another name`, d.loc);
 }
 const prev = globals.get(d.name);
 if (d.kind === 'var') {
 if (prev) throw err(`${d.name} is already declared (line ${prev.loc.line})`, d.loc);
 if (type.kind === 'array' && type.len === null && !d.init) throw err(`the size of array ${d.name} is not given`, d.loc);
 const sym = { kind: 'var', name: d.name, type, storage: 'global', label: d.name, loc: d.loc };
 globals.set(d.name, sym);
 sym.init = d.init ? staticInit(sym, d.init) : null;
 data.push(sym);
 return null;
 }
 if (type.params.length > 8) throw err(`${d.name} has ${type.params.length} parameters; the subset passes at most 8, all in registers a0–a7`, d.loc);
 if (prev) {
 if (prev.kind !== 'func') throw err(`${d.name} is already declared as a variable (line ${prev.loc.line})`, d.loc);
 if (!sameFunc(prev.type, type)) throw err(`${d.name} is declared differently on line ${prev.loc.line}`, d.loc);
 if (d.kind === 'func' && prev.defined) throw err(`function ${d.name} is defined twice (first on line ${prev.loc.line})`, d.loc);
 if (d.kind === 'func') { prev.defined = true; prev.loc = d.loc; }
 return prev;
 }
 const sym = { kind: 'func', name: d.name, type, label: d.name, defined: d.kind === 'func', loc: d.loc };
 globals.set(d.name, sym);
 return sym;
 }
 const sameFunc = (a, b) => same(a.ret, b.ret) && a.params.length === b.params.length && a.params.every((p, k) => same(p, b.params[k]));
 function local(d) {
 const scope = scopes[scopes.length - 1];
 if (scope.has(d.name)) throw err(`${d.name} is already declared in this block (line ${scope.get(d.name).loc.line})`, d.loc);
 const type = resolveType(d.type, d.loc);
 if (d.storage === 'static') {
 claimLabel(d.name, d.loc);
 let label = `${fn.name}.${d.name}`;
 while (fn.staticLabels.has(label)) label += '_';
 fn.staticLabels.add(label);
 const sym = { kind: 'var', name: d.name, type, storage: 'static', label, loc: d.loc };
 if (type.kind === 'array' && type.len === null && !d.init) throw err(`the size of array ${d.name} is not given`, d.loc);
 sym.init = d.init ? staticInit(sym, d.init) : null;
 scope.set(d.name, sym);
 data.push(sym);
 return;
 }
 const sym = { kind: 'var', name: d.name, type, storage: 'local', loc: d.loc, id: fn.locals.length };
 if (d.init) {
 if (type.kind === 'array') {
 if (d.init.kind === 'str') {
 if (!(isInt(type.of) && type.of.size === 1)) throw err(`a string can initialise only a char array, not ${d.name}`, d.init.loc);
 if (type.len === null) type.len = d.init.bytes.length + 1;
 if (d.init.bytes.length > type.len) throw err(`the string is longer than ${d.name}[${type.len}]`, d.init.loc);
 } else if (d.init.kind === 'list') {
 if (type.len === null) type.len = d.init.items.length;
 if (d.init.items.length > type.len) throw err(`too many initialisers for ${d.name}[${type.len}]`, d.init.items[type.len].loc);
 d.init.items.forEach((x) => { expr(x); assignable(type.of, x, `initialiser of ${d.name}`); });
 } else throw err(`array ${d.name} needs an initialiser list { … } or a string`, d.init.loc);
 } else {
 const x = d.init.kind === 'list' && d.init.items.length === 1 ? d.init.items[0] : d.init;
 if (x.kind === 'list') throw err(`${d.name} is not an array; give one value`, x.loc);
 expr(x);
 assignable(type, x, `initialiser of ${d.name}`);
 d.init = x;
 }
 } else if (type.kind === 'array' && type.len === null) throw err(`the size of array ${d.name} is not given`, d.loc);
 d.sym = sym;
 fn.locals.push(sym);
 scope.set(d.name, sym);
 }
 function stmt(s) {
 switch (s.kind) {
 case 'block':
 scopes.push(new Map());
 s.items.forEach(stmt);
 scopes.pop();
 break;
 case 'decl': s.vars.forEach((d) => {
 if (d.kind === 'proto') throw err(`function ${d.name} must be declared outside other functions`, d.loc);
 local(d);
 }); break;
 case 'expr': expr(s.e); break;
 case 'if': cond(s.c); stmt(s.then); if (s.else) stmt(s.else); break;
 case 'while': cond(s.c); loops++; stmt(s.body); loops--; break;
 case 'do': loops++; stmt(s.body); loops--; cond(s.c); break;
 case 'for':
 scopes.push(new Map());
 if (s.init) stmt(s.init);
 if (s.c) cond(s.c);
 if (s.step) expr(s.step);
 loops++; stmt(s.body); loops--;
 scopes.pop();
 break;
 case 'switch': {
 expr(s.e);
 const t = valueType(s.e.type);
 if (!isInt(t)) throw err('switch needs an integer', s.e.loc);
 s.type = promote(t);
 s.cases = [];
 s.default = null;
 switches.push(s);
 stmt(s.body);
 switches.pop();
 break;
 }
 case 'case': {
 const sw = switches[switches.length - 1];
 if (!sw) throw err('case outside a switch', s.loc);
 const v = toType(constInt(s.value, 'a case value'), sw.type);
 const dup = sw.cases.find((c) => c.value === v);
 if (dup) throw err(`case ${signedOf(v)} appears twice in this switch (line ${dup.node.loc.line})`, s.loc);
 sw.cases.push({ node: s, value: v });
 stmt(s.stmt);
 break;
 }
 case 'default': {
 const sw = switches[switches.length - 1];
 if (!sw) throw err('default outside a switch', s.loc);
 if (sw.default) throw err(`a second default in this switch (the first on line ${sw.default.loc.line})`, s.loc);
 sw.default = s;
 stmt(s.stmt);
 break;
 }
 case 'break': if (!loops && !switches.length) throw err('break outside a loop or a switch', s.loc); break;
 case 'continue': if (!loops) throw err('continue outside a loop', s.loc); break;
 case 'return': {
 const ret = fn.sym.type.ret;
 if (s.e) {
 expr(s.e);
 if (ret.kind === 'void') throw err(`${fn.name} returns void; return gives no value here`, s.loc);
 assignable(ret, s.e, 'return value');
 } else if (ret.kind !== 'void') throw err(`${fn.name} returns ${typeName(ret)}; give a value: return …;`, s.loc);
 break;
 }
 case 'empty': break;
 default: throw err(`unexpected statement ${s.kind}`, s.loc);
 }
 }
 function cond(e) {
 expr(e);
 if (!isScalar(valueType(e.type))) throw err('a condition must be an integer or a pointer', e.loc);
 }
 for (const d of ast.decls) {
 if (d.kind === 'var') { declareGlobal(d); continue; }
 const sym = declareGlobal(d);
 if (d.kind !== 'func') continue;
 fn = { name: d.name, sym, node: d, locals: [], params: [], staticLabels: new Set(), calls: false };
 scopes.push(new Map());
 (d.params ?? []).forEach((p, k) => {
 if (!p.name) throw err(`parameter ${k + 1} of ${d.name} needs a name in the definition`, p.loc);
 if (scopes[0].has(p.name)) throw err(`two parameters are named ${p.name}`, p.loc);
 const ps = { kind: 'var', name: p.name, type: sym.type.params[k], storage: 'param', loc: p.loc, index: k };
 fn.params.push(ps);
 scopes[0].set(p.name, ps);
 });
 d.body.items.forEach(stmt);
 scopes.pop();
 funcs.push(fn);
 fn = null;
 }
 const main = globals.get('main');
 if (!main || main.kind !== 'func' || !main.defined) throw err('the program needs a function main: int main(void) { … }', { line: 1, col: 1 });
 if (!same(main.type.ret, T.int) || main.type.params.length) throw err('main must be declared int main(void)', main.loc);
 for (const f of used) {
 if (!f.defined) throw err(`function ${f.name} is declared but never defined`, f.loc);
 }
 return { funcs, data, strings, builtins: [...used].filter((f) => f.builtin).map((f) => f.name) };
}
