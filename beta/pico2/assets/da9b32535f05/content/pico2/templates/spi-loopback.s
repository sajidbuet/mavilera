# spi-loopback.s -- SPI in loopback: SPI0 sends four bytes and receives each one back.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# SPI sends and receives at the same time: each clock pulse shifts one bit out on MOSI and one in
# from MISO. With SSPCR1.LBM (loop back) set, the PL022 connects its own output to its input, so
# every byte sent comes back. The program releases SPI0 from reset, sets the bit clock to
# clk_peri / (2 x (1 + 3)) (SSPCPSR 2, SCR 3), 8-bit frames, then sends 0x11, 0x22, 0x33, 0x44,
# reading each back from SSPDR when SSPSR.RNE says it has arrived. a0 ends as their sum, 0xaa.
# Try: step through it and watch the SPI tab: the TX and RX FIFOs and the bus log.
# Clear LBM (write 2, not 3, to SSPCR1) and run: nothing is wired to MISO, every byte reads 0.
        .text
_start: li      t0, 0x40010000          # CLOCKS
        li      t1, 0x800
        sw      t1, 0x48(t0)            # CLK_PERI_CTRL: ENABLE, from clk_sys (the SPI's clock)
        li      t0, 0x40023000          # RESETS, clear alias
        li      t1, 0x40000             # bit 18: SPI0
        sw      t1, 0(t0)
        li      t0, 0x40020000
wait:   lw      t2, 8(t0)               # RESET_DONE
        and     t2, t2, t1
        beqz    t2, wait
        li      s0, 0x40080000          # SPI0
        li      t1, 2
        sw      t1, 0x10(s0)            # SSPCPSR: prescaler 2
        li      t1, 0x0307
        sw      t1, 0x00(s0)            # SSPCR0: SCR 3, 8-bit frames (DSS 7), Motorola, mode 0
        li      t1, 3
        sw      t1, 0x04(s0)            # SSPCR1: SSE (enabled) | LBM (loop back)
        la      s1, data
        li      s2, 4                   # bytes to send
        li      a0, 0
next:   lbu     t1, 0(s1)
        sw      t1, 0x08(s0)            # SSPDR: into the TX FIFO; the frame starts
rx:     lw      t2, 0x0c(s0)            # SSPSR
        andi    t2, t2, 4               # RNE: a byte has come in
        beqz    t2, rx
        lw      t3, 0x08(s0)            # SSPDR: the byte received
        add     a0, a0, t3
        addi    s1, s1, 1
        addi    s2, s2, -1
        bnez    s2, next
        ebreak                          # a0 = 0xaa

        .data
data:   .byte   0x11, 0x22, 0x33, 0x44
