# Reference builds for the SDK pack check (pico2 P1-F2): pico-examples programs built by CMake with the WebAssembly clang
# and the same frozen profile as tools/pico-full/profile (board pico2, rp2350-riscv, -Og -g, stdio UART). check-pack.mjs
# builds the same sources from the pack and compares the loadable images. Sources: PICO_EXAMPLES_SRC (pinned
# pico-examples). Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
cmake_minimum_required(VERSION 3.13)
set(PICO_BOARD pico2 CACHE STRING "" FORCE)
set(PICO_PLATFORM rp2350-riscv CACHE STRING "" FORCE)
include($ENV{PICO_SDK_PATH}/pico_sdk_init.cmake)
project(pico_full_check C CXX ASM)
set(CMAKE_C_STANDARD 11)
pico_sdk_init()
file(TO_CMAKE_PATH "$ENV{PICO_SDK_PATH}" _sdk)
file(TO_CMAKE_PATH "$ENV{PICO_EXAMPLES_SRC}" EX)
foreach(LANG IN ITEMS C CXX ASM)
  set(CMAKE_${LANG}_FLAGS_DEBUG "-Og -g")
  string(APPEND CMAKE_${LANG}_FLAGS " -ffile-prefix-map=${_sdk}=/pico/sdk -ffile-prefix-map=${CMAKE_BINARY_DIR}=/pico/build -ffile-prefix-map=${EX}=/project")
endforeach()
# the pack's fixed build date, as the profile (P1-R4, research D58)
include(${CMAKE_CURRENT_LIST_DIR}/../cmake/build-date.cmake)
pico_full_build_date(_build_date)
add_compile_definitions(PICO_PROGRAM_BUILD_DATE="${_build_date}")

# name, source (relative to pico-examples), further libraries (separated by ","), USB stdio (1) or UART only (0)
# P1-R4: one program per new object set (hello_multicore: uart_mc; hello_usb: usb) and pico_status_led (an archive library)
set(PROGRAMS
  "hello_uart|uart/hello_uart/hello_uart.c||0"
  "blink|blink/blink.c||0"
  "timer_lowlevel|timer/timer_lowlevel/timer_lowlevel.c||0"
  "hello_gpio_irq|gpio/hello_gpio_irq/hello_gpio_irq.c||0"
  "hello_timer|timer/hello_timer/hello_timer.c||0"
  "hello_watchdog|watchdog/hello_watchdog/hello_watchdog.c||0"
  "hello_pwm|pwm/hello_pwm/hello_pwm.c|hardware_pwm|0"
  "hello_adc|adc/hello_adc/hello_adc.c|hardware_adc|0"
  "hello_multicore|multicore/hello_multicore/multicore.c|pico_multicore|0"
  "multicore_fifo_irqs|multicore/multicore_fifo_irqs/multicore_fifo_irqs.c|pico_multicore|0"
  "hello_usb|hello_world/usb/hello_usb.c||1"
  "status_blink|status_led/status_blink/status_blink.c|pico_status_led|0")
foreach(P IN LISTS PROGRAMS)
  string(REPLACE "|" ";" F "${P}")
  list(GET F 0 NAME)
  list(GET F 1 SRC)
  list(GET F 2 LIBS)
  list(GET F 3 USB)
  string(REPLACE "," ";" LIBS "${LIBS}")
  add_executable(${NAME} ${EX}/${SRC})
  target_link_libraries(${NAME} pico_stdlib ${LIBS})
  pico_enable_stdio_uart(${NAME} 1)
  pico_enable_stdio_usb(${NAME} ${USB})
endforeach()
