# build-runtimes.ps1 -- step 3 of the Pico Full toolchain (pico2 P1-F2): RP2350 RISC-V runtimes built BY the wasm clang
# (through the compile daemon, which must be running: start-ccd.ps1): compiler-rt builtins and picolibc 1.8.12 with TLS
# (the SDK's picolibc path needs it), installed into build\sysroot-rv32; then picolibc's libos/fallback sources (sbrk ...)
# added to libc.a (D28 gate c: picolibc's CMake build compiles libos only with TESTS=ON; without OS_FALLBACK its
# CMakeLists puts them into libc, which is what this does; the SDK linker script provides __heap_start/__heap_end).
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
. "$PSScriptRoot\env.ps1"
Need $LLVM_WASM 'llvm.wasm'; Need "$CCD\clang.exe" 'ccd stand-ins'; Need $PICOLIBC_SRC 'picolibc'
$ar = "$WASI_SDK\bin\llvm-ar.exe"

# compiler-rt builtins
$bb = Join-Path $B 'builtins-rv32'
cmake -G Ninja -S "$LLVM_SRC\compiler-rt\lib\builtins" -B $bb "-DCMAKE_TOOLCHAIN_FILE=$PF\cmake\Toolchain-RV32-wasmclang.cmake" `
  -DCMAKE_BUILD_TYPE=Release "-DCMAKE_INSTALL_PREFIX=$SYSROOT" "-DLLVM_MAIN_SRC_DIR=$LLVM_SRC\llvm" `
  -DCOMPILER_RT_BAREMETAL_BUILD=ON -DCOMPILER_RT_DEFAULT_TARGET_ONLY=ON -DCOMPILER_RT_OS_DIR=baremetal `
  -DCOMPILER_RT_BUILTINS_ENABLE_PIC=OFF -DCOMPILER_RT_EXCLUDE_ATOMIC_BUILTIN=ON -DCOMPILER_RT_INCLUDE_TESTS=OFF
if ($LASTEXITCODE) { throw 'builtins configure failed' }
cmake --build $bb --target install
if ($LASTEXITCODE) { throw 'builtins build failed' }
# the baremetal driver looks for the builtins in the resource directory
$rtdir = Join-Path $RESOURCE 'lib\riscv32-unknown-unknown-elf'
New-Item -ItemType Directory -Force $rtdir | Out-Null
Copy-Item "$SYSROOT\lib\baremetal\libclang_rt.builtins-riscv32.a" "$rtdir\libclang_rt.builtins.a" -Force

# picolibc
$pb = Join-Path $B 'picolibc-rv32'
cmake -G Ninja -S $PICOLIBC_SRC -B $pb "-DCMAKE_TOOLCHAIN_FILE=$PF\cmake\TC-picolibc-rv32.cmake" `
  -DCMAKE_BUILD_TYPE=MinSizeRel "-DCMAKE_INSTALL_PREFIX=$SYSROOT" -DTESTS=OFF -DPOSIX_CONSOLE=OFF -D__THREAD_LOCAL_STORAGE=ON
if ($LASTEXITCODE) { throw 'picolibc configure failed' }
cmake --build $pb --target install
if ($LASTEXITCODE) { throw 'picolibc build failed' }
# picolibc keeps its maths in libc.a; the SDK links -lm
if (-not (Test-Path "$SYSROOT\lib\libm.a")) { & $ar rcs "$SYSROOT\lib\libm.a"; if ($LASTEXITCODE) { throw 'empty libm.a failed' } }

# libos fallback sources into libc.a, with exactly the flags picolibc used for libc/stdlib/abort.c
$ref = (ninja -C $pb -t commands | Select-String 'libc/stdlib/abort\.c\b' | Select-Object -First 1).Line
if (-not $ref) { throw 'reference compile command not found' }
$tokens = [regex]::Matches($ref, '"[^"]*"|\S+') | ForEach-Object { $_.Value.Trim('"') }
$flags = @(); $skip = $false
foreach ($t in $tokens[1..($tokens.Count - 1)]) {
  if ($skip) { $skip = $false; continue }
  if ($t -in '-MT', '-MF', '-o') { $skip = $true; continue }
  if ($t -in '-MD', '-c' -or $t -match 'abort\.c$') { continue }
  $flags += $t
}
$out = Join-Path $pb 'os-fallback'
New-Item -ItemType Directory -Force $out | Out-Null
$objs = foreach ($s in 'fpathconf', 'getpid', 'kill', 'pathconf', 'raise', 'sbrk', 'signal', 'sigprocmask', 'sysconf') {
  $o = "$out\fallback-$s.c.obj"
  & "$CCD\clang.exe" @flags -c "$PICOLIBC_SRC\libos\fallback\$s.c" -o $o
  if ($LASTEXITCODE) { throw "compile failed: $s" }
  $o
}
& $ar rs "$SYSROOT\lib\libc.a" @objs
if ($LASTEXITCODE) { throw 'llvm-ar failed' }
"runtimes in $SYSROOT (libc.a with $($objs.Count) fallback objects); builtins in $rtdir"
