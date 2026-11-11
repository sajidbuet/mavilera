# env.ps1 -- common paths of the Pico Full toolchain scripts (pico2 P1-F2). Dot-source it: . "$PSScriptRoot\env.ps1"
#   PICO_FULL_WORK  work folder (sources, tools, build trees, outputs); default %LOCALAPPDATA%\pico2sim-build\pico-full.
#                   Must be outside OneDrive (research CLAUDE.md, D24). The layout is that of experiment E-CC-WASM-1, so
#                   PICO_FULL_WORK=C:\Research\pico2-sim-scratch\e-cc-wasm-1 reuses its builds.
#   PICO_SDK_PATH   the pinned pico-sdk checkout (pins.json picoSdk.commit).
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
$ErrorActionPreference = 'Stop'
$PF = $PSScriptRoot
$W = if ($env:PICO_FULL_WORK) { $env:PICO_FULL_WORK } else { Join-Path $env:LOCALAPPDATA 'pico2sim-build\pico-full' }
if ($W -match '\\OneDrive\\') { throw "PICO_FULL_WORK must be outside OneDrive: $W" }
$env:PICO_FULL_WORK = $W
$PINS = Get-Content (Join-Path $PF 'pins.json') -Raw | ConvertFrom-Json
$WASI_SDK = Join-Path $W "tools\$($PINS.wasiSdk.folder)"
$MSYS = 'C:\msys64\ucrt64\bin'
$LLVM_SRC = Join-Path $W 'src\llvm-project'
$PICOLIBC_SRC = Join-Path $W 'src\picolibc'
$B = Join-Path $W 'build'
$SYSROOT = Join-Path $B 'sysroot-rv32'
$LLVM_WASM = Join-Path $B 'llvm.wasm'
$RESOURCE = Join-Path $B 'clang-wasm\lib\clang\23'
$CCD = Join-Path $W 'ccd'
function Need($path, $what) { if (-not (Test-Path $path)) { throw "$what not found: $path (run the earlier step)" } }
