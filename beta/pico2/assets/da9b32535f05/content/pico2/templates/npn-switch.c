/* npn-switch.c -- A transistor switches an LED: GP17 drives an NPN transistor's base through 1k.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * The LED and its 330 ohm resistor hang from 3.3 V into the transistor's collector; its emitter is
 * on ground. With GP17 low, no base current flows: the transistor is cut off and the LED dark.
 * With GP17 high, a base current of about (3.3 - 0.64) V / (1k + ...) = 0.7 mA flows; the
 * transistor (a BC547B, gain about 290) could pass 290 times as much, more than the LED's
 * resistor allows, so it is saturated: about 0.06 V from collector to emitter, and the LED carries
 * (3.3 - 1.84 - 0.06) V / 350 ohm = 4 mA. The pin itself gives only the base current.
 * Try: click the transistor and the LED on the Board while the LED is lit: Inspect gives both
 * currents. Make the base resistor 1M: the base current is too small, the LED is dim (the
 * transistor is active, not saturated).
 */
#include <rp2350.h>

void print(const char *s)
{
    while (*s)
        putchar(*s++);
}

int main(void)
{
    pin_output(17);
    for (int i = 0; i < 3; i++) {
        pin_write(17, 1);
        print("base high: the transistor conducts, the LED is on\n");
        delay_ms(300);
        pin_write(17, 0);
        print("base low: the transistor is cut off, the LED is off\n");
        delay_ms(300);
    }
    return 0;
}
