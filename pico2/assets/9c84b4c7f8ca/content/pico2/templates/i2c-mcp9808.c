/* i2c-mcp9808.c -- An I2C temperature sensor: the MCP9808 of the lab kit, at address 0x18.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * I2C is two wires shared by many parts: the master (the RP2350) sends START, a 7-bit address and
 * a read/write bit; the part with that address acknowledges. The MCP9808 keeps its temperature in
 * register 5 as 16 bits, most significant byte first: bits 12-0 are sixteenths of a degree,
 * bit 12 the sign. The program first writes the register number (keeping the bus: nostop), then
 * reads two bytes, three times a second apart. This template chooses Parts: lab kit.
 * Try: Run, then change the Temperature in the Pins panel's Environment and run again. Set Parts
 * to none and run: no part answers (i2c_write gives -1). The I2C tab lists each
 * transfer: address, direction, bytes.
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
    uint8_t reg[1];
    uint8_t b[2];
    i2c_setup(100);
    for (int i = 0; i < 3; i++) {
        reg[0] = 5;
        if (i2c_write(0x18, reg, 1, 1) < 0) {
            print("No part answers at 0x18: choose Parts: lab kit in the Pins panel.\n");
            return 1;
        }
        i2c_read(0x18, b, 2);
        int raw = ((b[0] & 0x1f) << 8) | b[1];
        if (raw & 0x1000)
            raw = raw - 0x2000;
        print("MCP9808: ");
        if (raw < 0) {
            putchar('-');
            raw = -raw;
        }
        print_num(raw / 16);
        putchar('.');
        int frac = (raw % 16) * 10000 / 16;
        putchar('0' + frac / 1000);
        putchar('0' + frac / 100 % 10);
        putchar('0' + frac / 10 % 10);
        putchar('0' + frac % 10);
        print(" C\n");
        sleep_ms(1000);
    }
    return 0;
}
