import { Terminal } from '@xterm/xterm';

import '@xterm/xterm/css/xterm.css';

export type UartTerminal = {
  write: (bytes: Uint8Array) => void;
  clear: () => void;
};

const COLS = 60;
const ROWS = 12;

export const createTerminal = (
  parent: HTMLElement,
  onInput: (bytes: Uint8Array) => void,
): UartTerminal => {
  // 게스트는 '\n'만 보내므로 xterm이 줄 처음으로도 돌아가게 한다.
  const terminal = new Terminal({ cols: COLS, rows: ROWS, convertEol: true });
  const encoder = new TextEncoder();
  terminal.open(parent);
  terminal.onData((data) => onInput(encoder.encode(data)));
  return {
    write: (bytes) => terminal.write(bytes),
    clear: () => terminal.reset(),
  };
};
