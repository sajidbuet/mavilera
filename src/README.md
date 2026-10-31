# src/ — application code (rights class: code)

Module plan from the specification §5.2. Simulation modules (`isa/`, `asm/`,
`core/`, `uarch/`, `cc/`) are pure JavaScript with no DOM access, so that the
same files run in the browser, in a Web Worker and under Node.js for the
tests. Folders are created when their milestone starts.

| Folder | Module | Responsibility | Milestone |
|---|---|---|---|
| `isa/` | `encoding.js` | Formats, opcodes, `funct3`/`funct7`, immediate packing; one table for assembler, disassembler and decoders | M1 |
| `asm/` | `assembler.js`, `disassembler.js`, `scratch.js`, `gcc-import.js` | Two-pass assembler in the dialect of `rvasm.py`; disassembler in `rvdis.py` style (§7); encode/decode scratchpad (WS-F-024); import of GCC `-S` output (WS-F-085) | M1, M5b |
| `mem/` | `bus.js`, `device.js`, `devices.js`, `platform.js`, `system.js`, `controller.js`, `cache.js`, … | Address map, memory system, caches (W-D26); the platform devices GPIO, timer and UART and their glue (WS-F-111) | M7 |
| `core/` | `memory.js`, `iss.js`, `priv.js`, `history.js`, `exports.js`, `callstack.js`, `share.js`, `data-io.js` | Byte-addressed memory and profiles (§6); instruction-level simulator RV32I + M, with traps and devices in the profile `iss-priv` (`priv.js`); reversible history; golden dump, trace and VCD exports (§13); call stack (WS-F-103/143); share link and settings file (WS-F-122/144); data import and export (WS-F-145) | M1, M5, M5b |
| `uarch/` | `single.js`, `pipe.js`, `multi.js`, `signals.js`, `compare.js`, `pipe-summary.js` | Ch 6, 8, 7 models, signal-level, with the book's names (§8); the comparison of the three (§8.4); stop events, hazard summary, folded diagram, prediction and CPI components of a pipelined run (WS-F-091, WS-F-140–142) | M2–M5b |
| `cc/` | `lexer.js`, `preprocess.js`, `parser.js`, `types.js`, `check.js`, `codegen.js`, `runtime.js`, `compiler.js` | C-subset compiler (§10.1): plain and register translation, psABI frames, source map | M5 |
| `ui/` | `strings.js`, `theme.css`, panels, `assist.js`, dialogs | Interface (§11); every string in `strings.js`; editor completion and hover help (WS-U-021); example library and data dialogs (WS-F-123, WS-F-145) | M1 onward |
| `worker/` | — | Web Worker for long runs (§5.3) | M1 |

Book-derived data (geometry, delay table, examples, help text) is not code
and lives in `content/`.
