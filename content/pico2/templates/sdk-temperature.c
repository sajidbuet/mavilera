/* sdk-temperature.c -- The chip's temperature sensor in Pico SDK C: ADC input 4, in degrees Celsius.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA sample project, written for the application).
 *
 * adc_set_temp_sensor_enabled powers the sensor, a diode whose voltage falls by 1.721 mV for each
 * degree: 0.706 V at 27 C (RP2350 datasheet, 12.4.6). On the RP2350 of a Pico 2 (60 pins) it is ADC
 * input 4. The temperature is 27 - (V - 0.706) / 0.001721, computed here in floating point (the Hazard3
 * cores have no floating-point unit: the compiler calls library functions for it).
 * Try: Run, then set the Temperature in the Pins panel's Environment (for example 40 C) and run again.
 */
#include "pico/stdlib.h"
#include "hardware/adc.h"
#include <stdio.h>

#define TEMPERATURE_INPUT 4

int main(void)
{
    stdio_init_all();
    adc_init();
    adc_set_temp_sensor_enabled(true);
    adc_select_input(TEMPERATURE_INPUT);
    for (int i = 0; i < 5; i++) {
        uint16_t r = adc_read();
        float volts = r * 3.3f / 4096.0f;
        float celsius = 27.0f - (volts - 0.706f) / 0.001721f;
        printf("result %u, temperature %.2f C\n", r, celsius);
        sleep_ms(500);
    }
    while (true)
        sleep_ms(1000);
}
