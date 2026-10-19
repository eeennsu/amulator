# amulator plugin

Claude Code plugin that lets Claude drive a RISC-V emulator running in a browser tab. The `emulator_*` tools open the page, tap and drag on the 320×480 screen, take screenshots, and save or load snapshots. The page is served on `127.0.0.1` only.

`plugin/server` and `plugin/web` are build output and are not checked in, so build them first.

Prerequisites: Node 22+ and pnpm.

```sh
pnpm install
pnpm build:plugin
pnpm smoke:plugin   # must print "smoke ok"
claude --plugin-dir ./plugin
```

Run the commands from the repository root.
