# uart-echo.s -- Echo over UART0: what you type comes back in capitals, until Enter.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# The start-up is hello-uart.s's, with the receiver on GPIO 1 as well. Then the program waits until
# UART0's receive FIFO holds a byte (UARTFR bit 4, RXFE: receive FIFO empty), reads it from UARTDR,
# turns a to z into A to Z (subtract 32), and sends it back. A carriage return (13), which the
# console's Send adds at the end of the line, ends the program with a newline.
# Try: Assemble, Run, type a line in Send to UART0 and press Enter. Step through getc while the
# FIFO is empty: the loop spins until a byte arrives. Then make it echo digits only.
        .text
_start: li      t0, 0x40048000          # XOSC
        li      t1, 47
        sw      t1, 12(t0)              # STARTUP: wait about 1 ms for the crystal
        li      t1, 0x00fabaa0
        sw      t1, 0(t0)               # CTRL: ENABLE, frequency range 1-15 MHz
xosc:   lw      t1, 4(t0)               # STATUS
        bgez    t1, xosc                # bit 31, STABLE
        li      t0, 0x40010000          # CLOCKS
        li      t1, 2
        sw      t1, 0x30(t0)            # CLK_REF_CTRL: clk_ref from the crystal
ref:    lw      t1, 0x38(t0)
        andi    t1, t1, 4
        beqz    t1, ref
        li      t1, CLK_SYS_DIV
        sw      t1, 0x40(t0)            # CLK_SYS_DIV: the chosen clk_sys
        li      t1, 0x40
        sw      t1, 0x3c(t0)            # CLK_SYS_CTRL: clk_sys from clk_ref
sys:    lw      t1, 0x44(t0)
        andi    t1, t1, 1
        beqz    t1, sys
        li      t1, 0x800
        sw      t1, 0x48(t0)            # CLK_PERI_CTRL: ENABLE; clk_peri from clk_sys
        li      t0, 0x40023000          # RESETS, clear alias
        li      t1, 0x04000240          # bits 26 UART0, 9 PADS_BANK0, 6 IO_BANK0
        sw      t1, 0(t0)
        li      t0, 0x40020000
done:   lw      t2, 8(t0)               # RESET_DONE
        and     t2, t2, t1
        bne     t2, t1, done
        li      t0, 0x40070000          # UART0
        li      t1, UART_IBRD
        sw      t1, 0x24(t0)            # UARTIBRD
        li      t1, UART_FBRD
        sw      t1, 0x28(t0)            # UARTFBRD
        li      t1, 0x70
        sw      t1, 0x2c(t0)            # UARTLCR_H: 8 data bits, FIFOs on
        li      t1, 0x301
        sw      t1, 0x30(t0)            # UARTCR: UARTEN, TXE, RXE
        li      t0, 0x40028000          # IO_BANK0
        li      t1, 2
        sw      t1, 4(t0)               # GPIO0_CTRL: function 2, UART0 TX
        sw      t1, 12(t0)              # GPIO1_CTRL: function 2, UART0 RX
        li      t0, 0x4003b000          # PADS_BANK0, clear alias
        li      t1, 0x100
        sw      t1, 4(t0)               # GPIO0's pad: clear ISO
        sw      t1, 8(t0)               # GPIO1's pad: clear ISO
loop:   call    getc
        li      t1, 13
        beq     a0, t1, end             # carriage return: the end of the line
        li      t1, 'a'
        bltu    a0, t1, send
        li      t1, 'z'
        bgtu    a0, t1, send
        addi    a0, a0, -32             # a-z to A-Z
send:   call    putc
        j       loop
end:    li      a0, '\n'
        call    putc
        mv      a0, zero
        ebreak

# getc(): wait for a byte from UART0's receive FIFO and return it in a0
getc:   li      t0, 0x40070000          # UART0
empty:  lw      t2, 0x18(t0)            # UARTFR
        andi    t2, t2, 0x10            # RXFE: the receive FIFO is empty
        bnez    t2, empty
        lw      a0, 0(t0)               # UARTDR: the byte (bits 8-11 are error flags)
        andi    a0, a0, 0xff
        ret

# putc(a0): send one byte to UART0
putc:   li      t0, 0x40070000
full:   lw      t2, 0x18(t0)            # UARTFR
        andi    t2, t2, 0x20            # TXFF: the transmit FIFO is full
        bnez    t2, full
        sw      a0, 0(t0)               # UARTDR
        ret
