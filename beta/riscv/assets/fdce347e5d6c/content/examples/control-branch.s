# control-branch.s -- The same if-else with a signed and with an unsigned comparison.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        li    a0, -1            # x
        li    a1, 1             # y
# signed: if (x < y) r = 1 else r = 2
        bge   a0, a1, else1     # branch on the opposite condition
        li    s1, 1             # then-part
        j     end1
else1:  li    s1, 2             # else-part
end1:
# unsigned: the same with bgeu
        bgeu  a0, a1, else2
        li    s2, 1
        j     end2
else2:  li    s2, 2
end2:   li    t0, 10
        mul   a0, s1, t0
        add   a0, a0, s2        # 12: signed says x < y, unsigned says not
        li    a7, 93
        ecall
