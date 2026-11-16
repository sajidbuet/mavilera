/* sdk-demo.c -- A complete project in Pico SDK C: SOS in Morse code on the LED and a beeper, meters on the LCD, and a button.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA sample project, written for the application).
 *
 * Every part of the chip the other samples show, working together:
 *   GPIO       the LED on GP25; the button on GP15 (to ground, with the pad's pull-up) by interrupt on both
 *              edges: while it is held the tone is an octave higher (double the frequency), and back when
 *              it is released. The handler reads the pin's level rather than counting edges, so a real
 *              button's bounce only flickers the pitch for a few milliseconds and it always settles right;
 *   TIMER      a repeating timer, one tick per Morse unit (UNIT_MS): its interrupt steps through the pattern of
 *              SOS (... --- ...) and switches the LED and the tone together. Morse timing: a dot is 1 unit on, a
 *              dash 3; 1 unit off inside a letter, 3 between letters, 7 before the next SOS (34 units, 6.8 s);
 *   PWM        a square wave on the speaker pin GP14 while the LED is on: the slice counts at 1 MHz
 *              (clk_sys / 48), so 1 kHz is a period of 1000 counts (top 999), half of it high;
 *   ADC        GP26 (input 0, a knob) and the chip's temperature sensor (input 4), read in turn;
 *   I2C        the lab kit's 16 x 2 LCD (PCF8574 at 0x27 on GP4 and GP5): line 1 the voltage, line 2
 *              the temperature, read five times a second and written only when a line changes;
 *   UART       printf: a status line after each SOS, and when the button goes down or up.
 * clk_sys runs at 48 MHz (set_sys_clock_khz): the program needs no more, and the simulator then keeps real time
 * on a modest computer; the timer counts microseconds whatever clk_sys is, and the tone's divider follows it.
 * The two handlers only set the LED, the tone and flags; the main loop does the slow work (the ADC, the LCD
 * over I2C, printf), so the interrupts stay short. This sample chooses Parts: lab kit and the speaker on GP14.
 * Try: turn Sound on, set GP26 in the Pins panel (or move its slider) and Run in Real time: the LCD follows the
 * knob, the LED flashes SOS and the tone beeps it. Hold the button (BTN on the Board, or GP15 to Low in the
 * Pins panel): the beep goes an octave up until you let go. Change UNIT_MS or TONE_HZ, or write your initials
 * into MORSE from a table of Morse code (a dot '1', a dash '111', '0' between them, '000' between letters).
 * On a Pico 2: the 1602 LCD with a PCF8574 backpack on GP4/GP5, a potentiometer on GP26, a piezo buzzer on
 * GP14, a push button from GP15 to GND; Load to Pico, and the Hardware tab's UART monitor shows the status lines.
 */
#include "pico/stdlib.h"
#include "hardware/adc.h"
#include "hardware/i2c.h"
#include "hardware/pwm.h"
#include "hardware/clocks.h"
#include <stdio.h>
#include <string.h>

#define LED 25
#define BUTTON 15
#define SPEAKER 14
#define SDA 4
#define SCL 5
#define LCD 0x27
#define UNIT_MS 200     /* one Morse unit (6 words a minute) */
#define TONE_HZ 1000    /* the tone; double while the button is held */
#define TEMPERATURE_INPUT 4
#define SYS_KHZ 48000   /* clk_sys 48 MHz, not the SDK's 150 MHz: plenty for this, and the simulator keeps real time */

/* ---- the LCD (as in "Text on an I2C LCD") ---- */
static void lcd_out(uint8_t v)
{
    i2c_write_blocking(i2c0, LCD, &v, 1, false);
    sleep_us(50);
}

static void lcd_half(uint8_t bits, uint8_t rs)
{
    uint8_t v = (uint8_t)(bits << 4) | 0x08 | rs;   /* 0x08: the backlight on */
    lcd_out(v | 0x04);                              /* E high, then low */
    lcd_out(v);
}

static void lcd_send(uint8_t byte, uint8_t rs)
{
    lcd_half(byte >> 4, rs);
    lcd_half(byte & 15, rs);
}

static char shown[2][17];                           /* what each line shows now */

static void lcd_line(int line, const char *s)       /* a whole line, padded to 16 characters; only when it changed */
{
    char want[17];
    for (int i = 0; i < 16; i++)
        want[i] = *s ? *s++ : ' ';
    want[16] = 0;
    if (strcmp(want, shown[line]) == 0)
        return;                                     /* the same text: no I2C traffic at all */
    strcpy(shown[line], want);
    lcd_send(0x80 | (line * 0x40), 0);
    for (int i = 0; i < 16; i++)
        lcd_send((uint8_t)want[i], 1);
}

static void lcd_init(void)
{
    i2c_init(i2c0, 100 * 1000);
    gpio_set_function(SDA, GPIO_FUNC_I2C);
    gpio_set_function(SCL, GPIO_FUNC_I2C);
    gpio_pull_up(SDA);
    gpio_pull_up(SCL);
    sleep_ms(50);
    lcd_half(3, 0); lcd_half(3, 0); lcd_half(3, 0); lcd_half(2, 0);   /* into 4-bit mode */
    lcd_send(0x28, 0);  /* two lines */
    lcd_send(0x0c, 0);  /* display on, no cursor */
    lcd_send(0x06, 0);  /* move right after each character */
    lcd_send(0x01, 0);  /* clear */
    sleep_ms(2);
}

/* ---- the tone: on while the LED is on; its frequency doubled while the button is held ---- */
static uint tone_slice;
static volatile bool led_on = false;
static volatile bool held = false;

static void tone_init(void)
{
    gpio_set_function(SPEAKER, GPIO_FUNC_PWM);
    tone_slice = pwm_gpio_to_slice_num(SPEAKER);
    pwm_set_clkdiv_int_frac(tone_slice, clock_get_hz(clk_sys) / 1000000, 0);   /* count at 1 MHz */
    pwm_set_wrap(tone_slice, 1000000 / TONE_HZ - 1);
    pwm_set_gpio_level(SPEAKER, 0);
    pwm_set_enabled(tone_slice, true);
}

static uint32_t tone_hz(void) { return held ? 2 * TONE_HZ : TONE_HZ; }

/* set the tone from the present state: called by both interrupt handlers */
static void tone_update(void)
{
    uint32_t period = 1000000 / tone_hz();          /* counts of the 1 MHz PWM clock */
    pwm_set_wrap(tone_slice, period - 1);
    pwm_set_gpio_level(SPEAKER, led_on ? period / 2 : 0);   /* half of it high, or silence */
}

/* ---- the button: a GPIO interrupt on each edge, falling (pressed) or rising (released) ---- */
static volatile bool button_changed = false;

static void on_button(uint gpio, uint32_t events)
{
    (void)events;
    if (gpio != BUTTON)
        return;
    bool now = !gpio_get(BUTTON);                   /* the level, not the edge: low while it is held */
    if (now != held) {
        held = now;
        tone_update();                              /* at once */
        button_changed = true;
    }
}

/* ---- SOS in Morse code: the repeating timer's interrupt, one tick per unit ---- */
/* '1' a unit on, '0' a unit off:  S = . . .   O = - - -   S = . . .   then the gap before the next SOS */
static const char MORSE[] = "10101" "000" "11101110111" "000" "10101" "0000000";
#define MORSE_UNITS (sizeof MORSE - 1)
static volatile uint unit = 0;
static volatile uint sent = 0;                      /* how many SOS have been sent */
static volatile bool sos_done = false;

static bool morse_tick(repeating_timer_t *t)
{
    (void)t;
    bool on = MORSE[unit] == '1';
    if (on != led_on) {
        led_on = on;
        gpio_put(LED, on);
        tone_update();                              /* the beep follows the LED */
    }
    if (++unit == MORSE_UNITS) {
        unit = 0;
        sent++;
        sos_done = true;
    }
    return true;
}

/* ---- the measurements ---- */
static int knob_mv(void)
{
    adc_select_input(0);
    return adc_read() * 3300 / 4096;
}

static int temperature_tenths(void)                 /* in tenths of a degree, without floating point */
{
    adc_select_input(TEMPERATURE_INPUT);
    int uv = adc_read() * 3300000 / 4096;           /* microvolts */
    return 270 - (uv - 706000) * 10 / 1721;         /* 27 C at 0.706 V, -1.721 mV per degree */
}

int main(void)
{
    set_sys_clock_khz(SYS_KHZ, true);               /* before stdio: the UART's divider follows clk_peri */
    stdio_init_all();
    gpio_init(LED);
    gpio_set_dir(LED, GPIO_OUT);
    adc_init();
    adc_gpio_init(26);
    adc_set_temp_sensor_enabled(true);
    tone_init();
    lcd_init();
    gpio_init(BUTTON);
    gpio_pull_up(BUTTON);                           /* reads 1 until the button connects it to ground */
    gpio_set_irq_enabled_with_callback(BUTTON, GPIO_IRQ_EDGE_FALL | GPIO_IRQ_EDGE_RISE, true, &on_button);
    printf("MAVILERA demo: SOS on LED GP25 and tone GP14; knob GP26, LCD 0x27, button GP15\n");

    repeating_timer_t timer;
    morse_tick(&timer);                             /* the first unit at once */
    add_repeating_timer_ms(UNIT_MS, morse_tick, NULL, &timer);

    char text[17];
    while (true) {
        int mv = knob_mv();
        int t = temperature_tenths();
        snprintf(text, sizeof text, "GP26: %4d mV", mv);
        lcd_line(0, text);
        snprintf(text, sizeof text, "Temp: %d.%d C", t / 10, (t < 0 ? -t : t) % 10);
        lcd_line(1, text);
        if (sos_done) {
            sos_done = false;
            printf("SOS %u sent, GP26 %d mV, %d.%d C\n", sent, mv, t / 10, (t < 0 ? -t : t) % 10);
        }
        if (button_changed) {
            button_changed = false;
            printf("button %s: tone %lu Hz\n", held ? "down" : "up", (unsigned long)tone_hz());
        }
        sleep_ms(200);
    }
}
