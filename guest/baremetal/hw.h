#ifndef HW_H
#define HW_H

/* packages/core/src/memoryMap.ts의 값과 같아야 한다. 원본은 memoryMap.ts다. */

#define RAM_BASE 0x80000000u
#define RAM_SIZE 0x4000000u

#define UART_BASE 0x10000000u
#define CLINT_BASE 0x11000000u

/* XRGB8888 리틀엔디언, 픽셀당 4바이트 */
#define FB_BASE 0x12000000u
#define FB_WIDTH 320
#define FB_HEIGHT 480
#define FB_STRIDE 1280

#define TOUCH_BASE 0x13000000u

/* 1틱 = 1us */
#define TIMEBASE_HZ 1000000

/* UART 레지스터 offset. 바이트 접근만 받는다. */
#define UART_THR 0x0u /* 쓰기: 송신 */
#define UART_RBR 0x0u /* 읽기: 수신 */
#define UART_LSR 0x5u
#define UART_LSR_DR 0x01u /* 수신 데이터가 있다 */

/* CLINT 레지스터 offset. 32비트 접근만 받는다. mtimecmp·mtime은 하위 워드 뒤 +4가 상위다. */
#define CLINT_MSIP 0x0u
#define CLINT_MTIMECMP 0x4000u
#define CLINT_MTIME 0xBFF8u

/* CSR 비트 */
#define MSTATUS_MIE (1u << 3)
#define MIE_MTIE (1u << 7)
#define MCAUSE_MTI 0x80000007u

#endif
