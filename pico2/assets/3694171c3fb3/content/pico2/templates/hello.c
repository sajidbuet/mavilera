/* hello.c -- Text and numbers on UART0 in MAVILERA C.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * putchar sends one character to UART0, the console. print sends a string; print_num a number
 * in decimal, its digits from the most significant, by calling itself for the others.
 * Try: Compile, then Run: the console shows the squares of 1 to 5. Then Reset and use Step line
 * (in the toolbar) into print_num, and watch it call itself.
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
    print("Hello, Pico 2! Squares:");
    for (int i = 1; i <= 5; i++) {
        putchar(' ');
        print_num(i * i);
    }
    putchar('\n');
    return 0;
}
