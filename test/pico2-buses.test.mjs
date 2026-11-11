// P1-M7 (docs/architecture/pico2-p1m7-adc-spi-i2c.md §4): the ADC, SPI and I2C models and the lab kit's parts, driven through the
// bus as a program would, with the machine's scheduler advancing time. Also the exit criterion's second half: every register of
// ADC, SPI0/1 and I2C0/1 reads its SVD reset value once the block is out of reset (the documented exception: ADC FCS.EMPTY).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Machine } from '../src/arch/pico2/soc/machine.js';
import { SVD_BLOCKS, SVD_REGS } from '../src/arch/pico2/soc/regs.generated.js';
import { adcCode, tempSensorVolts } from '../src/arch/pico2/soc/adc.js';
import { bmeRaw, bmeCompensate, createKit, ENV_DEFAULTS, Lcd1602 } from '../src/arch/pico2/parts/kit.js';

const BASE = Object.fromEntries(SVD_BLOCKS.map(([n, b]) => [n, b >>> 0]));
const SET = 0x2000, CLR = 0x3000;
const RESET_BIT = { ADC: 0, I2C0: 4, I2C1: 5, SPI0: 18, SPI1: 19 };

/** A machine with the crystal on, clk_peri from clk_sys (the ring oscillator) and clk_adc from the crystal, and `blocks` out of reset. */
function machine(blocks = []) {
  const m = new Machine();
  const w = (a, v) => m.bus.write32(a >>> 0, v | 0);
  w(BASE.XOSC, 0x00fabaa0);
  w(BASE.CLOCKS + 0x48, 0x800);              // CLK_PERI_CTRL: ENABLE, from clk_sys
  w(BASE.CLOCKS + 0x6c, 0x860);              // CLK_ADC_CTRL: ENABLE, AUXSRC xosc
  let mask = 0; for (const b of blocks) mask |= 1 << RESET_BIT[b];
  w(BASE.RESETS + CLR, mask);
  return m;
}
const rd = (m, a) => m.bus.read32(a >>> 0) >>> 0;
const wr = (m, a, v) => m.bus.write32(a >>> 0, v | 0);
/** Advance the machine by n clk_sys cycles, running its events (the core does nothing meanwhile). */
function tick(m, n) { m.hart.ticks += n; if (m.hart.ticks >= m.deadline) m.serviceDue(); }
function until(m, cond, limit = 1e7) { let t = 0; while (!cond() && t < limit) { tick(m, 16); t += 16; } assert.ok(cond(), 'condition not reached'); return t; }

test('P1-M7 exit criterion: ADC, SPI0/1, I2C0/1 registers read their SVD reset values once out of reset', () => {
  const m = machine(['ADC', 'SPI0', 'SPI1', 'I2C0', 'I2C1']);
  const SKIP = /^(FIFO|SSPDR|IC_DATA_CMD|IC_CLR_.*)$/; // reads with side effects (pop a FIFO, clear a flag)
  const EXCEPT = { ADC: { FCS: [0x100, 'EMPTY follows the FIFO, which is empty (the datasheet\'s reset column says 0)'] } };
  for (const [block, regsOf] of [['ADC', 'ADC'], ['SPI0', 'SPI0'], ['SPI1', 'SPI0'], ['I2C0', 'I2C0'], ['I2C1', 'I2C0']]) {
    for (const [name, off, reset, , , , , rse] of SVD_REGS[regsOf]) {
      if (SKIP.test(name) || rse) continue;
      const want = EXCEPT[block]?.[name] ? (reset | EXCEPT[block][name][0]) >>> 0 : reset >>> 0;
      assert.equal(rd(m, BASE[block] + off), want, `${block}.${name}`);
    }
  }
  assert.equal(m.diags.size, 0, JSON.stringify([...m.diags.keys()]));
});

test('ADC: one-shot conversion takes 96 clk_adc cycles; the code is round(V / 3.3 x 4096); the temperature sensor needs TS_EN', () => {
  const m = machine(['ADC']), A = BASE.ADC;
  m.adc.setVolts(0, 1.65);
  wr(m, A, 1); // EN
  assert.equal(rd(m, A) & 0x100, 0x100, 'READY after EN');
  wr(m, A + SET, 4); // START_ONCE
  assert.equal(rd(m, A) & 0x100, 0, 'converting');
  const k = m.freq.sys / m.freq.adc, t = until(m, () => (rd(m, A) & 0x100) !== 0);
  assert.ok(Math.abs(t - 96 * k) <= 16, `${t} cycles for ${96 * k}`);
  assert.equal(rd(m, A + 4), 2048);
  wr(m, A, 0x4001); wr(m, A + SET, 4); until(m, () => (rd(m, A) & 0x100) !== 0);
  assert.equal(rd(m, A + 4), 0, 'input 4 without the bias reads 0');
  wr(m, A, 0x4003); wr(m, A + SET, 4); until(m, () => (rd(m, A) & 0x100) !== 0);
  assert.equal(rd(m, A + 4), adcCode(tempSensorVolts(ENV_DEFAULTS.temp)));
  assert.equal(adcCode(tempSensorVolts(27)), Math.round((0.706 / 3.3) * 4096));
});

test('ADC: free-running round robin into the FIFO (RROBIN 0b00110 from input 0: 0, 1, 2, 1, 2 …), SHIFT, OVER, THRESH and IRQ 35', () => {
  const m = machine(['ADC']), A = BASE.ADC;
  [0.1, 1.0, 2.0].forEach((v, i) => m.adc.setVolts(i, v));
  wr(m, A + 0x8, 0x01000003); // FCS: EN, SHIFT, THRESH 1
  wr(m, A + 0x18, 1);         // INTE
  wr(m, A, (0x06 << 16) | 1 | 8); // RROBIN 1, 2; EN; START_MANY (DIV 0: back to back)
  until(m, () => m.adc.fifo.length === 8);
  assert.deepEqual(m.adc.fifo, [0.1, 1.0, 2.0, 1.0, 2.0, 1.0, 2.0, 1.0].map((v) => adcCode(v) >>> 4));
  assert.equal(m.harts[0].irqc.irq[35], 1, 'IRQ 35 raised (level >= THRESH)');
  tick(m, 2000);
  assert.equal(rd(m, A + 8) & 0x800, 0x800, 'OVER after a conversion into the full FIFO');
  assert.equal(rd(m, A + 8) & 0xf0000, 0x80000, 'LEVEL 8');
  wr(m, A, 1); // stop
  while (rd(m, A + 8) & 0xf0000) rd(m, A + 0xc);
  rd(m, A + 0xc);
  assert.equal(rd(m, A + 8) & 0x400, 0x400, 'UNDER after a read of the empty FIFO');
});

test('ADC: DIV paces free-running conversions (one per 1 + INT + FRAC/256 cycles of clk_adc) and DMA reads the FIFO by DREQ 48', () => {
  const m = machine(['ADC']), A = BASE.ADC, D = BASE.DMA;
  wr(m, BASE.RESETS + CLR, 1 << 2); // DMA
  m.adc.setVolts(0, 3.3);
  wr(m, A + 0x10, (999 << 8) | 128); // DIV: 1000.5 clk_adc cycles
  wr(m, A + 0x8, 0x01000009);        // FCS: EN, DREQ_EN, THRESH 1
  const buf = 0x20001000;
  wr(m, D + 0x0, A + 0xc); wr(m, D + 0x4, buf); wr(m, D + 0x8, 10);
  wr(m, D + 0xc, 1 | (1 << 2) | (1 << 6) | (48 << 17)); // EN, halfwords, INCR_WRITE, TREQ 48
  const c0 = m.hart.ticks;
  wr(m, A, 1 | 8);
  until(m, () => !m.dma.ch[0].busy, 1e8);
  const k = m.freq.sys / m.freq.adc, took = m.hart.ticks - c0;
  assert.ok(Math.abs(took - 9 * 1000.5 * k - 96 * k) < 1100 * k, `${took} cycles`); // ten conversions, 1000.5 clk_adc cycles apart
  for (let i = 0; i < 10; i++) assert.equal(m.bus.read16(buf + 2 * i), 4095);
  assert.equal(m.adc.conversions >= 10, true);
});

test('SPI: a frame takes bits x CPSDVSR x (1 + SCR) clk_peri cycles; loopback returns each byte; the RX FIFO overruns (ROR); DREQ', () => {
  const m = machine(['SPI0']), S = BASE.SPI0;
  wr(m, S + 0x10, 4); wr(m, S + 0x0, 0x0207); wr(m, S + 0x4, 3); // CPSDVSR 4, SCR 2, 8 bits; SSE | LBM
  const per = 8 * 4 * 3 * (m.freq.sys / m.freq.peri);
  const c0 = m.hart.ticks;
  wr(m, S + 0x8, 0xa5);
  assert.equal(rd(m, S + 0xc) & 0x10, 0x10, 'BSY');
  const t = until(m, () => (rd(m, S + 0xc) & 4) !== 0);
  assert.ok(Math.abs(m.hart.ticks - c0 - per) <= 16, `${t} for ${per}`);
  assert.equal(rd(m, S + 0x8), 0xa5);
  for (let i = 0; i < 9; i++) { wr(m, S + 0x8, i); until(m, () => !(rd(m, S + 0xc) & 0x10)); }
  assert.equal(rd(m, S + 0x18) & 1, 1, 'RORRIS: the ninth frame found the RX FIFO full');
  wr(m, S + 0x20, 1); assert.equal(rd(m, S + 0x18) & 1, 0, 'cleared through SSPICR');
  wr(m, S + 0x24, 3);
  assert.equal(m.spi[0].dreq(1), true, 'RX DREQ while data waits'); assert.equal(m.spi[0].dreq(0), true, 'TX DREQ while there is room');
});

test('SPI: frames reach the kit\'s BME280 only while its chip select GP17 is low and the pins select SPI', () => {
  const m = machine(['SPI0', 'ADC']), S = BASE.SPI0;
  wr(m, BASE.RESETS + CLR, (1 << 6) | (1 << 9)); // IO_BANK0, PADS_BANK0
  m.setKit(true);
  wr(m, S + 0x10, 2); wr(m, S + 0x0, 0x0007); wr(m, S + 0x4, 2);
  const xfer = (b) => { wr(m, S + 0x8, b); until(m, () => (rd(m, S + 0xc) & 4) !== 0); return rd(m, S + 0x8); };
  xfer(0xd0); assert.equal(xfer(0), 0, 'pins not yet SPI: nothing answers');
  for (const n of [16, 18, 19]) { wr(m, BASE.IO_BANK0 + 8 * n + 4, 1); wr(m, BASE.PADS_BANK0 + 4 + 4 * n + CLR, 0x100); }
  wr(m, BASE.IO_BANK0 + 8 * 17 + 4, 5); wr(m, BASE.PADS_BANK0 + 4 + 4 * 17 + CLR, 0x100);
  wr(m, 0xd0000000 + 0x18, 1 << 17); wr(m, 0xd0000000 + 0x38, 1 << 17); // GPIO_OUT_SET, GPIO_OE_SET: CS high
  xfer(0xd0); assert.equal(xfer(0), 0, 'deselected');
  wr(m, 0xd0000000 + 0x20, 1 << 17); // GPIO_OUT_CLR: CS low
  xfer(0xd0); assert.equal(xfer(0), 0x60, 'BME280 chip id');
  assert.deepEqual(m.spi[0].log.slice(-2).map((e) => [e.cs, e.tx, e.rx]), [[17, 0xd0, 0], [17, 0, 0x60]]);
});

test('I2C: write and read through a repeated START; a NACK aborts (7B_ADDR_NOACK, flush, STOP); IC_CLR_TX_ABRT clears it', () => {
  const m = machine(['I2C0']), I = BASE.I2C0;
  wr(m, BASE.RESETS + CLR, (1 << 6) | (1 << 9));
  m.setKit(true);
  for (const n of [4, 5]) { wr(m, BASE.IO_BANK0 + 8 * n + 4, 3); wr(m, BASE.PADS_BANK0 + 4 + 4 * n + CLR, 0x100); }
  wr(m, I + 0x6c, 0); wr(m, I + 0x0, 0x165); wr(m, I + 0x1c, 60); wr(m, I + 0x20, 90); wr(m, I + 0xa0, 5); wr(m, I + 0x4, 0x68); wr(m, I + 0x6c, 1);
  const P = 60 + 5 + 7 + 90 + 1;
  wr(m, I + 0x10, 0x75); // the register pointer (WHO_AM_I), no STOP: the master holds the bus
  const t = until(m, () => (rd(m, I + 0x34) & 0x10) !== 0); // TX_EMPTY (TX_EMPTY_CTRL: the byte has gone)
  assert.ok(Math.abs(t - 19 * P) <= 16, `${t} cycles for START + address + byte = ${19 * P}`);
  wr(m, I + 0x6c, 0); assert.equal(rd(m, I + 0x9c) & 1, 1, 'still active while it holds the bus');
  wr(m, I + 0x6c, 1);
  wr(m, I + 0x10, 0x100 | 0x200 | 0x400); // read, STOP, RESTART
  until(m, () => (rd(m, I + 0x34) & 0x200) !== 0);
  assert.equal(rd(m, I + 0x10) & 0xff, 0x68, 'WHO_AM_I');
  assert.deepEqual(m.i2c[0].log.map((e) => [e.addr, e.read, e.ack, e.bytes]), [[0x68, false, true, [0x75]], [0x68, true, true, [0x68]]]);
  rd(m, I + 0x60);
  wr(m, I + 0x6c, 0); wr(m, I + 0x4, 0x23); wr(m, I + 0x6c, 1);
  wr(m, I + 0x10, 0x200 | 0x11);
  until(m, () => (rd(m, I + 0x34) & 0x200) !== 0);
  assert.equal(rd(m, I + 0x34) & 0x40, 0x40, 'TX_ABRT');
  assert.equal(rd(m, I + 0x80) & 1, 1, 'ABRT_7B_ADDR_NOACK');
  wr(m, I + 0x10, 0x200 | 0x22); assert.equal(rd(m, I + 0x74), 0, 'TX FIFO held flushed');
  assert.equal(rd(m, I + 0x80) >>> 23, 1, 'TX_FLUSH_CNT counts the dropped command');
  rd(m, I + 0x54);
  assert.equal(rd(m, I + 0x80), 0); assert.equal(rd(m, I + 0x34) & 0x40, 0);
});

test('parts: BMP280/BME280 raw values compensate back to the environment; MCP9808 below zero; the LCD in 4-bit mode; the 24C02 page', () => {
  for (const env of [{ temp: 25, pressure: 1013.25, humidity: 40 }, { temp: -10.5, pressure: 850, humidity: 90 }, { temp: 60, pressure: 1100, humidity: 5 }]) {
    const r = bmeRaw(env), c = bmeCompensate(r.adcT, r.adcP, r.adcH);
    assert.equal(Math.round(c.t * 100), Math.round(env.temp * 100));
    assert.ok(Math.abs(c.p - env.pressure * 100) <= 1, `${c.p} Pa`);
    assert.ok(Math.abs(c.h - env.humidity) < 0.01, `${c.h} %`);
  }
  let env = { ...ENV_DEFAULTS, temp: -5.25 };
  const kit = createKit(() => env), mcp = kit.i2c[0].parts.find((p) => p.address === 0x18);
  mcp.start(false); mcp.write(5); mcp.start(true);
  const ta = (mcp.read() << 8) | mcp.read();
  assert.equal(ta & 0x1fff, (Math.round(-5.25 * 16) & 0x1fff), 'two\'s complement sixteenths');
  const lcd = new Lcd1602(), nib = (v, rs) => { lcd.write((v << 4) | 8 | rs | 4); lcd.write((v << 4) | 8 | rs); };
  const send = (b, rs) => { nib(b >> 4, rs); nib(b & 15, rs); };
  [3, 3, 3, 2].forEach((v) => nib(v, 0)); send(0x28, 0); send(0x0c, 0); send(0x01, 0);
  for (const ch of 'Hi') send(ch.charCodeAt(0), 1);
  send(0xc0 | 3, 0); send(0x41, 1);
  assert.deepEqual(lcd.lines(), ['Hi              ', '   A            ']);
  const rom = kit.i2c[0].parts.find((p) => p.address === 0x50);
  rom.start(false); rom.write(6); for (const b of [1, 2, 3, 4]) rom.write(b);
  rom.start(false); rom.write(0); rom.start(true);
  assert.deepEqual(Array.from({ length: 8 }, () => rom.read()), [3, 4, 0xff, 0xff, 0xff, 0xff, 1, 2], 'a page write wraps within its 8 bytes');
});

test('save and load carry the ADC, SPI, I2C state and the kit (EEPROM, LCD, environment)', () => {
  const m = machine(['ADC', 'I2C0']);
  m.setKit(true); m.setEnv('temp', 33); m.adc.setVolts(2, 1.2);
  m.kit.i2c[0].parts.find((p) => p.address === 0x50).mem[7] = 0x42;
  const s = JSON.parse(JSON.stringify(m.save()));
  m.setEnv('temp', 0); m.adc.setVolts(2, 0); m.kit.i2c[0].parts.find((p) => p.address === 0x50).mem[7] = 0;
  m.load(s);
  assert.equal(m.env.temp, 33); assert.equal(m.adc.volts[2], 1.2); assert.equal(m.kit.i2c[0].parts.find((p) => p.address === 0x50).mem[7], 0x42);
  assert.equal(JSON.stringify(m.save()), JSON.stringify(s));
});
