/* sdk-pwm-tone.c -- A tone from PWM in Pico SDK C: five notes on the speaker pin GP14.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA sample project, written for the application).
 *
 * The sample chooses GP14 as the speaker (Pins panel). A PWM slice counting 0..top at clk_sys / div
 * repeats every (top + 1) x div cycles of clk_sys, so the note's frequency is clk_sys / ((top + 1) x div);
 * the level (top + 1) / 2 gives a square wave. clock_get_hz(clk_sys) is the system clock the SDK set
 * (150 MHz), so a divider of 64 keeps top within 16 bits for these notes.
 * Try: turn Sound on (the speaker button in the toolbar) and Run in Real time. On a Pico 2, a small
 * piezo buzzer between GP14 and GND plays the same notes.
 */
#include "pico/stdlib.h"
#include "hardware/pwm.h"
#include "hardware/clocks.h"
#include <stdio.h>

#define SPEAKER 14
#define DIV 64
#define NOTE_MS 300

static const int notes[5] = { 523, 587, 659, 784, 1047 }; /* C5 D5 E5 G5 C6, in Hz */

int main(void)
{
    stdio_init_all();
    gpio_set_function(SPEAKER, GPIO_FUNC_PWM);
    uint slice = pwm_gpio_to_slice_num(SPEAKER);
    pwm_set_clkdiv_int_frac(slice, DIV, 0);
    pwm_set_enabled(slice, true);
    uint32_t sys = clock_get_hz(clk_sys);
    for (int i = 0; i < 5; i++) {
        uint32_t top = sys / DIV / notes[i] - 1;
        pwm_set_wrap(slice, top);
        pwm_set_gpio_level(SPEAKER, (top + 1) / 2);
        printf("%d Hz: top %lu\n", notes[i], (unsigned long)top);
        sleep_ms(NOTE_MS);
    }
    pwm_set_gpio_level(SPEAKER, 0);    /* silence: the pin stays low */
    while (true)
        sleep_ms(1000);
}
