// pico2-full.test.mjs -- the Pico Full build pieces (pico2 P1-F2, research D33): the SDK pack format, the driver's
// templates and precompiled-header rule, the diagnostics parser; and, when the compiler and a pack are present
// (PICO_FULL_WORK with build/llvm.wasm and out/manifest.json, made by tools/pico-full), real builds through the compiler
// host: a program, several files with a header and assembly, compile errors in two files, a link error, and that a
// rebuild never sees the files of the previous one. Those are skipped, with the reason, without the compiler.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { writePack, readPack, PackError } from '../src/arch/pico2/full/pack.js';
import { expand, startsWithPchHeader, chooseSet, setOf, includesHeader, PACK_SETS } from '../src/arch/pico2/full/driver.js';
import { parseDiagnostics, locate } from '../src/arch/pico2/full/diagnostics.js';
import { MemFS, normalise } from '../src/arch/pico2/full/wasi.js';
import { CompilerHost } from '../src/arch/pico2/full/host.js';

const te = new TextEncoder();

test('pack: write then read gives the meta and every file; other bytes are refused', () => {
  const files = [['/pico/a.h', te.encode('#define A 1\n')], ['/pico/lib/x.o', new Uint8Array([1, 2, 3])], ['/pico/empty', new Uint8Array(0)]];
  const bytes = writePack({ templates: { c: ['clang'] } }, files);
  const { meta, files: back } = readPack(bytes);
  assert.deepEqual(meta, { templates: { c: ['clang'] } });
  assert.deepEqual([...back.keys()], files.map(([p]) => p));
  for (const [p, d] of files) assert.deepEqual([...back.get(p)], [...d]);
  assert.throws(() => readPack(te.encode('PK\x03\x04 not a pack')), PackError);
  const v2 = bytes.slice(); new DataView(v2.buffer).setUint32(4, 2, true);
  assert.throws(() => readPack(v2), /format 2/);
  assert.throws(() => readPack(bytes.subarray(0, bytes.length - 2)), /damaged/);
});

test('driver: templates expand whole-argument placeholders and the object list; a missing value is an error', () => {
  assert.deepEqual(expand(['clang', '-cc1', '-o', '{obj}', '-main-file-name', '{name}', '{src}'], { obj: '/b/a.o', name: 'a.c', src: '/project/a.c' }),
    ['clang', '-cc1', '-o', '/b/a.o', '-main-file-name', 'a.c', '/project/a.c']);
  assert.deepEqual(expand(['ld.lld', '{objs}', '/pico/lib/base/x.o', '-o', '{out}'], { objs: ['/b/1.o', '/b/2.o'], out: '/b/p.elf' }),
    ['ld.lld', '/b/1.o', '/b/2.o', '/pico/lib/base/x.o', '-o', '/b/p.elf']);
  assert.throws(() => expand(['{src}'], {}), /needs \{src\}/);
});

test('driver: the precompiled header is used only when the first directive includes its header', () => {
  const H = 'pico/stdlib.h';
  assert.ok(startsWithPchHeader('#include "pico/stdlib.h"\nint main(void){}', H));
  assert.ok(startsWithPchHeader('// blink\n/* a\n comment */\n#include <pico/stdlib.h>\n', H));
  assert.ok(startsWithPchHeader('#  include "pico/stdlib.h"  // first\n', H));
  assert.ok(!startsWithPchHeader('#include <stdio.h>\n#include "pico/stdlib.h"\n', H), 'another include first');
  assert.ok(!startsWithPchHeader('#define LED 25\n#include "pico/stdlib.h"\n', H), 'a define first changes the header');
  assert.ok(!startsWithPchHeader('int x;\n', H));
});

// P1-R4 (research D58): the object set follows the project option (stdio) and whether a project file includes pico/multicore.h
test('driver: the object set follows the stdio option and an include of pico/multicore.h; comments do not count', () => {
  const meta = { sets: Object.fromEntries(PACK_SETS.map((s) => [s, { templates: { c: [s] }, pch: null }])) };
  const f = (text, name = 'main.c') => [{ name, text }];
  assert.deepEqual(chooseSet(meta, f('#include "pico/stdlib.h"\n')), { id: 'uart', stdio: 'uart', multicore: false });
  assert.deepEqual(chooseSet(meta, f('#include "pico/stdlib.h"\n'), { stdio: 'usb' }), { id: 'usb', stdio: 'usb', multicore: false });
  assert.equal(chooseSet(meta, f('#include "pico/multicore.h"\n')).id, 'uart_mc');
  assert.equal(chooseSet(meta, f('  #  include <pico/multicore.h>\n'), { stdio: 'usb' }).id, 'usb_mc');
  assert.equal(chooseSet(meta, [{ name: 'main.c', text: 'int main(void){}' }, { name: 'cores.h', text: '#include "pico/multicore.h"\n' }]).id, 'uart_mc', 'a project header counts');
  assert.equal(chooseSet(meta, f('// #include "pico/multicore.h"\n/* #include "pico/multicore.h" */\n')).id, 'uart', 'commented out');
  assert.equal(chooseSet(meta, f('#include "pico/multicore.h"\n', 'notes.txt')).id, 'uart', 'not a source file');
  assert.equal(chooseSet(meta, f('#include "pico/multicore_extra.h"\n')).id, 'uart');
  assert.equal(chooseSet(meta, f(''), { stdio: 'radio' }).stdio, 'uart', 'an unknown option falls back to UART');
  // a pack from before P1-R4: only the default set
  const old = { templates: { c: ['old'] }, pch: { path: '/p' } };
  assert.equal(chooseSet(old, f('')).id, 'uart');
  assert.equal(chooseSet(old, f(''), { stdio: 'usb' }).id, null);
  assert.equal(chooseSet(old, f('#include "pico/multicore.h"\n')).id, null);
  assert.deepEqual(setOf(old).templates.c, ['old']);
  assert.throws(() => setOf(old, 'usb'), /no object set usb/);
  assert.deepEqual(setOf(meta, 'usb_mc').templates.c, ['usb_mc']);
  assert.ok(includesHeader('#include "pico/multicore.h"', 'pico/multicore.h'));
  assert.ok(!includesHeader('x = "#include \\"pico/multicore.h\\"";', 'pico/multicore.h'), 'not at the start of a line');
});

test('pack builder: Windows command lines split as the C runtime does (quotes inside an argument, escaped quotes)', async () => {
  const { tok } = await import('../tools/pico-full/cmdline.mjs');
  assert.deepEqual(tok('clang.exe -DPICO_BOARD=\\"pico2\\" -DPICO_PROGRAM_BUILD_DATE="\\"Nov 15 2026\\"" -I C:\\a\\b  "C:\\x y\\z.c"'),
    ['clang.exe', '-DPICO_BOARD="pico2"', '-DPICO_PROGRAM_BUILD_DATE="Nov 15 2026"', '-I', 'C:\\a\\b', 'C:\\x y\\z.c']);
  assert.deepEqual(tok('a\\\\\\"b c\\\\"d e" ""'), ['a\\"b', 'c\\d e', '']);
});

test('diagnostics: clang errors in project files and SDK headers, notes, lld undefined symbols', () => {
  const clang = [
    'In file included from /project/main.c:2:',
    '/project/util.h:3:5: error: unknown type name \'uint\'',
    '    3 | int uint x;',
    '      |     ^',
    '/project/main.c:7:12: warning: unused variable \'n\' [-Wunused-variable]',
    '/pico/sdk/src/rp2_common/hardware_gpio/include/hardware/gpio.h:40:1: note: \'gpio_init\' declared here',
    '/project/main.c:1:10: fatal error: \'hardware/pwmx.h\' file not found',
    '2 errors generated.',
  ].join('\n');
  assert.deepEqual(parseDiagnostics(clang), [
    { file: 'util.h', path: 'util.h', line: 3, col: 5, severity: 'error', message: 'unknown type name \'uint\'' },
    { file: 'main.c', path: 'main.c', line: 7, col: 12, severity: 'warning', message: 'unused variable \'n\' [-Wunused-variable]' },
    { file: null, path: 'hardware/gpio.h', line: 40, col: 1, severity: 'note', message: '\'gpio_init\' declared here' },
    { file: 'main.c', path: 'main.c', line: 1, col: 10, severity: 'error', message: '\'hardware/pwmx.h\' file not found' },
  ]);
  const lld = [
    'ld.lld: error: undefined symbol: blink_led',
    '>>> referenced by main.c:9 (/project/main.c:9)',
    '>>>               /build/main.c.o:(main)',
    'ld.lld: error: undefined symbol: helper',
    '>>> referenced by /build/b.S.o:(.text+0x4)',
  ].join('\n');
  assert.deepEqual(parseDiagnostics(lld), [
    { file: 'main.c', path: 'main.c', line: 9, col: null, severity: 'error', message: 'undefined symbol: blink_led' },
    { file: null, path: null, line: null, col: null, severity: 'error', message: 'undefined symbol: helper' },
  ]);
  assert.deepEqual(locate('/pico/sysroot/include/stdio.h'), { file: null, path: 'stdio.h' });
});

test('in-memory file system: files make their folders; list, rename, unlink', () => {
  const fs = new MemFS();
  fs.addFile('/a/b/c.txt', te.encode('x'));
  assert.deepEqual(fs.stat('/a/b'), { type: 'dir', size: 0 });
  assert.deepEqual(fs.list('/a'), ['b']);
  assert.ok(fs.rename('/a/b/c.txt', '/a/d.txt'));
  assert.deepEqual(fs.list('/a').sort(), ['b', 'd.txt']);
  assert.ok(fs.unlink('/a/d.txt'));
  assert.equal(fs.stat('/a/d.txt'), null);
  assert.equal(normalise('/a/./b/../c/'), '/a/c');
});

// ---- real builds (need the compiler and a pack) ----
const W = process.env.PICO_FULL_WORK;
const manifest = W && existsSync(join(W, 'out', 'manifest.json')) ? JSON.parse(readFileSync(join(W, 'out', 'manifest.json'), 'utf8')) : null;
const ready = Boolean(manifest && existsSync(join(W, 'build', 'llvm.wasm')) && existsSync(join(W, 'out', manifest.sdkPack.file)));
const SKIP = ready ? false : 'needs PICO_FULL_WORK with build/llvm.wasm and an SDK pack (tools/pico-full)';
let host = null;
async function getHost() {
  host ??= new CompilerHost({ module: await WebAssembly.compile(readFileSync(join(W, 'build', 'llvm.wasm'))), pack: new Uint8Array(readFileSync(join(W, 'out', manifest.sdkPack.file))) });
  return host;
}
const isElf = (b) => b && b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46;
const HELLO = '#include "pico/stdlib.h"\n#include <stdio.h>\n\nint main(void) {\n    stdio_init_all();\n    printf("hello\\n");\n    return 0;\n}\n';

test('build: a program with the precompiled header gives an ELF', { skip: SKIP }, async () => {
  const h = await getHost();
  const r = await h.build([{ name: 'main.c', text: HELLO }]);
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  assert.ok(isElf(r.elf));
  assert.ok(r.pch, 'the precompiled header was prepared');
  assert.deepEqual(r.log.map((j) => j.step), ['compile (precompiled header)', 'link']);
  assert.deepEqual(r.diagnostics, []);
});

test('build: C files, a header and an assembly file link together; .txt and .md files are left out', { skip: SKIP }, async () => {
  const h = await getHost();
  const r = await h.build([
    { name: 'main.c', text: '#include "pico/stdlib.h"\n#include "util.h"\nint main(void) { return twice(add3(1)); }\n' },
    { name: 'util.h', text: 'int twice(int x);\nint add3(int x);\n' },
    { name: 'util.c', text: '#include "util.h"\nint twice(int x) { return 2 * x; }\n' },
    { name: 'add3.S', text: '.text\n.global add3\nadd3:\n    addi a0, a0, 3\n    ret\n' },
    { name: 'notes.md', text: '# not built' },
  ]);
  assert.ok(r.ok, JSON.stringify(r.diagnostics) + r.log.map((j) => j.stderr).join(''));
  assert.deepEqual(r.log.map((j) => `${j.file ?? '-'} ${j.step}`), ['main.c compile (precompiled header)', 'util.c compile', 'add3.S preprocess', 'add3.S assemble', '- link']);
});

// P1-M8 (design Q5): a .pio file becomes its header before the build (the module's PIO assembler, as pico_generate_pio_header), the
// SDK's hardware_pio loads it, and the simulator runs it: the state machine toggles GP25 at the rate the program and divider give
test('build: a .pio file in a project becomes <file>.pio.h for the C files; the built program runs its state machine', { skip: SKIP }, async () => {
  const { withPioHeaders } = await import('../src/arch/pico2/pio/asm.js');
  const pio = '.program tick\n.side_set 1\n.wrap_target\n    nop side 1 [15]\n    nop side 0 [15]\n.wrap\n% c-sdk {\nstatic inline void tick_init(PIO pio, uint sm, uint offset, uint pin, float div) {\n'
    + '    pio_sm_config c = tick_program_get_default_config(offset);\n    sm_config_set_sideset_pins(&c, pin);\n    sm_config_set_clkdiv(&c, div);\n'
    + '    pio_gpio_init(pio, pin);\n    pio_sm_set_consecutive_pindirs(pio, sm, pin, 1, true);\n    pio_sm_init(pio, sm, offset, &c);\n    pio_sm_set_enabled(pio, sm, true);\n}\n%}\n';
  const main = '#include "pico/stdlib.h"\n#include "hardware/pio.h"\n#include "tick.pio.h"\nint main(void) {\n    uint offset = pio_add_program(pio0, &tick_program);\n'
    + '    tick_init(pio0, 0, offset, 25, 150.f);\n    while (true) tight_loop_contents();\n}\n';
  const pr = withPioHeaders([{ name: 'main.c', text: main }, { name: 'tick.pio', text: pio }]);
  assert.ok(pr.ok, JSON.stringify(pr.diagnostics));
  assert.deepEqual(pr.files.map((x) => x.name), ['main.c', 'tick.pio.h']);
  const h = await getHost();
  const r = await h.build(pr.files);
  assert.ok(r.ok, JSON.stringify(r.diagnostics) + r.log.map((j) => j.stderr).join(''));
  const { descriptor } = await import('../src/arch/pico2/index.js');
  const program = descriptor.language.loadImage(r.elf, 'elf', 'main.elf');
  const e = descriptor.engine.create(program, { runLimit: Infinity });
  while (e.clock().timeNs < 3e6) e.advance({ cycles: 500_000 });
  const m = e.machine, l = m.pins.log, t = [];
  for (let i = 0; i < l.pins.length; i++) if (l.pins[i] === 25 && l.states[i] <= 1) t.push(l.cycles[i]);
  const d = t.slice(2).map((v, i) => v - t[i + 1]);
  assert.ok(d.length > 10, `${d.length} changes of GP25`);
  assert.ok(d.every((x) => x === 16 * 150), `half periods ${[...new Set(d)].join(',')} cycles (16 state machine cycles of 150)`);
});

test('build: compile errors in two files are all reported with file and line; nothing is linked', { skip: SKIP }, async () => {
  const h = await getHost();
  const r = await h.build([
    { name: 'main.c', text: '#include "pico/stdlib.h"\nint main(void) {\n    gpio_init(25)\n    return 0;\n}\n' },
    { name: 'util.c', text: 'int f(void) {\n  return undeclared_name;\n}\n' },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'compile');
  const errors = r.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.file}:${d.line}`);
  assert.deepEqual(errors, ['main.c:3', 'util.c:2']);
  assert.ok(!r.log.some((j) => j.step === 'link'));
});

test('build: an undefined function is a link error located where it is called', { skip: SKIP }, async () => {
  const h = await getHost();
  const r = await h.build([{ name: 'main.c', text: '#include "pico/stdlib.h"\nvoid blink_led(void);\nint main(void) {\n    blink_led();\n    return 0;\n}\n' }]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'link');
  assert.deepEqual(r.diagnostics.map((d) => [d.severity, d.message, d.file, d.line]), [['error', 'undefined symbol: blink_led', 'main.c', 4]]);
});

test('build: a rebuild does not see the previous build\'s files', { skip: SKIP }, async () => {
  const h = await getHost();
  assert.ok((await h.build([{ name: 'main.c', text: HELLO }, { name: 'extra.c', text: 'int extra = 1;\n' }])).ok);
  const r = await h.build([{ name: 'main.c', text: '#include "extra.h"\nint main(void) { return 0; }\n' }]);
  assert.equal(r.ok, false);
  assert.ok(!h.fs.stat('/build/extra.c.o'), 'old object removed');
  assert.ok(!h.fs.stat('/project/extra.c'), 'old source removed');
});

// ---- P1-R4 (research D58): the object sets (need a pack with sets) ----
const SETS_SKIP = SKIP || (!manifest?.sets ? 'needs an SDK pack with object sets (P1-R4)' : false);
/** Runs a built ELF on the model for `ms` of simulated time; returns {text: UART0's output, engine}. */
async function runElf(elf, ms) {
  const { descriptor } = await import('../src/arch/pico2/index.js');
  const e = descriptor.engine.create(descriptor.language.loadImage(elf, 'elf', 'main.elf'), { runLimit: Infinity });
  // stops when the engine stops (an error such as a ROM function it does not model) instead of waiting for time that never comes
  for (let last = -1; e.clock().timeNs < ms * 1e6 && e.clock().timeNs !== last;) { last = e.clock().timeNs; e.advance({ cycles: 500_000 }); }
  assert.equal(e.state().error ?? null, null, 'the program runs without an engine error');
  return { text: e.machine.uart[0].text(), engine: e };
}
const TICKS = '#include <stdio.h>\n#include "pico/stdlib.h"\nint main(void) {\n    stdio_init_all();\n    for (int i = 0; i < 3; i++) { printf("tick %d\\n", i); sleep_ms(5); }\n    puts("done");\n    for (;;) tight_loop_contents();\n}\n';

test('sets: a project including pico/multicore.h builds with uart_mc and both cores print', { skip: SETS_SKIP }, async () => {
  const h = await getHost();
  const src = '#include <stdio.h>\n#include "pico/stdlib.h"\n#include "pico/multicore.h"\nvoid core1(void) { printf("core 1 says %d\\n", (int)multicore_fifo_pop_blocking()); for (;;) tight_loop_contents(); }\n'
    + 'int main(void) {\n    stdio_init_all();\n    multicore_launch_core1(core1);\n    multicore_fifo_push_blocking(42);\n    sleep_ms(5);\n    puts("core 0 done");\n    for (;;) tight_loop_contents();\n}\n';
  const r = await h.build([{ name: 'main.c', text: src }]);
  assert.ok(r.ok, JSON.stringify(r.diagnostics) + r.log.map((j) => j.stderr).join(''));
  assert.deepEqual(r.set, { id: 'uart_mc', stdio: 'uart', multicore: true });
  const { text } = await runElf(r.elf, 20);
  assert.match(text, /core 1 says 42/);
  assert.match(text, /core 0 done/);
});

test('sets: the option "UART and USB" builds with TinyUSB; on the model the UART output equals the UART-only build\'s', { skip: SETS_SKIP }, async () => {
  const h = await getHost();
  const uart = await h.build([{ name: 'main.c', text: TICKS }]);
  const usb = await h.build([{ name: 'main.c', text: TICKS }], { stdio: 'usb' });
  assert.ok(uart.ok && usb.ok, JSON.stringify(usb.diagnostics) + usb.log.map((j) => j.stderr).join(''));
  assert.equal(uart.set.id, 'uart');
  assert.equal(usb.set.id, 'usb');
  assert.ok(usb.elf.length > uart.elf.length, 'TinyUSB and the USB stdio driver are linked');
  const a = await runElf(uart.elf, 40), b = await runElf(usb.elf, 40);
  assert.equal(a.text, 'tick 0\r\ntick 1\r\ntick 2\r\ndone\r\n');
  assert.equal(b.text, a.text, 'TinyUSB does not hang the program or change its UART output');
});

test('sets: pico_status_led links from the pack (its pioasm-generated header included)', { skip: SETS_SKIP }, async () => {
  const h = await getHost();
  const r = await h.build([{ name: 'main.c', text: '#include "pico/stdlib.h"\n#include "pico/status_led.h"\nint main(void) {\n    status_led_init();\n    for (int i = 0; i < 4; i++) { status_led_set_state(i & 1); sleep_ms(1); }\n    for (;;) tight_loop_contents();\n}\n' }]);
  assert.ok(r.ok, JSON.stringify(r.diagnostics) + r.log.map((j) => j.stderr).join(''));
  const { engine } = await runElf(r.elf, 10);
  const l = engine.machine.pins.log;
  let n = 0;
  for (let i = 0; i < l.pins.length; i++) if (l.pins[i] === 25 && l.states[i] <= 1) n++;
  assert.ok(n >= 3, `GP25 changed ${n} times`);
});

test('sets: the pack\'s fixed build date is in binary info', { skip: SETS_SKIP }, async () => {
  const h = await getHost();
  const r = await h.build([{ name: 'main.c', text: HELLO }]);
  assert.ok(manifest.buildDate && /^[A-Z][a-z]{2} [ 123]\d \d{4}$/.test(manifest.buildDate), manifest.buildDate);
  assert.ok(Buffer.from(r.elf).includes(Buffer.from(`${manifest.buildDate}\0`)), 'the date string is in the image');
});
