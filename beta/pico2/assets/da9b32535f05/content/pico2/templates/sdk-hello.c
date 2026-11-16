/* sdk-hello.c -- Hello in Pico SDK C: printf to UART0, once a second.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA sample project, written for the application).
 *
 * stdio_init_all() connects printf to UART0 (GP0 TX, GP1 RX, 115200 bit/s, 8N1). Here UART0 is the
 * console; on a board it is a USB-UART adapter on GP0, GP1 and GND, or the USB cable itself when the
 * Project menu's Output is "UART and USB". The SDK sends "\r\n" for each "\n".
 * Try: Build and Run: the squares of 1 to 5, then a line each second. On a Pico 2: Load to Pico,
 * connect the Hardware tab's UART monitor and press Compare with the simulator.
 */
#include "pico/stdlib.h"
#include <stdio.h>

int main(void)
{
    stdio_init_all();
    printf("Hello, Pico 2! Squares:");
    for (int i = 1; i <= 5; i++)
        printf(" %d", i * i);
    printf("\n");
    for (int n = 1;; n++) {
        sleep_ms(1000);
        printf("still running: %d s\n", n);
    }
}
