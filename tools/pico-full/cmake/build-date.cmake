# build-date.cmake -- the fixed build date of the Pico Full pack (pico2 P1-R4, research D58): PICO_PROGRAM_BUILD_DATE in
# the form of the C preprocessor's __DATE__ ("Nov 14 2026", "Nov  4 2026"), from SOURCE_DATE_EPOCH (seconds since 1970,
# the reproducible-builds convention; CMake's string(TIMESTAMP) reads it). Required: without it the date would be the day of
# the build and the pack would differ from day to day.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
function(pico_full_build_date OUT)
  if(NOT DEFINED ENV{SOURCE_DATE_EPOCH} OR NOT "$ENV{SOURCE_DATE_EPOCH}" MATCHES "^[0-9]+$")
    message(FATAL_ERROR "set SOURCE_DATE_EPOCH (seconds since 1970, UTC) for the pack's fixed build date")
  endif()
  set(_months Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec)
  string(TIMESTAMP _m "%m" UTC)
  string(TIMESTAMP _d "%d" UTC)
  string(TIMESTAMP _y "%Y" UTC)
  math(EXPR _mi "${_m} - 1")
  list(GET _months ${_mi} _mon)
  string(REGEX REPLACE "^0" " " _d "${_d}")
  set(${OUT} "${_mon} ${_d} ${_y}" PARENT_SCOPE)
endfunction()
