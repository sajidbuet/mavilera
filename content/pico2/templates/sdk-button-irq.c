/* sdk-button-irq.c -- A button on GP15 by interrupt: each press changes the LED and is counted.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA sample project, written for the application).
 *
 * The button connects GP15 to ground while it is pressed; gpio_pull_up makes the pin read 1 while it
 * is released. gpio_set_irq_enabled_with_callback asks IO_BANK0 for an interrupt on each falling
 * edge (a press) and installs on_edge as the handler: the main loop only sleeps and prints when the
 * count has changed. `volatile` tells the compiler that the handler changes `presses` behind main's
 * back. A real button bounces, so one press may count twice; the Pins panel's does not.
 * Try: open the Pins panel, Run in Real time, and set GP15 to Low and back to Released a few times.
 */
#include "pico/stdlib.h"
#include <stdio.h>

#define BUTTON 15
#define LED 25

static volatile int presses = 0;

static void on_edge(uint gpio, uint32_t events)
{
    if (gpio == BUTTON && (events & GPIO_IRQ_EDGE_FALL)) {
        presses++;
        gpio_put(LED, presses & 1);
    }
}

int main(void)
{
    stdio_init_all();
    gpio_init(LED);
    gpio_set_dir(LED, GPIO_OUT);
    gpio_init(BUTTON);
    gpio_pull_up(BUTTON);
    gpio_set_irq_enabled_with_callback(BUTTON, GPIO_IRQ_EDGE_FALL, true, &on_edge);
    printf("Press the button on GP15.\n");
    int shown = 0;
    while (true) {
        if (presses != shown) {
            shown = presses;
            printf("press %d\n", shown);
        }
        sleep_ms(1);
    }
}
