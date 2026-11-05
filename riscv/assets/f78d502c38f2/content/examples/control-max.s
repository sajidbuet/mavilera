# control-max.s -- A leaf procedure and its caller.
# Exit code = max(17, -5).
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
_start: li    a0, 17
        li    a1, -5
        call  max               # a0 = max(a0, a1)
        li    a7, 93
        ecall

# max(a, b): returns the larger of two signed integers.
# Leaf: calls nothing, uses only a0, a1; saves nothing.
max:    bge   a0, a1, maxend    # a is larger: return it
        mv    a0, a1
maxend: ret
