// minify.test.mjs -- the release copy of the sources (tools/minify.mjs, WS-N-004): comments, indentation and
// blank lines go; strings, template literals, regular expressions, line breaks and the copyright lines stay; every
// shipped module still parses and the shipped JSON round-trips. The whole suite on a minified copy is
// tools/minify.mjs --check-suite, run by tools/verify.mjs.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { stripJs, stripCss, minify } from '../tools/minify.mjs';
import { ROOT, shippedFiles } from '../tools/site-files.mjs';

test('JavaScript: comments and indentation go, the copyright and rights lines stay', () => {
  const src = '// head -- what it is\n// Copyright (c) 2026 A. Licensed.\n// Rights class: code.\n\n/** doc\n * more */\nfunction f(a, b) {\n    return a + b; // sum\n}\n';
  assert.equal(stripJs(src), '// Copyright (c) 2026 A. Licensed.\n// Rights class: code.\nfunction f(a, b) {\n return a + b;\n}\n');
});

test('JavaScript: strings, template literals, regular expressions and statement-ending line breaks keep their meaning', () => {
  // each program computes a value; the minified program must compute the same
  const programs = [
    "const s = '// not a comment'; return s;",
    'const a = 1, b = 2; return `line 1\n    indented // kept ${a + `inner ${b}`} /* kept */`;',
    "const s = '// x'; return [/\\/\\/ [/*]+ x/g.test(s), /[/]/.source];",
    'const a = 8, b = 2, c = 2; return a / b / c;',
    'const f = (x) => { if (x) return /a  b/.source; return 0; }; return f(1);',
    'return "a\\"b // c";',
    'let x = 1, y = 1, z = 2\nx = y\n++z\nreturn [x, z];',
    'const o = { a: 1 } /* c */ ; return o.a; // tail',
  ];
  for (const p of programs) {
    const run = (code) => JSON.stringify(vm.runInNewContext(`(() => {\n${code}\n})()`)); // values of another realm
    assert.equal(run(stripJs(p)), run(p), p);
  }
});

test('CSS: comments and spaces go; a space before a colon and strings stay', () => {
  const src = '/* theme\n  Copyright (c) 2026 A.\n*/\n.a :hover,\n.b > .c {\n  content: "/* x */  y";\n  margin: 0 1px;\n}\n';
  assert.equal(stripCss(src), '/* Copyright (c) 2026 A. */\n.a :hover,.b>.c{content:"/* x */  y";margin:0 1px;}\n');
});

test('JSON is written without spaces; other files are unchanged', () => {
  assert.equal(minify('a.json', '{\n "a": [1, 2],\n "b": "c d"\n}\n'), '{"a":[1,2],"b":"c d"}\n');
  assert.equal(minify('a.s', '  addi x1, x0, 1 # c\n'), '  addi x1, x0, 1 # c\n');
});

test('every shipped JavaScript module minifies and still parses as a module; the shipped JSON round-trips', () => {
  const modules = {};
  let before = 0;
  let after = 0;
  for (const p of shippedFiles()) {
    const text = readFileSync(join(ROOT, p), 'utf8');
    if (p.endsWith('.js')) {
      const out = minify(p, text);
      before += text.length;
      after += out.length;
      assert.match(out, /Copyright \(c\) 2026 Sajid Muhaimin Choudhury/, `${p}: the copyright line`);
      assert.equal(minify(p, out), out, `${p}: minified twice is minified once`);
      modules[p] = out;
    } else if (p.endsWith('.json')) {
      assert.deepEqual(JSON.parse(minify(p, text)), JSON.parse(text), p);
    }
  }
  assert.ok(after <= before, `${before} -> ${after}`); // (the sources already minified: tools/minify.mjs --check-suite)
  // parsed, not run: a vm.SourceTextModule per file in a child process (the API needs a flag)
  const check = `const vm = require('node:vm'); let t = ''; process.stdin.on('data', (d) => { t += d; }).on('end', () => {
    const bad = []; for (const [p, code] of Object.entries(JSON.parse(t))) { try { new vm.SourceTextModule(code); } catch (e) { bad.push(p + ': ' + e.message); } }
    process.stdout.write(JSON.stringify(bad)); });`;
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '-e', check], { input: JSON.stringify(modules), encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [], 'modules that no longer parse');
});
