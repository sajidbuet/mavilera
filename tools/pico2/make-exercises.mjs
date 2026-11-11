// tools/pico2/make-exercises.mjs -- writes the Pico 2 practice exercises (WS-F-148; P1-M9, research D45 Q4-Q5) to
// content/pico2/exercises/: the task, a starter that builds and fails the tests, and tests whose expected values are worked out
// here in JavaScript (not by running a solution). No solution is written to content/; the model solutions the tests run live in
// test/fixtures/exercise-solutions/pico2/ and are not published.
//
//   node tools/pico2/make-exercises.mjs
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'content', 'pico2', 'exercises');
const COPYRIGHT = 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: content (Apache-2.0). '
  + 'A practice exercise written for MAVILERA (spec WS-F-148, roadmap P1-M9), not taken from a textbook; produced by tools/pico2/make-exercises.mjs.';
const u32 = (v) => v >>> 0;
const popcount = (v) => { let n = 0; for (let x = v >>> 0; x; x &= x - 1) n++; return n; };

/** The start-up of an assembly exercise that needs the clocks: the crystal, clk_sys as chosen (CLK_SYS_DIV), TIMER0 at 1 µs. */
const CLOCK_START = `_start: li      t0, 0x40048000          # XOSC
        li      t1, 47
        sw      t1, 12(t0)              # STARTUP: about 1 ms
        li      t1, 0x00fabaa0
        sw      t1, 0(t0)               # CTRL: ENABLE, 1-15 MHz
xosc:   lw      t1, 4(t0)
        bgez    t1, xosc
        li      t0, 0x40010000          # CLOCKS
        li      t1, 2
        sw      t1, 0x30(t0)            # CLK_REF_CTRL: clk_ref from the crystal
ref:    lw      t1, 0x38(t0)
        andi    t1, t1, 4
        beqz    t1, ref
        li      t1, CLK_SYS_DIV
        sw      t1, 0x40(t0)            # CLK_SYS_DIV: the chosen clk_sys
        li      t1, 0x40
        sw      t1, 0x3c(t0)            # CLK_SYS_CTRL: clk_sys from clk_ref
sys:    lw      t1, 0x44(t0)
        andi    t1, t1, 1
        beqz    t1, sys
        li      t0, 0x40023000          # RESETS, clear alias
        li      t1, 0x00800a40          # bits 23 TIMER0, 11 PIO0, 9 PADS_BANK0, 6 IO_BANK0
        sw      t1, 0(t0)
        li      t0, 0x40020000
done:   lw      t2, 8(t0)
        and     t2, t2, t1
        bne     t2, t1, done
        li      t0, 0x40108000          # TICKS
        li      t1, TICK_CYCLES
        sw      t1, 0x1c(t0)            # TIMER0_CYCLES
        li      t1, 1
        sw      t1, 0x18(t0)            # TIMER0_CTRL: ENABLE`;

const EXERCISES = [
  {
    id: 'sum-words', group: 'isa', lang: 'asm', title: 'The sum of a table of words',
    task: 'count (a word, 1 to 16) words of table are numbers. Store their sum at total, then stop with ebreak. '
      + 'Keep the labels count, table and total and their lines in .data: the tests write count and table and read total.',
    starter: `# sum-words -- practice exercise (MAVILERA, Pico 2)
# Store at total the sum of the count words of table, then ebreak.
# Hint: la, lw, add, addi, and a loop that counts down with bnez.
        .text
_start: ebreak                          # replace with your code

        .data
count:  .word   0                       # the tests write the count here (1 to 16)
table:  .space  64                      # ... and the words here
total:  .word   0                       # your result
`,
    cases: [[1, 2, 3, 4], [100], [-5, 5, -7], [0x7fffffff, 1], [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160], [0]],
    test: (xs) => ({ name: `[${xs.join(', ')}]`, memory: [{ at: 'count', words: [xs.length] }, { at: 'table', words: xs.map(u32) }],
      expect: { memory: [{ at: 'total', words: [u32(xs.reduce((a, b) => a + b, 0))] }] } }),
  },
  {
    id: 'count-ones', group: 'isa', lang: 'asm', title: 'Count the 1 bits of a word, fast',
    task: 'Put in a0 the number of 1 bits of the word at value, then stop with ebreak, within 40 clock cycles from the start. '
      + 'A loop over 32 bits takes longer: Hazard3 has the bit-manipulation extensions. Keep the label value: the tests write it.',
    starter: `# count-ones -- practice exercise (MAVILERA, Pico 2)
# Put in a0 the number of 1 bits of the word at value, then ebreak, within 40 clock cycles.
# Hint: look for an instruction of the Zbb extension that counts bits (the Instructions view's
# tour template shows the extensions).
        .text
_start: li      a0, 0                   # replace with your code
        ebreak

        .data
value:  .word   0                       # the tests write the word here
`,
    cases: [0, 1, 0xffffffff, 0x80000000, 0x12345678, 0xaaaaaaaa, 0x00f00f00],
    test: (v) => ({ name: `0x${v.toString(16).padStart(8, '0')}`, memory: [{ at: 'value', words: [v] }],
      expect: { registers: { a0: popcount(v) }, maxCycles: 40 } }),
  },
  {
    id: 'print-number', group: 'c', lang: 'c', title: 'Print a number over UART',
    task: 'n is a number from 0 to 2147483647. Send its decimal digits and a newline to UART0 with putchar (for example "305\\n"), '
      + 'then return 0. Keep the line that defines n: the tests write it.',
    starter: `/* print-number -- practice exercise (MAVILERA, Pico 2)
 * Send the decimal digits of n and a newline to UART0, then return 0.
 * Hint: the last digit is n % 10; collect the digits in an array, then send them in reverse.
 */
#include <rp2350.h>

int n = 0;      /* the tests write this number (0 to 2147483647) */

int main(void)
{
    putchar('?');                       /* replace with your code */
    putchar('\\n');
    return 0;
}
`,
    cases: [0, 7, 10, 305, 99999, 1000000, 2147483647],
    test: (v) => ({ name: String(v), memory: [{ at: 'n', words: [v] }], expect: { output: `${v}\n`, exit: 0 } }),
  },
  {
    id: 'blink-period', group: 'devices', lang: 'c', title: 'Blink with a given rhythm',
    task: 'Make GP25 (the LED) an output and change it 8 times, 250 ms apart: on, off, on, off, … (it ends off), then return 0. '
      + 'The tests measure the changes on the pin: 8 of them, a period of 500 ms and 250 ms high, within 1 %.',
    starter: `/* blink-period -- practice exercise (MAVILERA, Pico 2)
 * GP25: on, off, on, off, ... 8 changes, 250 ms apart, then return 0.
 * Hint: pin_output, pin_write and delay_ms from <rp2350.h>.
 */
#include <rp2350.h>

int main(void)
{
    pin_output(25);
    pin_write(25, 1);                   /* replace with your code */
    return 0;
}
`,
    cases: [null],
    test: () => ({ name: '8 changes, 250 ms apart', limitMs: 3000,
      expect: { exit: 0, pins: { 25: 0 }, edges: [{ pin: 25, count: 8, periodUs: 500000, highUs: 250000, tolerance: 0.01 }] } }),
  },
  {
    id: 'count-presses', group: 'devices', lang: 'c', title: 'Count the presses of a button',
    task: 'A button on GP15 connects the pin to ground while it is pressed; pin_input turns on the pin\'s pull-up, so it reads 1 when released. '
      + 'Count the presses (high to low changes) during the first 100 ms after main starts, then return the count. '
      + 'A press can be as short as 1 ms.',
    starter: `/* count-presses -- practice exercise (MAVILERA, Pico 2)
 * Count the high-to-low changes of GP15 during the first 100 ms, then return the count.
 * Hint: pin_input, pin_read, and time_us to know when 100 ms have passed. Count a change, not a
 * low level: remember the level you read last.
 */
#include <rp2350.h>

int main(void)
{
    pin_input(15);
    return 0;                           /* replace with your code */
}
`,
    // presses as [press ms, release ms]; the pin is driven high at 0 and the times are from the machine's start
    cases: [[], [[20, 25]], [[10, 11], [30, 40], [60, 61]], [[5, 6], [15, 16], [25, 26], [35, 36], [45, 46], [55, 56], [65, 66]], [[40, 90]]],
    test: (ps) => ({ name: ps.length ? `${ps.length} press${ps.length > 1 ? 'es' : ''} (${ps.map(([a, b]) => `${a}-${b} ms`).join(', ')})` : 'no press', limitMs: 500,
      inputs: [{ us: 0, pin: 15, level: 1 }, ...ps.flatMap(([a, b]) => [{ us: a * 1000, pin: 15, level: 0 }, { us: b * 1000, pin: 15, level: 1 }])],
      expect: { exit: ps.length } }),
  },
  {
    id: 'pwm-duty', group: 'sound', lang: 'c', title: 'A PWM wave with a given duty',
    task: 'Make GP14 a PWM output of 1 kHz that is high for 25 % of each period (250 µs), keep it running for 20 ms, then set its '
      + 'level to 0 and return 0. Compute from CLK_SYS_HZ so that it works at every clk_sys. The tests measure the period and the '
      + 'high time on the pin, within 1 %.',
    starter: `/* pwm-duty -- practice exercise (MAVILERA, Pico 2)
 * GP14: 1 kHz, high 25 % of each period, for 20 ms; then level 0 and return 0.
 * Hint: pwm_start(pin, top, div) counts 0..top at clk_sys / div; pwm_level(pin, level) keeps the
 * pin high for level counts. The pwm-tone template shows both.
 */
#include <rp2350.h>

int main(void)
{
    pwm_start(14, 999, 1);              /* replace with your code */
    delay_ms(20);
    pwm_level(14, 0);
    delay_ms(2);
    return 0;
}
`,
    cases: [null],
    test: () => ({ name: '1 kHz, 25 %', limitMs: 1000,
      expect: { exit: 0, edges: [{ pin: 14, periodUs: 1000, highUs: 250, tolerance: 0.01 }] } }),
  },
  {
    id: 'two-core-sum', group: 'cores', lang: 'c', title: 'A sum on core 1',
    task: 'n is a number from 1 to 1000. Core 0 starts core 1 and sends it n through the FIFO; core 1 computes 1 + 2 + … + n and '
      + 'sends the sum back; core 0 prints "sum = " and the sum and a newline on UART0, then returns 0. '
      + 'Keep the line that defines n: the tests write it.',
    starter: `/* two-core-sum -- practice exercise (MAVILERA, Pico 2)
 * Core 1 adds 1..n (n from core 0 through the FIFO) and sends the sum back; core 0 prints
 * "sum = <sum>\\n" and returns 0.
 * Hint: core1_start, fifo_push, fifo_pop (the two-cores template shows them).
 */
#include <rp2350.h>

int n = 1;      /* the tests write this number (1 to 1000) */

void print_num(uint32_t v)
{
    if (v >= 10)
        print_num(v / 10);
    putchar('0' + v % 10);
}

void core1_main(void)
{
    /* your code for core 1 */
}

int main(void)
{
    /* replace with your code */
    return 0;
}
`,
    cases: [1, 10, 100, 1000],
    test: (v) => ({ name: `n = ${v}`, memory: [{ at: 'n', words: [v] }], limitMs: 1000, expect: { output: `sum = ${(v * (v + 1)) / 2}\n`, exit: 0 } }),
  },
  {
    id: 'pio-pulse', group: 'pio', lang: 'asm', title: 'Pulses from PIO',
    task: 'The assembly program is complete: it loads the PIO program of pio-pulse.pio into PIO0, runs state machine 0 at 1 MHz '
      + '(one cycle a microsecond) with SET on GP16, waits 2 ms and stops. Write the PIO program (the second tab) so that GP16 '
      + 'repeats a pulse every 10 µs that is high for 3 µs. Keep the program\'s name, pulse.',
    starter: `# pio-pulse -- practice exercise (MAVILERA, Pico 2): the core's part (complete). Write the PIO
# program in pio-pulse.pio, the second tab: GP16 high for 3 us of every 10 us.
        .text
${CLOCK_START}
        li      t0, 0x40028084          # IO_BANK0 GPIO16_CTRL
        li      t1, 6
        sw      t1, 0(t0)               # function 6: PIO0
        li      t0, 0x4003b044          # PADS_BANK0 GPIO16, clear alias
        li      t1, 0x180
        sw      t1, 0(t0)               # clear ISO and OD
        li      s0, 0x50200000          # PIO0
        la      t0, pulse_program       # the program's words, from pio-pulse.pio
        li      t1, pulse_length
        addi    t2, s0, 0x48            # INSTR_MEM0
copy:   lhu     t3, 0(t0)
        sw      t3, 0(t2)
        addi    t0, t0, 2
        addi    t2, t2, 4
        addi    t1, t1, -1
        bnez    t1, copy
        li      t1, (CLK_SYS_HZ / 1000000) << 16
        sw      t1, 0xc8(s0)            # SM0_CLKDIV: 1 MHz
        li      t1, (1 << 26) | (16 << 5)
        sw      t1, 0xdc(s0)            # SM0_PINCTRL: SET 1 pin from GP16
        li      t1, (pulse_wrap << 12) | (pulse_wrap_target << 7)
        sw      t1, 0xcc(s0)            # SM0_EXECCTRL: the wrap
        li      t1, 0xe081
        sw      t1, 0xd8(s0)            # SM0_INSTR: set pindirs, 1 (at once): GP16 is an output
        li      t1, 1
        sw      t1, 0(s0)               # CTRL: start state machine 0
        li      a0, 2000
        call    wait                    # 2 ms
        sw      zero, 0(s0)             # CTRL: stop it
        mv      a0, zero
        ebreak

# wait(a0): until TIMER0 has counted a0 microseconds
wait:   li      t0, 0x400b0028          # TIMER0 TIMERAWL
        lw      t1, 0(t0)
poll:   lw      t2, 0(t0)
        sub     t2, t2, t1
        bltu    t2, a0, poll
        ret
`,
    companion: { name: 'pio-pulse.pio', text: `; pio-pulse.pio -- practice exercise (MAVILERA, Pico 2): the PIO program.
; GP16 (SET pin 0) high for 3 cycles of every 10; the state machine runs at 1 MHz.
; Hint: an instruction takes one cycle, and [n] after it adds n more cycles.

.program pulse
.wrap_target
    set pins, 1                 ; replace these two lines
    set pins, 0
.wrap
` },
    cases: [null],
    test: () => ({ name: '10 µs period, 3 µs high', limitMs: 200,
      expect: { exit: 0, edges: [{ pin: 16, periodUs: 10, highUs: 3, tolerance: 0.001 }] } }),
  },
];

const GROUPS = { isa: 'Assembly language', c: 'MAVILERA C', devices: 'The chip\'s devices', sound: 'PWM and sound', cores: 'Two cores', pio: 'PIO' };

mkdirSync(DIR, { recursive: true });
for (const e of EXERCISES) {
  const file = {
    _copyright: COPYRIGHT, format: 'risc-vista-exercise', version: 1, arch: 'pico2', title: e.title, task: e.task, lang: e.lang,
    starter: e.starter, ...(e.companion ? { companion: e.companion } : {}), tests: e.cases.map(e.test),
  };
  writeFileSync(join(DIR, `${e.id}.json`), JSON.stringify(file, null, 1) + '\n');
}
const index = { _copyright: COPYRIGHT, groups: GROUPS, exercises: EXERCISES.map((e) => ({ id: e.id, file: `${e.id}.json`, group: e.group, title: e.title, lang: e.lang })) };
writeFileSync(join(DIR, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log(`${EXERCISES.length} exercises written to ${DIR}`);
