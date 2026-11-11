/* i2c-lcd.c -- Text on an I2C LCD: the lab kit's 16 x 2 display at address 0x27.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * The display's controller (an HD44780) takes 4 data bits at a time; a PCF8574 port expander puts
 * each I2C byte on eight wires: bit 0 RS (0 command, 1 character), bit 2 E (the controller reads
 * the data when E falls), bit 3 the backlight, bits 7-4 the data. So one character is four I2C
 * writes: the high half with E high, then E low, then the low half the same way. The start-up
 * sequence 3, 3, 3, 2 puts the controller into 4-bit mode. This template chooses Parts: lab kit.
 * Try: Run, and watch the LCD in the Pins panel (or the I2C tab) count from 0 to 9.
 * Change the text and run again; set_cursor(1, 0) is the start of the second line.
 */
#include <rp2350.h>

uint8_t out[1];

void lcd_out(int v)
{
    out[0] = v;
    i2c_write(0x27, out, 1, 0);
}

/* half a byte: the four data bits with E high, then with E low */
void lcd_half(int bits, int rs)
{
    int v = (bits << 4) | 8 | rs;   /* 8: the backlight on */
    lcd_out(v | 4);
    delay_us(50);
    lcd_out(v);
    delay_us(50);
}

void lcd_send(int byte, int rs)
{
    lcd_half(byte >> 4, rs);
    lcd_half(byte & 15, rs);
}

void lcd_text(const char *s)
{
    while (*s)
        lcd_send(*s++, 1);
}

void set_cursor(int line, int col)
{
    lcd_send(0x80 | (line * 0x40 + col), 0);
}

int main(void)
{
    i2c_setup(100);
    lcd_half(3, 0);                 /* the start-up: 8-bit mode three times, then 4-bit */
    lcd_half(3, 0);
    lcd_half(3, 0);
    lcd_half(2, 0);
    lcd_send(0x28, 0);              /* two lines, 5 x 8 dots */
    lcd_send(0x0c, 0);              /* display on, no cursor */
    lcd_send(0x06, 0);              /* move right after each character */
    lcd_send(0x01, 0);              /* clear */
    set_cursor(0, 1);
    lcd_text("Hello, Pico 2!");
    for (int i = 0; i < 10; i++) {
        set_cursor(1, 0);
        lcd_text("count: ");
        lcd_send('0' + i, 1);
        sleep_ms(200);
    }
    return 0;
}
