/* sdk-adc-knob.c -- Read a knob with the ADC in Pico SDK C: the voltage on GP26, ten times.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA sample project, written for the application).
 *
 * adc_init starts the ADC; adc_gpio_init(26) takes GP26's digital input off the pin so that it only
 * feeds ADC input 0; adc_select_input(0) chooses it; adc_read converts once: 0 to 4095 for 0 V to
 * 3.3 V. 3300 * result / 4096 is the voltage in millivolts, in whole numbers.
 * Try: in the Pins panel, set GP26 to 1.65 V and Run: about 2048 and 1650 mV. Then Run in Real time
 * and move the slider while it runs. On a Pico 2, a 10 kOhm potentiometer between 3V3 and GND with its
 * wiper on GP26 does the same.
 */
#include "pico/stdlib.h"
#include "hardware/adc.h"
#include <stdio.h>

int main(void)
{
    stdio_init_all();
    adc_init();
    adc_gpio_init(26);
    adc_select_input(0);
    printf("GP26 (ADC input 0):\n");
    for (int i = 0; i < 10; i++) {
        uint16_t r = adc_read();
        printf("result %u = %u mV\n", r, (unsigned)(r * 3300u / 4096u));
        sleep_ms(300);
    }
    while (true)
        sleep_ms(1000);
}
