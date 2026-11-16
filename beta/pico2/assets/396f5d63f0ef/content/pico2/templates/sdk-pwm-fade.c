/* sdk-pwm-fade.c -- Fade the LED with PWM in Pico SDK C: the duty cycle up and down.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA sample project, written for the application).
 *
 * gpio_set_function gives GP25 to its PWM slice (slice 4, channel B). The slice counts 0..WRAP and
 * keeps the pin high while the count is below the level, so level / (WRAP + 1) is the fraction of time
 * the LED is on: the eye sees it as brightness. The level rises in 20 steps and falls again, twice.
 * Try: Run in Real time and watch GP25 on the Board tab, or the PWM tab's duty. Change STEP_MS.
 */
#include "pico/stdlib.h"
#include "hardware/pwm.h"
#include <stdio.h>

#define LED 25
#define WRAP 999
#define STEP_MS 25

int main(void)
{
    stdio_init_all();
    gpio_set_function(LED, GPIO_FUNC_PWM);
    uint slice = pwm_gpio_to_slice_num(LED);
    pwm_set_wrap(slice, WRAP);
    pwm_set_enabled(slice, true);
    for (int round = 0; round < 2; round++) {
        for (int level = 0; level <= WRAP + 1; level += 50) {
            pwm_set_gpio_level(LED, level);
            sleep_ms(STEP_MS);
        }
        for (int level = WRAP + 1; level >= 0; level -= 50) {
            pwm_set_gpio_level(LED, level);
            sleep_ms(STEP_MS);
        }
    }
    printf("faded twice; slice %u\n", slice);
    while (true)
        sleep_ms(1000);
}
