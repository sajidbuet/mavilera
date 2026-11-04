# GPU fixtures (test/gpu-*.test.mjs, GPU-1)

Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
Rights class: code.

Student-facing file of the textbook's Chapter 11 laboratory (open-ended GPU route), copied unchanged under the
author's decision G12 (`docs/research/gpu-npu/DECISIONS.md`). No instructor file (`code/chapter11/ref/`) is copied
or read for these tests.

| File | Source in the book repository | Book commit | SHA-256 |
|---|---|---|---|
| `simt_tests.hex` | `code/chapter11/programs/simt/simt_tests.hex` | `9e99307` (2026-10-22) | `af47e1e69c2c458f2371e6f9daffa2bbdecb4b0632afa4eb8aaca59a445d454a` |

Format (as `tb/tb_simt_core.sv` reads it, one hexadecimal word per line): word 0 the number of tests (3); per test 27
words: the program length, the sixteen program words (unused ones 0, HALT), the four lane inputs (`din`), the four
expected outputs (r2 of each lane), the expected `cycles` and the expected idle lane-slots. The testbench also checks
`done` and that the final `active_mask` is all ones. The test checks the hash before it uses the file.
