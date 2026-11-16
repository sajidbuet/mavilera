/* sdk-two-cores.c -- Two cores in Pico SDK C: core 1 squares the numbers core 0 sends through the FIFO.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA sample project, written for the application).
 *
 * multicore_launch_core1 starts core 1 at core1_main with its own stack. The SIO has two FIFOs, one
 * each way: multicore_fifo_push_blocking puts a word into the other core's, multicore_fifo_pop_blocking
 * waits for one from it. Core 0 sends 1 to 5; core 1 sends back each square; core 0 prints them.
 * Including pico/multicore.h makes the build link pico_multicore.
 * Try: Run, and watch both cores in the Registers panel's core 1 group. Change core1_main to send
 * n * n * n.
 */
#include "pico/stdlib.h"
#include "pico/multicore.h"
#include <stdio.h>

static void core1_main(void)
{
    while (true) {
        uint32_t n = multicore_fifo_pop_blocking();
        multicore_fifo_push_blocking(n * n);
    }
}

int main(void)
{
    stdio_init_all();
    multicore_launch_core1(core1_main);
    for (uint32_t n = 1; n <= 5; n++) {
        multicore_fifo_push_blocking(n);
        printf("core 1: %lu squared is %lu\n", (unsigned long)n, (unsigned long)multicore_fifo_pop_blocking());
    }
    while (true)
        sleep_ms(1000);
}
