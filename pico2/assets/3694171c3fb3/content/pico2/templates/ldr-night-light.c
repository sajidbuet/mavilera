/* ldr-night-light.c -- A night light: a light sensor (LDR) on GP27 turns an LED on GP16 on in the dark.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * The LDR's resistance falls as light rises (about 5.7k at 10 lux, a third of that at 100 lux). With
 * the 10k below it, GP27 is high in the light and lower in the dark: at the default 300 lux about
 * 3.07 V, at 2 lux about 1.3 V. Below 1.65 V the program calls it dark and lights the LED. It
 * reads twelve times, 100 ms apart, and prints each change.
 * Try: Run in Real time, open the Pins panel's Environment and set Light to 2 lux: the LED comes
 * on. Back to 300: it goes off.
 */
#include <rp2350.h>

void print(const char *s)
{
    while (*s)
        putchar(*s++);
}

int main(void)
{
    pin_output(16);
    int was = -1;
    for (int i = 0; i < 12; i++) {
        int mv = adc_read(1) * 3300 / 4096;
        int dark = mv < 1650;
        pin_write(16, dark);
        if (dark != was) {
            if (dark)
                print("dark: LED on\n");
            else
                print("light: LED off\n");
        }
        was = dark;
        delay_ms(100);
    }
    return 0;
}
