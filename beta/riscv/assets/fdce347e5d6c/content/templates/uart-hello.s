# uart-hello.s -- a serial port by polling: send a greeting, then echo two received characters.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a template written for the application).
#
# UART registers (base 0x40002000): TXDATA 0x00 (write a byte to send), RXDATA 0x04 (read the next
# received byte), STATUS 0x08 (bit 0 TX ready, bit 1 a received byte is waiting), CTRL 0x0C (interrupt
# enables). A byte takes 4 cycles to send, so the transmitter is busy right after a write; a program that
# writes faster than that loses bytes (STATUS bit 2), which is why this one waits for bit 0 first.
# The UART of this laboratory is a simple model of ours, not that of any real chip. The stimulus
# gives the receiver the letters "ok" at cycles 300 and 340; in the Peripherals tab you can type
# more. The console shows what the UART sent: Hello, UART! and "ok".
        .data
msg:    .asciz "Hello, UART!\n"
        .text
main:   li   s0, 0x40002000     # the UART
        la   s1, msg
send:   lbu  t0, 0(s1)
        beqz t0, listen         # the end of the text
txwait: lw   t1, 8(s0)          # STATUS
        andi t1, t1, 1          # TX ready?
        beqz t1, txwait
        sw   t0, 0(s0)          # TXDATA
        addi s1, s1, 1
        j    send
listen: li   s2, 2              # characters to echo
echo:   lw   t1, 8(s0)
        andi t1, t1, 2          # a received byte waiting?
        beqz t1, echo
        lw   t0, 4(s0)          # RXDATA: reading takes the byte
txw2:   lw   t1, 8(s0)
        andi t1, t1, 1
        beqz t1, txw2
        sw   t0, 0(s0)          # send it back
        addi s2, s2, -1
        bnez s2, echo
        halt
