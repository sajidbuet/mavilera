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

# name, source (relative to pico-examples), further libraries
set(PROGRAMS
  "hello_uart|uart/hello_uart/hello_uart.c|"
  "blink|blink/blink.c|"
  "timer_lowlevel|timer/timer_lowlevel/timer_lowlevel.c|"
  "hello_gpio_irq|gpio/hello_gpio_irq/hello_gpio_irq.c|"
  "hello_timer|timer/hello_timer/hello_timer.c|"
  "hello_watchdog|watchdog/hello_watchdog/hello_watchdog.c|"
  "hello_pwm|pwm/hello_pwm/hello_pwm.c|hardware_pwm"
  "hello_adc|adc/hello_adc/hello_adc.c|hardware_adc")
foreach(P IN LISTS PROGRAMS)
  string(REPLACE "|" ";" F "${P}")
  list(GET F 0 NAME)
  list(GET F 1 SRC)
  list(GET F 2 LIBS)
  add_executable(${NAME} ${EX}/${SRC})
  target_link_libraries(${NAME} pico_stdlib ${LIBS})
  pico_enable_stdio_uart(${NAME} 1)
  pico_enable_stdio_usb(${NAME} 0)
endforeach()
