/* time-us.c -- Measuring time with TIMER0: time_us before and after.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * time_us reads TIMER0, which the start-up makes count microseconds. The program times 1000
 * additions in a loop and prints how long they took. The core runs at the clk_sys chosen in
 * the toolbar (CLK_SYS_HZ): at 4 MHz one microsecond is 4 clock cycles of Hazard3.
 * Try: Compile, then Run. Set Translation to Register, build and run again: fewer loads and
 * stores, fewer microseconds. Change clk_sys to 12 MHz: the same cycles take a third of the
 * time. The Core view shows where the cycles go.
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
    int s = 0;
    int start = time_us();
    for (int i = 0; i < 1000; i++)
        s = s + i;
    int took = time_us() - start;
    print("1000 additions took ");
    print_num(took);
    print(" us\n");
    return s;
}
