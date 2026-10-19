---
name: amulator
description: Use when the user asks to look at, draw on, tap, or snapshot the amulator emulator screen.
---

# amulator

Drive the browser RISC-V emulator through the `emulator_*` tools. The screen is 320×480 pixels. Coordinates are screen pixels with the origin at the top-left (x 0..319, y 0..479).

1. Call `emulator_open`. It returns this session's page URL and opens it in the default browser only when no tab is connected. Pass `program`: `paint` (default, touch drawing), or `hello` / `clock` (text programs).
2. Call `emulator_screenshot` until it returns an image. Each call waits up to 5 s for the tab to connect and the guest to boot, so retry a few times, a few seconds apart. Done when an image comes back; `emulator_tap` and `emulator_drag` fail before the guest has booted.
3. Call `emulator_tap` or `emulator_drag` (`steps` 1..100, default 16). A reply means the guest consumed the input.
4. Call `emulator_screenshot` again to verify the result.
5. When asked to save or restore a state, call `emulator_snapshot_save` or `emulator_snapshot_load`. A snapshot holds the whole machine, strokes included. `emulator_snapshot_load` reports `restored: false` when no snapshot exists.

If step 2 keeps failing and no browser tab opened, call `emulator_open` again; with `openBrowser: false` it returns only the URL for the user to open.
