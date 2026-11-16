// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { SVD_BLOCKS, SVD_REGS } from '../soc/regs.generated.js';
import { asmLine as I } from '../../../cc/runtime.js';
import { T, ptr } from '../../../cc/types.js';
import { STACK_TOP } from '../language.js';
import { clockConfig } from '../clock.js';
export const HEADER_BLOCKS = Object.freeze(['RESETS', 'CLOCKS', 'XOSC', 'TICKS', 'IO_BANK0', 'PADS_BANK0', 'SIO', 'UART0', 'UART1', 'TIMER0', 'TIMER1',
 'PWM', 'DMA',
 'ADC', 'SPI0', 'I2C0',
 'PIO0']);
const hex = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
const BLOCK = new Map(SVD_BLOCKS.map(([name, base, from]) => [name, { base: base >>> 0, regs: SVD_REGS[from ?? name] ?? SVD_REGS[name] }]));
export function reg(block, name) {
 const b = BLOCK.get(block);
 const r = b?.regs?.find((x) => x[0] === name);
 if (!r) throw new Error(`rp2350.h: no register ${block}.${name} in the SVD table`);
 return (b.base + r[1]) >>> 0;
}
const base = (block) => BLOCK.get(block).base;
const off = (block, name) => reg(block, name) - base(block);
export const ATOMIC = Object.freeze({ XOR: 0x1000, SET: 0x2000, CLR: 0x3000 });
export const RESET_BITS = Object.freeze({ ADC: 0, DMA: 2, I2C0: 4, IO_BANK0: 6, PADS_BANK0: 9, PIO0: 11, PWM: 16, SPI0: 18, TIMER0: 23, TIMER1: 24, UART0: 26, UART1: 27 });
export const PAD = Object.freeze({ PDE: 0x4, PUE: 0x8, IE: 0x40, OD: 0x80, ISO: 0x100 });
export const FUNCSEL = Object.freeze({ SPI: 1, UART: 2, I2C: 3, PWM: 4, SIO: 5, PIO0: 6, NULL: 31 });
export function headerText(clk = clockConfig()) {
 const out = [
 '/* rp2350.h -- registers of the RP2350 blocks the Pico 2 Laboratory models, for the C subset of MAVILERA.',
 '   Each register is a macro naming the 32-bit word at its address; write BLOCK_REGISTER = value or read it.',
 '   Register names and addresses: the RP2350 SVD file (pico-sdk 2.3.1). This is not the Pico SDK. */',
 '',
 `#define ATOMIC_XOR ${hex(ATOMIC.XOR)}   /* add to a block address: the write XORs (RP2350 datasheet 2.1.3) */`,
 `#define ATOMIC_SET ${hex(ATOMIC.SET)}   /* the write sets the bits that are 1 */`,
 `#define ATOMIC_CLR ${hex(ATOMIC.CLR)}   /* the write clears the bits that are 1 */`,
 '',
 ];
 for (const name of HEADER_BLOCKS) {
 const b = BLOCK.get(name);
 out.push(`/* ${name} */`, `#define ${name}_BASE ${hex(b.base)}`);
 for (const [r, o] of b.regs) out.push(`#define ${name}_${r} (*(volatile uint32_t *)${hex(b.base + o)})`);
 out.push('');
 }
 out.push('/* bits used by the examples */');
 for (const [k, v] of Object.entries(RESET_BITS)) out.push(`#define RESETS_${k}_BIT ${hex(1 << v)}`);
 for (const [k, v] of Object.entries(PAD)) out.push(`#define PADS_${k}_BIT ${hex(v)}`);
 for (const [k, v] of Object.entries(FUNCSEL)) out.push(`#define FUNCSEL_${k} ${v}`);
 out.push(`#define UART_FR_TXFF_BIT ${hex(0x20)}`, `#define UART_FR_RXFE_BIT ${hex(0x10)}`);
 out.push(`#define PWM_CSR_EN_BIT ${hex(1)}`, `#define PWM_CSR_PH_CORRECT_BIT ${hex(2)}`,
 '#define PWM_DIV_INT_LSB 4      /* CHn_DIV = divider << 4: the integer divider 1-255 (0 means 256) */',
 '#define PWM_SLICE_BYTES 20     /* CHn registers are 0x14 apart: CH1_CSR = CH0_CSR + 20 bytes */',
 `#define DMA_CTRL_EN_BIT ${hex(1)}`, `#define DMA_CTRL_SIZE_BYTE ${hex(0)}`, `#define DMA_CTRL_SIZE_HALF ${hex(1 << 2)}`, `#define DMA_CTRL_SIZE_WORD ${hex(2 << 2)}`,
 `#define DMA_CTRL_INCR_READ_BIT ${hex(1 << 4)}`, `#define DMA_CTRL_INCR_WRITE_BIT ${hex(1 << 6)}`,
 '#define DMA_CTRL_RING_SIZE_LSB 8   /* RING_SIZE n: the read address wraps on 2^n bytes (RING_SEL 0) */',
 '#define DMA_CTRL_CHAIN_TO_LSB 13   /* CHAIN_TO: a channel\'s own number means no chain */',
 '#define DMA_CTRL_TREQ_SEL_LSB 17   /* TREQ_SEL: the DREQ that paces the channel */',
 `#define DMA_CTRL_BUSY_BIT ${hex(1 << 26)}`, '#define DMA_TREQ_UNPACED 63', '#define DMA_DREQ_PWM_WRAP0 32  /* slice n wraps: DREQ 32 + n */',
 `#define DMA_COUNT_ENDLESS ${hex(0xf0000000)}  /* TRANS_COUNT MODE ENDLESS: the count never runs out */`, '');
 out.push(`#define ADC_CS_EN_BIT ${hex(1)}`, `#define ADC_CS_TS_EN_BIT ${hex(2)}`, `#define ADC_CS_START_ONCE_BIT ${hex(4)}`, `#define ADC_CS_START_MANY_BIT ${hex(8)}`,
 `#define ADC_CS_READY_BIT ${hex(0x100)}`, '#define ADC_CS_AINSEL_LSB 12', '#define ADC_TEMPERATURE_INPUT 4  /* the temperature sensor; inputs 0-3 are GP26-GP29 */',
 `#define SPI_SR_TNF_BIT ${hex(2)}`, `#define SPI_SR_RNE_BIT ${hex(4)}`, `#define SPI_SR_BSY_BIT ${hex(0x10)}`, `#define SPI_CR1_LBM_BIT ${hex(1)}`, `#define SPI_CR1_SSE_BIT ${hex(2)}`,
 `#define I2C_DATA_CMD_READ_BIT ${hex(0x100)}`, `#define I2C_DATA_CMD_STOP_BIT ${hex(0x200)}`, `#define I2C_RAW_TX_EMPTY_BIT ${hex(0x10)}`, `#define I2C_RAW_STOP_DET_BIT ${hex(0x200)}`, '');
 out.push('#define PIO_SM_STRIDE 24          /* SMn registers are 0x18 apart: PIO0_SM1_CLKDIV = PIO0_SM0_CLKDIV + 24 bytes */',
 '#define PIO_CTRL_SM_ENABLE_LSB 0  /* CTRL: bit n starts state machine n */', '#define PIO_CTRL_SM_RESTART_LSB 4',
 '#define PIO_CLKDIV_INT_LSB 16     /* SMn_CLKDIV: divider integer part in bits 31:16, fraction (1/256) in 15:8 */',
 '#define PIO_EXECCTRL_WRAP_TOP_LSB 12', '#define PIO_EXECCTRL_WRAP_BOTTOM_LSB 7', '#define PIO_EXECCTRL_SIDE_EN_BIT 0x40000000',
 '#define PIO_SHIFTCTRL_AUTOPULL_BIT 0x00020000', '#define PIO_SHIFTCTRL_AUTOPUSH_BIT 0x00010000', '#define PIO_SHIFTCTRL_OUT_SHIFTDIR_BIT 0x00080000',
 '#define PIO_SHIFTCTRL_IN_SHIFTDIR_BIT 0x00040000', '#define PIO_SHIFTCTRL_PULL_THRESH_LSB 25', '#define PIO_SHIFTCTRL_PUSH_THRESH_LSB 20',
 '#define PIO_PINCTRL_SIDESET_COUNT_LSB 29', '#define PIO_PINCTRL_SET_COUNT_LSB 26', '#define PIO_PINCTRL_OUT_COUNT_LSB 20', '#define PIO_PINCTRL_IN_BASE_LSB 15',
 '#define PIO_PINCTRL_SIDESET_BASE_LSB 10', '#define PIO_PINCTRL_SET_BASE_LSB 5', '#define PIO_PINCTRL_OUT_BASE_LSB 0',
 `#define PIO_FSTAT_TXFULL_LSB 16`, `#define PIO_FSTAT_RXEMPTY_LSB 8`, '');
 out.push('/* the clock the start-up sets (the clk_sys option beside Translation) */',
 `#define CLK_SYS_HZ ${clk.hz}`, `#define UART_BAUD ${clk.baud}`, '');
 out.push('/* built in, declared by this header (their code is in the generated assembly when they are used):',
 '   void pin_output(int pin);  void pin_input(int pin);  void pin_write(int pin, int value);  int pin_read(int pin);',
 '   void delay_us(uint32_t us);  void delay_ms(uint32_t ms);  uint32_t time_us(void);',
 '   void pwm_start(int pin, uint32_t top, uint32_t div);  void pwm_level(int pin, uint32_t level);',
 '   void dma_copy(void *dst, const void *src, int words);',
 '   void sleep_ms(uint32_t ms);  (like delay_ms, but the core sleeps in wfi until a TIMER0 alarm: for programs without interrupts)',
 '   void core1_start(void);  (runs the program\'s own void core1_main(void) on core 1)',
 '   void fifo_push(uint32_t v);  uint32_t fifo_pop(void);  int core_id(void);',
 '   uint32_t adc_read(int input);  (0-4095; input 0-3 is GP26-GP29, 4 the temperature sensor)',
 '   void i2c_setup(uint32_t khz);  int i2c_write(int addr, const uint8_t *buf, int n, int nostop);  int i2c_read(int addr, uint8_t *buf, int n);',
 '      (I2C0 on GP4 SDA, GP5 SCL, the lab kit\'s bus; both return n, or -1 when no part answers)',
 '   void spi_setup(uint32_t khz);  void spi_select(int on);  int spi_transfer(int byte);  (SPI0 on GP16-GP19, chip select GP17)',
 '   void pio_load(const uint16_t *words, int n);  (PIO0 out of reset, the words into its instruction memory from 0)',
 '   void pio_pin(int pin);  void pio_put(int sm, uint32_t v);  uint32_t pio_get(int sm);  (a pin to PIO0; PIO0 state machine FIFOs)',
 '   putchar(c) writes to UART0; exit(code) ends the program (ebreak, the code in a0). */', '');
 return out.join('\n');
}
const fn = (ret, ...params) => ({ kind: 'func', ret, params });
export const HELPERS = Object.freeze({
 pin_output: { type: fn(T.void, T.int), note: 'makes a GPIO pin an output driven by the SIO' },
 pin_input: { type: fn(T.void, T.int), note: 'makes a GPIO pin an input with its pull-up' },
 pin_write: { type: fn(T.void, T.int, T.int), note: 'drives an output pin high (non-zero) or low' },
 pin_read: { type: fn(T.int, T.int), note: 'reads a pin: 0 or 1' },
 delay_us: { type: fn(T.void, T.uint), note: 'waits a number of microseconds on TIMER0' },
 delay_ms: { type: fn(T.void, T.uint), note: 'waits a number of milliseconds on TIMER0' },
 time_us: { type: fn(T.uint), note: 'reads TIMER0: microseconds since the start, low 32 bits' },
 pwm_start: { type: fn(T.void, T.int, T.uint, T.uint), note: 'gives a pin to its PWM slice and starts the slice: period top + 1 counts of clk_sys / div, level 0' },
 pwm_level: { type: fn(T.void, T.int, T.uint), note: 'sets a PWM pin\'s compare value: high for level counts of each period (from the next period)' },
 dma_copy: { type: fn(T.void, ptr(T.void), ptr(T.void), T.int), note: 'copies words with DMA channel 0, unpaced, and waits until it is done' },
 sleep_ms: { type: fn(T.void, T.uint), note: 'waits a number of milliseconds asleep (wfi until TIMER0 alarm 0); not for programs with interrupt handlers' },
 core1_start: { type: fn(T.void), note: 'launches core 1 at the program\'s void core1_main(void) (the FIFO handshake), with a 4 KiB stack of its own' },
 fifo_push: { type: fn(T.void, T.uint), note: 'sends a word to the other core through the SIO FIFO (waits while it is full)' },
 fifo_pop: { type: fn(T.uint), note: 'receives a word from the other core (sleeps with h3.block while the FIFO is empty)' },
 core_id: { type: fn(T.int), note: 'the number of the core running it: 0 or 1 (SIO CPUID)' },
 adc_read: { type: fn(T.uint, T.int), note: 'converts an ADC input (0-3: GP26-GP29, 4: the temperature sensor) and returns the 12-bit result; the first call starts the ADC' },
 i2c_setup: { type: fn(T.void, T.uint), note: 'starts I2C0 as a master at a speed in kHz on GP4 (SDA) and GP5 (SCL), with the pull-ups on' },
 i2c_write: { type: fn(T.int, T.int, ptr(T.uchar), T.int, T.int), note: 'writes n bytes to the part at a 7-bit address (nostop: keep the bus for a read); returns n, or -1 when it does not answer' },
 i2c_read: { type: fn(T.int, T.int, ptr(T.uchar), T.int), note: 'reads n bytes from the part at a 7-bit address, then STOP; returns n, or -1 when it does not answer' },
 spi_setup: { type: fn(T.void, T.uint), note: 'starts SPI0 as a master at a speed in kHz, 8-bit frames, mode 0, on GP16 (MISO), GP18 (SCK), GP19 (MOSI); GP17 is the chip select, high' },
 spi_select: { type: fn(T.void, T.int), note: 'drives the chip select GP17: low (selected) for on != 0, high for 0' },
 spi_transfer: { type: fn(T.int, T.int), note: 'sends one byte on SPI0 and returns the byte received at the same time' },
 pio_load: { type: fn(T.void, ptr(T.ushort), T.int), note: 'takes PIO0 out of reset and writes n instruction words into its memory from address 0 (jumps in the words are absolute)' },
 pio_pin: { type: fn(T.void, T.int), note: 'gives a GPIO pin to PIO0 (function 6), its pad out of isolation with the input on' },
 pio_put: { type: fn(T.void, T.int, T.uint), note: 'writes a word to the TX FIFO of PIO0 state machine sm, waiting while it is full' },
 pio_get: { type: fn(T.uint, T.int), note: 'reads a word from the RX FIFO of PIO0 state machine sm, waiting while it is empty' },
});
const BASIC = Object.freeze({
 putchar: { type: fn(T.int, T.int), note: 'writes one character to UART0, the console' },
 exit: { type: fn(T.void, T.int), note: 'ends the program with an exit code (ebreak; the code stays in a0)' },
});
function startup(clk) {
 const C = (r) => off('CLOCKS', r), X = (r) => off('XOSC', r), U = (r) => off('UART0', r);
 const resetMask = (1 << RESET_BITS.IO_BANK0) | (1 << RESET_BITS.PADS_BANK0) | (1 << RESET_BITS.TIMER0) | (1 << RESET_BITS.UART0)
 | (1 << RESET_BITS.PWM) | (1 << RESET_BITS.DMA);
 const gpioCtrl = (n) => off('IO_BANK0', `GPIO${n}_CTRL`), pad = (n) => off('PADS_BANK0', `GPIO${n}`);
 const mhz = `${clk.hz / 1e6} MHz`;
 return [
 '# start-up (pico2): the RP2350 leaves reset on its ring oscillator with the peripherals held in reset; this code',
 `# starts the 12 MHz crystal, clocks clk_ref from it and clk_sys and clk_peri at ${mhz}, releases the blocks C programs`,
 `# use, starts TIMER0 counting microseconds and UART0 at ${clk.baud} baud, then calls main and ends with exit(main's value)`,
 '_start:',
 I('li', `sp, ${hex(STACK_TOP)}`, 'top of the SRAM'),
 I('li', `t0, ${hex(base('XOSC'))}`, 'XOSC'),
 I('li', 't1, 47', 'STARTUP: about 1 ms at 12 MHz'),
 I('sw', `t1, ${X('STARTUP')}(t0)`),
 I('li', 't1, 0x00fabaa0', 'CTRL: ENABLE (0xfab), FREQ_RANGE 1-15 MHz (0xaa0)'),
 I('sw', `t1, ${X('CTRL')}(t0)`),
 '.Lstart_xosc:',
 I('lw', `t1, ${X('STATUS')}(t0)`),
 I('bgez', 't1, .Lstart_xosc', 'wait for STATUS.STABLE (bit 31)'),
 I('li', `t0, ${hex(base('CLOCKS'))}`, 'CLOCKS'),
 I('li', 't1, 2', 'CLK_REF_CTRL.SRC = 2: the crystal oscillator'),
 I('sw', `t1, ${C('CLK_REF_CTRL')}(t0)`),
 '.Lstart_ref:',
 I('lw', `t1, ${C('CLK_REF_SELECTED')}(t0)`),
 I('andi', 't1, t1, 4'),
 I('beqz', 't1, .Lstart_ref', 'wait until clk_ref has switched'),
 I('li', `t1, ${hex(clk.divReg)}`, `CLK_SYS_DIV: clk_ref / ${clk.div} = ${mhz} (INT in bits 31:16), set before the switch`),
 I('sw', `t1, ${C('CLK_SYS_DIV')}(t0)`),
 I('li', 't1, 0x40', 'CLK_SYS_CTRL.SRC = 0: clk_ref (at reset 0x41: the ring oscillator)'),
 I('sw', `t1, ${C('CLK_SYS_CTRL')}(t0)`),
 '.Lstart_sys:',
 I('lw', `t1, ${C('CLK_SYS_SELECTED')}(t0)`),
 I('andi', 't1, t1, 1'),
 I('beqz', 't1, .Lstart_sys', 'wait until clk_sys has switched'),
 I('li', 't1, 0x800', 'CLK_PERI_CTRL: ENABLE, from clk_sys'),
 I('sw', `t1, ${C('CLK_PERI_CTRL')}(t0)`),
 I('li', `t0, ${hex(base('RESETS') + ATOMIC.CLR)}`, 'RESETS, clear alias'),
 I('li', `t1, ${hex(resetMask)}`, 'IO_BANK0, PADS_BANK0, TIMER0, UART0, PWM, DMA'),
 I('sw', `t1, ${off('RESETS', 'RESET')}(t0)`, 'release them from reset'),
 I('li', `t0, ${hex(base('RESETS'))}`),
 '.Lstart_reset:',
 I('lw', `t2, ${off('RESETS', 'RESET_DONE')}(t0)`),
 I('and', 't2, t2, t1'),
 I('bne', 't2, t1, .Lstart_reset', 'wait for RESET_DONE'),
 I('li', `t0, ${hex(base('TICKS'))}`, 'TICKS'),
 I('li', `t1, ${clk.tickCycles}`, `TIMER0 tick every ${clk.tickCycles} clk_ref cycles: 1 us (ticks come from clk_ref, not clk_sys)`),
 I('sw', `t1, ${off('TICKS', 'TIMER0_CYCLES')}(t0)`),
 I('li', 't1, 1'),
 I('sw', `t1, ${off('TICKS', 'TIMER0_CTRL')}(t0)`, 'ENABLE'),
 I('li', `t0, ${hex(base('UART0'))}`, 'UART0'),
 I('li', `t1, ${clk.ibrd}`, `baud divisor ${mhz} / (16 x ${clk.baud}): integer part`),
 I('sw', `t1, ${U('UARTIBRD')}(t0)`),
 I('li', `t1, ${clk.fbrd}`, 'fractional part, in 64ths'),
 I('sw', `t1, ${U('UARTFBRD')}(t0)`),
 I('li', 't1, 0x70', 'LCR_H: 8 data bits, FIFOs on (written after the divisor)'),
 I('sw', `t1, ${U('UARTLCR_H')}(t0)`),
 I('li', 't1, 0x301', 'CR: UARTEN, TXE, RXE'),
 I('sw', `t1, ${U('UARTCR')}(t0)`),
 I('li', `t0, ${hex(base('IO_BANK0'))}`, 'GPIO 0 and 1 to UART0 (TX, RX)'),
 I('li', `t1, ${FUNCSEL.UART}`),
 I('sw', `t1, ${gpioCtrl(0)}(t0)`),
 I('sw', `t1, ${gpioCtrl(1)}(t0)`),
 I('li', `t0, ${hex(base('PADS_BANK0') + ATOMIC.CLR)}`, 'their pads: out of isolation'),
 I('li', `t1, ${hex(PAD.ISO)}`),
 I('sw', `t1, ${pad(0)}(t0)`),
 I('sw', `t1, ${pad(1)}(t0)`),
 I('call', 'main'),
 I('ebreak', '', 'exit(main\'s value): the value is in a0; with no trap handler ebreak ends the program'),
 ];
}
function routines(clk = clockConfig()) {
 const sio = (r) => off('SIO', r);
 const stride = off('IO_BANK0', 'GPIO1_CTRL') - off('IO_BANK0', 'GPIO0_CTRL');
 const padStride = off('PADS_BANK0', 'GPIO1') - off('PADS_BANK0', 'GPIO0');
 if (stride !== 8 || padStride !== 4) throw new Error('rp2350.h: unexpected GPIO register layout');
 const ctrlAddr = (rd) => [I('li', `t0, ${hex(reg('IO_BANK0', 'GPIO0_CTRL'))}`, 'IO_BANK0 GPIO0_CTRL'), I('slli', 't1, a0, 3', 'pin x 8'), I('add', `${rd}, t0, t1`, 'GPIOn_CTRL')];
 const padAddr = (rd, alias) => [I('li', `t0, ${hex(reg('PADS_BANK0', 'GPIO0') + alias)}`, `PADS_BANK0 GPIO0, ${alias === ATOMIC.SET ? 'set' : 'clear'} alias`),
 I('slli', 't1, a0, 2', 'pin x 4'), I('add', `${rd}, t0, t1`)];
 const bit = [I('li', 't1, 1'), I('sll', 't1, t1, a0', '1 << pin')];
 const timer = hex(reg('TIMER0', 'TIMERAWL'));
 return {
 putchar: () => ['# putchar(c): wait while UART0\'s transmit FIFO is full, then write c; returns c as an unsigned char', 'putchar:',
 I('li', `t0, ${hex(base('UART0'))}`),
 '.Lputchar_wait:', I('lw', `t1, ${off('UART0', 'UARTFR')}(t0)`), I('andi', 't1, t1, 0x20', 'FR.TXFF: the FIFO is full'), I('bnez', 't1, .Lputchar_wait'),
 I('andi', 'a0, a0, 255'), I('sw', `a0, ${off('UART0', 'UARTDR')}(t0)`, 'into the transmit FIFO'), I('ret')],
 exit: () => ['# exit(code): the code stays in a0; with no trap handler ebreak ends the program', 'exit:', I('ebreak')],
 pin_output: () => ['# pin_output(pin): the pin\'s function is the SIO, its pad leaves isolation, its output is enabled', 'pin_output:',
 ...ctrlAddr('t2'), I('li', `t1, ${FUNCSEL.SIO}`, 'FUNCSEL = SIO'), I('sw', 't1, 0(t2)'),
 ...padAddr('t2', ATOMIC.CLR), I('li', `t1, ${hex(PAD.ISO | PAD.OD)}`, 'clear ISO and OD'), I('sw', 't1, 0(t2)'),
 ...bit, I('li', `t0, ${hex(base('SIO'))}`), I('sw', `t1, ${sio('GPIO_OE_SET')}(t0)`, 'output enable'), I('ret')],
 pin_input: () => ['# pin_input(pin): the pin\'s function is the SIO, input enabled with the pull-up, output disabled', 'pin_input:',
 ...ctrlAddr('t2'), I('li', `t1, ${FUNCSEL.SIO}`, 'FUNCSEL = SIO'), I('sw', 't1, 0(t2)'),
 ...padAddr('t2', ATOMIC.CLR), I('li', `t1, ${hex(PAD.ISO | PAD.PDE)}`, 'clear ISO and the pull-down'), I('sw', 't1, 0(t2)'),
 ...padAddr('t2', ATOMIC.SET), I('li', `t1, ${hex(PAD.IE | PAD.PUE)}`, 'set IE and the pull-up'), I('sw', 't1, 0(t2)'),
 ...bit, I('li', `t0, ${hex(base('SIO'))}`), I('sw', `t1, ${sio('GPIO_OE_CLR')}(t0)`, 'output disable'), I('ret')],
 pin_write: () => ['# pin_write(pin, value): GPIO_OUT_SET or GPIO_OUT_CLR with 1 << pin', 'pin_write:',
 ...bit, I('li', `t0, ${hex(base('SIO'))}`), I('beqz', 'a1, .Lpin_write_low'),
 I('sw', `t1, ${sio('GPIO_OUT_SET')}(t0)`, 'high'), I('ret'),
 '.Lpin_write_low:', I('sw', `t1, ${sio('GPIO_OUT_CLR')}(t0)`, 'low'), I('ret')],
 pin_read: () => ['# pin_read(pin): bit pin of GPIO_IN', 'pin_read:',
 I('li', `t0, ${hex(base('SIO'))}`), I('lw', `t1, ${sio('GPIO_IN')}(t0)`), I('srl', 't1, t1, a0'), I('andi', 'a0, t1, 1'), I('ret')],
 time_us: () => ['# time_us(): TIMER0\'s raw count, low 32 bits (microseconds since the start-up)', 'time_us:',
 I('li', `t0, ${timer}`, 'TIMER0 TIMERAWL'), I('lw', 'a0, 0(t0)'), I('ret')],
 delay_us: () => ['# delay_us(n): wait until TIMER0 has advanced by n (unsigned difference: correct across the wrap)', 'delay_us:',
 I('li', `t0, ${timer}`, 'TIMER0 TIMERAWL'), I('lw', 't1, 0(t0)', 'the start'),
 '.Ldelay_us_wait:', I('lw', 't2, 0(t0)'), I('sub', 't2, t2, t1', 'microseconds so far'), I('bltu', 't2, a0, .Ldelay_us_wait'), I('ret')],
 delay_ms: () => ['# delay_ms(n): delay_us(n x 1000)', 'delay_ms:', I('li', 't1, 1000'), I('mul', 'a0, a0, t1'), I('j', 'delay_us', 'its return is this routine\'s return')],
 sleep_ms: () => ['# sleep_ms(n): arm TIMER0 alarm 0 for n ms from now, let only its interrupt end a wfi (INTE, the controller\'s enable of IRQ 0',
 '# and mie.MEIE; mstatus.MIE stays as it is, so no trap is taken), sleep until the alarm flag is set, then put it all back', 'sleep_ms:',
 I('li', 't1, 1000'), I('mul', 'a0, a0, t1', 'microseconds'),
 I('li', `t0, ${hex(base('TIMER0'))}`, 'TIMER0'), I('lw', `t1, ${off('TIMER0', 'TIMERAWL')}(t0)`), I('add', 't1, t1, a0', 'the alarm time'),
 I('li', 't2, 1'), I('sw', `t2, ${off('TIMER0', 'INTR')}(t0)`, 'clear an old alarm 0 flag'),
 I('li', `t3, ${hex(base('TIMER0') + ATOMIC.SET)}`), I('sw', `t2, ${off('TIMER0', 'INTE')}(t3)`, 'INTE: alarm 0 raises TIMER0_IRQ_0 (IRQ 0)'),
 I('sw', `t1, ${off('TIMER0', 'ALARM0')}(t0)`, 'arm alarm 0'),
 I('li', 't3, 0x10000'), I('csrs', '0xbe0, t3', 'meiea window 0: enable IRQ 0 in the interrupt controller'),
 I('li', 't3, 0x800'), I('csrs', 'mie, t3', 'mie.MEIE: an external interrupt ends wfi'),
 '.Lsleep_ms_wait:', I('wfi', '', 'sleep'), I('lw', `t3, ${off('TIMER0', 'INTR')}(t0)`), I('andi', 't3, t3, 1'), I('beqz', 't3, .Lsleep_ms_wait'),
 I('sw', `t2, ${off('TIMER0', 'INTR')}(t0)`, 'acknowledge'), I('li', `t3, ${hex(base('TIMER0') + ATOMIC.CLR)}`), I('sw', `t2, ${off('TIMER0', 'INTE')}(t3)`),
 I('li', 't3, 0x800'), I('csrc', 'mie, t3'), I('li', 't3, 0x10000'), I('csrc', '0xbe0, t3'), I('ret')],
 core1_start: () => ['# core1_start(): launch core 1 at core1_main: send 0, 0, 1, mtvec, sp, entry through the FIFO, each echoed by core 1',
 '# (a wrong echo starts again; before each 0 the incoming FIFO is drained and h3.unblock wakes core 1); the words are on the stack', 'core1_start:',
 I('addi', 'sp, sp, -24'), I('sw', 'zero, 0(sp)'), I('sw', 'zero, 4(sp)'), I('li', 't0, 1'), I('sw', 't0, 8(sp)'),
 I('csrr', 't0, mtvec', 'core 1 takes core 0\'s trap vector'), I('sw', 't0, 12(sp)'),
 I('li', `t0, ${hex(STACK_TOP - 0x1000)}`, 'core 1\'s stack: 4 KiB below core 0\'s'), I('sw', 't0, 16(sp)'),
 I('la', 't0, core1_main', 'its entry: the program\'s core1_main'), I('sw', 't0, 20(sp)'),
 I('li', `t3, ${hex(base('SIO'))}`, 'SIO'), I('li', 't4, 0', 'offset of the word to send'),
 '.Lcore1_send:', I('add', 't5, sp, t4'), I('lw', 't1, 0(t5)'), I('bnez', 't1, .Lcore1_push'),
 '.Lcore1_drain:', I('lw', `t2, ${sio('FIFO_ST')}(t3)`), I('andi', 't2, t2, 1', 'VLD: a word from core 1 waits'), I('beqz', 't2, .Lcore1_sev'),
 I('lw', `t2, ${sio('FIFO_RD')}(t3)`, 'discard it'), I('j', '.Lcore1_drain'),
 '.Lcore1_sev:', I('slt', 'zero, zero, ra', 'h3.unblock: wake core 1 if it waits'),
 '.Lcore1_push:', I('lw', `t2, ${sio('FIFO_ST')}(t3)`), I('andi', 't2, t2, 2', 'RDY: room in the FIFO to core 1'), I('beqz', 't2, .Lcore1_push'),
 I('sw', `t1, ${sio('FIFO_WR')}(t3)`),
 '.Lcore1_echo:', I('lw', `t2, ${sio('FIFO_ST')}(t3)`), I('andi', 't2, t2, 1'), I('beqz', 't2, .Lcore1_echo', 'wait for the echo'),
 I('lw', `t2, ${sio('FIFO_RD')}(t3)`), I('bne', 't2, t1, .Lcore1_again', 'a wrong echo: from the start'),
 I('addi', 't4, t4, 4'), I('li', 't5, 24'), I('blt', 't4, t5, .Lcore1_send'),
 I('addi', 'sp, sp, 24'), I('ret'),
 '.Lcore1_again:', I('li', 't4, 0'), I('j', '.Lcore1_send')],
 fifo_push: () => ['# fifo_push(v): wait for room in the FIFO to the other core, write v, then h3.unblock (as the SDK\'s __sev)', 'fifo_push:',
 I('li', `t0, ${hex(base('SIO'))}`), '.Lfifo_push_wait:', I('lw', `t1, ${sio('FIFO_ST')}(t0)`), I('andi', 't1, t1, 2', 'RDY'), I('beqz', 't1, .Lfifo_push_wait'),
 I('sw', `a0, ${sio('FIFO_WR')}(t0)`), I('slt', 'zero, zero, ra', 'h3.unblock: the other core may be waiting in fifo_pop'), I('ret')],
 fifo_pop: () => ['# fifo_pop(): while the FIFO from the other core is empty, sleep in h3.block (an h3.unblock or an interrupt wakes it); then read', 'fifo_pop:',
 I('li', `t0, ${hex(base('SIO'))}`), '.Lfifo_pop_wait:', I('lw', `t1, ${sio('FIFO_ST')}(t0)`), I('andi', 't1, t1, 1', 'VLD'), I('bnez', 't1, .Lfifo_pop_read'),
 I('slt', 'zero, zero, zero', 'h3.block'), I('j', '.Lfifo_pop_wait'),
 '.Lfifo_pop_read:', I('lw', `a0, ${sio('FIFO_RD')}(t0)`), I('ret')],
 core_id: () => ['# core_id(): SIO CPUID, 0 on core 0 and 1 on core 1', 'core_id:', I('li', `t0, ${hex(base('SIO'))}`), I('lw', `a0, ${sio('CPUID')}(t0)`), I('ret')],
 adc_read: () => {
 const A = (r) => off('ADC', r);
 return ['# adc_read(input): on first use clk_adc from the 12 MHz crystal, the ADC out of reset and on (EN, wait READY); an input 0-3',
 '# (GP26-GP29) gets its pad\'s digital side and pulls off, input 4 the temperature sensor\'s bias; select it, START_ONCE, wait READY, RESULT', 'adc_read:',
 I('li', `t0, ${hex(base('ADC'))}`, 'ADC'), I('lw', `t1, ${A('CS')}(t0)`), I('andi', 't1, t1, 1', 'CS.EN: already on?'), I('bnez', 't1, .Ladc_read_on'),
 I('li', `t2, ${hex(base('CLOCKS'))}`), I('li', 't1, 0x860', 'CLK_ADC_CTRL: ENABLE, AUXSRC = the crystal (12 MHz)'), I('sw', `t1, ${off('CLOCKS', 'CLK_ADC_CTRL')}(t2)`),
 I('li', `t2, ${hex(base('RESETS') + ATOMIC.CLR)}`), I('li', `t1, ${hex(1 << RESET_BITS.ADC)}`), I('sw', `t1, ${off('RESETS', 'RESET')}(t2)`, 'the ADC out of reset'),
 I('li', `t2, ${hex(base('RESETS'))}`), '.Ladc_read_reset:', I('lw', `t3, ${off('RESETS', 'RESET_DONE')}(t2)`), I('and', 't3, t3, t1'), I('beqz', 't3, .Ladc_read_reset'),
 I('li', 't1, 1'), I('sw', `t1, ${A('CS')}(t0)`, 'CS.EN'),
 '.Ladc_read_ready:', I('lw', `t1, ${A('CS')}(t0)`), I('andi', 't1, t1, 0x100'), I('beqz', 't1, .Ladc_read_ready', 'wait for READY'),
 '.Ladc_read_on:', I('li', 't1, 4'), I('bgeu', 'a0, t1, .Ladc_read_temp', 'input 4 and above: the temperature sensor'),
 I('slli', 't3, a0, 2', 'input x 4'),
 I('li', `t2, ${hex(reg('PADS_BANK0', 'GPIO26') + ATOMIC.SET)}`, 'PADS_BANK0 GPIO26, set alias'), I('add', 't2, t2, t3'), I('li', `t1, ${hex(PAD.OD)}`), I('sw', 't1, 0(t2)', 'OD: output off'),
 I('li', `t2, ${hex(reg('PADS_BANK0', 'GPIO26') + ATOMIC.CLR)}`, 'clear alias'), I('add', 't2, t2, t3'), I('li', `t1, ${hex(PAD.IE | PAD.PUE | PAD.PDE)}`), I('sw', 't1, 0(t2)', 'IE, PUE, PDE: digital input and pulls off (as the SDK\'s adc_gpio_init; research D51 Q7)'),
 I('j', '.Ladc_read_sel'),
 '.Ladc_read_temp:', I('li', 'a0, 4'), I('li', `t2, ${hex(base('ADC') + ATOMIC.SET)}`), I('li', 't1, 2'), I('sw', `t1, ${A('CS')}(t2)`, 'CS.TS_EN: the sensor\'s bias on'),
 '.Ladc_read_sel:', I('lw', `t1, ${A('CS')}(t0)`), I('li', 't2, 0xffff0fff'), I('and', 't1, t1, t2', 'clear AINSEL'), I('slli', 't2, a0, 12'), I('or', 't1, t1, t2'),
 I('ori', 't1, t1, 4', 'START_ONCE'), I('sw', `t1, ${A('CS')}(t0)`, 'select the input and start one conversion'),
 '.Ladc_read_wait:', I('lw', `t1, ${A('CS')}(t0)`), I('andi', 't1, t1, 0x100'), I('beqz', 't1, .Ladc_read_wait', 'READY: the conversion is done'),
 I('lw', `a0, ${A('RESULT')}(t0)`, 'the 12-bit result'), I('ret')];
 },
 i2c_setup: () => {
 const C = (r) => off('I2C0', r);
 return ['# i2c_setup(khz): I2C0 out of reset; a fast-mode master with repeated STARTs and TX_EMPTY_CTRL; SCL period = clk_sys / speed,',
 '# 3/5 of it low, 2/5 high (each at least 8 cycles); GP4 (SDA) and GP5 (SCL) to function I2C with their pull-ups', 'i2c_setup:',
 I('li', `t2, ${hex(base('RESETS') + ATOMIC.CLR)}`), I('li', `t1, ${hex(1 << RESET_BITS.I2C0)}`), I('sw', `t1, ${off('RESETS', 'RESET')}(t2)`, 'I2C0 out of reset'),
 I('li', `t2, ${hex(base('RESETS'))}`), '.Li2c_setup_reset:', I('lw', `t3, ${off('RESETS', 'RESET_DONE')}(t2)`), I('and', 't3, t3, t1'), I('beqz', 't3, .Li2c_setup_reset'),
 I('li', `t0, ${hex(base('I2C0'))}`, 'I2C0'), I('sw', `zero, ${C('IC_ENABLE')}(t0)`, 'disabled while it is set up'),
 I('li', 't1, 0x165', 'IC_CON: MASTER_MODE, SPEED fast, RESTART_EN, SLAVE_DISABLE, TX_EMPTY_CTRL'), I('sw', `t1, ${C('IC_CON')}(t0)`),
 I('sw', `zero, ${C('IC_TX_TL')}(t0)`), I('sw', `zero, ${C('IC_RX_TL')}(t0)`),
 I('li', 't1, 1000'), I('mul', 'a0, a0, t1', 'Hz'), I('li', `t1, ${clk.hz}`, 'CLK_SYS_HZ'), I('divu', 't1, t1, a0', 'clk_sys cycles per SCL period'),
 I('li', 't2, 3'), I('mul', 't2, t1, t2'), I('li', 't3, 5'), I('divu', 't2, t2, t3', 'LCNT = 3/5'), I('sub', 't3, t1, t2', 'HCNT = the rest'),
 I('li', 't4, 8'), I('bgeu', 't2, t4, .Li2c_setup_l'), I('li', 't2, 8', 'at least 8'), '.Li2c_setup_l:', I('bgeu', 't3, t4, .Li2c_setup_h'), I('li', 't3, 8'), '.Li2c_setup_h:',
 I('sw', `t3, ${C('IC_FS_SCL_HCNT')}(t0)`), I('sw', `t2, ${C('IC_FS_SCL_LCNT')}(t0)`),
 I('srli', 't1, t2, 4', 'SPKLEN = LCNT / 16, at least 1'), I('bnez', 't1, .Li2c_setup_sp'), I('li', 't1, 1'), '.Li2c_setup_sp:', I('sw', `t1, ${C('IC_FS_SPKLEN')}(t0)`),
 I('li', 't1, 1'), I('sw', `t1, ${C('IC_ENABLE')}(t0)`, 'enabled'),
 I('li', `t0, ${hex(base('IO_BANK0'))}`), I('li', `t1, ${FUNCSEL.I2C}`), I('sw', `t1, ${off('IO_BANK0', 'GPIO4_CTRL')}(t0)`, 'GP4: SDA'), I('sw', `t1, ${off('IO_BANK0', 'GPIO5_CTRL')}(t0)`, 'GP5: SCL'),
 I('li', `t0, ${hex(base('PADS_BANK0') + ATOMIC.CLR)}`), I('li', `t1, ${hex(PAD.ISO | PAD.PDE)}`), I('sw', `t1, ${off('PADS_BANK0', 'GPIO4')}(t0)`), I('sw', `t1, ${off('PADS_BANK0', 'GPIO5')}(t0)`),
 I('li', `t0, ${hex(base('PADS_BANK0') + ATOMIC.SET)}`), I('li', `t1, ${hex(PAD.IE | PAD.PUE)}`), I('sw', `t1, ${off('PADS_BANK0', 'GPIO4')}(t0)`, 'pull-ups on'), I('sw', `t1, ${off('PADS_BANK0', 'GPIO5')}(t0)`),
 I('ret')];
 },
 i2c_write: () => {
 const C = (r) => off('I2C0', r);
 return ['# i2c_write(addr, buf, n, nostop): IC_TAR = addr, then each byte (STOP with the last unless nostop); after each, wait for',
 '# TX_EMPTY; an abort (no acknowledge) or the STOP: wait for STOP_DET; returns n, or -1 after an abort', 'i2c_write:',
 I('li', `t0, ${hex(base('I2C0'))}`), I('sw', `zero, ${C('IC_ENABLE')}(t0)`), I('sw', `a0, ${C('IC_TAR')}(t0)`, 'the target address'), I('li', 't1, 1'), I('sw', `t1, ${C('IC_ENABLE')}(t0)`),
 I('li', 't4, 0', 'bytes sent'), I('blez', 'a2, .Li2c_write_done'),
 '.Li2c_write_next:', I('add', 't1, a1, t4'), I('lbu', 't1, 0(t1)'), I('addi', 't5, t4, 1'), I('bne', 't5, a2, .Li2c_write_put', 'not the last byte'),
 I('bnez', 'a3, .Li2c_write_put', 'nostop: no STOP'), I('li', 't2, 0x200'), I('or', 't1, t1, t2', 'STOP after the last byte'),
 '.Li2c_write_put:', I('sw', `t1, ${C('IC_DATA_CMD')}(t0)`),
 '.Li2c_write_empty:', I('lw', `t2, ${C('IC_RAW_INTR_STAT')}(t0)`), I('andi', 't2, t2, 0x10'), I('beqz', 't2, .Li2c_write_empty', 'TX_EMPTY: the byte has left'),
 I('lw', `t3, ${C('IC_TX_ABRT_SOURCE')}(t0)`), I('beqz', 't3, .Li2c_write_ok'), I('lw', `t2, ${C('IC_CLR_TX_ABRT')}(t0)`, 'clear the abort'),
 '.Li2c_write_stop:', I('lw', `t2, ${C('IC_RAW_INTR_STAT')}(t0)`), I('andi', 't2, t2, 0x200'), I('beqz', 't2, .Li2c_write_stop', 'STOP_DET'), I('lw', `t2, ${C('IC_CLR_STOP_DET')}(t0)`),
 I('li', 'a0, -1'), I('ret'),
 '.Li2c_write_ok:', I('addi', 't4, t4, 1'), I('blt', 't4, a2, .Li2c_write_next'), I('bnez', 'a3, .Li2c_write_done'),
 '.Li2c_write_stop2:', I('lw', `t2, ${C('IC_RAW_INTR_STAT')}(t0)`), I('andi', 't2, t2, 0x200'), I('beqz', 't2, .Li2c_write_stop2', 'STOP_DET'), I('lw', `t2, ${C('IC_CLR_STOP_DET')}(t0)`),
 '.Li2c_write_done:', I('mv', 'a0, a2'), I('ret')];
 },
 i2c_read: () => {
 const C = (r) => off('I2C0', r);
 return ['# i2c_read(addr, buf, n): IC_TAR = addr, then n read commands (STOP with the last), each byte from IC_DATA_CMD when IC_RXFLR', '# shows it; an abort: -1', 'i2c_read:',
 I('li', `t0, ${hex(base('I2C0'))}`), I('sw', `zero, ${C('IC_ENABLE')}(t0)`), I('sw', `a0, ${C('IC_TAR')}(t0)`), I('li', 't1, 1'), I('sw', `t1, ${C('IC_ENABLE')}(t0)`),
 I('li', 't4, 0'), I('blez', 'a2, .Li2c_read_done'),
 '.Li2c_read_next:', I('li', 't1, 0x100', 'CMD: read'), I('addi', 't5, t4, 1'), I('bne', 't5, a2, .Li2c_read_put'), I('li', 't1, 0x300', 'read, then STOP'),
 '.Li2c_read_put:', I('sw', `t1, ${C('IC_DATA_CMD')}(t0)`),
 '.Li2c_read_wait:', I('lw', `t2, ${C('IC_RAW_INTR_STAT')}(t0)`), I('andi', 't2, t2, 0x40'), I('bnez', 't2, .Li2c_read_abort', 'TX_ABRT'),
 I('lw', `t2, ${C('IC_RXFLR')}(t0)`), I('beqz', 't2, .Li2c_read_wait', 'wait for the byte'),
 I('lw', `t2, ${C('IC_DATA_CMD')}(t0)`), I('add', 't3, a1, t4'), I('sb', 't2, 0(t3)'), I('addi', 't4, t4, 1'), I('blt', 't4, a2, .Li2c_read_next'),
 '.Li2c_read_done:', I('mv', 'a0, a2'), I('ret'),
 '.Li2c_read_abort:', I('lw', `t2, ${C('IC_CLR_TX_ABRT')}(t0)`, 'clear the abort'),
 '.Li2c_read_stop:', I('lw', `t2, ${C('IC_RAW_INTR_STAT')}(t0)`), I('andi', 't2, t2, 0x200'), I('beqz', 't2, .Li2c_read_stop', 'STOP_DET'), I('lw', `t2, ${C('IC_CLR_STOP_DET')}(t0)`),
 I('li', 'a0, -1'), I('ret')];
 },
 spi_setup: () => {
 const P = (r) => off('SPI0', r);
 return ['# spi_setup(khz): SPI0 out of reset; SSPCPSR = 2, SCR = clk_peri / (2 x speed) - 1 (at most 255), 8-bit Motorola frames, mode 0,',
 '# enabled as a master; GP16 (MISO), GP18 (SCK), GP19 (MOSI) to function SPI; GP17, the chip select, an SIO output, high', 'spi_setup:',
 I('li', `t2, ${hex(base('RESETS') + ATOMIC.CLR)}`), I('li', `t1, ${hex(1 << RESET_BITS.SPI0)}`), I('sw', `t1, ${off('RESETS', 'RESET')}(t2)`, 'SPI0 out of reset'),
 I('li', `t2, ${hex(base('RESETS'))}`), '.Lspi_setup_reset:', I('lw', `t3, ${off('RESETS', 'RESET_DONE')}(t2)`), I('and', 't3, t3, t1'), I('beqz', 't3, .Lspi_setup_reset'),
 I('li', 't1, 2000'), I('mul', 'a0, a0, t1', '2 x Hz'), I('li', `t1, ${clk.hz}`, 'clk_peri = clk_sys'), I('divu', 't1, t1, a0'), I('addi', 't1, t1, -1', 'SCR'),
 I('bgez', 't1, .Lspi_setup_lo'), I('li', 't1, 0'), '.Lspi_setup_lo:', I('li', 't2, 255'), I('ble', 't1, t2, .Lspi_setup_hi'), I('li', 't1, 255'), '.Lspi_setup_hi:',
 I('li', `t0, ${hex(base('SPI0'))}`, 'SPI0'), I('li', 't2, 2'), I('sw', `t2, ${P('SSPCPSR')}(t0)`, 'prescaler 2'),
 I('slli', 't1, t1, 8'), I('ori', 't1, t1, 7', 'DSS = 7: 8-bit frames; FRF 0, SPO 0, SPH 0'), I('sw', `t1, ${P('SSPCR0')}(t0)`),
 I('li', 't1, 2'), I('sw', `t1, ${P('SSPCR1')}(t0)`, 'SSE: enabled, a master'),
 I('li', `t0, ${hex(base('IO_BANK0'))}`), I('li', `t1, ${FUNCSEL.SPI}`), I('sw', `t1, ${off('IO_BANK0', 'GPIO16_CTRL')}(t0)`, 'GP16: MISO'),
 I('sw', `t1, ${off('IO_BANK0', 'GPIO18_CTRL')}(t0)`, 'GP18: SCK'), I('sw', `t1, ${off('IO_BANK0', 'GPIO19_CTRL')}(t0)`, 'GP19: MOSI'),
 I('li', `t1, ${FUNCSEL.SIO}`), I('sw', `t1, ${off('IO_BANK0', 'GPIO17_CTRL')}(t0)`, 'GP17: chip select, by the SIO'),
 I('li', `t0, ${hex(base('PADS_BANK0') + ATOMIC.CLR)}`), I('li', `t1, ${hex(PAD.ISO | PAD.OD)}`),
 ...[16, 17, 18, 19].map((n) => I('sw', `t1, ${off('PADS_BANK0', `GPIO${n}`)}(t0)`)),
 I('li', `t0, ${hex(base('PADS_BANK0') + ATOMIC.SET)}`), I('li', `t1, ${hex(PAD.IE)}`), I('sw', `t1, ${off('PADS_BANK0', 'GPIO16')}(t0)`, 'MISO: input on'),
 I('li', `t0, ${hex(base('SIO'))}`), I('li', `t1, ${hex(1 << 17)}`), I('sw', `t1, ${sio('GPIO_OUT_SET')}(t0)`, 'chip select high'), I('sw', `t1, ${sio('GPIO_OE_SET')}(t0)`), I('ret')];
 },
 spi_select: () => ['# spi_select(on): the chip select GP17 low for on != 0 (the part listens), high for 0', 'spi_select:',
 I('li', `t0, ${hex(base('SIO'))}`), I('li', `t1, ${hex(1 << 17)}`), I('beqz', 'a0, .Lspi_select_off'),
 I('sw', `t1, ${sio('GPIO_OUT_CLR')}(t0)`, 'low: selected'), I('ret'), '.Lspi_select_off:', I('sw', `t1, ${sio('GPIO_OUT_SET')}(t0)`, 'high'), I('ret')],
 spi_transfer: () => {
 const P = (r) => off('SPI0', r);
 return ['# spi_transfer(byte): wait for room in the TX FIFO, write the byte, wait until a byte has come back (RNE), return it', 'spi_transfer:',
 I('li', `t0, ${hex(base('SPI0'))}`),
 '.Lspi_transfer_tx:', I('lw', `t1, ${P('SSPSR')}(t0)`), I('andi', 't1, t1, 2'), I('beqz', 't1, .Lspi_transfer_tx', 'TNF: room to send'),
 I('andi', 'a0, a0, 255'), I('sw', `a0, ${P('SSPDR')}(t0)`),
 '.Lspi_transfer_rx:', I('lw', `t1, ${P('SSPSR')}(t0)`), I('andi', 't1, t1, 4'), I('beqz', 't1, .Lspi_transfer_rx', 'RNE: the byte received'),
 I('lw', `a0, ${P('SSPDR')}(t0)`), I('ret')];
 },
 pio_load: () => ['# pio_load(words, n): PIO0 out of reset, then the n halfwords into INSTR_MEM0, INSTR_MEM1, … (4 bytes apart)', 'pio_load:',
 I('li', `t2, ${hex(base('RESETS') + ATOMIC.CLR)}`), I('li', `t1, ${hex(1 << RESET_BITS.PIO0)}`), I('sw', `t1, ${off('RESETS', 'RESET')}(t2)`, 'PIO0 out of reset'),
 I('li', `t2, ${hex(base('RESETS'))}`), '.Lpio_load_reset:', I('lw', `t3, ${off('RESETS', 'RESET_DONE')}(t2)`), I('and', 't3, t3, t1'), I('beqz', 't3, .Lpio_load_reset'),
 I('li', `t0, ${hex(reg('PIO0', 'INSTR_MEM0'))}`, 'PIO0 INSTR_MEM0'),
 '.Lpio_load_next:', I('blez', 'a1, .Lpio_load_done'), I('lhu', 't1, 0(a0)'), I('sw', 't1, 0(t0)'), I('addi', 'a0, a0, 2'), I('addi', 't0, t0, 4'), I('addi', 'a1, a1, -1'), I('j', '.Lpio_load_next'),
 '.Lpio_load_done:', I('ret')],
 pio_pin: () => ['# pio_pin(pin): the pin\'s function is PIO0 (6), its pad leaves isolation, its input on', 'pio_pin:',
 ...ctrlAddr('t2'), I('li', `t1, ${FUNCSEL.PIO0}`, 'FUNCSEL = PIO0'), I('sw', 't1, 0(t2)'),
 ...padAddr('t2', ATOMIC.CLR), I('li', `t1, ${hex(PAD.ISO | PAD.OD)}`, 'clear ISO and OD'), I('sw', 't1, 0(t2)'),
 ...padAddr('t2', ATOMIC.SET), I('li', `t1, ${hex(PAD.IE)}`, 'set IE'), I('sw', 't1, 0(t2)'), I('ret')],
 pio_put: () => ['# pio_put(sm, v): wait while FSTAT.TXFULL of sm is set, then write TXF[sm]', 'pio_put:',
 I('li', `t0, ${hex(base('PIO0'))}`, 'PIO0'), I('addi', 't2, a0, 16', 'TXFULL bit: 16 + sm'), I('li', 't3, 1'), I('sll', 't2, t3, t2'),
 '.Lpio_put_wait:', I('lw', `t1, ${off('PIO0', 'FSTAT')}(t0)`), I('and', 't1, t1, t2'), I('bnez', 't1, .Lpio_put_wait'),
 I('slli', 't1, a0, 2'), I('add', 't1, t1, t0'), I('sw', `a1, ${off('PIO0', 'TXF0')}(t1)`, 'TXF[sm]'), I('ret')],
 pio_get: () => ['# pio_get(sm): wait while FSTAT.RXEMPTY of sm is set, then read RXF[sm]', 'pio_get:',
 I('li', `t0, ${hex(base('PIO0'))}`, 'PIO0'), I('addi', 't2, a0, 8', 'RXEMPTY bit: 8 + sm'), I('li', 't3, 1'), I('sll', 't2, t3, t2'),
 '.Lpio_get_wait:', I('lw', `t1, ${off('PIO0', 'FSTAT')}(t0)`), I('and', 't1, t1, t2'), I('bnez', 't1, .Lpio_get_wait'),
 I('slli', 't1, a0, 2'), I('add', 't1, t1, t0'), I('lw', `a0, ${off('PIO0', 'RXF0')}(t1)`, 'RXF[sm]'), I('ret')],
 pwm_start: () => ['# pwm_start(pin, top, div): the pin to function PWM (pad out of isolation), its slice (pin >> 1) & 7: DIV = div,', '# TOP = top, CC = 0, CSR = EN (free-running, trailing edge)', 'pwm_start:',
 ...ctrlAddr('t2'), I('li', `t1, ${FUNCSEL.PWM}`, 'FUNCSEL = PWM'), I('sw', 't1, 0(t2)'),
 ...padAddr('t2', ATOMIC.CLR), I('li', `t1, ${hex(PAD.ISO | PAD.OD)}`, 'clear ISO and OD'), I('sw', 't1, 0(t2)'),
 I('srli', 't1, a0, 1'), I('andi', 't1, t1, 7', 'slice'), I('li', 't2, 20'), I('mul', 't1, t1, t2', 'slice x 0x14'),
 I('li', `t0, ${hex(base('PWM'))}`, 'PWM'), I('add', 't0, t0, t1', 'CHn_CSR'),
 I('sw', 'zero, 0(t0)', 'CSR = 0: stopped while it is set up'), I('slli', 'a2, a2, 4', 'DIV: INT in bits 11:4'), I('sw', `a2, ${off('PWM', 'CH0_DIV')}(t0)`),
 I('sw', `a1, ${off('PWM', 'CH0_TOP')}(t0)`, 'TOP'), I('sw', `zero, ${off('PWM', 'CH0_CC')}(t0)`, 'CC: both levels 0'),
 I('li', 't1, 1'), I('sw', 't1, 0(t0)', 'CSR.EN: start (TOP and CC are loaded now)'), I('ret')],
 pwm_level: () => ['# pwm_level(pin, level): the slice\'s CC, A (even pin) in bits 15:0, B (odd) in 31:16; the other half kept', 'pwm_level:',
 I('srli', 't1, a0, 1'), I('andi', 't1, t1, 7'), I('li', 't2, 20'), I('mul', 't1, t1, t2'),
 I('li', `t0, ${hex(reg('PWM', 'CH0_CC'))}`, 'PWM CH0_CC'), I('add', 't0, t0, t1', 'CHn_CC'), I('lw', 't2, 0(t0)'),
 I('slli', 'a1, a1, 16'), I('andi', 't1, a0, 1'), I('bnez', 't1, .Lpwm_level_b'),
 I('srli', 'a1, a1, 16', 'channel A: bits 15:0'), I('srli', 't2, t2, 16'), I('slli', 't2, t2, 16', 'keep B'), I('or', 't2, t2, a1'), I('sw', 't2, 0(t0)'), I('ret'),
 '.Lpwm_level_b:', I('slli', 't2, t2, 16'), I('srli', 't2, t2, 16', 'keep A'), I('or', 't2, t2, a1', 'channel B: bits 31:16'), I('sw', 't2, 0(t0)'), I('ret')],
 dma_copy: () => ['# dma_copy(dst, src, words): DMA channel 0 copies 32-bit words, unpaced (TREQ 63), and is waited for', 'dma_copy:',
 I('li', `t0, ${hex(base('DMA'))}`, 'DMA channel 0'), I('sw', `a1, ${off('DMA', 'CH0_READ_ADDR')}(t0)`, 'READ_ADDR = src'),
 I('sw', `a0, ${off('DMA', 'CH0_WRITE_ADDR')}(t0)`, 'WRITE_ADDR = dst'), I('sw', `a2, ${off('DMA', 'CH0_TRANS_COUNT')}(t0)`, 'TRANS_COUNT = words'),
 I('li', `t1, ${hex(1 | (2 << 2) | (1 << 4) | (1 << 6) | (0x3f << 17))}`, 'EN, words, both addresses increment, no chain, unpaced'),
 I('sw', `t1, ${off('DMA', 'CH0_CTRL_TRIG')}(t0)`, 'CTRL_TRIG: the write starts it'),
 '.Ldma_copy_wait:', I('lw', `t1, ${off('DMA', 'CH0_CTRL_TRIG')}(t0)`), I('li', `t2, ${hex(1 << 26)}`), I('and', 't1, t1, t2', 'BUSY'), I('bnez', 't1, .Ldma_copy_wait'), I('ret')],
 };
}
export function pico2Target({ clock } = {}) {
 const clk = clockConfig(clock);
 return {
 label: 'Hazard3 (RP2350), RV32IM',
 m: true,
 headers: { 'rp2350.h': { text: headerText(clk), stdint: true, builtins: HELPERS } },
 builtins: BASIC,
 startup: () => startup(clk),
 routines: routines(clk),
 needs: { delay_ms: ['delay_us'] },
 };
}
