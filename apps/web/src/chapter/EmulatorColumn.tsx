import { Badge, Button, Stack, Tabs, Text, type TabItem } from '@eeennsu/web';
import { useEffect, type RefObject } from 'react';

import type { DeviceAccess } from '@amulator/core/bus';
import { disassemble } from '@amulator/core/cpu/disassemble';

import type { EmulatorController } from '../emulator/mountEmulator';
import type { MachineView } from '../messages';
import { DeviceLog } from './DeviceLog';
import { formatHex } from './format';
import { MemoryView } from './MemoryView';
import { RegisterTable } from './RegisterTable';
import type { InspectTab } from './types';
import { usePeek } from './usePeek';

const INSTRUCTION_BYTES = 4;
const TAB_LABELS: Record<InspectTab, string> = {
  registers: '레지스터',
  memory: '메모리',
  devices: '장치 기록',
};

const isInspectTab = (value: string): value is InspectTab => Object.hasOwn(TAB_LABELS, value);

type RunLineProps = {
  controller: EmulatorController | undefined;
  state: MachineView | undefined;
  busy: boolean;
};

// 멈춘 상태마다 pc의 명령어 4바이트를 읽어 역어셈블 한 줄로 보인다.
const RunLine = ({ controller, state, busy }: RunLineProps) => {
  const paused = state !== undefined && state.paused ? state : undefined;
  const pc = paused?.cpu.pc ?? 0;
  const peek = usePeek(controller, paused, pc, INSTRUCTION_BYTES);
  // 읽는 중이거나 읽지 못하면 역어셈블 줄을 비운다.
  const instruction =
    peek.status === 'ready' && peek.bytes.length >= INSTRUCTION_BYTES
      ? disassemble(
          new DataView(peek.bytes.buffer, peek.bytes.byteOffset, peek.bytes.byteLength).getUint32(
            0,
            true,
          ),
          pc,
        )
      : '';

  const send = (type: 'pause' | 'resume') => controller?.send({ type });

  return (
    <Stack direction='row' align='center' wrap className='gap-2'>
      <Button
        label='멈춤'
        size='sm'
        variant='secondary'
        disabled={busy}
        onClick={() => send('pause')}
      />
      <Button
        label='한 단계'
        size='sm'
        variant='secondary'
        disabled={busy || paused === undefined}
        onClick={() => controller?.send({ type: 'step', count: 1 })}
      />
      <Button
        label='계속'
        size='sm'
        variant='secondary'
        disabled={busy}
        onClick={() => send('resume')}
      />
      {/* worker는 실행 중에 state를 보내지 않는다. 그때의 pc·idle은 resume 순간 값이라 보이지 않는다. */}
      {state === undefined ? (
        <Text size='sm' tone='muted'>
          시작 상태를 만드는 중
        </Text>
      ) : paused === undefined ? (
        <Badge variant='secondary'>실행 중</Badge>
      ) : (
        <>
          <Text size='sm'>{`pc ${formatHex(paused.cpu.pc)}`}</Text>
          {instruction !== '' && <Text size='sm'>{instruction}</Text>}
          {paused.cpu.idle && <Badge variant='secondary'>쉬는 중(wfi)</Badge>}
        </>
      )}
    </Stack>
  );
};

type Props = {
  screenRef: RefObject<HTMLDivElement | null>;
  terminalRef: RefObject<HTMLDivElement | null>;
  controller: EmulatorController | undefined;
  state: MachineView | undefined;
  accesses: readonly DeviceAccess[];
  changed: ReadonlySet<string>;
  tab: InspectTab;
  onTabChange: (tab: InspectTab) => void;
  busy: boolean;
  status: string;
  notice: string;
};

// 화면과 터미널은 Tabs 밖에 둔다. DS Tabs는 숨은 패널을 마운트하지 않아서, 안에 두면 탭을 바꿀 때 에뮬레이터가 다시 켜진다.
export const EmulatorColumn = ({
  screenRef,
  terminalRef,
  controller,
  state,
  accesses,
  changed,
  tab,
  onTabChange,
  busy,
  status,
  notice,
}: Props) => {
  const devicesOpen = tab === 'devices';
  useEffect(() => {
    controller?.send({ type: 'trace', enabled: devicesOpen });
  }, [controller, devicesOpen]);

  const items: TabItem[] = [
    {
      value: 'registers',
      label: TAB_LABELS.registers,
      content:
        state === undefined ? (
          <Text tone='muted'>시작 상태를 만드는 중이다</Text>
        ) : !state.paused ? (
          <Text tone='muted'>멈추면 레지스터가 보인다</Text>
        ) : (
          <RegisterTable cpu={state.cpu} changed={changed} />
        ),
    },
    {
      value: 'memory',
      label: TAB_LABELS.memory,
      content: <MemoryView controller={controller} state={state} />,
    },
    { value: 'devices', label: TAB_LABELS.devices, content: <DeviceLog accesses={accesses} /> },
  ];

  return (
    <Stack className='gap-4'>
      {/* canvas 크기는 site.css의 #screen이 정한다. 비어 있어도 화면으로 읽히게 표면 색을 깐다. */}
      <div
        ref={screenRef}
        role='img'
        aria-label='에뮬레이터 화면'
        className='w-full max-w-xs overflow-hidden rounded-lg bg-surface-muted'
      />
      {/* xterm은 열 수만큼만 그리므로 폭을 내용에 맞추고, 좁은 화면에서는 가로로 넘긴다. */}
      <div
        ref={terminalRef}
        className='w-fit max-w-full overflow-x-auto rounded-sm border border-border'
      />
      <Text size='sm' tone='muted'>
        {status}
      </Text>
      {/* status에는 1초마다 바뀌는 MIPS가 들어 있어 낭독 영역에 넣지 않는다. 실행기 오류만 알린다. */}
      <div role='status'>
        {notice !== '' && (
          <Text size='sm' tone='danger'>
            {notice}
          </Text>
        )}
      </div>
      <RunLine controller={controller} state={state} busy={busy} />
      <Tabs
        label='들여다보기'
        items={items}
        value={tab}
        onValueChange={(next) => {
          if (isInspectTab(next)) onTabChange(next);
        }}
      />
    </Stack>
  );
};
