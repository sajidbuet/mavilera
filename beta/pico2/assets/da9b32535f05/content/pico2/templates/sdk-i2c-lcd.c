/* sdk-i2c-lcd.c -- Text on an I2C LCD in Pico SDK C: the lab kit's 16 x 2 display at address 0x27.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA sample project, written for the application).
 *
 * The display's controller (an HD44780) takes 4 data bits at a time; a PCF8574 port expander puts each
 * I2C byte on eight wires: bit 0 RS (0 command, 1 character), bit 2 E (the controller takes the data
 * when E falls), bit 3 the backlight, bits 7-4 the data. So one character is four I2C bytes: the high
 * half with E high, then E low, then the low half the same way. The start-up 3, 3, 3, 2 puts the
 * controller into 4-bit mode. This sample chooses Parts: lab kit (I2C0 on GP4 and GP5).
 * Try: Run, and watch the LCD in the Pins panel (or the I2C tab) count from 0 to 9. Change the text;
 * lcd_cursor(1, 0) is the start of the second line. On a Pico 2, a 1602 display with a PCF8574
 * backpack at 0x27 shows the same (its own supply may be 5 V: check its I2C levels first).
 */
#include "pico/stdlib.h"
#include "hardware/i2c.h"

#define SDA 4
#define SCL 5
#define LCD 0x27
#define BACKLIGHT 0x08
#define ENABLE 0x04

static void lcd_out(uint8_t v)
{
    i2c_write_blocking(i2c0, LCD, &v, 1, false);
    sleep_us(50);
}

/* half a byte: the four data bits with E high, then with E low */
static void lcd_half(uint8_t bits, uint8_t rs)
{
    uint8_t v = (uint8_t)(bits << 4) | BACKLIGHT | rs;
    lcd_out(v | ENABLE);
    lcd_out(v);
}

static void lcd_send(uint8_t byte, uint8_t rs)
{
    lcd_half(byte >> 4, rs);
    lcd_half(byte & 15, rs);
}

static void lcd_text(const char *s)
{
    while (*s)
        lcd_send((uint8_t)*s++, 1);
}

static void lcd_cursor(int line, int col)
{
    lcd_send(0x80 | (line * 0x40 + col), 0);
}

int main(void)
{
    i2c_init(i2c0, 100 * 1000);
    gpio_set_function(SDA, GPIO_FUNC_I2C);
    gpio_set_function(SCL, GPIO_FUNC_I2C);
    gpio_pull_up(SDA);
    gpio_pull_up(SCL);
    sleep_ms(50);                       /* the display's own start after power-up */
    lcd_half(3, 0);
    lcd_half(3, 0);
    lcd_half(3, 0);
    lcd_half(2, 0);
    lcd_send(0x28, 0);                  /* two lines, 5 x 8 dots */
    lcd_send(0x0c, 0);                  /* display on, no cursor */
    lcd_send(0x06, 0);                  /* move right after each character */
    lcd_send(0x01, 0);                  /* clear */
    sleep_ms(2);
    lcd_cursor(0, 1);
    lcd_text("Hello, Pico 2!");
    for (int i = 0; i < 10; i++) {
        lcd_cursor(1, 0);
        lcd_text("count: ");
        lcd_send('0' + i, 1);
        sleep_ms(200);
    }
    while (true)
        sleep_ms(1000);
}
