/* dma-sine.c -- A sine from DMA and PWM: the DMA feeds a table of levels to a PWM slice, one per period.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * The template chooses GP14 as the speaker (Pins panel). Turn Sound on and Run in Real time.
 * GP14 is output A of PWM slice 7. The slice counts 0..99 at clk_sys: a carrier of CLK_SYS_HZ / 100
 * (40 kHz at 4 MHz). At each wrap the slice asks the DMA for data (DREQ 32 + 7); DMA channel 0 then
 * writes the next word of the table into CH7_CC, and that level applies from the next period. The
 * read address wraps on 256 bytes (64 words) and the count never ends (ENDLESS), so the table
 * repeats: a sine of CLK_SYS_HZ / 100 / 64 Hz (625 Hz at 4 MHz). The core only waits.
 * A ring needs its table on a 256-byte boundary: dma_copy first puts the table there.
 * Try: the clk_sys option. At 1 MHz the carrier is 10 kHz, inside hearing: you hear it beside the
 * sine. At 12 MHz it is 120 kHz and the sine is higher. Change SECONDS for a longer note.
 */
#include <rp2350.h>

#define SPEAKER 14
#define SECONDS 3

/* 50 + 45 sin(2 pi k / 64), k = 0..63, rounded: levels of 100 counts per period */
uint32_t sine[64] = {
    50, 54, 59, 63, 67, 71, 75, 79, 82, 85, 88, 90, 92, 94, 94, 95,
    95, 95, 94, 94, 92, 90, 88, 85, 82, 79, 75, 71, 67, 63, 59, 54,
    50, 46, 41, 37, 33, 29, 25, 21, 18, 15, 12, 10, 8, 6, 6, 5,
    5, 5, 6, 6, 8, 10, 12, 15, 18, 21, 25, 29, 33, 37, 41, 46 };
uint32_t space[128];                            /* room for 64 words on a 256-byte boundary */

int main(void)
{
    uint32_t *ring = (uint32_t *)(((uint32_t)space + 255) & 0xffffff00);
    dma_copy(ring, sine, 64);                   /* channel 0 copies the table, then is free again */
    pwm_start(SPEAKER, 99, 1);                  /* slice 7: 100 counts per period */
    DMA_CH0_READ_ADDR = (uint32_t)ring;
    DMA_CH0_WRITE_ADDR = PWM_BASE + 7 * PWM_SLICE_BYTES + 0xc;  /* CH7_CC: A's level in bits 15:0 */
    DMA_CH0_TRANS_COUNT = DMA_COUNT_ENDLESS | 1;
    DMA_CH0_CTRL_TRIG = DMA_CTRL_EN_BIT | DMA_CTRL_SIZE_WORD | DMA_CTRL_INCR_READ_BIT
        | (8 << DMA_CTRL_RING_SIZE_LSB)         /* 2^8 = 256 bytes */
        | (0 << DMA_CTRL_CHAIN_TO_LSB)          /* channel 0 itself: no chain */
        | ((DMA_DREQ_PWM_WRAP0 + 7) << DMA_CTRL_TREQ_SEL_LSB);
    sleep_ms(SECONDS * 1000);                  /* the core sleeps: DMA and PWM go on */
    DMA_CH0_CTRL_TRIG = 0;                      /* EN off: the channel pauses */
    DMA_CHAN_ABORT = 1;                         /* and ends */
    pwm_level(SPEAKER, 0);
    delay_ms(1);
    return 0;
}
