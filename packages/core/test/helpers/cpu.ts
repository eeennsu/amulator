import { createBus } from '../../src/bus';
import { Cpu } from '../../src/cpu/cpu';
import { RAM_BASE } from '../../src/memoryMap';

const RAM_BYTES = 0x1000;

// words를 pc부터 RAM에 쓰고 pc에서 시작하는 CPU를 만든다.
export const setup = (words: readonly number[], pc = RAM_BASE, readTime = () => 0): Cpu => {
  const bus = createBus(new Uint8Array(RAM_BYTES), []);
  words.forEach((word, index) => {
    bus.write(pc + index * 4, 4, word);
  });
  const cpu = new Cpu(bus, readTime);
  cpu.pc = pc;
  return cpu;
};
