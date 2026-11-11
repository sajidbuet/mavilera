# Cross toolchain for building clang/lld to wasm32-wasip1 with wasi-sdk 34 (pico2 P1-F2; as experiment E-CC-WASM-1).
# Flags follow YoWASP clang's build.sh (reference, 944dd7c) with one change: ThinLTO instead of full LTO.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
file(TO_CMAKE_PATH "$ENV{PICO_FULL_WORK}" _work)
file(READ "${CMAKE_CURRENT_LIST_DIR}/../pins.json" _pins)
string(JSON _wasi GET "${_pins}" wasiSdk folder)
set(WASI_SDK_PREFIX "${_work}/tools/${_wasi}")
include("${WASI_SDK_PREFIX}/share/cmake/wasi-sdk-p1.cmake")
set(CMAKE_LINKER "${WASI_SDK_PREFIX}/bin/wasm-ld.exe")

# -mcpu=lime1: bulk memory, multivalue, mutable globals, sign-ext, nontrapping fptoint, extended-const (as YoWASP).
# _WASI_EMULATED_MMAN: LLVM references mmap on paths not taken in this configuration.
set(_c "-mcpu=lime1 -D_WASI_EMULATED_MMAN -flto=thin")
# 4 GiB maximum memory; 8 MiB stack placed first (clang's deep recursion corrupts the heap otherwise, per YoWASP).
set(_l "-lwasi-emulated-mman -Wl,--max-memory=4294967296 -Wl,-z,stack-size=8388608,--stack-first -flto=thin -Wl,--thinlto-jobs=16 -Wl,--strip-all")
set(CMAKE_C_FLAGS_INIT "${_c}")
set(CMAKE_CXX_FLAGS_INIT "${_c}")
set(CMAKE_EXE_LINKER_FLAGS_INIT "${_l}")
