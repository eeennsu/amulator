/* RAM 하나에 모든 섹션을 둔다. 에뮬레이터는 PT_LOAD를 RAM_BASE부터 올리고 e_entry로 점프한다. */
ENTRY(_start)

MEMORY
{
  RAM (rwx) : ORIGIN = 0x80000000, LENGTH = 64M
}

_stack_top = ORIGIN(RAM) + LENGTH(RAM);

SECTIONS
{
  .text : {
    KEEP(*(.text.init))
    *(.text .text.*)
  } > RAM

  .rodata : ALIGN(4) {
    *(.rodata .rodata.*)
  } > RAM

  .data : ALIGN(4) {
    *(.data .data.*)
    *(.sdata .sdata.*)
  } > RAM

  .bss (NOLOAD) : ALIGN(4) {
    _bss_start = .;
    *(.sbss .sbss.*)
    *(.bss .bss.*)
    *(COMMON)
    . = ALIGN(4);
    _bss_end = .;
  } > RAM
}
