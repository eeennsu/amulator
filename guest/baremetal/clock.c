#include "hw.h"

#define UART_REG8(offset) (*(volatile unsigned char *)(UART_BASE + (offset)))
#define CLINT_REG32(offset) (*(volatile unsigned *)(CLINT_BASE + (offset)))

#define DECIMAL_DIGITS_MAX 10 /* 2^32 - 1은 10자리다 */

/* 다음 타이머 기한. 이전 기한에 더해 가므로 처리가 늦어도 초가 밀리지 않는다. */
static unsigned long long next_deadline;
static unsigned uptime_seconds;

static void put_char(char c) {
  UART_REG8(UART_THR) = (unsigned char)c;
}

static void put_str(const char *s) {
  while (*s) {
    put_char(*s++);
  }
}

/* libc 없이 십진수를 찍는다. */
static void put_uint(unsigned value) {
  char digits[DECIMAL_DIGITS_MAX];
  int count = 0;

  do {
    digits[count++] = (char)('0' + value % 10);
    value /= 10;
  } while (value != 0);
  while (count > 0) {
    put_char(digits[--count]);
  }
}

/* 64비트 mtime을 32비트 둘로 읽는다. 하위를 읽는 사이 상위가 바뀌면 다시 읽는다. */
static unsigned long long read_mtime(void) {
  unsigned hi;
  unsigned lo;

  do {
    hi = CLINT_REG32(CLINT_MTIME + 4);
    lo = CLINT_REG32(CLINT_MTIME);
  } while (hi != CLINT_REG32(CLINT_MTIME + 4));
  return ((unsigned long long)hi << 32) | lo;
}

/* 먼저 상위를 최대로 올려 중간 값이 과거로 보여 생기는 가짜 인터럽트를 막는다. */
static void write_mtimecmp(unsigned long long value) {
  CLINT_REG32(CLINT_MTIMECMP + 4) = 0xFFFFFFFFu;
  CLINT_REG32(CLINT_MTIMECMP) = (unsigned)value;
  CLINT_REG32(CLINT_MTIMECMP + 4) = (unsigned)(value >> 32);
}

void handle_trap(unsigned mcause, unsigned mepc) {
  (void)mepc;
  if (mcause != MCAUSE_MTI) {
    /* 예상하지 않은 트랩이면 멈춘다. */
    for (;;) {
      __asm__ volatile("wfi");
    }
  }

  uptime_seconds++;
  put_str("uptime: ");
  put_uint(uptime_seconds);
  put_str(" s\n");

  next_deadline += TIMEBASE_HZ;
  write_mtimecmp(next_deadline);
}

int main(void) {
  put_str("clock ready\n");

  next_deadline = read_mtime() + TIMEBASE_HZ;
  write_mtimecmp(next_deadline);
  __asm__ volatile("csrs mie, %0" : : "r"(MIE_MTIE));
  __asm__ volatile("csrs mstatus, %0" : : "r"(MSTATUS_MIE));

  for (;;) {
    __asm__ volatile("wfi");
    while (UART_REG8(UART_LSR) & UART_LSR_DR) {
      put_char((char)UART_REG8(UART_RBR));
    }
  }
}
