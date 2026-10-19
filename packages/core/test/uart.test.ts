import { describe, expect, it } from 'vitest';

import { BusFault } from '../src/bus';
import { createUart16550 } from '../src/devices/uart16550';

const DATA = 0;
const IER = 1;
const IIR = 2;
const LCR = 3;
const LSR = 5;
const SCR = 7;
const DLAB = 0x80;
const LSR_IDLE = 0x60;
const LSR_DATA_READY = 0x61;

const setup = () => {
  const sent: number[] = [];
  const uart = createUart16550((byte) => sent.push(byte));
  return { sent, uart };
};

describe('UART 송신', () => {
  it('offset 0에 쓰면 onTransmit이 그 바이트로 불린다', () => {
    const { sent, uart } = setup();
    uart.write(DATA, 1, 0x41);
    uart.write(DATA, 1, 0x0a);
    expect(sent).toEqual([0x41, 0x0a]);
  });
});

describe('UART 수신', () => {
  it('LSR은 수신이 비면 0x60이다', () => {
    const { uart } = setup();
    expect(uart.read(LSR, 1)).toBe(LSR_IDLE);
  });

  it('받은 바이트는 DR 비트를 세우고 offset 0 읽기로 꺼낸다', () => {
    const { uart } = setup();
    uart.receive(new Uint8Array([0x61]));
    expect(uart.read(LSR, 1)).toBe(LSR_DATA_READY);
    expect(uart.read(DATA, 1)).toBe(0x61);
    expect(uart.read(LSR, 1)).toBe(LSR_IDLE);
  });

  it('여러 바이트는 받은 순서대로 나온다', () => {
    const { uart } = setup();
    uart.receive(new Uint8Array([0x68, 0x69]));
    expect(uart.read(DATA, 1)).toBe(0x68);
    expect(uart.read(DATA, 1)).toBe(0x69);
  });
});

describe('UART 레지스터', () => {
  it('IIR은 대기 인터럽트 없음(0x01)을 돌려준다', () => {
    const { uart } = setup();
    expect(uart.read(IIR, 1)).toBe(0x01);
  });

  it('IER·LCR·SCR은 쓴 값을 그대로 읽는다', () => {
    const { uart } = setup();
    uart.write(IER, 1, 0x05);
    uart.write(LCR, 1, 0x03);
    uart.write(SCR, 1, 0xa5);
    expect([uart.read(IER, 1), uart.read(LCR, 1), uart.read(SCR, 1)]).toEqual([0x05, 0x03, 0xa5]);
  });

  it('DLAB이 서 있으면 offset 0·1은 divisor 래치이고 송신하지 않는다', () => {
    const { sent, uart } = setup();
    uart.write(LCR, 1, DLAB);
    uart.write(DATA, 1, 0x0c);
    uart.write(IER, 1, 0x01);
    expect(uart.read(DATA, 1)).toBe(0x0c);
    expect(uart.read(IER, 1)).toBe(0x01);
    expect(sent).toEqual([]);

    uart.write(LCR, 1, 0x03);
    expect(uart.read(IER, 1)).toBe(0); // 래치가 아닌 IER는 건드리지 않았다
  });

  it('바이트가 아닌 접근은 접근 오류다', () => {
    const { uart } = setup();
    expect(() => uart.read(DATA, 4)).toThrow(BusFault);
    expect(() => uart.write(DATA, 2, 0x41)).toThrow(BusFault);
  });
});
