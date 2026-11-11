# The frozen Pico Full build profile (pico2 P1-F2, ADR-0012 point 3, research D33 Q3/Q4): board pico2, platform
# rp2350-riscv, Debug = -Og plus -g, stdio over UART only. Two programs are built with the WebAssembly clang:
#   base -- pico_stdlib only: its objects are linked whole into every student program (as CMake links them for a
#           pico_stdlib program; objects registering through sections must not sit in an archive)
#   full -- pico_stdlib plus every further library of the pack: objects of sources that base does not compile go into
#           the pack's archive, so ld.lld takes only what a program uses. build-pack.mjs checks that the sources both
#           programs compile give identical objects (the extra libraries' LIB_* defines change nothing shared).
# Left out (build-pack.mjs lists them with the reason in the pack manifest):
#   pico_multicore, pico_low_power       -- their LIB_* defines change shared code (malloc mutex, runtime init, sections)
#   pico_stdio_rtt, pico_stdio_semihosting, pico_stdio_usb, tinyusb, pico_usb_reset -- stdio is UART only (D33 Q4)
#   pico_bootsel_via_double_reset        -- runs from a constructor; an archive member that nothing references is never linked
#   pico_cyw43_*, pico_btstack, pico_lwip, pico_mbedtls -- radio and network (no radio on pico2)
#   hardware_dcp, hardware_rcp, cmsis    -- Arm only
#   pico_status_led                      -- builds the host tool pioasm for its PIO LED driver (PIO is out of P1-F2, D33 Q6)
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
cmake_minimum_required(VERSION 3.13)
set(PICO_BOARD pico2 CACHE STRING "" FORCE)
set(PICO_PLATFORM rp2350-riscv CACHE STRING "" FORCE)
include($ENV{PICO_SDK_PATH}/pico_sdk_init.cmake)
project(pico_full_profile C CXX ASM)
set(CMAKE_C_STANDARD 11)
pico_sdk_init()

# -Og -g (the SDK's Debug is -Og without -g); host paths of the SDK and this build are replaced in debug information and
# __FILE__ by the guest paths the pack uses
foreach(LANG IN ITEMS C CXX ASM)
  set(CMAKE_${LANG}_FLAGS_DEBUG "-Og -g")
  string(APPEND CMAKE_${LANG}_FLAGS " -ffile-prefix-map=$ENV{PICO_SDK_PATH}=/pico/sdk -ffile-prefix-map=${CMAKE_BINARY_DIR}=/pico/build")
endforeach()

add_executable(base main.c)
target_link_libraries(base pico_stdlib)
pico_enable_stdio_uart(base 1)
pico_enable_stdio_usb(base 0)

set(PACK_EXTRA
  hardware_adc hardware_boot_lock hardware_dma hardware_exception hardware_flash hardware_hazard3 hardware_i2c
  hardware_interp hardware_pio hardware_powman hardware_pwm hardware_riscv_platform_timer hardware_rosc hardware_sha256
  hardware_spi hardware_vreg hardware_watchdog hardware_xip_cache
  pico_aon_timer pico_async_context_poll pico_async_context_threadsafe_background pico_atomic pico_bootrom pico_flash
  pico_i2c_slave pico_rand pico_sha256 pico_unique_id pico_util)
set(PACK_LINKED "")
set(PACK_MISSING "")
foreach(LIB IN LISTS PACK_EXTRA)
  if(TARGET ${LIB})
    list(APPEND PACK_LINKED ${LIB})
  else()
    list(APPEND PACK_MISSING ${LIB})
  endif()
endforeach()
# a static library: CMake compiles the libraries' sources into it and never links it (the pack builder fixes objects
# for lld first, see build-pack.mjs)
add_library(full STATIC main.c)
target_link_libraries(full pico_stdlib ${PACK_LINKED})
pico_enable_stdio_uart(full 1)
pico_enable_stdio_usb(full 0)
file(WRITE ${CMAKE_BINARY_DIR}/pack-libraries.json "{\"linked\": \"${PACK_LINKED}\", \"missing\": \"${PACK_MISSING}\"}\n")
