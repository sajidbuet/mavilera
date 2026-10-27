	.file	"sum.c"
	.option nopic
	.attribute arch, "rv32i2p1"
	.attribute unaligned_access, 0
	.attribute stack_align, 16
	.text
	.align	2
	.globl	sum
	.type	sum, @function
sum:
	ble	a1,zero,.L4
	mv	a5,a0
	slli	a1,a1,2
	add	a3,a0,a1
	li	a0,0
.L3:
	lw	a4,0(a5)
	add	a0,a0,a4
	addi	a5,a5,4
	bne	a5,a3,.L3
	ret
.L4:
	li	a0,0
	ret
	.size	sum, .-sum
	.align	2
	.globl	fact
	.type	fact, @function
fact:
	li	a5,1
	bgt	a0,a5,.L13
	li	a0,1
	ret
.L13:
	addi	sp,sp,-16
	sw	ra,12(sp)
	sw	s0,8(sp)
	mv	s0,a0
	addi	a0,a0,-1
	call	fact
	mv	a1,s0
	call	__mulsi3
	lw	ra,12(sp)
	lw	s0,8(sp)
	addi	sp,sp,16
	jr	ra
	.size	fact, .-fact
	.align	2
	.globl	main
	.type	main, @function
main:
	addi	sp,sp,-16
	sw	ra,12(sp)
	sw	s0,8(sp)
	li	a1,5
	lui	a0,%hi(.LANCHOR0)
	addi	a0,a0,%lo(.LANCHOR0)
	call	sum
	mv	s0,a0
	li	a1,6
	call	__modsi3
	call	fact
	add	a0,s0,a0
	lw	ra,12(sp)
	lw	s0,8(sp)
	addi	sp,sp,16
	jr	ra
	.size	main, .-main
	.globl	msg
	.globl	table
	.data
	.align	2
	.set	.LANCHOR0,. + 0
	.type	table, @object
	.size	table, 20
table:
	.word	3
	.word	1
	.word	4
	.word	1
	.word	5
	.section	.srodata,"a"
	.align	2
	.type	msg, @object
	.size	msg, 4
msg:
	.string	"hi\n"
	.globl	__modsi3
	.globl	__mulsi3
	.ident	"GCC: (ga690b2cf8) 16.1.0"
	.section	.note.GNU-stack,"",@progbits
