/* pwm-tone.c -- A tone from PWM: a square wave at a musical note's frequency on the speaker pin.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * The template chooses GP14 as the speaker (Pins panel). Turn Sound on (the speaker button in the
 * toolbar) and Run in Real time: you hear five notes. pwm_start(pin, top, div) gives the pin to its
 * PWM slice and counts 0..top at clk_sys / div, so one period of the pin is (top + 1) x div cycles of
 * clk_sys: the note's frequency is CLK_SYS_HZ / ((top + 1) x div). pwm_level(pin, level) keeps the pin
 * high for `level` counts of each period: half of top + 1 makes a square wave.
 * Try: change NOTE_MS, or the clk_sys option (1, 4 or 12 MHz): the notes stay in tune, because
 * top is computed from CLK_SYS_HZ.
 */
#include <rp2350.h>

#define SPEAKER 14
#define NOTE_MS 300

/* C5 D5 E5 G5 C6, in Hz */
int notes[5] = { 523, 587, 659, 784, 1047 };

void play(int hz, int ms)
{
    uint32_t top = CLK_SYS_HZ / hz - 1;
    pwm_start(SPEAKER, top, 1);
    pwm_level(SPEAKER, (top + 1) / 2);
    sleep_ms(ms);                   /* asleep meanwhile: the PWM goes on */
}

int main(void)
{
    for (int i = 0; i < 5; i++)
        play(notes[i], NOTE_MS);
    pwm_level(SPEAKER, 0);          /* silence: the pin stays low */
    delay_ms(20);                   /* until the last period has ended */
    return 0;
}
