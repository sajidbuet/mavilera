/* sdk-uart-echo.c -- Echo over UART in capitals, in Pico SDK C: getchar and putchar on UART0.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA sample project, written for the application).
 *
 * getchar waits for a character from UART0 (the console's input line here; on a board, what the
 * Hardware tab's UART monitor sends). Each letter goes back as a capital; Enter (CR) ends the line.
 * Try: Run in Real time, type a line in "Send to UART0" below the console and press Enter.
 * On a Pico 2, send a line from the UART monitor (line end CR).
 */
#include "pico/stdlib.h"
#include <stdio.h>
#include <ctype.h>

int main(void)
{
    stdio_init_all();
    printf("Type a line:\n");
    while (true) {
        int c = getchar();
        if (c == '\r' || c == '\n')
            printf("\n");
        else
            putchar(toupper(c));
    }
}
