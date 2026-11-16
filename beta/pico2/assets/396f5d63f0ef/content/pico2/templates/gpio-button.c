/* gpio-button.c -- A button on GP15: each press changes the LED and is counted; the fifth ends the program.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * The Pins panel drives a pin from outside the chip, as a button would. Think of a button that
 * connects GP15 to ground while it is pressed: pin_input turns on the pad's pull-up, so the pin reads
 * 1 while nothing drives it. In the Pins panel, Low is pressed and Released is released.
 * The program reads GP15 again and again and remembers the level it read last: a press is a change
 * from 1 to 0, not a 0. Each press changes GP25 and sends "press n" to the console.
 * Try: open the Pins panel, Run in Real time, then set GP15 to Low and back to Released five times.
 * Then change the test to count low readings (now == 0) and press once: why does it end at once?
 * A real button bounces for a few milliseconds; the Pins panel's does not.
 */
#include <rp2350.h>

#define BUTTON 15
#define LED 25

void print_num(int n)
{
    if (n >= 10)
        print_num(n / 10);
    putchar('0' + n % 10);
}

int main(void)
{
    pin_input(BUTTON);
    pin_output(LED);
    int last = pin_read(BUTTON);
    int presses = 0;
    while (presses < 5) {
        int now = pin_read(BUTTON);
        if (last == 1 && now == 0) {        /* a change from high to low: a press */
            presses++;
            pin_write(LED, presses & 1);
            putchar('p'); putchar('r'); putchar('e'); putchar('s'); putchar('s'); putchar(' ');
            print_num(presses);
            putchar('\n');
        }
        last = now;
    }
    return presses;
}
