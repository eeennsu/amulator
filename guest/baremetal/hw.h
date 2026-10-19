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

#endif
