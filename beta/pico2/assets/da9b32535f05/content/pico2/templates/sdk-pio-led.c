/* sdk-pio-led.c -- PIO drives the LED in Pico SDK C: the core sends 1 and 0, a state machine sets the pin.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA sample project, written for the application).
 *
 * The project's second file, sdk-pio-led.pio, is a PIO program of two instructions: wait for a word
 * from the TX FIFO (pull block), then shift its lowest bit out to the pin (out pins, 1). Building turns
 * the .pio file into sdk-pio-led.pio.h, which holds the program and the led_follow_init function from
 * its "% c-sdk" block. pio_add_program loads it into PIO0's instruction memory; pio_sm_put_blocking
 * puts a word into state machine 0's TX FIFO.
 * Try: Run in Real time and watch GP25, and the PIO tab: the FIFO and the state machine's PC. Then
 * change the .pio program to `out pins, 1 [31]` and look at the delay between the pin changes.
 */
#include "pico/stdlib.h"
#include "hardware/pio.h"
#include "sdk-pio-led.pio.h"
#include <stdio.h>

#define LED 25

int main(void)
{
    stdio_init_all();
    PIO pio = pio0;
    uint sm = 0;
    uint offset = pio_add_program(pio, &led_follow_program);
    led_follow_init(pio, sm, offset, LED);
    printf("PIO program at offset %u\n", offset);
    for (int i = 0; i < 10; i++) {
        pio_sm_put_blocking(pio, sm, i & 1 ? 0 : 1);
        sleep_ms(200);
    }
    printf("done\n");
    while (true)
        sleep_ms(1000);
}
