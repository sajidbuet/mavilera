/* traffic-light.c -- A traffic light: three LEDs on GP16, GP17 and GP18, twice through its cycle.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * The circuit: a red LED on GP16, a yellow one on GP17, a green one on GP18, each through
 * 220 ohm to ground. The program writes the three pins together for each step of the cycle
 * red, red and yellow, green, yellow, and prints the step's name.
 * Try: Real time in the Board view and watch the lights; then Edit circuit and swap two LEDs'
 * colours with F2.
 */
#include <rp2350.h>

void print(const char *s)
{
    while (*s)
        putchar(*s++);
}

void lights(int red, int yellow, int green)
{
    pin_write(16, red);
    pin_write(17, yellow);
    pin_write(18, green);
}

int main(void)
{
    pin_output(16);
    pin_output(17);
    pin_output(18);
    for (int i = 0; i < 2; i++) {
        lights(1, 0, 0); print("red\n"); delay_ms(400);
        lights(1, 1, 0); print("red and yellow\n"); delay_ms(150);
        lights(0, 0, 1); print("green\n"); delay_ms(400);
        lights(0, 1, 0); print("yellow\n"); delay_ms(150);
    }
    lights(0, 0, 0);
    return 0;
}
