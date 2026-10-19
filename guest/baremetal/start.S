/* 부트 진입점. 트랩은 trap.S의 trap_entry가 받아 handle_trap(mcause, mepc)을 부른다. */
  .section .text.init, "ax"
  .globl _start
_start:
  la sp, _stack_top
  la t0, trap_entry
  csrw mtvec, t0

  /* .bss를 0으로 채운다. link.ld가 양 끝을 4바이트 정렬한다. */
  la a0, _bss_start
  la a1, _bss_end
1:
  bgeu a0, a1, 2f
  sw zero, 0(a0)
  addi a0, a0, 4
  j 1b
2:
  call main

  /* main이 돌아오면 멈춘다. */
3:
  wfi
  j 3b

  /* 트랩을 쓰지 않는 게스트도 링크되게 하는 기본 핸들러다. 트랩이 오면 멈춘다. clock.c 같은 강한 심볼이 덮어쓴다. */
  .text
  .weak handle_trap
handle_trap:
4:
  wfi
  j 4b
