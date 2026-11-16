/* sdk-blink.c -- Blink the LED in Pico SDK C: gpio_init, gpio_set_dir, gpio_put and sleep_ms.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA sample project, written for the application).
 *
 * gpio_init gives GP25 to the SIO (the processors' own GPIO block) as an input; gpio_set_dir makes it
 * an output and gpio_put drives it. sleep_ms waits on TIMER0 with the core asleep between ticks.
 * On a Pico 2 the LED is on GP25; on a Pico 2 W it is on the wireless chip, so this program does
 * not light it there.
 * Try: Run in Real time and watch GP25 in the Pins panel or on the Board tab: 250 ms on, 250 ms off.
 * Change BLINK_MS and run again.
 */
#include "pico/stdlib.h"

#define LED 25
#define BLINK_MS 250

int main(void)
{
    gpio_init(LED);
    gpio_set_dir(LED, GPIO_OUT);
    while (true) {
        gpio_put(LED, 1);
        sleep_ms(BLINK_MS);
        gpio_put(LED, 0);
        sleep_ms(BLINK_MS);
    }
}
