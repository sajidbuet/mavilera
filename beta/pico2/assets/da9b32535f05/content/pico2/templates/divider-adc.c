/* divider-adc.c -- A voltage divider into the ADC: two 10k resistors between 3.3 V and ground, the
 * middle on GP27 (ADC input 1).
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * Two equal resistors halve the voltage: 3.3 V x 10k / (10k + 10k) = 1.65 V, which the 12-bit ADC
 * reads as 1.65 / 3.3 x 4096 = 2048. adc_read also turns off GP27's pull-down, as the SDK's
 * adc_gpio_init does: left on, its 64k in parallel with the lower 10k would pull the middle down.
 * Try: Edit circuit, make the upper resistor 4k7 (F2) and run: 3.3 x 10 / 14.7 = 2.24 V.
 */
#include <rp2350.h>

void print(const char *s)
{
    while (*s)
        putchar(*s++);
}

void print_num(int n)
{
    if (n >= 10)
        print_num(n / 10);
    putchar('0' + n % 10);
}

int main(void)
{
    for (int i = 0; i < 3; i++) {
        int r = adc_read(1);
        print("GP27: ");
        print_num(r);
        print(" = ");
        print_num(r * 3300 / 4096);
        print(" mV\n");
        delay_ms(100);
    }
    return 0;
}
