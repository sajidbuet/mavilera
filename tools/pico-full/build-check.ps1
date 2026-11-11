# build-check.ps1 -- reference CMake builds for check-pack.mjs (check/CMakeLists.txt) with the WebAssembly clang through
# the compile daemon (start-ccd.ps1 must be running) into build\check. Needs PICO_EXAMPLES_SRC (pinned pico-examples).
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
. "$PSScriptRoot\env.ps1"
Need $env:PICO_SDK_PATH 'PICO_SDK_PATH'; Need $env:PICO_EXAMPLES_SRC 'PICO_EXAMPLES_SRC'; Need "$CCD\clang.exe" 'ccd stand-ins'
$cb = Join-Path $B 'check'
cmake -G Ninja -S "$PF\check" -B $cb "-DCMAKE_TOOLCHAIN_FILE=$PF\cmake\pico_riscv_wasmclang.cmake" `
  -DCMAKE_BUILD_TYPE=Debug -DPICO_CLIB=picolibc "-DPICO_SDK_PATH=$env:PICO_SDK_PATH"
if ($LASTEXITCODE) { throw 'check configure failed' }
Get-ChildItem (Join-Path $cb 'generated') -Recurse -Include *.h -File | ForEach-Object {
  $t = [IO.File]::ReadAllText($_.FullName)
  $n = $t -replace '(?<=["<])[Cc]:/', '/'
  if ($n -ne $t) { [IO.File]::WriteAllText($_.FullName, $n) }
}
cmake --build $cb
if ($LASTEXITCODE) { throw 'check build failed' }
"reference builds in $cb"
