/* plain-vs-register.c -- One function, two translations.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a RISC-VISTA template, written for the application).
 *
 * Try: Compile, then open the "Assembly from C" tab. Switch Translation between
 * Plain (every variable in the stack frame, as an unoptimised compiler keeps
 * them) and Register (scalars in s1-s11): count the loads and stores in the loop
 * of dot, and compare the instruction counts after a run. Point at a line of C
 * to see its assembly.
 */
int dot(const int *a, const int *b, int n)
{
    int s = 0;
    for (int i = 0; i < n; i++)
        s += a[i] * b[i];
    return s;
}

int x[4] = { 1, 2, 3, 4 };
int y[4] = { 5, 6, 7, 8 };

int main(void)
{
    return dot(x, y, 4);    /* 5 + 12 + 21 + 32 = 70, the exit code */
}
