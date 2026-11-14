/* blink.c -- Blink the LED in MAVILERA C: pin_output, pin_write and delay_ms.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * The start-up code before main (see the Listing's Generated assembly tab) runs the chip from
 * its 12 MHz crystal at the clk_sys chosen in the toolbar and starts TIMER0; <rp2350.h>
 * declares the helpers. The LED on GP25
 * changes ten times, 100 ms apart. (On a Pico 2 W the LED is on the wireless chip.)
 * Try: Compile, then Step line (in the toolbar): the marked line in the editor follows the program
 * into blink and back. Click the gutter beside delay_ms to stop there on each turn.
 */
#include <rp2350.h>

#define LED 25

void blink(int times, int ms)
{
    int on = 0;
    for (int i = 0; i < times; i++) {
        on = 1 - on;
        pin_write(LED, on);
        delay_ms(ms);
    }
}

int main(void)
{
    pin_output(LED);
    blink(10, 100);
    return 0;
}
