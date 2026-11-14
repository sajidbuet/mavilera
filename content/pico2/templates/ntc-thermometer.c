/* ntc-thermometer.c -- A thermometer: a thermistor (NTC) below 10k on GP28 (ADC input 2).
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * An NTC thermistor's resistance falls as it warms: 10k at 25 C, and R = 10k x exp(B x (1/T -
 * 1/298.15 K)) with B = 3977 K (its datasheet's values). With 10k above it, GP28 gives
 * 3.3 V x R / (10k + R): 1650 mV at 25 C, less when warmer. Without floating point, the program
 * keeps the voltage of every 5 degrees from 0 to 60 C in a table (worked out from the formula)
 * and prints the temperature whose voltage is nearest.
 * Try: set the Environment's Temperature in the Pins panel and run again.
 */
#include <rp2350.h>

int table[13] = { 2548, 2386, 2210, 2025, 1837, 1650, 1469, 1298, 1140, 996, 867, 753, 652 };

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
        int mv = adc_read(2) * 3300 / 4096;
        int best = 0;
        for (int k = 1; k < 13; k++) {
            int d = table[k] - mv, e = table[best] - mv;
            if (d < 0) d = -d;
            if (e < 0) e = -e;
            if (d < e) best = k;
        }
        print("GP28 = ");
        print_num(mv);
        print(" mV: about ");
        print_num(best * 5);
        print(" C\n");
        delay_ms(300);
    }
    return 0;
}
