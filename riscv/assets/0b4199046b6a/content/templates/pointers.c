/* pointers.c -- Indexing an array and walking it with a pointer.
 * Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
 * Rights class: content (a RISC-VISTA template, written for the application).
 *
 * Try: Compile and compare the loops of sum_index and sum_pointer in the
 * "Assembly from C" tab: the index form computes a + 4*i in every iteration;
 * the pointer form adds 4 to the pointer. Step through both with the register
 * holding the pointer selected in the Registers pane.
 */
int sum_index(const int *a, int n)
{
    int s = 0;
    for (int i = 0; i < n; i++)
        s += a[i];
    return s;
}

int sum_pointer(const int *a, int n)
{
    int s = 0;
    const int *end = a + n;
    while (a < end) {
        s += *a;
        a++;
    }
    return s;
}

int v[5] = { 3, 1, 4, 1, 5 };

int main(void)
{
    return sum_index(v, 5) * 100 + sum_pointer(v, 5);    /* 1414 */
}
