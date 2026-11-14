# hello-uart.s -- Hello over UART0: start the chip, then feed the transmit FIFO.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# The RP2350 leaves reset on its ring oscillator with its peripherals held in reset. Before
# UART0 can send, this program starts the 12 MHz crystal, clocks the chip and its peripherals
# from it at the clk_sys chosen in the toolbar, releases IO_BANK0, PADS_BANK0 and UART0 from
# reset, sets the baud rate and gives GPIO 0 to the UART. CLK_SYS_DIV, UART_IBRD and UART_FBRD
# are symbols the assembler defines for that clock. MAVILERA C's start-up does the same for you.
# Try: Assemble, then Run (F5): the text appears in the console. Step through puts and watch
# the loop that waits while the FIFO is full (UARTFR bit 5, TXFF).
        .text
_start: li      t0, 0x40048000          # XOSC
        li      t1, 47
        sw      t1, 12(t0)              # STARTUP: wait about 1 ms for the crystal
        li      t1, 0x00fabaa0
        sw      t1, 0(t0)               # CTRL: ENABLE (0xfab), frequency range 1-15 MHz (0xaa0)
xosc:   lw      t1, 4(t0)               # STATUS
        bgez    t1, xosc                # bit 31, STABLE, makes the word negative
        li      t0, 0x40010000          # CLOCKS
        li      t1, 2
        sw      t1, 0x30(t0)            # CLK_REF_CTRL: clk_ref from the crystal
ref:    lw      t1, 0x38(t0)            # CLK_REF_SELECTED
        andi    t1, t1, 4
        beqz    t1, ref
        li      t1, CLK_SYS_DIV
        sw      t1, 0x40(t0)            # CLK_SYS_DIV: clk_ref / divisor = the chosen clk_sys
        li      t1, 0x40
        sw      t1, 0x3c(t0)            # CLK_SYS_CTRL: clk_sys from clk_ref
sys:    lw      t1, 0x44(t0)            # CLK_SYS_SELECTED
        andi    t1, t1, 1
        beqz    t1, sys
        li      t1, 0x800
        sw      t1, 0x48(t0)            # CLK_PERI_CTRL: ENABLE; clk_peri from clk_sys
        li      t0, 0x40023000          # RESETS + 0x3000: its clear alias
        li      t1, 0x04000240          # bits 26 UART0, 9 PADS_BANK0, 6 IO_BANK0
        sw      t1, 0(t0)               # out of reset
        li      t0, 0x40020000          # RESETS
done:   lw      t2, 8(t0)               # RESET_DONE
        and     t2, t2, t1
        bne     t2, t1, done
        li      t0, 0x40070000          # UART0
        li      t1, UART_IBRD
        sw      t1, 0x24(t0)            # UARTIBRD: clk_peri / (16 x baud), its integer part
        li      t1, UART_FBRD
        sw      t1, 0x28(t0)            # UARTFBRD: the fraction x 64 (4 MHz: 2.17, so 2 and 11)
        li      t1, 0x70
        sw      t1, 0x2c(t0)            # UARTLCR_H: 8 data bits, FIFOs on
        li      t1, 0x301
        sw      t1, 0x30(t0)            # UARTCR: UARTEN, TXE, RXE
        li      t0, 0x40028000          # IO_BANK0
        li      t1, 2
        sw      t1, 4(t0)               # GPIO0_CTRL: function 2, UART0 TX
        li      t0, 0x4003b000          # PADS_BANK0 + 0x3000: its clear alias
        li      t1, 0x100
        sw      t1, 4(t0)               # GPIO0's pad: clear ISO (isolation)
        la      a0, msg
        call    puts
        ebreak

# puts(a0): send the bytes of a string up to its zero byte
puts:   li      t0, 0x40070000          # UART0
next:   lbu     t1, 0(a0)
        beqz    t1, sent
full:   lw      t2, 0x18(t0)            # UARTFR
        andi    t2, t2, 0x20            # TXFF: the transmit FIFO is full
        bnez    t2, full
        sw      t1, 0(t0)               # UARTDR: into the FIFO
        addi    a0, a0, 1
        j       next
sent:   ret

        .data
msg:    .asciz  "Hello from Hazard3 on the Pico 2!\n"
