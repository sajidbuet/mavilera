# fetch.ps1 -- step 1 of the Pico Full toolchain (pico2 P1-F2): pinned sources and wasi-sdk into PICO_FULL_WORK.
#   llvm-project (sparse, at the pinned tag; the WASI patch applied), picolibc (tag), wasi-sdk 34 (archive checked by
#   SHA-256, extracted). Downloads are untrusted data: nothing here runs code from them. Permission: research D27.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
. "$PSScriptRoot\env.ps1"
New-Item -ItemType Directory -Force (Join-Path $W 'src'), (Join-Path $W 'tools'), (Join-Path $W 'dl') | Out-Null

function Clone($url, $tag, $commit, $dir, $sparse) {
  if (-not (Test-Path (Join-Path $dir '.git'))) {
    git clone --filter=blob:none --no-checkout --depth 1 --branch $tag $url $dir
    if ($LASTEXITCODE) { throw "clone failed: $url" }
    if ($sparse) { git -C $dir sparse-checkout set @sparse; if ($LASTEXITCODE) { throw 'sparse-checkout failed' } }
    git -C $dir checkout $tag
    if ($LASTEXITCODE) { throw "checkout failed: $tag" }
  }
  $head = git -C $dir rev-parse HEAD
  if ($head -ne $commit) { throw "$dir is at $head, pinned $commit" }
  "$dir at $tag ($commit)"
}

Clone $PINS.llvmProject.url $PINS.llvmProject.tag $PINS.llvmProject.commit $LLVM_SRC $PINS.llvmProject.sparse
$patch = Join-Path $PF $PINS.llvmProject.patch.file
if ((Get-FileHash $patch -Algorithm SHA256).Hash.ToLower() -ne $PINS.llvmProject.patch.sha256) { throw 'patch hash differs from pins.json' }
git -C $LLVM_SRC apply --check $patch 2>$null
if ($LASTEXITCODE -eq 0) { git -C $LLVM_SRC apply $patch; if ($LASTEXITCODE) { throw 'patch failed' }; 'WASI patch applied' }
else { git -C $LLVM_SRC apply --reverse --check $patch 2>$null; if ($LASTEXITCODE) { throw 'the WASI patch neither applies nor is applied' }; 'WASI patch already applied' }

Clone $PINS.picolibc.url $PINS.picolibc.tag $PINS.picolibc.commit $PICOLIBC_SRC $null

if (-not (Test-Path $WASI_SDK)) {
  $arc = Join-Path $W "dl\$(Split-Path $PINS.wasiSdk.url -Leaf)"
  if (-not (Test-Path $arc)) { Invoke-WebRequest $PINS.wasiSdk.url -OutFile $arc }
  if ((Get-FileHash $arc -Algorithm SHA256).Hash.ToLower() -ne $PINS.wasiSdk.sha256) { throw "wasi-sdk archive hash differs: $arc" }
  tar -xzf $arc -C (Join-Path $W 'tools')
  if ($LASTEXITCODE) { throw 'wasi-sdk extraction failed' }
}
"wasi-sdk at $WASI_SDK"

# P1-R4 (research D58): TinyUSB, the pico-sdk's submodule lib/tinyusb at the commit the pinned SDK names (MIT), for the
# USB object sets; fetched as one commit into the SDK checkout given by PICO_SDK_PATH (nothing in it is run)
if ($env:PICO_SDK_PATH) {
  $tu = Join-Path $env:PICO_SDK_PATH 'lib\tinyusb'
  $pin = (git -C $env:PICO_SDK_PATH ls-tree HEAD lib/tinyusb) -split '\s+' | Select-Object -Index 2
  if ($pin -ne $PINS.tinyusb.commit) { throw "the SDK names TinyUSB $pin, pins.json $($PINS.tinyusb.commit)" }
  if ((git -C $tu rev-parse HEAD 2>$null) -ne $pin) {
    git -C $tu init -q; git -C $tu fetch -q --depth 1 $PINS.tinyusb.url $pin; git -C $tu checkout -q FETCH_HEAD
    if ($LASTEXITCODE) { throw 'TinyUSB fetch failed' }
  }
  "TinyUSB at $(git -C $tu rev-parse HEAD)"
}
