# tools/pico-full — the Pico Full compiler and SDK pack (pico2 P1-F2)

Builds what Pico Full downloads on demand (ADR-0012, research D28/D33): **`llvm.wasm`** (clang + lld 23.1.5, RISC-V only,
one multi-call `wasm32-wasip1` module) and the **SDK pack** (`sdk-pack-<sha12>.bin`: headers, prebuilt Pico SDK objects
and archive, picolibc, builtins, linker scripts, recorded compiler jobs). Design: `docs/architecture/pico2-p1f2-sdk-compiler.md`.
Development tools only; nothing here is part of the site, and no output is committed (no file over 1 MB in git).

## Inputs and permissions
Pinned in `pins.json` (as experiment E-CC-WASM-1): llvm-project `llvmorg-23.1.5` with `llvm-23.1.5-wasi.patch` (own port of
YoWASP's WASI patch, Apache-2.0 WITH LLVM-exception), wasi-sdk 34, picolibc 1.8.12, pico-sdk `079c6f3`. Downloading and
running them outside OneDrive is permitted by research decision D27. Host: Windows, CMake, Ninja, Node 23, MSYS2 ucrt64 gcc/g++
(host TableGen and the daemon's stand-in executables), optionally the RISC-V GCC objdump (`.dis` listings only).

Environment: `PICO_FULL_WORK` (work folder, default `%LOCALAPPDATA%\pico2sim-build\pico-full`, **never under OneDrive**);
`PICO_SDK_PATH` (pinned pico-sdk); `PICO_EXAMPLES_SRC` (pinned pico-examples, for the check). The work-folder layout is that of
E-CC-WASM-1, so `PICO_FULL_WORK=<the E-CC-WASM-1 work folder>` reuses its builds.

## Steps
| Step | Script | Result | Time (development host) |
|---|---|---|---|
| 1 | `fetch.ps1` | sources at the pinned commits, WASI patch applied, wasi-sdk checked by SHA-256 | download-bound |
| 2 | `build-llvm.ps1` | host TableGen (static), `build\llvm.wasm` (MinSizeRel, ThinLTO) | about an hour; much memory |
| 3 | `build-ccd.ps1`, then `start-ccd.ps1` in its own window | the compile daemon (`ccd/`): CMake and Ninja run the wasm clang through stand-in `clang.exe` | seconds |
| 4 | `build-runtimes.ps1` | compiler-rt builtins, picolibc with TLS and the `libos` fallback (`sbrk` …) in `build\sysroot-rv32` | minutes |
| 5 | `build-profile.ps1` | the frozen profile (`profile/`: per object set `base_<set>` = pico_stdlib, `full_<set>` = every pack library) in `build\profile` | ~3 min |
| 6 | `node build-pack.mjs` | `out\sdk-pack-<sha12>.bin`, `out\manifest.json` | ~12 s |
| 7 | `build-check.ps1`, `node check-pack.mjs` | pico-examples built by CMake and from the pack; loadable images compared | ~2 min |

## Reproducibility (2026-11-14, `docs/architecture/pico2-full-release-gates.md`)
- `llvm.wasm` rebuilt from steps 1-2 in a fresh work folder is bit-identical to `pins.json` `outputs.llvmWasm` (61 min).
- The pack is bit-identical across work folders when `SOURCE_DATE_EPOCH` (seconds) is set for `build-pack.mjs` (it fixes the
  meta's `created`); without it only that field differs. Host paths are mapped to guest paths (`/pico/...`) in every object, and
  binary info carries the fixed build date. A changed runtime option needs a fresh `build\picolibc-rv32` (CMake keeps cached values).

## Object sets (P1-R4, research D58; `docs/architecture/pico2-p1r4-pack.md`)
`uart` (default), `uart_mc` (a project file includes `pico/multicore.h`), `usb` (the project option Output = UART and USB:
`pico_stdio_usb`, TinyUSB `86ad6e5`, `pico_usb_reset`), `usb_mc`. Each has its own templates and precompiled header; objects are
stored once and the further libraries are linked lazily (`--start-lib`). `SOURCE_DATE_EPOCH` is required: it also gives the fixed
`PICO_PROGRAM_BUILD_DATE`. pioasm (for `pico_status_led`) is built on the host with the MSYS2 g++.

## What the pack builder checks (it stops on any failure)
- Per object set, sources compiled by both `base_<set>` and `full_<set>` give the same code and data (allocated sections and relocations); only debug
  line numbers may differ (`crt0_riscv.S`: the further libraries' defines move preprocessed lines).
- Templates keep no host path. The profile's `main.c`, built in a fresh in-memory file system from the pack bytes (with and
  without the precompiled header), links to the same loadable image as CMake's `base.elf`.

## Decisions made here (recorded in the pack's meta)
- **Profile:** board `pico2`, `rp2350-riscv`, CMake Debug with `-g` (= `-Og -g`), stdio over UART only, picolibc.
- **Objects:** `base_<set>`'s objects linked whole in CMake's order; the further libraries' objects linked lazily (`--start-lib`).
- **Left out** (`excluded.json`, with reasons): pico_low_power (its `LIB_*` define changes shared code), RTT/semihosting stdio,
  pico_bootsel_via_double_reset, radio and network, Arm-only. Of TinyUSB only the rp2040 port (other vendors' headers carry other
  terms); `stage.mjs` refuses TinyUSB files that are not MIT.
- **lld fix:** `hardware_exception/exception_table_riscv.S` declares `.section .time_critical.hardware_exception` without
  flags (not allocated); GNU ld accepts relocations there, lld does not. The builder gives such `.time_critical*` sections
  alloc+exec.
- **Precompiled header** of `pico/stdlib.h`: not shipped (3.8 MB raw, 1.8 MB gzip); its job is in the pack and the driver
  runs it once after loading (0.46 s in Node).
- **clang's own headers:** the generic C ones and the RISC-V intrinsics only (123 KB of 8.1 MB).
- **Paths:** `/pico/sdk`, `/pico/build`, `/pico/sysroot`, `/pico/clang`, `/pico/lib`; students' files in `/project`
  (`-ffile-prefix-map` in the profile, so SDK objects carry `/pico/sdk/...` in `__FILE__` and debug information).
