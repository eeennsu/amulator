import { BusFault, type AccessWidth, type Device } from '../bus';
import { UART_BASE } from '../memoryMap';

export type Uart16550 = Device & { receive: (bytes: Uint8Array) => void };

const UART_SIZE = 8;

const REG = { data: 0, ier: 1, iir: 2, lcr: 3, mcr: 4, lsr: 5, msr: 6, scr: 7 } as const;
const LCR_DLAB = 0x80;
const LSR_DATA_READY = 0x01;
const LSR_TX_IDLE = 0x60; // THRE | TEMT: 송신은 쓰는 즉시 끝난다
const IIR_NO_INTERRUPT = 0x01;

// shortcut: 인터럽트를 만들지 않고 FIFO 깊이 제한도 없다, 게스트가 UART 인터럽트를 써야 할 때 MEIP 연결과 함께 더한다
export const createUart16550 = (onTransmit: (byte: number) => void): Uart16550 => {
  const rx: number[] = [];
  const latch = { dll: 0, dlm: 0, ier: 0, lcr: 0, mcr: 0, scr: 0 };

  const read = (offset: number, width: AccessWidth): number => {
    if (width !== 1) throw new BusFault(UART_BASE + offset, 'read');
    const dlab = (latch.lcr & LCR_DLAB) !== 0;
    switch (offset) {
      case REG.data:
        return dlab ? latch.dll : (rx.shift() ?? 0);
      case REG.ier:
        return dlab ? latch.dlm : latch.ier;
      case REG.iir:
        return IIR_NO_INTERRUPT;
      case REG.lcr:
        return latch.lcr;
      case REG.mcr:
        return latch.mcr;
      case REG.lsr:
        return LSR_TX_IDLE | (rx.length > 0 ? LSR_DATA_READY : 0);
      case REG.msr:
        return 0;
      default:
        return latch.scr;
    }
  };

  // IIR(FCR 자리)·LSR·MSR 쓰기는 무시한다.
  const write = (offset: number, width: AccessWidth, value: number): void => {
    if (width !== 1) throw new BusFault(UART_BASE + offset, 'write');
    const dlab = (latch.lcr & LCR_DLAB) !== 0;
    switch (offset) {
      case REG.data:
        if (dlab) latch.dll = value;
        else onTransmit(value);
        break;
      case REG.ier:
        if (dlab) latch.dlm = value;
        else latch.ier = value;
        break;
      case REG.lcr:
        latch.lcr = value;
        break;
      case REG.mcr:
        latch.mcr = value;
        break;
      case REG.scr:
        latch.scr = value;
        break;
      default:
        break;
    }
  };

  return {
    name: 'uart16550',
    base: UART_BASE,
    size: UART_SIZE,
    read,
    write,
    receive: (bytes) => {
      for (const byte of bytes) rx.push(byte);
    },
  };
};
