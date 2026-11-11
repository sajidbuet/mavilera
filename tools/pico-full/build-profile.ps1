# build-profile.ps1 -- step 4 of the Pico Full toolchain (pico2 P1-F2): configure and build the frozen profile
# (profile/CMakeLists.txt: programs base and all) with the WebAssembly clang through the compile daemon (start-ccd.ps1
# must be running) into build\profile. build-pack.mjs then makes the SDK pack from it.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
. "$PSScriptRoot\env.ps1"
Need $env:PICO_SDK_PATH 'PICO_SDK_PATH'; Need "$CCD\clang.exe" 'ccd stand-ins'; Need "$SYSROOT\lib\libc.a" 'runtimes'
$sdkHead = git -C $env:PICO_SDK_PATH rev-parse HEAD
if ($sdkHead -ne $PINS.picoSdk.commit) { throw "pico-sdk is at $sdkHead, pinned $($PINS.picoSdk.commit)" }
$pb = Join-Path $B 'profile'
cmake -G Ninja -S "$PF\profile" -B $pb "-DCMAKE_TOOLCHAIN_FILE=$PF\cmake\pico_riscv_wasmclang.cmake" `
  -DCMAKE_BUILD_TYPE=Debug -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -DPICO_CLIB=picolibc "-DPICO_SDK_PATH=$env:PICO_SDK_PATH"
if ($LASTEXITCODE) { throw 'profile configure failed' }
# The SDK writes the board header into generated headers by absolute host path; the WASI clang sees C:\ as "/".
Get-ChildItem (Join-Path $pb 'generated') -Recurse -Include *.h -File | ForEach-Object {
  $t = [IO.File]::ReadAllText($_.FullName)
  $n = $t -replace '(?<=["<])[Cc]:/', '/'
  if ($n -ne $t) { [IO.File]::WriteAllText($_.FullName, $n); "rewrote $($_.Name)" }
}
cmake --build $pb
if ($LASTEXITCODE) { throw 'profile build failed' }
"profile built in $pb"
