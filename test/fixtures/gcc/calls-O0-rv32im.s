	.file	"calls.c"
	.option nopic
	.attribute arch, "rv32i2p1_m2p0_zmmul1p0"
	.attribute unaligned_access, 0
	.attribute stack_align, 16
	.text
	.comm	buf,32,4
	.comm	counter,4,4
	.align	2
	.type	sq, @function
sq:
	addi	sp,sp,-32
	sw	ra,28(sp)
	sw	s0,24(sp)
	addi	s0,sp,32
	sw	a0,-20(s0)
	lw	a5,-20(s0)
	mul	a5,a5,a5
	mv	a0,a5
	lw	ra,28(sp)
	lw	s0,24(sp)
	addi	sp,sp,32
	jr	ra
	.size	sq, .-sq
	.align	2
	.type	tw, @function
tw:
	addi	sp,sp,-32
	sw	ra,28(sp)
	sw	s0,24(sp)
	addi	s0,sp,32
	sw	a0,-20(s0)
	lw	a5,-20(s0)
	slli	a5,a5,1
	mv	a0,a5
	lw	ra,28(sp)
	lw	s0,24(sp)
	addi	sp,sp,32
	jr	ra
	.size	tw, .-tw
	.globl	ops
	.section	.sdata,"aw"
	.align	2
	.type	ops, @object
	.size	ops, 8
ops:
	.word	sq
	.word	tw
	.text
	.align	2
	.globl	puts2
	.type	puts2, @function
puts2:
	addi	sp,sp,-32
	sw	ra,28(sp)
	sw	s0,24(sp)
	addi	s0,sp,32
	sw	a0,-20(s0)
	j	.L6
.L7:
	lw	a5,-20(s0)
	addi	a4,a5,1
	sw	a4,-20(s0)
	lbu	a5,0(a5)
	mv	a0,a5
	call	putchar
.L6:
	lw	a5,-20(s0)
	lbu	a5,0(a5)
	bne	a5,zero,.L7
	nop
	nop
	lw	ra,28(sp)
	lw	s0,24(sp)
	addi	sp,sp,32
	jr	ra
	.size	puts2, .-puts2
	.section	.rodata
	.align	2
.LC0:
	.string	"ok\n"
	.text
	.align	2
	.globl	main
	.type	main, @function
main:
	addi	sp,sp,-32
	sw	ra,28(sp)
	sw	s0,24(sp)
	addi	s0,sp,32
	sw	zero,-20(s0)
	j	.L9
.L10:
	lw	a5,-20(s0)
	andi	a5,a5,1
	lui	a4,%hi(ops)
	addi	a4,a4,%lo(ops)
	slli	a5,a5,2
	add	a5,a4,a5
	lw	a5,0(a5)
	lw	a0,-20(s0)
	jalr	a5
	mv	a3,a0
	lui	a5,%hi(buf)
	addi	a4,a5,%lo(buf)
	lw	a5,-20(s0)
	slli	a5,a5,2
	add	a5,a4,a5
	sw	a3,0(a5)
	lw	a5,-20(s0)
	addi	a5,a5,1
	sw	a5,-20(s0)
.L9:
	lw	a4,-20(s0)
	li	a5,7
	ble	a4,a5,.L10
	sw	zero,-24(s0)
	sw	zero,-28(s0)
	j	.L11
.L12:
	lui	a5,%hi(buf)
	addi	a4,a5,%lo(buf)
	lw	a5,-28(s0)
	slli	a5,a5,2
	add	a5,a4,a5
	lw	a5,0(a5)
	lw	a4,-24(s0)
	add	a5,a4,a5
	sw	a5,-24(s0)
	lw	a5,-28(s0)
	addi	a5,a5,1
	sw	a5,-28(s0)
.L11:
	lw	a4,-28(s0)
	li	a5,7
	ble	a4,a5,.L12
	lui	a5,%hi(counter)
	lw	a4,-24(s0)
	sw	a4,%lo(counter)(a5)
	lui	a5,%hi(.LC0)
	addi	a0,a5,%lo(.LC0)
	call	puts2
	lui	a5,%hi(counter)
	lw	a4,%lo(counter)(a5)
	srai	a5,a4,31
	srli	a5,a5,24
	add	a4,a4,a5
	andi	a4,a4,255
	sub	a5,a4,a5
	mv	a0,a5
	lw	ra,28(sp)
	lw	s0,24(sp)
	addi	sp,sp,32
	jr	ra
	.size	main, .-main
	.ident	"GCC: (ga690b2cf8) 16.1.0"
	.section	.note.GNU-stack,"",@progbits
