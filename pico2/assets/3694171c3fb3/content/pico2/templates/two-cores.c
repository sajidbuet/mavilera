/* two-cores.c -- Two cores, two LEDs: core 1 blinks GP15 while core 0 blinks GP25.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * After reset core 1 waits in the bootrom. core1_start() wakes it with the launch handshake through
 * the SIO FIFO (see core1_start in the generated assembly) and core 1 runs core1_main with a stack of
 * its own. Both cores then run at once: core 0 changes GP25 ten times, 100 ms apart; core 1 changes
 * GP15 six times, 150 ms apart, and sends its core number through the FIFO when it is done. core 0
 * waits for that word (fifo_pop sleeps until it comes) and returns it: the exit code is 1.
 * Try: Run in Real time with the Pins panel open. Step: core 0 steps one instruction and core 1 runs
 * alongside; watch the "Core 1" registers. Change core 1's delay and see who finishes first.
 */
#include <rp2350.h>

#define LED0 25
#define LED1 15

void core1_main(void)
{
    pin_output(LED1);
    for (int i = 0; i < 6; i++) {
        pin_write(LED1, 1 - (i & 1));
        delay_ms(150);
    }
    fifo_push(core_id());       /* 1: core 1 is done */
}

int main(void)
{
    pin_output(LED0);
    core1_start();
    for (int i = 0; i < 10; i++) {
        pin_write(LED0, 1 - (i & 1));
        delay_ms(100);
    }
    return fifo_pop();          /* waits for core 1's word */
}
