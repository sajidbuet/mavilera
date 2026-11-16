/* sdk-spi-loopback.c -- SPI in loopback, in Pico SDK C: SPI0 sends four bytes and receives each one back.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA sample project, written for the application).
 *
 * SPI sends and receives at the same time: each clock pulse shifts a bit out on MOSI and one in from
 * MISO. spi_init starts SPI0 at 1 MHz, 8-bit frames, mode 0. The SDK has no call for the PL022's loop
 * back, so the program sets SSPCR1.LBM itself through the block's registers (spi_get_hw): every byte
 * sent then comes back without a wire. spi_write_read_blocking sends `out` and fills `in`.
 * Try: Run and watch the SPI tab. Remove the hw_set_bits line: nothing is wired to MISO, every byte
 * reads 0. On a Pico 2 without the loop back, a wire from GP19 (MOSI) to GP16 (MISO) does the same,
 * with spi0 on GP16-GP19 (gpio_set_function with GPIO_FUNC_SPI).
 */
#include "pico/stdlib.h"
#include "hardware/spi.h"
#include <stdio.h>

int main(void)
{
    stdio_init_all();
    spi_init(spi0, 1000 * 1000);
    hw_set_bits(&spi_get_hw(spi0)->cr1, SPI_SSPCR1_LBM_BITS);
    const uint8_t out[4] = { 0x11, 0x22, 0x33, 0x44 };
    uint8_t in[4] = { 0 };
    spi_write_read_blocking(spi0, out, in, 4);
    int sum = 0;
    for (int i = 0; i < 4; i++) {
        printf("sent 0x%02x, received 0x%02x\n", out[i], in[i]);
        sum += in[i];
    }
    printf("sum 0x%02x\n", sum);
    while (true)
        sleep_ms(1000);
}
