/* circuit-led.c -- An LED and its resistor on GP16: a circuit on the Board.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * The circuit that comes with this program (open the Board view): GP16, a 220 ohm resistor, a red
 * LED, ground. While the program drives GP16 high, a current flows through all three: about
 * (3.3 V - 1.65 V) / (45 + 220 + 25) ohm = 5.7 mA (1.65 V and 25 ohm are the LED's, from its
 * datasheet's curve; 45 ohm is the pin's own output resistance). The LED blinks five times.
 * Try: click the LED on the Board while it is lit: Inspect gives its current. Then Edit circuit,
 * select the resistor, F2, type 1k and run again: the LED is dimmer (about 1.5 mA).
 */
#include <rp2350.h>

int main(void)
{
    pin_output(16);
    for (int i = 0; i < 5; i++) {
        pin_write(16, 1);
        delay_ms(200);
        pin_write(16, 0);
        delay_ms(200);
    }
    return 0;
}
