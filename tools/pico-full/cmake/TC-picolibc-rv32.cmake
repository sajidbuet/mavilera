# picolibc 1.8.12 for RP2350 RISC-V with the wasm clang (see Toolchain-RV32-wasmclang.cmake). pico2 P1-F2.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
include("${CMAKE_CURRENT_LIST_DIR}/Toolchain-RV32-wasmclang.cmake")
set(TARGET_COMPILE_OPTIONS -mcpu=rp2350-hazard3 -mabi=ilp32 -nostdlib)
