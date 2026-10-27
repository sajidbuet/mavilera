	.file	"calls.c"
	.option nopic
	.attribute arch, "rv32i2p1"
	.attribute unaligned_access, 0
	.attribute stack_align, 16
	.text
.Ltext0:
	.cfi_sections	.debug_frame
	.align	2
	.type	sq, @function
sq:
.LVL0:
.LFB0:
.LM1:
	.cfi_startproc
.LM2:
	addi	sp,sp,-16
	.cfi_def_cfa_offset 16
	sw	ra,12(sp)
	.cfi_offset 1, -4
	mv	a1,a0
.LM3:
.LM4:
	call	__mulsi3
.LVL1:
.LM5:
	lw	ra,12(sp)
	.cfi_restore 1
	addi	sp,sp,16
	.cfi_def_cfa_offset 0
	jr	ra
	.cfi_endproc
.LFE0:
	.size	sq, .-sq
	.align	2
	.type	tw, @function
tw:
.LVL2:
.LFB1:
.LM6:
	.cfi_startproc
.LM7:
.LM8:
	slli	a0,a0,1
.LVL3:
.LM9:
	ret
	.cfi_endproc
.LFE1:
	.size	tw, .-tw
	.align	2
	.globl	puts2
	.type	puts2, @function
puts2:
.LVL4:
.LFB2:
.LM10:
	.cfi_startproc
.LM11:
	addi	sp,sp,-16
	.cfi_def_cfa_offset 16
	sw	ra,12(sp)
	sw	s0,8(sp)
	.cfi_offset 1, -4
	.cfi_offset 8, -8
	mv	s0,a0
.LM12:
.LM13:
	lbu	a0,0(a0)
.LVL5:
.LM14:
	beq	a0,zero,.L4
.L6:
.LM15:
.LM16:
	addi	s0,s0,1
.LVL6:
.LM17:
	call	putchar
.LVL7:
.LM18:
	lbu	a0,0(s0)
	bne	a0,zero,.L6
.L4:
.LM19:
	lw	ra,12(sp)
	.cfi_restore 1
	lw	s0,8(sp)
	.cfi_restore 8
.LVL8:
.LM20:
	addi	sp,sp,16
	.cfi_def_cfa_offset 0
	jr	ra
	.cfi_endproc
.LFE2:
	.size	puts2, .-puts2
	.section	.rodata.str1.4,"aMS",@progbits,1
	.align	2
.LC0:
	.string	"ok\n"
	.text
	.align	2
	.globl	main
	.type	main, @function
main:
.LFB3:
.LM21:
	.cfi_startproc
	addi	sp,sp,-32
	.cfi_def_cfa_offset 32
	sw	ra,28(sp)
	sw	s0,24(sp)
	sw	s1,20(sp)
	sw	s2,16(sp)
	sw	s3,12(sp)
	sw	s4,8(sp)
	.cfi_offset 1, -4
	.cfi_offset 8, -8
	.cfi_offset 9, -12
	.cfi_offset 18, -16
	.cfi_offset 19, -20
	.cfi_offset 20, -24
.LM22:
.LBB2:
.LM23:
.LVL9:
.LM24:
	lui	s1,%hi(buf)
	addi	s1,s1,%lo(buf)
.LBE2:
.LM25:
	mv	s2,s1
.LBB3:
.LM26:
	li	s0,0
.LM27:
	lui	s3,%hi(ops)
	addi	s3,s3,%lo(ops)
.LM28:
	li	s4,8
.LVL10:
.L10:
.LM29:
.LM30:
	andi	a5,s0,1
.LM31:
	slli	a5,a5,2
	add	a5,s3,a5
.LM32:
	lw	a5,0(a5)
	mv	a0,s0
	jalr	a5
.LVL11:
.LM33:
	sw	a0,0(s2)
.LM34:
	addi	s0,s0,1
.LVL12:
.LM35:
	addi	s2,s2,4
	bne	s0,s4,.L10
	addi	a3,s1,32
.LBE3:
.LM36:
	li	a5,0
.L11:
.LVL13:
.LBB4:
.LM37:
.LM38:
	lw	a4,0(s1)
	add	a5,a5,a4
.LVL14:
.LM39:
.LM40:
	addi	s1,s1,4
	bne	s1,a3,.L11
.LBE4:
.LM41:
.LM42:
	lui	s0,%hi(counter)
.LVL15:
.LM43:
	sw	a5,%lo(counter)(s0)
.LM44:
	lui	a0,%hi(.LC0)
	addi	a0,a0,%lo(.LC0)
	call	puts2
.LVL16:
.LM45:
.LM46:
	lw	a5,%lo(counter)(s0)
	srai	a0,a5,31
	srli	a0,a0,24
	add	a5,a5,a0
	andi	a5,a5,255
.LM47:
	sub	a0,a5,a0
	lw	ra,28(sp)
	.cfi_restore 1
	lw	s0,24(sp)
	.cfi_restore 8
	lw	s1,20(sp)
	.cfi_restore 9
	lw	s2,16(sp)
	.cfi_restore 18
	lw	s3,12(sp)
	.cfi_restore 19
	lw	s4,8(sp)
	.cfi_restore 20
	addi	sp,sp,32
	.cfi_def_cfa_offset 0
	jr	ra
	.cfi_endproc
.LFE3:
	.size	main, .-main
	.globl	ops
	.comm	counter,4,4
	.comm	buf,32,4
	.section	.sdata,"aw"
	.align	2
	.type	ops, @object
	.size	ops, 8
ops:
	.word	sq
	.word	tw
	.text
.Letext0:
	.section	.debug_info,"",@progbits
.Ldebug_info0:
	.4byte	0x1df
	.2byte	0x5
	.byte	0x1
	.byte	0x4
	.4byte	.Ldebug_abbrev0
	.uleb128 0xc
	.4byte	.LASF6
	.byte	0x1d
	.byte	0x3
	.4byte	0x31647
	.4byte	.LASF0
	.4byte	.LASF1
	.4byte	.Ltext0
	.4byte	.Letext0-.Ltext0
	.4byte	.Ldebug_line0
	.uleb128 0x1
	.byte	0x8
	.byte	0x7
	.4byte	.LASF2
	.uleb128 0x1
	.byte	0x4
	.byte	0x7
	.4byte	.LASF3
	.uleb128 0x3
	.4byte	0x49
	.4byte	0x49
	.uleb128 0x4
	.4byte	0x32
	.byte	0x7
	.byte	0
	.uleb128 0xd
	.byte	0x4
	.byte	0x5
	.string	"int"
	.uleb128 0x5
	.string	"buf"
	.byte	0x5
	.byte	0x5
	.4byte	0x39
	.uleb128 0x5
	.byte	0x3
	.4byte	buf
	.uleb128 0xe
	.4byte	.LASF4
	.byte	0x1
	.byte	0x6
	.byte	0x5
	.4byte	0x49
	.uleb128 0x5
	.byte	0x3
	.4byte	counter
	.uleb128 0x3
	.4byte	0x83
	.4byte	0x83
	.uleb128 0x4
	.4byte	0x32
	.byte	0x1
	.byte	0
	.uleb128 0x6
	.4byte	0x88
	.uleb128 0xf
	.4byte	0x49
	.4byte	0x97
	.uleb128 0x7
	.4byte	0x49
	.byte	0
	.uleb128 0x5
	.string	"ops"
	.byte	0x9
	.byte	0x7
	.4byte	0x73
	.uleb128 0x5
	.byte	0x3
	.4byte	ops
	.uleb128 0x10
	.4byte	.LASF7
	.byte	0x1
	.byte	0x4
	.byte	0x5
	.4byte	0x49
	.4byte	0xbe
	.uleb128 0x7
	.4byte	0x49
	.byte	0
	.uleb128 0x11
	.4byte	.LASF8
	.byte	0x1
	.byte	0xb
	.byte	0x5
	.4byte	0x49
	.4byte	.LFB3
	.4byte	.LFE3-.LFB3
	.uleb128 0x1
	.byte	0x9c
	.4byte	0x13c
	.uleb128 0x8
	.string	"s"
	.byte	0xd
	.byte	0x7
	.4byte	0x49
	.4byte	.LLST3
	.4byte	.LVUS3
	.uleb128 0x12
	.4byte	.LLRL4
	.4byte	0x110
	.uleb128 0x8
	.string	"i"
	.byte	0xc
	.byte	0xc
	.4byte	0x49
	.4byte	.LLST5
	.4byte	.LVUS5
	.uleb128 0x13
	.4byte	.LVL11
	.uleb128 0x9
	.uleb128 0x1
	.byte	0x5a
	.uleb128 0x2
	.byte	0x78
	.sleb128 0
	.byte	0
	.byte	0
	.uleb128 0x14
	.4byte	.LBB4
	.4byte	.LBE4-.LBB4
	.4byte	0x128
	.uleb128 0x15
	.string	"i"
	.byte	0x1
	.byte	0xe
	.byte	0xc
	.4byte	0x49
	.byte	0
	.uleb128 0x16
	.4byte	.LVL16
	.4byte	0x13c
	.uleb128 0x9
	.uleb128 0x1
	.byte	0x5a
	.uleb128 0x5
	.byte	0x3
	.4byte	.LC0
	.byte	0
	.byte	0
	.uleb128 0x17
	.4byte	.LASF9
	.byte	0x1
	.byte	0xa
	.byte	0x6
	.4byte	.LFB2
	.4byte	.LFE2-.LFB2
	.uleb128 0x1
	.byte	0x9c
	.4byte	0x16d
	.uleb128 0x2
	.string	"s"
	.byte	0xa
	.byte	0x18
	.4byte	0x16d
	.4byte	.LLST2
	.4byte	.LVUS2
	.uleb128 0xa
	.4byte	.LVL7
	.4byte	0xa8
	.byte	0
	.uleb128 0x6
	.4byte	0x179
	.uleb128 0x1
	.byte	0x1
	.byte	0x8
	.4byte	.LASF5
	.uleb128 0x18
	.4byte	0x172
	.uleb128 0xb
	.string	"tw"
	.byte	0x8
	.4byte	0x49
	.4byte	.LFB1
	.4byte	.LFE1-.LFB1
	.uleb128 0x1
	.byte	0x9c
	.4byte	0x1a7
	.uleb128 0x2
	.string	"x"
	.byte	0x8
	.byte	0x13
	.4byte	0x49
	.4byte	.LLST1
	.4byte	.LVUS1
	.byte	0
	.uleb128 0xb
	.string	"sq"
	.byte	0x7
	.4byte	0x49
	.4byte	.LFB0
	.4byte	.LFE0-.LFB0
	.uleb128 0x1
	.byte	0x9c
	.4byte	0x1d9
	.uleb128 0x2
	.string	"x"
	.byte	0x7
	.byte	0x13
	.4byte	0x49
	.4byte	.LLST0
	.4byte	.LVUS0
	.uleb128 0xa
	.4byte	.LVL1
	.4byte	0x1d9
	.byte	0
	.uleb128 0x19
	.4byte	.LASF10
	.4byte	.LASF10
	.byte	0
	.section	.debug_abbrev,"",@progbits
.Ldebug_abbrev0:
	.uleb128 0x1
	.uleb128 0x24
	.byte	0
	.uleb128 0xb
	.uleb128 0xb
	.uleb128 0x3e
	.uleb128 0xb
	.uleb128 0x3
	.uleb128 0xe
	.byte	0
	.byte	0
	.uleb128 0x2
	.uleb128 0x5
	.byte	0
	.uleb128 0x3
	.uleb128 0x8
	.uleb128 0x3a
	.uleb128 0x21
	.sleb128 1
	.uleb128 0x3b
	.uleb128 0xb
	.uleb128 0x39
	.uleb128 0xb
	.uleb128 0x49
	.uleb128 0x13
	.uleb128 0x2
	.uleb128 0x17
	.uleb128 0x2137
	.uleb128 0x17
	.byte	0
	.byte	0
	.uleb128 0x3
	.uleb128 0x1
	.byte	0x1
	.uleb128 0x49
	.uleb128 0x13
	.uleb128 0x1
	.uleb128 0x13
	.byte	0
	.byte	0
	.uleb128 0x4
	.uleb128 0x21
	.byte	0
	.uleb128 0x49
	.uleb128 0x13
	.uleb128 0x2f
	.uleb128 0xb
	.byte	0
	.byte	0
	.uleb128 0x5
	.uleb128 0x34
	.byte	0
	.uleb128 0x3
	.uleb128 0x8
	.uleb128 0x3a
	.uleb128 0x21
	.sleb128 1
	.uleb128 0x3b
	.uleb128 0xb
	.uleb128 0x39
	.uleb128 0xb
	.uleb128 0x49
	.uleb128 0x13
	.uleb128 0x3f
	.uleb128 0x19
	.uleb128 0x2
	.uleb128 0x18
	.byte	0
	.byte	0
	.uleb128 0x6
	.uleb128 0xf
	.byte	0
	.uleb128 0xb
	.uleb128 0x21
	.sleb128 4
	.uleb128 0x49
	.uleb128 0x13
	.byte	0
	.byte	0
	.uleb128 0x7
	.uleb128 0x5
	.byte	0
	.uleb128 0x49
	.uleb128 0x13
	.byte	0
	.byte	0
	.uleb128 0x8
	.uleb128 0x34
	.byte	0
	.uleb128 0x3
	.uleb128 0x8
	.uleb128 0x3a
	.uleb128 0x21
	.sleb128 1
	.uleb128 0x3b
	.uleb128 0xb
	.uleb128 0x39
	.uleb128 0xb
	.uleb128 0x49
	.uleb128 0x13
	.uleb128 0x2
	.uleb128 0x17
	.uleb128 0x2137
	.uleb128 0x17
	.byte	0
	.byte	0
	.uleb128 0x9
	.uleb128 0x49
	.byte	0
	.uleb128 0x2
	.uleb128 0x18
	.uleb128 0x7e
	.uleb128 0x18
	.byte	0
	.byte	0
	.uleb128 0xa
	.uleb128 0x48
	.byte	0
	.uleb128 0x7d
	.uleb128 0x1
	.uleb128 0x7f
	.uleb128 0x13
	.byte	0
	.byte	0
	.uleb128 0xb
	.uleb128 0x2e
	.byte	0x1
	.uleb128 0x3
	.uleb128 0x8
	.uleb128 0x3a
	.uleb128 0x21
	.sleb128 1
	.uleb128 0x3b
	.uleb128 0xb
	.uleb128 0x39
	.uleb128 0x21
	.sleb128 12
	.uleb128 0x27
	.uleb128 0x19
	.uleb128 0x49
	.uleb128 0x13
	.uleb128 0x11
	.uleb128 0x1
	.uleb128 0x12
	.uleb128 0x6
	.uleb128 0x40
	.uleb128 0x18
	.uleb128 0x7a
	.uleb128 0x19
	.uleb128 0x1
	.uleb128 0x13
	.byte	0
	.byte	0
	.uleb128 0xc
	.uleb128 0x11
	.byte	0x1
	.uleb128 0x25
	.uleb128 0xe
	.uleb128 0x13
	.uleb128 0xb
	.uleb128 0x90
	.uleb128 0xb
	.uleb128 0x91
	.uleb128 0x6
	.uleb128 0x3
	.uleb128 0x1f
	.uleb128 0x1b
	.uleb128 0x1f
	.uleb128 0x11
	.uleb128 0x1
	.uleb128 0x12
	.uleb128 0x6
	.uleb128 0x10
	.uleb128 0x17
	.byte	0
	.byte	0
	.uleb128 0xd
	.uleb128 0x24
	.byte	0
	.uleb128 0xb
	.uleb128 0xb
	.uleb128 0x3e
	.uleb128 0xb
	.uleb128 0x3
	.uleb128 0x8
	.byte	0
	.byte	0
	.uleb128 0xe
	.uleb128 0x34
	.byte	0
	.uleb128 0x3
	.uleb128 0xe
	.uleb128 0x3a
	.uleb128 0xb
	.uleb128 0x3b
	.uleb128 0xb
	.uleb128 0x39
	.uleb128 0xb
	.uleb128 0x49
	.uleb128 0x13
	.uleb128 0x3f
	.uleb128 0x19
	.uleb128 0x2
	.uleb128 0x18
	.byte	0
	.byte	0
	.uleb128 0xf
	.uleb128 0x15
	.byte	0x1
	.uleb128 0x27
	.uleb128 0x19
	.uleb128 0x49
	.uleb128 0x13
	.uleb128 0x1
	.uleb128 0x13
	.byte	0
	.byte	0
	.uleb128 0x10
	.uleb128 0x2e
	.byte	0x1
	.uleb128 0x3f
	.uleb128 0x19
	.uleb128 0x3
	.uleb128 0xe
	.uleb128 0x3a
	.uleb128 0xb
	.uleb128 0x3b
	.uleb128 0xb
	.uleb128 0x39
	.uleb128 0xb
	.uleb128 0x27
	.uleb128 0x19
	.uleb128 0x49
	.uleb128 0x13
	.uleb128 0x3c
	.uleb128 0x19
	.uleb128 0x1
	.uleb128 0x13
	.byte	0
	.byte	0
	.uleb128 0x11
	.uleb128 0x2e
	.byte	0x1
	.uleb128 0x3f
	.uleb128 0x19
	.uleb128 0x3
	.uleb128 0xe
	.uleb128 0x3a
	.uleb128 0xb
	.uleb128 0x3b
	.uleb128 0xb
	.uleb128 0x39
	.uleb128 0xb
	.uleb128 0x27
	.uleb128 0x19
	.uleb128 0x49
	.uleb128 0x13
	.uleb128 0x11
	.uleb128 0x1
	.uleb128 0x12
	.uleb128 0x6
	.uleb128 0x40
	.uleb128 0x18
	.uleb128 0x7a
	.uleb128 0x19
	.uleb128 0x1
	.uleb128 0x13
	.byte	0
	.byte	0
	.uleb128 0x12
	.uleb128 0xb
	.byte	0x1
	.uleb128 0x55
	.uleb128 0x17
	.uleb128 0x1
	.uleb128 0x13
	.byte	0
	.byte	0
	.uleb128 0x13
	.uleb128 0x48
	.byte	0x1
	.uleb128 0x7d
	.uleb128 0x1
	.byte	0
	.byte	0
	.uleb128 0x14
	.uleb128 0xb
	.byte	0x1
	.uleb128 0x11
	.uleb128 0x1
	.uleb128 0x12
	.uleb128 0x6
	.uleb128 0x1
	.uleb128 0x13
	.byte	0
	.byte	0
	.uleb128 0x15
	.uleb128 0x34
	.byte	0
	.uleb128 0x3
	.uleb128 0x8
	.uleb128 0x3a
	.uleb128 0xb
	.uleb128 0x3b
	.uleb128 0xb
	.uleb128 0x39
	.uleb128 0xb
	.uleb128 0x49
	.uleb128 0x13
	.byte	0
	.byte	0
	.uleb128 0x16
	.uleb128 0x48
	.byte	0x1
	.uleb128 0x7d
	.uleb128 0x1
	.uleb128 0x7f
	.uleb128 0x13
	.byte	0
	.byte	0
	.uleb128 0x17
	.uleb128 0x2e
	.byte	0x1
	.uleb128 0x3f
	.uleb128 0x19
	.uleb128 0x3
	.uleb128 0xe
	.uleb128 0x3a
	.uleb128 0xb
	.uleb128 0x3b
	.uleb128 0xb
	.uleb128 0x39
	.uleb128 0xb
	.uleb128 0x27
	.uleb128 0x19
	.uleb128 0x11
	.uleb128 0x1
	.uleb128 0x12
	.uleb128 0x6
	.uleb128 0x40
	.uleb128 0x18
	.uleb128 0x7a
	.uleb128 0x19
	.uleb128 0x1
	.uleb128 0x13
	.byte	0
	.byte	0
	.uleb128 0x18
	.uleb128 0x26
	.byte	0
	.uleb128 0x49
	.uleb128 0x13
	.byte	0
	.byte	0
	.uleb128 0x19
	.uleb128 0x2e
	.byte	0
	.uleb128 0x3f
	.uleb128 0x19
	.uleb128 0x3c
	.uleb128 0x19
	.uleb128 0x6e
	.uleb128 0xe
	.uleb128 0x3
	.uleb128 0xe
	.byte	0
	.byte	0
	.byte	0
	.section	.debug_loclists,"",@progbits
	.4byte	.Ldebug_loc3-.Ldebug_loc2
.Ldebug_loc2:
	.2byte	0x5
	.byte	0x4
	.byte	0
	.4byte	0
.Ldebug_loc0:
.LVUS3:
	.uleb128 0x10
	.uleb128 0x12
	.uleb128 0x13
	.uleb128 0x18
.LLST3:
	.byte	0x4
	.uleb128 .LVL13-.Ltext0
	.uleb128 .LVL14-.Ltext0
	.uleb128 0x1
	.byte	0x5f
	.byte	0x4
	.uleb128 .LVL14-.Ltext0
	.uleb128 .LVL16-1-.Ltext0
	.uleb128 0x1
	.byte	0x5f
	.byte	0
.LVUS5:
	.uleb128 0x3
	.uleb128 0x8
	.uleb128 0x8
	.uleb128 0x16
.LLST5:
	.byte	0x4
	.uleb128 .LVL9-.Ltext0
	.uleb128 .LVL10-.Ltext0
	.uleb128 0x2
	.byte	0x30
	.byte	0x9f
	.byte	0x4
	.uleb128 .LVL10-.Ltext0
	.uleb128 .LVL15-.Ltext0
	.uleb128 0x1
	.byte	0x58
	.byte	0
.LVUS2:
	.uleb128 0
	.uleb128 0x4
	.uleb128 0x4
	.uleb128 0xa
.LLST2:
	.byte	0x4
	.uleb128 .LVL4-.Ltext0
	.uleb128 .LVL5-.Ltext0
	.uleb128 0x1
	.byte	0x5a
	.byte	0x4
	.uleb128 .LVL5-.Ltext0
	.uleb128 .LVL8-.Ltext0
	.uleb128 0x1
	.byte	0x58
	.byte	0
.LVUS1:
	.uleb128 0
	.uleb128 0x3
	.uleb128 0x3
	.uleb128 0
.LLST1:
	.byte	0x4
	.uleb128 .LVL2-.Ltext0
	.uleb128 .LVL3-.Ltext0
	.uleb128 0x1
	.byte	0x5a
	.byte	0x4
	.uleb128 .LVL3-.Ltext0
	.uleb128 .LFE1-.Ltext0
	.uleb128 0xa
	.byte	0xa3
	.uleb128 0x3
	.byte	0xa5
	.uleb128 0xa
	.uleb128 0x2b
	.byte	0xa8
	.uleb128 0x32
	.byte	0xa8
	.uleb128 0
	.byte	0x9f
	.byte	0
.LVUS0:
	.uleb128 0
	.uleb128 0x4
	.uleb128 0x4
	.uleb128 0
.LLST0:
	.byte	0x4
	.uleb128 .LVL0-.Ltext0
	.uleb128 .LVL1-1-.Ltext0
	.uleb128 0x1
	.byte	0x5a
	.byte	0x4
	.uleb128 .LVL1-1-.Ltext0
	.uleb128 .LFE0-.Ltext0
	.uleb128 0xa
	.byte	0xa3
	.uleb128 0x3
	.byte	0xa5
	.uleb128 0xa
	.uleb128 0x2b
	.byte	0xa8
	.uleb128 0x32
	.byte	0xa8
	.uleb128 0
	.byte	0x9f
	.byte	0
.Ldebug_loc3:
	.section	.debug_aranges,"",@progbits
	.4byte	0x1c
	.2byte	0x2
	.4byte	.Ldebug_info0
	.byte	0x4
	.byte	0
	.2byte	0
	.2byte	0
	.4byte	.Ltext0
	.4byte	.Letext0-.Ltext0
	.4byte	0
	.4byte	0
	.section	.debug_rnglists,"",@progbits
.Ldebug_ranges0:
	.4byte	.Ldebug_ranges3-.Ldebug_ranges2
.Ldebug_ranges2:
	.2byte	0x5
	.byte	0x4
	.byte	0
	.4byte	0
.LLRL4:
	.byte	0x4
	.uleb128 .LBB2-.Ltext0
	.uleb128 .LBE2-.Ltext0
	.byte	0x4
	.uleb128 .LBB3-.Ltext0
	.uleb128 .LBE3-.Ltext0
	.byte	0
.Ldebug_ranges3:
	.section	.debug_line,"",@progbits
.Ldebug_line0:
	.4byte	.LELT0-.LSLT0
.LSLT0:
	.2byte	0x5
	.byte	0x4
	.byte	0
	.4byte	.LELTP0-.LASLTP0
.LASLTP0:
	.byte	0x1
	.byte	0x1
	.byte	0x1
	.byte	0xf6
	.byte	0xf2
	.byte	0xd
	.byte	0
	.byte	0x1
	.byte	0x1
	.byte	0x1
	.byte	0x1
	.byte	0
	.byte	0
	.byte	0
	.byte	0x1
	.byte	0
	.byte	0
	.byte	0x1
	.byte	0x1
	.uleb128 0x1
	.uleb128 0x1f
	.uleb128 0x1
	.4byte	.LASF1
	.byte	0x2
	.uleb128 0x1
	.uleb128 0x1f
	.uleb128 0x2
	.uleb128 0xb
	.uleb128 0x2
	.4byte	.LASF0
	.byte	0
	.4byte	.LASF0
	.byte	0
.LELTP0:
	.byte	0
	.uleb128 0x5
	.byte	0x2
	.4byte	.LM1
	.byte	0x1d
	.byte	0x5
	.uleb128 0x16
	.byte	0x2
	.uleb128 .LM2-.LM1
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x16
	.byte	0x2
	.uleb128 .LM3-.LM2
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x18
	.byte	0x2
	.uleb128 .LM4-.LM3
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x21
	.byte	0x2
	.uleb128 .LM5-.LM4
	.byte	0x1
	.byte	0x5
	.uleb128 0x26
	.byte	0
	.uleb128 0x5
	.byte	0x2
	.4byte	.LM6
	.byte	0x6
	.byte	0x18
	.byte	0x5
	.uleb128 0x16
	.byte	0x2
	.uleb128 .LM7-.LM6
	.byte	0x1
	.byte	0x5
	.uleb128 0x18
	.byte	0x2
	.uleb128 .LM8-.LM7
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x26
	.byte	0x2
	.uleb128 .LM9-.LM8
	.byte	0x1
	.byte	0x5
	.uleb128 0x26
	.byte	0
	.uleb128 0x5
	.byte	0x2
	.4byte	.LM10
	.byte	0x6
	.byte	0x19
	.byte	0x5
	.uleb128 0x1b
	.byte	0x2
	.uleb128 .LM11-.LM10
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x1b
	.byte	0x2
	.uleb128 .LM12-.LM11
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x1d
	.byte	0x2
	.uleb128 .LM13-.LM12
	.byte	0
	.uleb128 0x2
	.byte	0x4
	.uleb128 0x2
	.byte	0x1
	.byte	0x5
	.uleb128 0x24
	.byte	0x2
	.uleb128 .LM14-.LM13
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x24
	.byte	0x2
	.uleb128 .LM15-.LM14
	.byte	0
	.uleb128 0x2
	.byte	0x4
	.uleb128 0x1
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x28
	.byte	0x2
	.uleb128 .LM16-.LM15
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x32
	.byte	0x2
	.uleb128 .LM17-.LM16
	.byte	0x1
	.byte	0x5
	.uleb128 0x28
	.byte	0x2
	.uleb128 .LM18-.LM17
	.byte	0
	.uleb128 0x2
	.byte	0x4
	.uleb128 0x2
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x24
	.byte	0x2
	.uleb128 .LM19-.LM18
	.byte	0
	.uleb128 0x2
	.byte	0x4
	.uleb128 0
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x37
	.byte	0x2
	.uleb128 .LM20-.LM19
	.byte	0x1
	.byte	0x5
	.uleb128 0x37
	.byte	0
	.uleb128 0x5
	.byte	0x2
	.4byte	.LM21
	.byte	0x6
	.byte	0x18
	.byte	0x5
	.uleb128 0x10
	.byte	0x2
	.uleb128 .LM22-.LM21
	.byte	0x18
	.byte	0x5
	.uleb128 0x3
	.byte	0x2
	.uleb128 .LM23-.LM22
	.byte	0x1
	.byte	0x5
	.uleb128 0x8
	.byte	0x2
	.uleb128 .LM24-.LM23
	.byte	0
	.uleb128 0x2
	.byte	0x4
	.uleb128 0x3
	.byte	0x1
	.byte	0x5
	.uleb128 0x15
	.byte	0x2
	.uleb128 .LM25-.LM24
	.byte	0
	.uleb128 0x2
	.byte	0x4
	.uleb128 0
	.byte	0x6
	.byte	0x16
	.byte	0x5
	.uleb128 0x10
	.byte	0x2
	.uleb128 .LM26-.LM25
	.byte	0x18
	.byte	0x5
	.uleb128 0xc
	.byte	0x2
	.uleb128 .LM27-.LM26
	.byte	0
	.uleb128 0x2
	.byte	0x4
	.uleb128 0x1
	.byte	0x1
	.byte	0x5
	.uleb128 0x2b
	.byte	0x2
	.uleb128 .LM28-.LM27
	.byte	0
	.uleb128 0x2
	.byte	0x4
	.uleb128 0x3
	.byte	0x1
	.byte	0x5
	.uleb128 0x15
	.byte	0x2
	.uleb128 .LM29-.LM28
	.byte	0
	.uleb128 0x2
	.byte	0x4
	.uleb128 0x1
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x1f
	.byte	0x2
	.uleb128 .LM30-.LM29
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x2e
	.byte	0x2
	.uleb128 .LM31-.LM30
	.byte	0x1
	.byte	0x5
	.uleb128 0x2b
	.byte	0x2
	.uleb128 .LM32-.LM31
	.byte	0x1
	.byte	0x5
	.uleb128 0x28
	.byte	0x2
	.uleb128 .LM33-.LM32
	.byte	0
	.uleb128 0x2
	.byte	0x4
	.uleb128 0x2
	.byte	0x1
	.byte	0x5
	.uleb128 0x26
	.byte	0x2
	.uleb128 .LM34-.LM33
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x1b
	.byte	0x2
	.uleb128 .LM35-.LM34
	.byte	0
	.uleb128 0x2
	.byte	0x4
	.uleb128 0x3
	.byte	0x1
	.byte	0x5
	.uleb128 0x15
	.byte	0x2
	.uleb128 .LM36-.LM35
	.byte	0
	.uleb128 0x2
	.byte	0x4
	.uleb128 0
	.byte	0x6
	.byte	0x18
	.byte	0x5
	.uleb128 0x7
	.byte	0x2
	.uleb128 .LM37-.LM36
	.byte	0
	.uleb128 0x2
	.byte	0x4
	.uleb128 0x1
	.byte	0x6
	.byte	0x18
	.byte	0x5
	.uleb128 0x1f
	.byte	0x2
	.uleb128 .LM38-.LM37
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x21
	.byte	0x2
	.uleb128 .LM39-.LM38
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x1b
	.byte	0x2
	.uleb128 .LM40-.LM39
	.byte	0
	.uleb128 0x2
	.byte	0x4
	.uleb128 0x2
	.byte	0x1
	.byte	0x5
	.uleb128 0x15
	.byte	0x2
	.uleb128 .LM41-.LM40
	.byte	0
	.uleb128 0x2
	.byte	0x4
	.uleb128 0
	.byte	0x18
	.byte	0x5
	.uleb128 0x3
	.byte	0x2
	.uleb128 .LM42-.LM41
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0xb
	.byte	0x2
	.uleb128 .LM43-.LM42
	.byte	0x1
	.byte	0x5
	.uleb128 0xb
	.byte	0x2
	.uleb128 .LM44-.LM43
	.byte	0x6
	.byte	0x18
	.byte	0x5
	.uleb128 0x3
	.byte	0x2
	.uleb128 .LM45-.LM44
	.byte	0x18
	.byte	0x5
	.uleb128 0x3
	.byte	0x2
	.uleb128 .LM46-.LM45
	.byte	0x6
	.byte	0x1
	.byte	0x5
	.uleb128 0x12
	.byte	0x2
	.uleb128 .LM47-.LM46
	.byte	0x18
	.byte	0x5
	.uleb128 0x1
	.byte	0
	.uleb128 0x5
	.byte	0x2
	.4byte	.Letext0
	.byte	0
	.uleb128 0x1
	.byte	0x1
.LELT0:
	.section	.debug_str,"MS",@progbits,1
.LASF7:
	.string	"putchar"
.LASF3:
	.string	"unsigned int"
.LASF4:
	.string	"counter"
.LASF6:
	.string	"GNU C23 16.1.0 -mabi=ilp32 -misa-spec=20191213 -march=rv32i -mcmodel=medlow -g -O1 -fcommon"
.LASF10:
	.string	"__mulsi3"
.LASF2:
	.string	"long long unsigned int"
.LASF8:
	.string	"main"
.LASF9:
	.string	"puts2"
.LASF5:
	.string	"char"
	.section	.debug_line_str,"MS",@progbits,1
.LASF0:
	.string	"calls.c"
.LASF1:
	.string	"C:\\work\\fixtures\\gcc"
	.globl	__mulsi3
	.ident	"GCC: (ga690b2cf8) 16.1.0"
	.section	.note.GNU-stack,"",@progbits
