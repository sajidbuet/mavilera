# cache-speedup.s -- Three processors, three memories: what the cache is worth.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a RISC-VISTA template, written for the application).
#
# Open the Compare view. Each processor runs this program four times over the
# same 16 words under three memory models: A ideal, B main memory without a
# cache, C main memory with the caches of the Memory setting. The first pass
# pays the misses, the later three hit, so C is far closer to A than B is. The
# ratio tables give C / A and C / B for each processor.
        addi s1, zero, 4        # passes
        addi a0, zero, 0
pass:   addi t0, zero, 512      # the array lies at 0x200 (memory size 1024 words)
        addi t1, zero, 16
inner:  lw   t2, 0(t0)
        add  a0, a0, t2
        addi t0, t0, 4
        addi t1, t1, -1
        bne  t1, zero, inner
        addi s1, s1, -1
        bne  s1, zero, pass
        halt