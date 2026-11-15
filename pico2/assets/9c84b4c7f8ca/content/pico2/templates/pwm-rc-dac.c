/* pwm-rc-dac.c -- A voltage from PWM: GP16's square wave through 10k into 1 uF, read back on GP27.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * The RP2350 has no digital-to-analogue converter, but a PWM pin and a filter make one: the
 * capacitor charges while the pin is high and discharges while it is low, and because it does so
 * slowly (10k x 1 uF = 10 ms, much longer than the PWM period of 400 clock cycles) it settles at
 * the average: duty x 3.3 V. The program sets the duty to 25 %, 50 % and 75 %, waits 100 ms
 * (ten time constants) and reads the capacitor's voltage with the ADC: about 825, 1650 and
 * 2475 mV, a few millivolts of ripple aside. Every PWM edge is simulated exactly.
 * Try: Edit circuit, make the capacitor 100n (F2): faster, but the ripple grows tenfold.
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
    adc_read(1);              /* the ADC on, and GP27's pulls off */
    pwm_start(16, 399, 1);    /* a period of 400 clock cycles */
    for (int duty = 25; duty <= 75; duty = duty + 25) {
        pwm_level(16, duty * 4);
        delay_ms(100);
        int mv = adc_read(1) * 3300 / 4096;
        print("duty ");
        print_num(duty);
        print(" %: ");
        print_num(mv);
        print(" mV\n");
    }
    return 0;
}
