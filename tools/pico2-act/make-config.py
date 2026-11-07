#!/usr/bin/env python3
# make-config.py -- derives the RP2350 variant of riscv-arch-test's Hazard3 configuration (ACT4 framework) from the upstream
# files, by explicit text edits that must each match exactly once. Run inside WSL; nothing is copied into this repository.
#   make-config.py UPSTREAM_CONFIG_DIR OUT_DIR COMPILER OBJDUMP SAIL
# UPSTREAM_CONFIG_DIR is config/cores/hazard3/hazard3-rv32imacb-u-pmp of the riscv-arch-test clone. The edits turn the testbench
# configuration of the upstream (16 PMP regions with TOR and NA4, Zbc/Zbkc/Zbkx, mvendorid 0) into what R-HZ-01 §3.2 and the RTL of
# the RP2350 revision give: NAPOT-only PMP with a 32-byte granule (Sail's `count` can only be 16, so the 11 regions are modelled
# as 16 with `usable_count` 8: regions 8 to 10 are hardwired in the RP2350 and cannot be tested through Sail), no Zbc, Zbkc or Zbkx,
# mvendorid 0x493 and mimpid 0x86fc4e3f. Zcmp has no switch in Sail 0.16, so the suite cannot check it.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: code.

import re
import shutil
import sys
from pathlib import Path

UP_NAME = "hazard3-rv32imacb-u-pmp"
NAME = "rp2350-hazard3"


def edit(text: str, old: str, new: str, what: str) -> str:
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"{what}: expected exactly one match, found {n}: {old!r}")
    return text.replace(old, new)


def main() -> None:
    if len(sys.argv) != 6:
        raise SystemExit(__doc__)
    up, out, compiler, objdump, sail = (Path(a) for a in sys.argv[1:6])
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(up, out)

    # ---- UDB configuration
    src = (out / f"{UP_NAME}.yaml").read_text()
    (out / f"{UP_NAME}.yaml").unlink()
    y = src
    y = edit(y, f"name: {UP_NAME}", f"name: {NAME}", "yaml name")
    y = re.sub(r"^description:.*$", "description: RP2350 Hazard3 - RV32IMAC_Zba_Zbb_Zbs_Zbkb_Zcb_Zicsr_Zifencei with U-mode, NAPOT-only PMP (derived from the upstream Hazard3 configuration by tools/pico2-act/make-config.py)", y, count=1, flags=re.M)
    for ext in ("Zbc", "Zbkc", "Zbkx"):
        y = edit(y, f'  - {{ name: {ext}, version: "= 1.0.0" }}\n', "", f"yaml {ext}")
    y = edit(y, "  NUM_USABLE_PMP_ENTRIES: 16", "  NUM_USABLE_PMP_ENTRIES: 8", "yaml usable PMP")
    y = edit(y, "  PMP_GRANULARITY: 2", "  PMP_GRANULARITY: 5", "yaml PMP granularity")
    y = edit(y, "  PMP_NA4_SUPPORTED: true", "  PMP_NA4_SUPPORTED: false", "yaml NA4")
    y = edit(y, "  PMP_TOR_SUPPORTED: true", "  PMP_TOR_SUPPORTED: false", "yaml TOR")
    y = edit(y, "  VENDOR_ID_BANK: 0x0", "  VENDOR_ID_BANK: 0x9", "yaml vendor bank")      # mvendorid 0x493 = 9 * 128 + 0x13
    y = edit(y, "  VENDOR_ID_OFFSET: 0x0", "  VENDOR_ID_OFFSET: 0x13", "yaml vendor offset")
    y = edit(y, "  IMP_ID_VALUE: 0x810200a0", "  IMP_ID_VALUE: 0x86fc4e3f", "yaml mimpid")
    (out / f"{NAME}.yaml").write_text(y)

    # ---- Sail configuration
    s = (out / "sail.json").read_text()
    s = edit(s, '"grain": 0,\n      "count": 16,\n      "usable_count": 16,\n      "tor_supported": true,\n      "na4_supported": true,',
             '"grain": 3,\n      "count": 16,\n      "usable_count": 8,\n      "tor_supported": false,\n      "na4_supported": false,', "sail pmp")
    s = edit(s, '"vendorid": 0,', '"vendorid": 1171,', "sail vendorid")          # 0x493
    s = edit(s, '"impid": 2164392096,', '"impid": 2264682047,', "sail impid")      # 0x86fc4e3f
    for ext in ("Zbc", "Zbkc", "Zbkx"):
        s = edit(s, f'    "{ext}": {{\n      "supported": true\n    }}', f'    "{ext}": {{\n      "supported": false\n    }}', f"sail {ext}")
    (out / "sail.json").write_text(s)

    # ---- framework configuration
    t = (out / "test_config.yaml").read_text()
    t = edit(t, f"name: {UP_NAME}", f"name: {NAME}", "test_config name")
    t = edit(t, f"udb_config: {UP_NAME}.yaml", f"udb_config: {NAME}.yaml", "test_config udb")
    t = re.sub(r"^compiler_exe:.*$", f"compiler_exe: {compiler}", t, count=1, flags=re.M)
    t = re.sub(r"^objdump_exe:.*$", f"objdump_exe: {objdump}", t, count=1, flags=re.M)
    t = re.sub(r"^ref_model_exe:.*$", f"ref_model_exe: {sail}", t, count=1, flags=re.M)
    (out / "test_config.yaml").write_text(t)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
