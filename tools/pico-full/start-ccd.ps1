# start-ccd.ps1 -- start the compile daemon (ccd/ccd-server.mjs) on llvm.wasm in this window; stop it with Ctrl+C.
#   -Workers n   worker threads (default: logical processors; fewer on a machine short of memory)
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
param([int]$Workers = 0, [int]$Port = 47321)
. "$PSScriptRoot\env.ps1"
Need $LLVM_WASM 'llvm.wasm'
$a = @("$PF\ccd\ccd-server.mjs", $LLVM_WASM, $Port)
if ($Workers -gt 0) { $a += $Workers }
node --no-warnings @a
