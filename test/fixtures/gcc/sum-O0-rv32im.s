	.file	"sum.c"
	.option nopic
	.attribute arch, "rv32i2p1_m2p0_zmmul1p0"
	.attribute unaligned_access, 0
	.attribute stack_align, 16
	.text
	.globl	table
	.data
	.align	2
	.type	table, @object
	.size	table, 20
table:
	.word	3
	.word	1
	.word	4
	.word	1
	.word	5
	.globl	msg
	.section	.srodata,"a"
	.align	2
	.type	msg, @object
	.size	msg, 4
msg:
	.string	"hi\n"
	.local	counter
	.comm	counter,4,4
	.text
	.align	2
	.globl	sum
	.type	sum, @function
sum:
	addi	sp,sp,-48
	sw	ra,44(sp)
	sw	s0,40(sp)
	addi	s0,sp,48
	sw	a0,-36(s0)
	sw	a1,-40(s0)
	sw	zero,-20(s0)
	sw	zero,-24(s0)
	j	.L2
.L3:
	lw	a5,-24(s0)
	slli	a5,a5,2
	lw	a4,-36(s0)
	add	a5,a4,a5
	lw	a5,0(a5)
	lw	a4,-20(s0)
	add	a5,a4,a5
	sw	a5,-20(s0)
	lw	a5,-24(s0)
	addi	a5,a5,1
	sw	a5,-24(s0)
.L2:
	lw	a4,-24(s0)
	lw	a5,-40(s0)
	blt	a4,a5,.L3
	lw	a5,-20(s0)
	mv	a0,a5
	lw	ra,44(sp)
	lw	s0,40(sp)
	addi	sp,sp,48
	jr	ra
	.size	sum, .-sum
	.align	2
	.globl	fact
	.type	fact, @function
fact:
	addi	sp,sp,-32
	sw	ra,28(sp)
	sw	s0,24(sp)
	addi	s0,sp,32
	sw	a0,-20(s0)
	lw	a4,-20(s0)
	li	a5,1
	ble	a4,a5,.L6
	lw	a5,-20(s0)
	addi	a5,a5,-1
	mv	a0,a5
	call	fact
	mv	a4,a0
	lw	a5,-20(s0)
	mul	a5,a4,a5
	j	.L8
.L6:
	li	a5,1
.L8:
	mv	a0,a5
	lw	ra,28(sp)
	lw	s0,24(sp)
	addi	sp,sp,32
	jr	ra
	.size	fact, .-fact
	.align	2
	.globl	main
	.type	main, @function
main:
	addi	sp,sp,-16
	sw	ra,12(sp)
	sw	s0,8(sp)
	addi	s0,sp,16
	li	a1,5
	lui	a5,%hi(table)
	addi	a0,a5,%lo(table)
	call	sum
	mv	a4,a0
	lui	a5,%hi(counter)
	sw	a4,%lo(counter)(a5)
	lui	a5,%hi(counter)
	lw	a4,%lo(counter)(a5)
	li	a5,715829248
	addi	a5,a5,-1365
	mulh	a3,a4,a5
	srai	a5,a4,31
	sub	a3,a3,a5
	mv	a5,a3
	slli	a5,a5,1
	add	a5,a5,a3
	slli	a5,a5,1
	sub	a3,a4,a5
	mv	a0,a3
	call	fact
	mv	a4,a0
	lui	a5,%hi(counter)
	lw	a5,%lo(counter)(a5)
	add	a5,a4,a5
	mv	a0,a5
	lw	ra,12(sp)
	lw	s0,8(sp)
	addi	sp,sp,16
	jr	ra
	.size	main, .-main
	.ident	"GCC: (ga690b2cf8) 16.1.0"
	.section	.note.GNU-stack,"",@progbits
