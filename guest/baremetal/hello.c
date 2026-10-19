#include "hw.h"

int main(void) {
  volatile unsigned char *thr = (volatile unsigned char *)UART_BASE;
  const char *s = "hello from amulator\n";

  while (*s) {
    *thr = (unsigned char)*s++;
  }
  return 0;
}
