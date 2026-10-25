import { useEffect, useRef, useState, type RefObject } from 'react';

import type { DeviceAccess } from '@amulator/core/bus';
import type { ElfSummary, MemoryRegion } from '@amulator/core/inspect';

import type { MachineView, WorkerToMain } from '../messages';
import type { ProgramName } from '../programs';
import { TRACE_CAPACITY } from '../worker/traceBuffer';
import { mountEmulator, type EmulatorController } from './mountEmulator';

const MEGA = 1_000_000;

type Options = {
  program: ProgramName;
  token: string | null;
  persist: boolean;
  startPaused: boolean;
};

type View = {
  note: string;
  bridgeNote: string;
  ips: number;
  elf?: ElfSummary;
  regions?: MemoryRegion[];
  state?: MachineView;
  accesses: DeviceAccess[];
  controller?: EmulatorController;
};

type Result = {
  screenRef: RefObject<HTMLDivElement | null>;
  terminalRef: RefObject<HTMLDivElement | null>;
  status: string;
  elf?: ElfSummary;
  regions?: MemoryRegion[];
  state?: MachineView;
  accesses: DeviceAccess[];
  controller?: EmulatorController;
};

const INITIAL_VIEW: View = { note: '', bridgeNote: '', ips: 0, accesses: [] };

const reduce = (view: View, message: WorkerToMain): View => {
  switch (message.type) {
    case 'booted':
      return {
        ...view,
        note: message.warning ?? (message.restored ? '스냅샷에서 복원했다' : '새로 부팅했다'),
        elf: message.elf,
        regions: message.regions,
        // reset 뒤에는 이전 머신의 상태와 기록이 남지 않게 한다.
        state: undefined,
        accesses: [],
      };
    case 'saved':
      return { ...view, note: `저장했다 (${message.bytes} B)` };
    case 'error':
      // id가 있는 오류는 peek·describeSnapshot을 부른 쪽이 받는다.
      return message.id === undefined ? { ...view, note: `오류: ${message.message}` } : view;
    case 'status':
      return { ...view, ips: message.ips };
    case 'state':
      return { ...view, state: message.state };
    case 'deviceAccesses':
      return { ...view, accesses: [...view.accesses, ...message.accesses].slice(-TRACE_CAPACITY) };
    default:
      return view;
  }
};

const renderStatus = ({ note, bridgeNote, ips }: View): string => {
  const label = bridgeNote === '' ? note : `${note} · ${bridgeNote}`;
  return ips > 0 ? `${label} · ${(ips / MEGA).toFixed(1)} MIPS` : label;
};

export const useEmulator = ({ program, token, persist, startPaused }: Options): Result => {
  const screenRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(INITIAL_VIEW);

  useEffect(() => {
    const screen = screenRef.current;
    const terminal = terminalRef.current;
    if (screen === null || terminal === null) return;

    // mountEmulator는 닫힌 컨트롤러의 콜백을 부르지 않으므로 여기 오는 메시지는 이번 마운트의 것이다.
    const controller = mountEmulator(
      { screen, terminal },
      {
        program,
        token,
        persist,
        startPaused,
        onMessage: (message) => setView((view) => reduce(view, message)),
        onBridgeStatus: (text) => setView((view) => ({ ...view, bridgeNote: text })),
      },
    );
    setView((view) => ({ ...view, controller }));

    return () => {
      controller.dispose();
      setView(INITIAL_VIEW);
    };
  }, [program, token, persist, startPaused]);

  return {
    screenRef,
    terminalRef,
    status: renderStatus(view),
    elf: view.elf,
    regions: view.regions,
    state: view.state,
    accesses: view.accesses,
    controller: view.controller,
  };
};
