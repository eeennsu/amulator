/* 부트 진입점. 트랩 진입(mtvec)은 이 파일에 이후 태스크에서 더한다. */
  .section .text.init, "ax"
  .globl _start
_start:
  la sp, _stack_top

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
