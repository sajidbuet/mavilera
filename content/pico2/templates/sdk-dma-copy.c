/* sdk-dma-copy.c -- Copy memory with DMA in Pico SDK C: 64 words moved while the core waits.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA sample project, written for the application).
 *
 * A DMA channel moves data without the processor: it reads from one address and writes to another,
 * TRANS_COUNT times. dma_claim_unused_channel takes a free channel; the configuration says 32-bit
 * transfers, both addresses moving on after each one, and no pacing (DREQ_FORCE: as fast as it can).
 * dma_channel_configure with `true` starts it; dma_channel_wait_for_finish_blocking waits for the end.
 * Try: Run and open the DMA tab: the channel's addresses and count. Change the size to DMA_SIZE_8
 * and the count to 4 * WORDS.
 */
#include "pico/stdlib.h"
#include "hardware/dma.h"
#include <stdio.h>

#define WORDS 64

static uint32_t source[WORDS], target[WORDS];

int main(void)
{
    stdio_init_all();
    for (int i = 0; i < WORDS; i++)
        source[i] = (uint32_t)(i * i + 7);
    int ch = dma_claim_unused_channel(true);
    dma_channel_config c = dma_channel_get_default_config(ch);
    channel_config_set_transfer_data_size(&c, DMA_SIZE_32);
    channel_config_set_read_increment(&c, true);
    channel_config_set_write_increment(&c, true);
    dma_channel_configure(ch, &c, target, source, WORDS, true);
    dma_channel_wait_for_finish_blocking(ch);
    int same = 0;
    for (int i = 0; i < WORDS; i++)
        same += target[i] == source[i];
    printf("channel %d copied %d words; %d are equal\n", ch, WORDS, same);
    dma_channel_unclaim(ch);
    while (true)
        sleep_ms(1000);
}
