// P1-M8 (docs/architecture/pico2-p1m8-pio.md §4): the PIO model, driven through the bus as a program would, with programs from the
// module's own PIO assembler; and the assembler itself on the RP2350 datasheet's forms. Times are in clk_sys cycles.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Machine } from '../src/arch/pico2/soc/machine.js';
import { assemblePio, disassemblePio, pioHeader, pioCHeader } from '../src/arch/pico2/pio/asm.js';
import { descriptor } from '../src/arch/pico2/index.js';

const PIO = [0x50200000, 0x50300000, 0x50400000], SET = 0x2000, CLR = 0x3000;
const SM = (k, r) => 0xc8 + 0x18 * k + r; // CLKDIV 0, EXECCTRL 4, SHIFTCTRL 8, ADDR 0xc, INSTR 0x10, PINCTRL 0x14
const wr = (m, a, v) => m.bus.write32(a >>> 0, v | 0);
const rd = (m, a) => m.bus.read32(a >>> 0) >>> 0;
function tick(m, n) { const end = m.hart.ticks + n; while (m.hart.ticks < end) { const t = Math.min(end, m.deadline); m.hart.ticks = Math.max(m.hart.ticks, t); if (m.hart.ticks >= m.deadline) m.serviceDue(); if (m.deadline > end) { m.hart.ticks = end; break; } } }

/** A machine with IO, pads and the three PIO blocks out of reset. */
function machine() {
  const m = new Machine();
  wr(m, 0x40020000 + CLR, (1 << 6) | (1 << 9) | (1 << 11) | (1 << 12) | (1 << 13) | (1 << 2));
  return m;
}
/** Assemble one program and load it at address 0 of block b. */
function load(m, b, src, opts) {
  const r = assemblePio(src, opts);
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  const p = r.programs[0];
  p.words.forEach((w, i) => wr(m, PIO[b] + 0x48 + 4 * i, w));
  return p;
}
/** Give pins to block b (function 6 + b), pads out of isolation, input on. */
function pins(m, b, ...ns) { for (const n of ns) { wr(m, 0x40028000 + 8 * n + 4, 6 + b); wr(m, 0x40038000 + 4 + 4 * n + CLR, 0x180); wr(m, 0x40038000 + 4 + 4 * n + SET, 0x40); } }
const wrap = (p) => (p.wrap << 12) | (p.wrapTarget << 7);
/** The cycles of pin n's changes to 0/1 (from the pins' log). */
function edges(m, n) { const l = m.pins.log, out = []; for (let i = 0; i < l.pins.length; i++) if (l.pins[i] === n && l.states[i] <= 1) out.push([l.cycles[i], l.states[i]]); return out; }

test('set, side-set and delays: a square wave whose period is the instructions and their delays, exact to the cycle', () => {
  const m = machine();
  const p = load(m, 0, '.program sq\n.side_set 1 opt\n set pindirs, 1\n.wrap_target\n set pins, 1 [2]\n set pins, 0 side 0 [4]\n.wrap\n');
  pins(m, 0, 3, 4);
  wr(m, PIO[0] + SM(0, 0x14), (2 << 29) | (4 << 10) | (1 << 26) | (3 << 5)); // side-set: 2 bits (opt included) from GP4; SET 1 pin GP3
  wr(m, PIO[0] + SM(0, 4), wrap(p) | (1 << 30)); // SIDE_EN
  wr(m, PIO[0], 1);
  tick(m, 200);
  const e3 = edges(m, 3).filter((e) => e[1] === 1).map((e) => e[0]);
  assert.ok(e3.length > 10);
  for (let i = 2; i < e3.length; i++) assert.equal(e3[i] - e3[i - 1], 3 + 5, 'set [2] + nop [4]: 8 cycles per period');
  const e4 = edges(m, 4);
  assert.equal(e4.length, 0, 'GP4 never left 0 (its direction is input: side-set drives the level only)');
});

test('the clock divider: integer 3 gives an enable every 3 cycles; 2.5 alternates periods of 2 and 3 (first-order delta-sigma)', () => {
  for (const [int, frac, want] of [[3, 0, [6]], [2, 128, [5]]]) {
    const m = machine();
    const p = load(m, 0, '.program t\n set pindirs, 1\n.wrap_target\n set pins, 1\n set pins, 0\n.wrap\n');
    pins(m, 0, 5);
    wr(m, PIO[0] + SM(0, 0x14), (1 << 26) | (5 << 5));
    wr(m, PIO[0] + SM(0, 4), wrap(p));
    wr(m, PIO[0] + SM(0, 0), (int << 16) | (frac << 8));
    wr(m, PIO[0], 1);
    tick(m, 400);
    const r = edges(m, 5).filter((e) => e[1] === 1).map((e) => e[0]);
    const d = r.slice(1).map((v, i) => v - r[i]);
    assert.ok(d.every((x) => x === want[0]), `${int}.${frac}: ${d.join(',')}`);
    const hl = edges(m, 5).map((e) => e[0]), seg = hl.slice(1).map((v, i) => v - hl[i]).slice(2, 12);
    if (frac) assert.ok(seg.includes(2) && seg.includes(3), `2.5: ${seg}`);
  }
});

test('a count-down loop (jmp x-- to itself) takes (X + 1) x (1 + delay) cycles, skipped or not; a forced read in the middle sees the true X', () => {
  const m = machine();
  const p = load(m, 0, '.program cd\n set pindirs, 1\n.wrap_target\n pull block\n mov x, osr\n set pins, 1\nl: jmp x-- l [1]\n set pins, 0\n.wrap\n');
  pins(m, 0, 6);
  wr(m, PIO[0] + SM(0, 0x14), (1 << 26) | (6 << 5));
  wr(m, PIO[0] + SM(0, 4), wrap(p));
  wr(m, PIO[0], 1);
  tick(m, 10);
  wr(m, PIO[0] + 0x10, 1000); // TXF0
  tick(m, 100);
  // a forced `mov isr, x` + `push` in the loop: the X it holds now
  const c0 = edges(m, 6).find((e) => e[1] === 1)[0];
  tick(m, c0 + 2 * 300 + 1 - m.hart.ticks);
  wr(m, PIO[0] + SM(0, 0x10), 0xa0c1); // mov isr, x
  wr(m, PIO[0] + SM(0, 0x10), 0x8020); // push block
  const x = rd(m, PIO[0] + 0x20);
  assert.ok(x >= 699 && x <= 701, `X after 300 iterations of 1000: ${x}`);
  tick(m, 3000);
  const e = edges(m, 6);
  const hi = e.find((v) => v[1] === 1)[0], lo = e.find((v) => v[1] === 0 && v[0] > hi)[0];
  assert.equal(lo - hi, (1000 + 1) * 2 + 1, 'the loop and the set pins, 0 after it');
});

test('wait pin through the synchroniser (2 cycles) and with INPUT_SYNC_BYPASS (none); jmp pin', () => {
  for (const bypass of [0, 1]) {
    const m = machine();
    const p = load(m, 0, '.program w\n set pindirs, 1\n.wrap_target\n wait 1 pin 0\n set pins, 1\n wait 0 pin 0\n set pins, 0\n.wrap\n');
    pins(m, 0, 8, 9);
    wr(m, PIO[0] + SM(0, 0x14), (1 << 26) | (9 << 5) | (8 << 15)); // SET GP9, IN base GP8
    wr(m, PIO[0] + SM(0, 4), wrap(p));
    if (bypass) wr(m, PIO[0] + 0x38, 1 << 8);
    wr(m, PIO[0], 1);
    tick(m, 50);
    const t = m.hart.ticks;
    m.pins.drive(8, 1);
    tick(m, 20);
    const up = edges(m, 9).find((e) => e[1] === 1)[0];
    // the drive happens during cycle t: the SM sees it at t + 2 through the synchroniser (t + 1 bypassing it); the set runs one cycle later
    assert.equal(up - t, bypass ? 2 : 3, `bypass ${bypass}: the wait sees the pin, the set follows on the next cycle`);
  }
});

test('IRQ flags: set and wait between two state machines (seen on the next cycle), REL, the flags register and IRQ0_INTE to the interrupt line', () => {
  const m = machine();
  load(m, 0, '.program a\n.wrap_target\n irq wait 1 rel\n.wrap\n');
  wr(m, PIO[0] + SM(0, 4), 0);
  wr(m, PIO[0] + SM(1, 4), 0);
  wr(m, PIO[0] + 0x170, 0xf00); // IRQ0_INTE: flags 0-3
  wr(m, PIO[0], 3); // SM0 sets flag 1 (1 + 0), SM1 sets flag 2 (1 + 1), each waits
  tick(m, 5);
  assert.equal(rd(m, PIO[0] + 0x30), 0b110, 'flags 1 and 2');
  assert.equal(m.harts[0].irqc.irq[15], 1, 'PIO0_IRQ_0');
  assert.equal(rd(m, PIO[0] + SM(0, 0xc)), 0, 'SM0 waits at its irq wait');
  wr(m, PIO[0] + 0x30, 0b010); // clear flag 1: SM0 goes on, wraps and sets it again
  tick(m, 3);
  assert.equal(rd(m, PIO[0] + 0x30) & 2, 2);
  assert.equal(m.pio.blocks[0].sm[0].executed, 1, 'its irq wait completed once, then set the flag again and waits');
});

test('IRQ NEXT/PREV across blocks (RP2350): a state machine of PIO0 sets a flag of PIO1, one of PIO1 waits on it', () => {
  const m = machine();
  load(m, 0, '.program s\n.pio_version 1\n irq next set 5\nh: jmp h\n');
  load(m, 1, '.program w\n.pio_version 1\n wait 1 irq 5\n mov isr, ~null\n push\nh: jmp h\n');
  wr(m, PIO[1], 1);
  tick(m, 10);
  assert.equal(m.pio.blocks[1].sm[0].pc, 0, 'PIO1 SM0 waits');
  wr(m, PIO[0], 1);
  tick(m, 10);
  assert.equal(rd(m, PIO[1] + 0x20), 0xffffffff, 'PIO1 SM0 went on after PIO0 set its flag 5');
  assert.equal(rd(m, PIO[1] + 0x30) & 0x20, 0, 'wait 1 irq cleared the flag');
});

test('autopull and autopush at their thresholds, FIFO join (8 deep), FDEBUG TXOVER/RXUNDER, FSTAT and FLEVEL', () => {
  const m = machine();
  const p = load(m, 0, '.program pp\n.wrap_target\n out x, 8\n in x, 8\n.wrap\n');
  wr(m, PIO[0] + SM(0, 8), (1 << 17) | (1 << 16) | (8 << 25) | (16 << 20) | (1 << 19) | (1 << 18)); // autopull 8, autopush 16, both right
  wr(m, PIO[0] + SM(0, 4), wrap(p));
  wr(m, PIO[0], 1);
  wr(m, PIO[0] + 0x10, 0x11); wr(m, PIO[0] + 0x10, 0x22); wr(m, PIO[0] + 0x10, 0x33); wr(m, PIO[0] + 0x10, 0x44);
  tick(m, 50);
  // each word gives one byte (pull threshold 8); two bytes make one push (16 bits, shifted in from the left)
  assert.equal(rd(m, PIO[0] + 0x20), 0x22110000);
  assert.equal(rd(m, PIO[0] + 0x20), 0x44330000);
  rd(m, PIO[0] + 0x20);
  assert.equal(rd(m, PIO[0] + 0x8) & (1 << 8), 1 << 8, 'RXUNDER');
  wr(m, PIO[0], 0);
  wr(m, PIO[0] + SM(0, 8), 1 << 30); // join TX: 8 deep
  for (let i = 0; i < 9; i++) wr(m, PIO[0] + 0x10, i);
  assert.equal(rd(m, PIO[0] + 0xc) & 0xf, 8, 'FLEVEL TX0 = 8');
  assert.equal(rd(m, PIO[0] + 0x8) & (1 << 16), 1 << 16, 'TXOVER');
  assert.equal(rd(m, PIO[0] + 0x4) & ((1 << 16) | (1 << 8) | 1), (1 << 16) | (1 << 8) | 1, 'TX full; RX (joined away) both empty and full');
});

test('FJOIN_RX_PUT/GET (RP2350): mov rxfifo[], isr read by the system through RXF0_PUTGETn; mov osr, rxfifo[y]', () => {
  const m = machine();
  load(m, 0, '.program pg\n.pio_version 1\n set y, 2\n mov isr, ~null\n mov rxfifo[y], isr\n mov rxfifo[1], isr\nh: jmp h\n');
  wr(m, PIO[0] + SM(0, 8), (1 << 15) | (1 << 14));
  wr(m, PIO[0], 1);
  tick(m, 10);
  assert.equal(rd(m, PIO[0] + 0x128 + 8), 0xffffffff, 'PUTGET2');
  assert.equal(rd(m, PIO[0] + 0x128 + 4), 0xffffffff, 'PUTGET1');
  assert.equal(rd(m, PIO[0] + 0x128), 0, 'PUTGET0');
});

test('EXEC: out exec runs the shifted-out instruction next; an INSTR write that stalls is latched (EXEC_STALLED) until it completes', () => {
  const m = machine();
  load(m, 0, '.program e\n.wrap_target\n out exec, 16\n.wrap\n');
  wr(m, PIO[0] + SM(0, 8), (1 << 17) | (16 << 25) | (1 << 19));
  wr(m, PIO[0], 1);
  wr(m, PIO[0] + 0x10, 0xe03f); // set x, 31 as data
  tick(m, 10);
  assert.equal(m.pio.blocks[0].sm[0].x, 31);
  const m2 = machine();
  load(m2, 0, '.program h\nh: jmp h\n');
  wr(m2, PIO[0], 1);
  wr(m2, PIO[0] + SM(0, 0x10), 0x80a0); // pull block: the TX FIFO is empty
  assert.equal(rd(m2, PIO[0] + SM(0, 4)) >>> 31, 1, 'EXEC_STALLED');
  wr(m2, PIO[0] + 0x10, 0x1234);
  tick(m2, 5);
  assert.equal(rd(m2, PIO[0] + SM(0, 4)) >>> 31, 0);
  assert.equal(m2.pio.blocks[0].sm[0].osr, 0x1234);
});

test('MOV STATUS (TX level < N, and an IRQ flag on RP2350), MOV PINDIRS, and the DMA paced by the TX DREQ', () => {
  const m = machine();
  load(m, 0, '.program st\n.pio_version 1\n mov x, status\n mov pindirs, ~null\nh: jmp h\n');
  pins(m, 0, 10);
  wr(m, PIO[0] + SM(0, 0x14), (1 << 20) | 10); // OUT 1 pin from GP10
  wr(m, PIO[0] + SM(0, 4), (31 << 12) | (0 << 5) | 1); // wrap top 31 (as at reset); STATUS_SEL TX level, N = 1
  wr(m, PIO[0], 1);
  tick(m, 5);
  assert.equal(m.pio.blocks[0].sm[0].x, 0xffffffff, 'TX level 0 < 1');
  assert.equal(m.pins.padOe[10], 1, 'mov pindirs, ~null');
  const d = machine();
  const p = load(d, 0, '.program o\n.wrap_target\n out pins, 8\n.wrap\n');
  pins(d, 0, 0, 1, 2, 3, 4, 5, 6, 7);
  wr(d, PIO[0] + SM(0, 0x14), (8 << 20) | (5 << 26)); // OUT 8 pins from GP0; SET 5 pins from GP0
  wr(d, PIO[0] + SM(0, 8), (1 << 17) | (8 << 25) | (1 << 19));
  wr(d, PIO[0] + SM(0, 0x10), 0xe09f); // set pindirs, 31: GP0-4 outputs
  wr(d, PIO[0] + SM(0, 4), wrap(p));
  wr(d, PIO[0], 1);
  const src = 0x20001000;
  for (let i = 0; i < 4; i++) d.bus.write32(src + 4 * i, 0x10 + i);
  wr(d, 0x50000000, src); wr(d, 0x50000004, PIO[0] + 0x10); wr(d, 0x50000008, 4);
  wr(d, 0x5000000c, 1 | (2 << 2) | (1 << 4) | (0 << 17)); // EN, words, INCR_READ, TREQ 0 = PIO0 TX0
  tick(d, 200);
  assert.equal(d.dma.transfers, 4);
  const lv = d.pins.log; const vals = [];
  for (let i = 0; i < lv.pins.length; i++) if (lv.pins[i] === 4 && lv.states[i] === 1) vals.push(lv.cycles[i]);
  assert.ok(vals.length >= 1, 'bit 4 of 0x10..0x13 reached GP4');
});

test('save and load in the middle of PIO activity: the run from the checkpoint repeats exactly', () => {
  const run = (m) => { tick(m, 5000); return JSON.stringify(m.save(), (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)); };
  const m = machine();
  const p = load(m, 0, '.program cd\n set pindirs, 1\n.wrap_target\n pull noblock\n mov x, osr\n set pins, 1\nl: jmp x-- l [1]\n set pins, 0 [3]\n.wrap\n');
  pins(m, 0, 6);
  wr(m, PIO[0] + SM(0, 0x14), (1 << 26) | (6 << 5));
  wr(m, PIO[0] + SM(0, 4), wrap(p));
  wr(m, PIO[0] + SM(0, 0), (3 << 16) | (64 << 8));
  wr(m, PIO[0], 1);
  m.pio.blocks[0].sm[0].x = 37;
  tick(m, 1234);
  const snap = m.save();
  const a = run(m);
  m.load(snap);
  assert.equal(run(m), a);
});

test('the assembler: every instruction form of RP-001 §11.4 against its encoding; side-set rules; errors with lines', () => {
  const r = assemblePio(`.program all
.pio_version 1
.side_set 2 opt
    jmp !x 0 side 1
    jmp x-- 1 [3]
    jmp x!=y 2
    jmp pin 3
    jmp !osre 4
    wait 1 gpio 7
    wait 0 pin 3
    wait 1 irq 2 rel
    wait 1 irq prev 1
    wait 1 jmppin + 2
    in pins, 32
    out exec, 16
    push iffull noblock
    pull ifempty
    mov rxfifo[y], isr
    mov osr, rxfifo[3]
    mov pindirs, ~x
    mov x, ::status
    irq next wait 6
    irq clear 3 rel
    set pindirs, 31
    nop side 3 [3]
`);
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  assert.deepEqual(r.programs[0].words.map((w) => w.toString(16)),
    ['1420', '341', 'a2', 'c3', 'e4', '2087', '2023', '20d2', '20c9', '20e2', '4000', '60f0', '8040', '80e0', '8010', '809b', 'a069', 'a035', 'c03e', 'c053', 'e09f', 'bf42']);
  assert.equal(disassemblePio(0xbf42, 3, true), 'nop                    side 3 [3]');
  const bad = assemblePio('.program b\n.side_set 1\n set pins, 1\n nop side 1 [16]\n jmp nowhere\n');
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.diagnostics.map((d) => d.line), [3, 4, 5]);
  const h = pioHeader(assemblePio('.program blink\n.side_set 1\n.define PUBLIC T 7\npublic top: nop side 0\n% c-sdk {\nstatic int x;\n%}\n'));
  assert.match(h, /#define blink_T 7/); assert.match(h, /#define blink_offset_top 0u/); assert.match(h, /sm_config_set_sideset\(&c, 1, false, false\);/); assert.match(h, /static int x;/);
});

test('research D43 (Q3 B): a .pio file beside an assembly program: its words at <name>_program in the data section, its symbols; errors in its own file; pioasm\'s version 0', () => {
  const pio = { name: 'demo.pio', text: '; demo\n.define public PERIOD 7\n.program demo\n.side_set 1 opt\nstart:\n.wrap_target\n    set pins, 1 side 1\npublic loop:\n    jmp loop\n.wrap\n' };
  const main = { name: 'main.s', text: '_start: la a0, demo_program\n li a1, demo_length\n li a2, demo_offset_loop\n li a3, PERIOD\n ebreak\n' };
  const p = descriptor.language.assemble([main, pio]);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const r = assemblePio(pio.text);
  const at = p.symbols.demo_program;
  assert.equal(at % 2, 0);
  assert.ok(p.segments.some((g) => !g.executable && at >= g.address && at < g.address + g.bytes.length), 'in the data section');
  const seg = p.segments.find((g) => !g.executable);
  assert.deepEqual([0, 1].map((k) => seg.bytes[at - seg.address + 2 * k] | (seg.bytes[at - seg.address + 2 * k + 1] << 8)), r.programs[0].words);
  assert.deepEqual([p.symbols.demo_length, p.symbols.demo_wrap_target, p.symbols.demo_wrap, p.symbols.demo_sideset_bits, p.symbols.demo_sideset_opt, p.symbols.demo_offset_loop, p.symbols.PERIOD],
    [2, 0, 1, 2, 1, 1, 7]);
  // an error in the .pio file is located there, at its own line
  const e = descriptor.language.assemble([main, { name: 'demo.pio', text: '.program demo\n    set pins, 99\n' }]);
  assert.ok(!e.ok);
  assert.ok(e.diagnostics.some((d) => d.file === 'demo.pio' && d.line === 2), JSON.stringify(e.diagnostics));
  // read as pioasm reads it: an RP2350 addition needs .pio_version 1
  const v = (head) => descriptor.language.assemble([{ name: 'v.pio', text: `${head}.program v\n    mov rxfifo[0], isr\n` }]);
  assert.ok(!v('').ok);
  assert.ok(v('.pio_version 1\n').ok, JSON.stringify(v('.pio_version 1\n').diagnostics));
  // the .pio_program blocks of P1-M8 are gone (D43): an unknown directive
  assert.ok(!descriptor.language.assemble([{ name: 'x.s', text: '.pio_program a\n nop\n.end_pio\n' }]).ok);
});

test('research D43 (Q3 B): MAVILERA C includes "<file>.pio.h", generated from the .pio file at each build; without the file, a hint', async () => {
  const pio = { name: 'my-prog.pio', text: '.program counter\n    pull block\n    mov x, ~osr\n    push block\n' };
  const h = pioCHeader(assemblePio(pio.text), pio.name);
  assert.match(h, /^#define counter_length 3$/m);
  assert.match(h, /^#define counter_wrap_target 0$/m);
  assert.match(h, /^#define counter_wrap 2$/m);
  assert.match(h, /^uint16_t counter_program\[3\] = \{$/m);
  const cc = await descriptor.language.extraLanguages.find((x) => x.id === 'c').load();
  const src = '#include <rp2350.h>\n#include "my-prog.pio.h"\nint main(void) { return counter_program[counter_length - 1] + counter_wrap; }\n';
  const ok = cc.compile(src, { name: 'main.c', companions: [pio] });
  assert.ok(ok.ok, JSON.stringify(ok.diagnostics));
  const bad = cc.compile(src, { name: 'main.c', companions: [{ name: 'my-prog.pio', text: '.program counter\n    bogus\n' }] });
  assert.ok(!bad.ok);
  assert.equal(bad.diagnostics[0].file, 'my-prog.pio');
  assert.equal(bad.diagnostics[0].line, 2);
  const none = cc.compile(src, { name: 'main.c', companions: [] });
  assert.ok(!none.ok);
  assert.match(none.diagnostics[0].note, /Add PIO file/);
});
