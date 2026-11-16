/* rc-debounce.c -- A button that bounces, smoothed by a capacitor: counts the presses on GP14.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * A real button's contacts bounce: for a fraction of a millisecond they open and close several
 * times. Read straight, one press would count as several. Here a 10k pull-up and a 100 nF
 * capacitor hold GP14: the button empties the capacitor at once (pin low), but between bounces
 * the 10k refills it slowly (time constant 10k x 100 nF = 1 ms), so the pin stays below its
 * switching point and reads low until the button is let go. The program counts the high-to-low
 * changes it sees for 600 ms.
 * Try: Run in Real time and press SW1 on the Board (or Space on it) a few times. Then Edit circuit
 * and delete the capacitor: each press still counts once here, because the drawn button does
 * not bounce; a bouncing press (the tests give one) would count several times.
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
    pin_input(14);
    int presses = 0;
    int was = pin_read(14);
    uint32_t start = time_us();
    while (time_us() - start < 600000) {
        int now = pin_read(14);
        if (was == 1 && now == 0) {
            presses = presses + 1;
            print("press ");
            print_num(presses);
            print("\n");
        }
        was = now;
    }
    return presses;
}
