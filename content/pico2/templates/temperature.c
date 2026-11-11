/* temperature.c -- The chip's temperature sensor: ADC input 4.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * Inside the RP2350 a diode's voltage falls by 1.721 mV for each degree: 0.706 V at 27 °C
 * (RP2350 datasheet, 12.4.6). adc_read(4) converts it. In tenths of a millivolt
 * v = result x 33000 / 4096, and the temperature in hundredths of a degree is
 * 2700 - (v - 7060) x 10000 / 1721. The program prints it five times, half a second apart.
 * Try: Run, then set the Temperature in the Pins panel's Environment (for example 40 °C) and run
 * again. A reading moves by about 2 °C per step of the 12-bit result: the sensor is coarse.
 */
#include <rp2350.h>

void print(const char *s)
{
    while (*s)
        putchar(*s++);
}

void print_num(int n)
{
    if (n < 0) {
        putchar('-');
        n = -n;
    }
    if (n >= 10)
        print_num(n / 10);
    putchar('0' + n % 10);
}

int main(void)
{
    for (int i = 0; i < 5; i++) {
        int r = adc_read(ADC_TEMPERATURE_INPUT);
        int v = r * 33000 / 4096;
        int t = 2700 - (v - 7060) * 10000 / 1721;
        print("result ");
        print_num(r);
        print(", temperature ");
        print_num(t / 100);
        putchar('.');
        putchar('0' + (t % 100) / 10);
        putchar('0' + t % 10);
        print(" C\n");
        sleep_ms(500);
    }
    return 0;
}
