/* sum.c -- source of the GCC -S fixtures of test/gcc-import.test.mjs.
   Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
   Rights class: code. */
int table[5] = {3, 1, 4, 1, 5};
const char msg[] = "hi\n";
static int counter;
int sum(const int *a, int n) {
  int s = 0;
  for (int i = 0; i < n; i++) s += a[i];
  return s;
}
int fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }
int main(void) {
  counter = sum(table, 5);
  return fact(counter % 6) + counter;
}
