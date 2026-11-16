/* twinkle.c -- Twinkle, Twinkle, Little Star on the speaker pin, over and over.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application; the melody is traditional).
 *
 * The template chooses GP14 as the speaker (Pins panel). Turn Sound on (the speaker button in the
 * toolbar) and Run in Real time: the tune plays until you pause. Each note is a square wave from PWM
 * slice 7 at the note's frequency: one period is top + 1 counts of clk_sys, so top = CLK_SYS_HZ / hz - 1
 * (the notes stay in tune at 1, 4 or 12 MHz). A short silence after each note keeps repeated notes apart.
 * The melody is two tables: the frequencies and the length of each note in beats.
 * Try: change BEAT_MS for the tempo, or write your own tune in the two tables (and NOTES).
 */
#include <rp2350.h>

#define SPEAKER 14
#define BEAT_MS 400
#define GAP_MS  40
#define NOTES   42

/* the notes used, in Hz */
#define C5 523
#define D5 587
#define E5 659
#define F5 698
#define G5 784
#define A5 880

int melody[NOTES] = {
    C5, C5, G5, G5, A5, A5, G5,     /* Twinkle, twinkle, little star, */
    F5, F5, E5, E5, D5, D5, C5,     /* how I wonder what you are.     */
    G5, G5, F5, F5, E5, E5, D5,     /* Up above the world so high,    */
    G5, G5, F5, F5, E5, E5, D5,     /* like a diamond in the sky.     */
    C5, C5, G5, G5, A5, A5, G5,     /* Twinkle, twinkle, little star, */
    F5, F5, E5, E5, D5, D5, C5 };   /* how I wonder what you are.     */
int beats[NOTES] = {
    1, 1, 1, 1, 1, 1, 2,
    1, 1, 1, 1, 1, 1, 2,
    1, 1, 1, 1, 1, 1, 2,
    1, 1, 1, 1, 1, 1, 2,
    1, 1, 1, 1, 1, 1, 2,
    1, 1, 1, 1, 1, 1, 2 };

/* one note: a square wave for its length, then a short silence */
void note(int hz, int ms)
{
    uint32_t top = CLK_SYS_HZ / hz - 1;
    pwm_start(SPEAKER, top, 1);
    pwm_level(SPEAKER, (top + 1) / 2);
    sleep_ms(ms - GAP_MS);          /* the core sleeps; the PWM plays */
    pwm_level(SPEAKER, 0);
    sleep_ms(GAP_MS);
}

int main(void)
{
    for (;;) {
        for (int i = 0; i < NOTES; i++)
            note(melody[i], beats[i] * BEAT_MS);
        sleep_ms(2 * BEAT_MS);      /* a rest, then from the start */
    }
    return 0;
}
