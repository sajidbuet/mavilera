	.file	"sum.c"
	.option nopic
	.attribute arch, "rv32i2p1_m2p0_zmmul1p0"
	.attribute unaligned_access, 0
	.attribute stack_align, 16
	.text
	.align	2
	.globl	sum
	.type	sum, @function
sum:
	ble	a1,zero,.L4
	slli	a1,a1,2
	mv	a5,a0
	add	a1,a0,a1
	li	a0,0
.L3:
	lw	a4,0(a5)
	addi	a5,a5,4
	add	a0,a0,a4
	bne	a5,a1,.L3
	ret
.L4:
	li	a0,0
	ret
	.size	sum, .-sum
	.align	2
	.globl	fact
	.type	fact, @function
fact:
	mv	a5,a0
	li	a0,1
	ble	a5,a0,.L7
	mv	a3,a0
.L9:
	mul	a0,a0,a5
	addi	a5,a5,-1
	bne	a5,a3,.L9
.L7:
	ret
	.size	fact, .-fact
	.section	.text.startup,"ax",@progbits
	.align	2
	.globl	main
	.type	main, @function
main:
	lui	a5,%hi(.LANCHOR0)
	addi	a5,a5,%lo(.LANCHOR0)
	addi	a2,a5,20
	li	a4,0
.L13:
	lw	a3,0(a5)
	addi	a5,a5,4
	add	a4,a4,a3
	bne	a5,a2,.L13
	li	a5,715829248
	addi	a5,a5,-1365
	mulh	a5,a4,a5
	srai	a3,a4,31
	li	a0,1
	sub	a5,a5,a3
	slli	a3,a5,1
	add	a5,a3,a5
	slli	a5,a5,1
	sub	a5,a4,a5
	ble	a5,a0,.L14
	mv	a2,a0
.L15:
	mul	a0,a0,a5
	addi	a5,a5,-1
	bne	a5,a2,.L15
.L14:
	add	a0,a4,a0
	ret
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
	.ident	"GCC: (ga690b2cf8) 16.1.0"
	.section	.note.GNU-stack,"",@progbits
