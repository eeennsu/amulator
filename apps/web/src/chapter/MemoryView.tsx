import { Table, Text, type TableColumn } from '@eeennsu/web';

import { RAM_BASE } from '@amulator/core/memoryMap';

import type { EmulatorController } from '../emulator/mountEmulator';
import type { MachineView } from '../messages';
import { Emphasis } from './Emphasis';
import { BYTE_HEX_WIDTH, formatHex } from './format';
import { usePeek } from './usePeek';

const LINE_BYTES = 16;
// pc 줄과 그 앞뒤 한 줄씩, 세 줄이다.
const VIEW_BYTES = LINE_BYTES * 3;
const INSTRUCTION_BYTES = 4;
const COLUMNS: TableColumn[] = [{ label: '주소' }, { label: '바이트' }];

type Props = { controller: EmulatorController | undefined; state: MachineView | undefined };

// pc가 든 줄의 앞 줄에서 시작한다. 진입 주소에서는 RAM_BASE로 잘려 pc 줄과 다음 두 줄이 보인다.
// 주소 계산에 비트 연산을 쓰지 않는다(0x8000_0000 위가 음수가 된다).
const viewBase = (pc: number): number => Math.max(RAM_BASE, pc - (pc % LINE_BYTES) - LINE_BYTES);

export const MemoryView = ({ controller, state }: Props) => {
  const paused = state !== undefined && state.paused ? state : undefined;
  const pc = paused?.cpu.pc ?? 0;
  const base = viewBase(pc);
  const peek = usePeek(controller, paused, base, VIEW_BYTES);

  if (paused === undefined) return <Text tone='muted'>멈추면 pc 근처 메모리가 보인다</Text>;
  // 읽는 중에는 아무것도 보이지 않는다. 진짜 실패만 글로 알린다.
  if (peek.status === 'pending') return null;
  if (peek.status === 'failed') return <Text tone='muted'>이 주소는 읽을 수 없다</Text>;
  const { bytes } = peek;

  const rows = Array.from({ length: Math.ceil(bytes.length / LINE_BYTES) }, (_, line) => {
    const start = line * LINE_BYTES;
    return {
      cells: [
        formatHex(base + start),
        <>
          {Array.from(bytes.subarray(start, start + LINE_BYTES), (byte, index) => {
            const offset = base + start + index - pc;
            const isPc = offset >= 0 && offset < INSTRUCTION_BYTES;
            return (
              <span key={index}>
                <Emphasis on={isPc} hint='pc'>
                  {formatHex(byte, BYTE_HEX_WIDTH)}
                </Emphasis>{' '}
              </span>
            );
          })}
        </>,
      ],
    };
  });

  return <Table label='메모리' columns={COLUMNS} rows={rows} />;
};
