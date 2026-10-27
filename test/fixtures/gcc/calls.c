/* calls.c -- source of the GCC -S fixtures of test/gcc-import.test.mjs.
   Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
   Rights class: code. */
int putchar(int c);
int buf[8];
int counter;
static int sq(int x) { return x * x; }
static int tw(int x) { return x + x; }
int (*ops[2])(int) = { sq, tw };
void puts2(const char *s) { while (*s) putchar(*s++); }
int main(void) {
  for (int i = 0; i < 8; i++) buf[i] = ops[i & 1](i);
  int s = 0;
  for (int i = 0; i < 8; i++) s += buf[i];
  counter = s;
  puts2("ok\n");
  return counter % 256;
}
