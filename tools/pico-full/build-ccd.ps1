# build-ccd.ps1 -- the compile daemon's stand-in executables (clang.exe, clang++.exe, ld.lld.exe) in PICO_FULL_WORK\ccd,
# with ccd-client.mjs next to them (pico2 P1-F2). Start the daemon with start-ccd.ps1 before the runtime and pack builds.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
. "$PSScriptRoot\env.ps1"
Need "$MSYS\gcc.exe" 'MSYS2 gcc'
New-Item -ItemType Directory -Force $CCD | Out-Null
$env:PATH = "$MSYS;$env:PATH"   # gcc finds its own programs and DLLs there
& "$MSYS\gcc.exe" -O2 -municode -static -o "$CCD\clang.exe" "$PF\ccd\ccwrap.c"
if ($LASTEXITCODE) { throw 'ccwrap build failed' }
Copy-Item "$CCD\clang.exe" "$CCD\clang++.exe" -Force
Copy-Item "$CCD\clang.exe" "$CCD\ld.lld.exe" -Force
Copy-Item "$PF\ccd\ccd-client.mjs" "$CCD\ccd-client.mjs" -Force
"stand-ins in $CCD"
