/* adc-knob.c -- Read a knob with the ADC: the voltage on GP26, ten times.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * GP26 is ADC input 0. A knob (a potentiometer between 0 V and 3.3 V) on it gives a voltage
 * that adc_read turns into a number from 0 to 4095: 4096 steps of 3.3 V / 4096 = about 0.8 mV.
 * The program reads it ten times, 300 ms apart, and prints the number and the millivolts
 * (no floating point: 3300 mV x result / 4096 in whole numbers).
 * Try: in the Pins panel, set GP26 to 1.65 V and Run: about 2048 and 1650 mV. Then Run in Real
 * time and move the GP26 slider while it runs: the next reading follows. The ADC tab
 * shows the ADC's input, RESULT and how many conversions it made.
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
    print("GP26 (ADC input 0):\n");
    for (int i = 0; i < 10; i++) {
        int r = adc_read(0);
        int mv = r * 3300 / 4096;
        print("result ");
        print_num(r);
        print(" = ");
        print_num(mv);
        print(" mV\n");
        sleep_ms(300);
    }
    return 0;
}
