/* sdk-timer.c -- A repeating timer in Pico SDK C: a callback every 100 ms, measured with time_us_64.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA sample project, written for the application).
 *
 * add_repeating_timer_ms sets an alarm of TIMER0; when it fires, the alarm's interrupt calls tick, which
 * changes the LED and counts. A negative period (-100) means 100 ms from one start of tick to the next,
 * however long tick takes. time_us_64 reads TIMER0's 64-bit microsecond count. Returning false from
 * tick would stop the timer; cancel_repeating_timer stops it from outside.
 * Try: Run: ten ticks take about 1000000 us. Change the period to -250 and run again.
 */
#include "pico/stdlib.h"
#include <stdio.h>

#define LED 25

static volatile int ticks = 0;

static bool tick(repeating_timer_t *t)
{
    (void)t;
    ticks++;
    gpio_put(LED, ticks & 1);
    return true;                        /* keep repeating */
}

int main(void)
{
    stdio_init_all();
    gpio_init(LED);
    gpio_set_dir(LED, GPIO_OUT);
    repeating_timer_t timer;
    uint64_t start = time_us_64();
    add_repeating_timer_ms(-100, tick, NULL, &timer);
    while (ticks < 10)
        tight_loop_contents();
    uint64_t took = time_us_64() - start;
    cancel_repeating_timer(&timer);
    printf("10 ticks took %llu us\n", took);
    while (true)
        sleep_ms(1000);
}
