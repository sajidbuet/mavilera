# GCC -S fixtures (test/gcc-import.test.mjs, WS-F-085)

Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
Rights class: code.

`sum.c` and `calls.c` are small programs written for this test. The `.s`
files are their assembly from the pinned GCC (`riscv32-pico-elf-gcc` 16.1.0,
`C:\pico\riscv-toolchain-16\bin`), made in this folder with:

```
gcc -S -O0 -march=rv32im -mabi=ilp32 -o sum-O0-rv32im.s sum.c
gcc -S -O2 -march=rv32im -mabi=ilp32 -o sum-O2-rv32im.s sum.c
gcc -S -O1 -march=rv32i  -mabi=ilp32 -o sum-O1-rv32i.s  sum.c
gcc -S -O1 -g -fcommon -march=rv32i  -mabi=ilp32 -o calls-O1g-rv32i.s calls.c
gcc -S -O0 -fcommon    -march=rv32im -mabi=ilp32 -o calls-O0-rv32im.s calls.c
```

Expected results, from the same sources built by GCC and run in the book's
`rvsim.py` through `tools/ref_cc.py` on 2026-10-27 (for `calls.c` with a
`putchar` added under `REF` that writes with `ecall` 64): `sum.c` exits with
16; `calls.c` exits with 88 and writes `ok\n`.
