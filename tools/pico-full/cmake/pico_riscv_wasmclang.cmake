# Pico SDK toolchain file for RP2350 RISC-V with the clang/lld built to WebAssembly (pico2 P1-F2; as experiment
# E-CC-WASM-1). Modelled on the SDK's cmake/preload/toolchains/util/pico_gcc_common.cmake and pico_arm_clang_common.cmake
# (pico-sdk 079c6f3); passed as CMAKE_TOOLCHAIN_FILE (the SDK then skips its PICO_COMPILER selection).
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
file(TO_CMAKE_PATH "$ENV{PICO_FULL_WORK}" PF_WORK)
file(READ "${CMAKE_CURRENT_LIST_DIR}/../pins.json" _pins)
string(JSON _wasi GET "${_pins}" wasiSdk folder)
set(CMAKE_SYSTEM_PROCESSOR hazard3)
set(CMAKE_SYSTEM_NAME PICO)   # the SDK's Platform/PICO.cmake

set(CMAKE_C_COMPILER "${PF_WORK}/ccd/clang.exe" CACHE FILEPATH "C compiler")
set(CMAKE_CXX_COMPILER "${PF_WORK}/ccd/clang++.exe" CACHE FILEPATH "C++ compiler")
set(CMAKE_ASM_COMPILER "${PF_WORK}/ccd/clang.exe" CACHE FILEPATH "ASM compiler")
set(CMAKE_ASM_COMPILE_OBJECT "<CMAKE_ASM_COMPILER> <DEFINES> <INCLUDES> <FLAGS> -o <OBJECT>   -c <SOURCE>")
set(CMAKE_INCLUDE_FLAG_ASM "-I")

set(_w "${PF_WORK}/tools/${_wasi}/bin")
set(CMAKE_AR "${_w}/llvm-ar.exe" CACHE FILEPATH "")
set(CMAKE_RANLIB "${_w}/llvm-ranlib.exe" CACHE FILEPATH "")
set(CMAKE_OBJCOPY "${_w}/llvm-objcopy.exe" CACHE FILEPATH "")
# Disassembly listings (.dis) only, not part of the pack: wasi-sdk's llvm-objdump has no RISC-V target, so the RISC-V
# GCC toolchain's objdump (research D10) is used when present.
file(TO_CMAKE_PATH "$ENV{LOCALAPPDATA}/pico2sim-build/tools/riscv-toolchain-16/bin/riscv32-pico-elf-objdump.exe" _gcc_objdump)
if(EXISTS "${_gcc_objdump}")
  set(CMAKE_OBJDUMP "${_gcc_objdump}" CACHE FILEPATH "")
else()
  set(CMAKE_OBJDUMP "${_w}/llvm-objdump.exe" CACHE FILEPATH "")
endif()
foreach(LANG IN ITEMS C CXX ASM)
    set(CMAKE_${LANG}_OUTPUT_EXTENSION .o)
endforeach()

set(CMAKE_FIND_ROOT_PATH "${PF_WORK}/build/sysroot-rv32")
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
list(APPEND CMAKE_TRY_COMPILE_PLATFORM_VARIABLES PICO_CLIB)

# -mcpu=rp2350-hazard3 is LLVM's name for the core the SDK's GCC calls hazard3-rp2350; -mstrict-align as the
# SDK's GCC default (PICO_NO_STRICT_ALIGN unset).
set(PICO_COMMON_LANG_FLAGS "--target=riscv32-unknown-elf -mcpu=rp2350-hazard3 -mabi=ilp32 -mstrict-align --sysroot=${PF_WORK}/build/sysroot-rv32 -resource-dir=${PF_WORK}/build/clang-wasm/lib/clang/23")
set(PICO_DISASM_OBJDUMP_ARGS "")
include("${PICO_SDK_PATH}/cmake/preload/toolchains/util/set_flags.cmake")
# No C++ standard library is built for RV32. The SDK compiles pico_cxx_options/new_delete.cpp into every program; with
# this SDK switch it does not include <cstdlib> (C programs never use operator new).
string(APPEND CMAKE_CXX_FLAGS_INIT " -DPICO_CXX_DISABLE_ALLOCATION_OVERRIDES=1 -isystem ${CMAKE_CURRENT_LIST_DIR}/cxx-shim")
# The SDK supplies its own crt0 (pico_crt0); no C++ library; as the SDK's ARM-clang llvm_libc branch does.
foreach(TYPE IN ITEMS EXE SHARED MODULE)
    set(CMAKE_${TYPE}_LINKER_FLAGS_INIT "-nostartfiles -nostdlib++")
endforeach()
