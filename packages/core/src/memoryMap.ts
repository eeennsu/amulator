// 이 파일이 메모리 맵의 원본이다. guest/baremetal/hw.h가 같은 값을 갖는다.
export const RAM_BASE = 0x8000_0000;
export const RAM_SIZE = 0x400_0000;

// UART(16550)와 CLINT는 mini-rv32ima와 같은 주소다.
export const UART_BASE = 0x1000_0000;
export const CLINT_BASE = 0x1100_0000;

// XRGB8888 리틀엔디언, 픽셀당 4바이트.
export const FB_BASE = 0x1200_0000;
export const FB_WIDTH = 320;
export const FB_HEIGHT = 480;
export const FB_STRIDE = FB_WIDTH * 4;

export const TOUCH_BASE = 0x1300_0000;

// 1틱 = 1µs
export const TIMEBASE_HZ = 1_000_000;
