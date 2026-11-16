/* pio-popcount.c -- PIO counts the 1 bits of a word: data in and out through its FIFOs.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * A PIO state machine cannot add, but it can count down. This program pulls a word from its TX FIFO
 * into the OSR, sets X to all ones (0xffffffff), then shifts the OSR out one bit at a time into Y and,
 * for every 1, decrements X; after 32 bits, ~X is the number of 1 bits, which it pushes into its
 * RX FIFO. The core writes words with pio_put and reads the answers with pio_get.
 * The PIO program is pio-popcount.pio, the second tab; Build assembles it into "pio-popcount.pio.h",
 * which gives popcount_program[] (its words) and popcount_length, popcount_wrap_target and
 * popcount_wrap; pio_load puts the words at address 0 of PIO0's instruction memory.
 * Try: Run, then step through it with the PIO tab open: watch the OSR empty and X count down.
 */
#include <rp2350.h>
#include "pio-popcount.pio.h"

void print(const char *s)
{
    while (*s)
        putchar(*s++);
}

void print_num(uint32_t n)
{
    if (n >= 10)
        print_num(n / 10);
    putchar('0' + n % 10);
}

void print_hex(uint32_t v)
{
    print("0x");
    for (int i = 28; i >= 0; i = i - 4)
        putchar("0123456789abcdef"[(v >> i) & 15]);
}

int main(void)
{
    uint32_t words[4] = { 0x00000001, 0x0000ffff, 0x80000001, 0xdeadbeef };
    pio_load(popcount_program, popcount_length);
    PIO0_SM0_EXECCTRL = (popcount_wrap << PIO_EXECCTRL_WRAP_TOP_LSB) | (popcount_wrap_target << PIO_EXECCTRL_WRAP_BOTTOM_LSB);
    PIO0_CTRL = 1;                      /* start state machine 0 */
    for (int i = 0; i < 4; i++) {
        pio_put(0, words[i]);
        uint32_t n = pio_get(0);
        print_hex(words[i]);
        print(" has ");
        print_num(n);
        print(" ones\n");
    }
    return 0;
}
