# RISC-V SIMT laboratory fixtures (GPU-2, decision G17)

Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
Rights class: content.

Student-facing files of the textbook's Chapter 11A laboratory (LAB-0022), copied unchanged under the author's
decision G17 (`docs/research/gpu-npu/DECISIONS.md`).

Source: book repository, `code/chapter11a/programs/simt/` at commit `1a2787b` (content identical to `77dd055`,
where Chapter 11A was drafted), copied from the Git blobs (LF line ends) on 2026-11-05. Student-facing only: nothing
from `code/chapter11a/ref/` (instructor core, mutants, `ref/programs/reduce_bar`).

Each program folder holds `prog.s` (source, for GNU as with `simt.inc`), `prog.hex` (one instruction word per line,
instruction memory from address 0), `data.hex` (256 data-memory words: the argument block at 0, arrays at 0x100,
0x140, 0x180) and `golden.hex` (the 256 data-memory words after the run, then `cycles`, `issued`, `active_slots`
and the fault code), written by the book's `code/chapter11a/model/regen.py` from the supplied model
`simt_model.py`. `ifelse8` runs on LANES 8, WARPS 1 (`tb_rvsimt_l8`); the others on LANES 4, WARPS 2.

Note for the author: `assembly-record.json` gives `simt_inc_sha256` `dee791ae…`, the hash of a CRLF checkout of
`simt.inc`; the Git blob (LF, copied here) hashes to `27bc916e…`. The other files of the book's folder have
`eol=lf` in its `.gitattributes`; `simt.inc` has none. The `prog.s` and `prog.hex` hashes of every program equal the
record (checked by `test/gpu-rvsimt.test.mjs`).

| File | SHA-256 |
|---|---|
| `uniform/prog.s` | `7186d85459f2c20be979f8f5cd63813ef4b8777e3b3f246f411b63aeeafd1ca5` |
| `uniform/prog.hex` | `1b01f059b04e8325845550db12558302c3353183241145573c85e332e4a89d02` |
| `uniform/data.hex` | `0a54f3e372eab9f753b69d81f4c2c3bf44d5e9cb47f15fbf32938186f8c0a1b3` |
| `uniform/golden.hex` | `03c69512ecf7740212690c138ee36d9e4067207fc0183303dc1abbba3ceeb74d` |
| `ifelse/prog.s` | `42406279fea60b649a4dded93475da5d26f0e845667db6b93b0f6c7a647a873b` |
| `ifelse/prog.hex` | `8363c80d6c56470587a04530802cc7f73dd9e48860d6c6b4b018aa52fcb3c6f7` |
| `ifelse/data.hex` | `2ed5608a7aba85c293fe2a38957137a76ac74456d0c5e7f6b0488eb0295081e5` |
| `ifelse/golden.hex` | `ff0bb012e75fa0a4941e39c95e168938eaffa5966170dd3167c9a0fb2f120ecc` |
| `ifelse8/prog.s` | `43b6d85641c5b680b46d8bef9edac16d204fcb95c0d50ac1fc8e6e003586d673` |
| `ifelse8/prog.hex` | `8cd1d027b2bdc0c3ba1065f673eda567d246d6ad1e0ef42666a42b2d1d720299` |
| `ifelse8/data.hex` | `2ed5608a7aba85c293fe2a38957137a76ac74456d0c5e7f6b0488eb0295081e5` |
| `ifelse8/golden.hex` | `d2e279bde01017ab5fc266574eaa944278836d219abdbb957ef6f041cba007cb` |
| `nested/prog.s` | `c9f2bae6ddfb8e3bec0d57a332b099ef93d825205207477ff6d9b08abcdcbcb7` |
| `nested/prog.hex` | `7f254b234dc63ad243f8774f88ef29feb6ce2601bf38cd708f34f453794a9aee` |
| `nested/data.hex` | `c7fe44d2256a18226c621b47e2acf7c471ede3bcb4916c9caeacf848a6bcfd69` |
| `nested/golden.hex` | `7fcdaee8eebe20a3545ecbebf446b4c206b79218b43c8261c2bdbb6e6223d581` |
| `vadd_tail/prog.s` | `9bac88df9189f010b101b5359ffb1bcf3611f236a8013adf1b4fb640c8b14b60` |
| `vadd_tail/prog.hex` | `9eb4c56ee949600fc6947f0d93141e369c500c12a68b6e8364b471574889278c` |
| `vadd_tail/data.hex` | `486321d27dae3675104f8c4a08cacfc32a873048917d064a895ae86d51420610` |
| `vadd_tail/golden.hex` | `f54ed9c91777e8d4543aeb7681c9015e3ec7cc928aab554f3c08c966f411b8a4` |
| `reverse_bar/prog.s` | `abb6bc81efa415311969e31f5e5093b01e12963748cf3f85421d95f8de8c29e9` |
| `reverse_bar/prog.hex` | `76783fca9f26add6cc6f24c6d9cafd811d8d24d90eef5668ece88b45d69ce747` |
| `reverse_bar/data.hex` | `9dcb0c6fab1865788de6beeef6af7c3ae2e3dada34e2c010fcad480205454af0` |
| `reverse_bar/golden.hex` | `cb2fb7c7059b3902544f00b7ee995e61663c68b3affc8f69e9acfe384f7c0896` |
| `fault_div/prog.s` | `5440ca2d8f16be79b3690d7e7c84b44ab3389035545aa7ac015e47fccdf96d59` |
| `fault_div/prog.hex` | `13814cc354a5947d17b13de0fdb958732c0a2d8a7ce507a971383569377f6d68` |
| `fault_div/data.hex` | `1b1aa352c4cf13742ba03d735859156d2198fca632d2b8ee950e442234f5eba2` |
| `fault_div/golden.hex` | `dfc1cf937542e6d7111adfc8da60d04d68bf7b2490a04b93e0427ca73e92a73b` |
| `fault_join/prog.s` | `690a3a0f66dcd3afdf5b25b01939f8ac9a76c98cbb4ff51844b356d1e9bf1f80` |
| `fault_join/prog.hex` | `d921b995b402fef701bfdb7565790b428963c98f6198c62a28e775e2695c9b25` |
| `fault_join/data.hex` | `1b1aa352c4cf13742ba03d735859156d2198fca632d2b8ee950e442234f5eba2` |
| `fault_join/golden.hex` | `4d3c2694de185c7e10f8fcea980e00fe94d3da87752cbefe4c7e8e02a98a72ec` |
| `simt.inc` | `27bc916ec405e8735f622bc5d96ceed4e796b76cb1dc1134c50ec04e5d65404f` |
| `assembly-record.json` | `dcd0123b1663191c5a0fc1eb82e0b5d8c768d2e76343544d7dffffaa633669e9` |
