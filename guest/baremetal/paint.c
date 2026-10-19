#include "hw.h"

#define UART_REG8(offset) (*(volatile unsigned char *)(UART_BASE + (offset)))
#define TOUCH_REG32(offset) (*(volatile unsigned *)(TOUCH_BASE + (offset)))

#define PIXEL_BYTES 4
#define COLOR_WHITE 0x00FFFFFFu
#define COLOR_BLACK 0x00000000u
#define BRUSH_RADIUS 1 /* 3x3 붓 */

static void put_str(const char *s) {
  while (*s) {
    UART_REG8(UART_THR) = (unsigned char)*s++;
  }
}

static int abs_int(int value) {
  return value < 0 ? -value : value;
}

static void fill_screen(unsigned color) {
  volatile unsigned *pixel = (volatile unsigned *)FB_BASE;

  for (int i = 0; i < FB_WIDTH * FB_HEIGHT; i++) {
    pixel[i] = color;
  }
}

static void draw_brush(int cx, int cy) {
  for (int y = cy - BRUSH_RADIUS; y <= cy + BRUSH_RADIUS; y++) {
    for (int x = cx - BRUSH_RADIUS; x <= cx + BRUSH_RADIUS; x++) {
      /* 모서리에서는 붓이 화면 밖으로 나가므로 자른다. */
      if (x >= 0 && x < FB_WIDTH && y >= 0 && y < FB_HEIGHT) {
        *(volatile unsigned *)(FB_BASE + (unsigned)y * FB_STRIDE + (unsigned)x * PIXEL_BYTES) =
            COLOR_BLACK;
      }
    }
  }
}

/* 정수 브레젠험. dy를 음수로 두면 여덟 구간을 한 식으로 다룬다. */
static void draw_line(int x0, int y0, int x1, int y1) {
  int dx = abs_int(x1 - x0);
  int dy = -abs_int(y1 - y0);
  int sx = x0 < x1 ? 1 : -1;
  int sy = y0 < y1 ? 1 : -1;
  int err = dx + dy;

  for (;;) {
    draw_brush(x0, y0);
    if (x0 == x1 && y0 == y1) {
      return;
    }
    int doubled = 2 * err;
    if (doubled >= dy) {
      err += dy;
      x0 += sx;
    }
    if (doubled <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

int main(void) {
  int prev_down = 0;
  int prev_x = 0;
  int prev_y = 0;

  fill_screen(COLOR_WHITE);
  put_str("paint ready\n");

  /* 터치 장치는 인터럽트가 없어서 wfi 없이 COUNT를 폴링한다. */
  for (;;) {
    if (TOUCH_REG32(TOUCH_COUNT) == 0) {
      continue;
    }
    int x = (int)TOUCH_REG32(TOUCH_X);
    int y = (int)TOUCH_REG32(TOUCH_Y);
    int down = TOUCH_REG32(TOUCH_DOWN) != 0;
    TOUCH_REG32(TOUCH_POP) = 1;

    if (down) {
      if (prev_down) {
        draw_line(prev_x, prev_y, x, y);
      } else {
        draw_brush(x, y);
      }
    }
    prev_down = down;
    prev_x = x;
    prev_y = y;
  }
}
