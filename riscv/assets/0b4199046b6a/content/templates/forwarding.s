# forwarding.s -- Data dependences and forwarding in the pipeline.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a RISC-VISTA template, written for the application).
#
# Each instruction uses the result of the one before, before it is written back.
# Try: step cycle by cycle and open the Hazards tab: fwd_sel_a and fwd_sel_b take
# operands from the MEM stage (the instruction one ahead) or from WB (two ahead).
# Then set Hazards to "Stub: none" (the program restarts) and run: the results
# are wrong, and the Hazards tab names each stale value.
        addi x1, x0, 5
        add  x2, x1, x1         # x1 from MEM: 10
        sub  x3, x2, x1         # x2 from MEM, x1 from WB: 5
        or   x4, x3, x2         # 15
        and  x5, x4, x3         # 5
        add  x6, x5, x4         # 20
        halt
