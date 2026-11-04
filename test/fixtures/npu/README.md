# NPU fixtures (test/npu-*.test.mjs, NPU-1)

Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
Rights class: code.

Student-facing files of the textbook's Chapter 11 laboratory, copied unchanged under the author's decision G12
(`docs/research/gpu-npu/DECISIONS.md`). No instructor file (`code/chapter11/ref/`) is copied.

| File | Source in the book repository | Book commit | SHA-256 |
|---|---|---|---|
| `mac_vectors.hex` | `code/chapter11/vectors/mac_vectors.hex` | `9e99307` (2026-10-22) | `86221ccaee9f11473754c5489c9f36d86de495834da2c792010281e653c4d3ed` |

## Laboratory programs and data (NPU-2)

Copied unchanged for tests N17–N25 (`test/npu-lab.test.mjs`): the `npu_mv` files from book commit `c2dc4c4`
(2026-11-04), in which the book moved its NPU to `0x5000_0000` (decision G1) and regenerated them; every other file
from book commit `9e99307` (2026-10-22), unchanged since. The programs, the tests and the MAVILERA template `npu-mv`
all use the NPU at `0x5000_0000`, and the golden dumps are compared on every word.

| File | Source (`code/chapter11/…`) | SHA-256 |
|---|---|---|
| `ch11/programs/sw_mv/prog.s` | `programs/sw_mv/prog.s` | `a7320c5aeb9477e8d915afb2c14585de4236d7795c742935404d35a3bbf5c424` |
| `ch11/programs/sw_mv/prog.hex` | `programs/sw_mv/prog.hex` | `d23bc944378f8ab5fb31e525d1c61c644c7457553b7f21b1417081e92d2a722a` |
| `ch11/programs/sw_mv/v1/golden.hex` | `programs/sw_mv/v1/golden.hex` | `54ea3e3641708c0bcf29b3b855732a06843f59d44c72a6c51963390b4ac808f3` |
| `ch11/programs/sw_mv/v4/golden.hex` | `programs/sw_mv/v4/golden.hex` | `36252bd3dc94697809bb21d9a949872ddb6475a80d76d4e1327b12f2bebcd3b8` |
| `ch11/programs/sw_mv/v16/golden.hex` | `programs/sw_mv/v16/golden.hex` | `8b3adc46a2538e3b7aa9ebfedc3ceb0df491753c432cde6b18fc2c8f7907ba00` |
| `ch11/programs/npu_mv/prog.s` | `programs/npu_mv/prog.s` | `0d59dea8c5d4a9b1024c18345829067449d290ffd763917d054be50cc9b03312` |
| `ch11/programs/npu_mv/prog.hex` | `programs/npu_mv/prog.hex` | `6287a8cbdb329c4919415293e4d7ee9adfbb2047f52d3b15597eee6af6ab4466` |
| `ch11/programs/npu_mv/v1/golden.hex` | `programs/npu_mv/v1/golden.hex` | `a2a8ba015da10860b3672ea8bb3c12b0484f44d93c17af5f31b29a17616dabbc` |
| `ch11/programs/npu_mv/v4/golden.hex` | `programs/npu_mv/v4/golden.hex` | `54938293f4198292519a2a6f055a8f9e15cde19f5b291683fb2526cc1ff265ec` |
| `ch11/programs/npu_mv/v16/golden.hex` | `programs/npu_mv/v16/golden.hex` | `64ad33d36ec9fd20363e675b525e70da26bdc612c950be695741b114ab8181d5` |
| `ch11/programs/sw_mv_m/prog.s` | `programs/sw_mv_m/prog.s` | `34b8f7b137d611805e6302e60757582adcb7bff9e85f27c6855b02b7bf10a8bc` |
| `ch11/data/v1/data.hex` | `data/v1/data.hex` | `98730230c57381b60cb8939bf941d696287e0a51f8f31ff4da971eec4132d3fb` |
| `ch11/data/v4/data.hex` | `data/v4/data.hex` | `f75f122ded4359d1fd62b85c1bdaaacb12fc4a32d901deb34228585808bfd44b` |
| `ch11/data/v16/data.hex` | `data/v16/data.hex` | `1e8a40769cb6130950c4b9e90ba0a0e128b8b8e9afee285a463e493e64c95c96` |

`golden.hex` (as `tb/tb_npu_soc.sv` reads it): words 0–31 x0–x31; 32 halt PC; 33 cycles; 34–161 RAM words 0–127;
162 NPU accesses; 163 STATUS reads; 164 K; then K pairs (cycle, OUT) of the GPIO OUT changes, the cycle being that of
the store that changed OUT (instructions counted from 0). `data.hex`: RAM words 0–127 (NV at 0x000, W at 0x010, the
vectors from 0x040).

## MAC vectors

`mac_vectors.hex`: one hex word per line. The first word is the number of cases (40); each case is nine words:
`WEIGHT[0..3]` (row i of W, W_ij in bits 8j+7…8j), the four INT8 activations packed (x_j in bits 8j+7…8j), and
the expected `y[0..3]` (INT32). The test checks the hash before it uses the file.
