/* sum-array.c -- An array, a loop and a function: C and the assembly it becomes.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a MAVILERA template, written for the application).
 *
 * main fills an array of eight numbers with their squares and sum adds them; main returns the
 * sum, 140, which the program leaves in a0 as its exit code.
 * Try: Compile, then point at a line of C: the assembly of that line is marked in the Listing.
 * Step line (in the toolbar) through the loops and watch i and the array in Memory;
 * set Translation to Register and build again: the loop keeps i in a register.
 */
int sum(int *a, int n)
{
    int s = 0;
    for (int i = 0; i < n; i++)
        s = s + a[i];
    return s;
}

int main(void)
{
    int a[8];
    for (int i = 0; i < 8; i++)
        a[i] = i * i;
    return sum(a, 8);
}
