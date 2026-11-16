/* sdk-i2c-mcp9808.c -- An I2C temperature sensor in Pico SDK C: the lab kit's MCP9808 at 0x18.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA sample project, written for the application).
 *
 * i2c_init starts I2C0 at 100 kHz; GP4 (SDA) and GP5 (SCL) are given to it with their pull-ups on (the
 * kit has its own 4.7 kOhm pull-ups as well). The MCP9808 keeps the temperature in register 5: two
 * bytes, most significant first; bits 12-0 are sixteenths of a degree, bit 12 the sign. The program
 * writes the register number keeping the bus (nostop = true: a repeated START follows), then reads
 * two bytes. i2c_write_blocking returns the number of bytes, or PICO_ERROR_GENERIC when no part
 * answers. This sample chooses Parts: lab kit.
 * Try: Run, then change the Temperature in the Pins panel's Environment and run again. The I2C tab
 * lists each transfer.
 */
#include "pico/stdlib.h"
#include "hardware/i2c.h"
#include <stdio.h>

#define SDA 4
#define SCL 5
#define MCP9808 0x18

int main(void)
{
    stdio_init_all();
    i2c_init(i2c0, 100 * 1000);
    gpio_set_function(SDA, GPIO_FUNC_I2C);
    gpio_set_function(SCL, GPIO_FUNC_I2C);
    gpio_pull_up(SDA);
    gpio_pull_up(SCL);
    for (int i = 0; i < 3; i++) {
        uint8_t reg = 5, b[2];
        if (i2c_write_blocking(i2c0, MCP9808, &reg, 1, true) != 1) {
            printf("No part answers at 0x18: choose Parts: lab kit in the Pins panel.\n");
            break;
        }
        i2c_read_blocking(i2c0, MCP9808, b, 2, false);
        int raw = ((b[0] & 0x1f) << 8) | b[1];
        if (raw & 0x1000)
            raw -= 0x2000;
        int sign = raw < 0;
        if (sign)
            raw = -raw;
        printf("MCP9808: %s%d.%04d C\n", sign ? "-" : "", raw / 16, (raw % 16) * 625);
        sleep_ms(1000);
    }
    while (true)
        sleep_ms(1000);
}
