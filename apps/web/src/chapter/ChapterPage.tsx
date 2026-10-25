import { Box, Card, CodeBlock, Collapsible, Prose, Stack, Text } from '@eeennsu/web';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { CpuView } from '@amulator/core/inspect';

import { useEmulator } from '../emulator/useEmulator';
import type { MachineView } from '../messages';
import { changedFields } from './changes';
import { EmulatorColumn } from './EmulatorColumn';
import { createStepRunner } from './runner';
import { StepList } from './StepList';
import { resultText } from './tryText';
import type { ChapterContent, ChapterStep, InspectTab, TryAction } from './types';

const ANDROID_COMPONENTS = { CodeBlock };
const NO_CHANGES: ReadonlySet<string> = new Set();
const UNKNOWN_ERROR = '알 수 없는 오류가 났다';

type StepRunner = ReturnType<typeof createStepRunner>;

// 어느 실행기·단계·"처음으로" 요청의 시작 상태가 만들어졌는지와, 그 뒤 해 본 동작 수다.
// 지금의 (실행기, 단계, 요청)과 다르면 시작 상태를 만드는 중이라서 busy는 상태에서 바로 나온다.
// last는 방금 한 동작의 결과 한 줄이다.
type Settled = {
  runner: StepRunner;
  current: number;
  restart: number;
  done: number;
  last?: string;
};
type Notice = { runner: StepRunner; current: number; restart: number; text: string };
type Tracked = {
  seen: MachineView | undefined;
  base: CpuView | undefined;
  changed: ReadonlySet<string>;
};

const stepAt = (steps: readonly ChapterStep[], index: number): ChapterStep => {
  const step = steps[index];
  if (step === undefined) throw new Error(`${index}번 단계가 없다`);
  return step;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : UNKNOWN_ERROR;

// 연속한 멈춘 상태 둘을 비교한다. state가 사라지면(다시 부팅) 기준을 버려 시작 상태 직후에는 강조가 없다.
// 렌더 중에 state를 맞추는 것은 React가 권하는 "props 변화에 맞춘 상태 조정" 방식이다.
const useChangedFields = (state: MachineView | undefined): ReadonlySet<string> => {
  const [tracked, setTracked] = useState<Tracked>({
    seen: undefined,
    base: undefined,
    changed: NO_CHANGES,
  });
  if (tracked.seen !== state) {
    if (state === undefined) {
      setTracked({ seen: undefined, base: undefined, changed: NO_CHANGES });
    } else if (state.paused) {
      setTracked({
        seen: state,
        base: state.cpu,
        changed: changedFields(tracked.base, state.cpu),
      });
    } else {
      setTracked({ ...tracked, seen: state, changed: NO_CHANGES });
    }
  }
  return tracked.changed;
};

type Props = { content: ChapterContent };

export const ChapterPage = ({ content: { steps, Android } }: Props) => {
  const [current, setCurrent] = useState(0);
  const [reached, setReached] = useState(0);
  const [restart, setRestart] = useState(0);
  const [tab, setTab] = useState<InspectTab>(() => stepAt(steps, 0).tab);
  const [settled, setSettled] = useState<Settled>();
  const [performing, setPerforming] = useState<StepRunner>();
  const [notice, setNotice] = useState<Notice>();
  const liveRunner = useRef<StepRunner | undefined>(undefined);

  const step = stepAt(steps, current);
  const { screenRef, terminalRef, status, elf, state, accesses, controller } = useEmulator({
    program: step.program,
    token: null,
    persist: false,
    startPaused: true,
  });
  const booted = elf !== undefined;
  const changed = useChangedFields(state);

  // 실행기는 컨트롤러 하나에 속한다. StrictMode의 이중 마운트가 컨트롤러를 바꾸면 실행기도 바뀐다.
  const runner = useMemo(
    () => (controller === undefined ? undefined : createStepRunner(controller)),
    [controller],
  );
  useEffect(() => {
    liveRunner.current = runner;
    return () => {
      liveRunner.current = undefined;
    };
  }, [runner]);

  const start = step.start;
  // elf 객체는 reset마다 새로 만들어지므로 의존성은 booted(elf !== undefined)로 둔다.
  useEffect(() => {
    if (runner === undefined || !booted) return;
    let cancelled = false;
    const finish = (text: string | undefined) => {
      if (cancelled) return;
      setSettled({ runner, current, restart, done: 0 });
      if (text !== undefined) setNotice({ runner, current, restart, text });
    };
    void runner.prepare(start).then(
      () => finish(undefined),
      (error: unknown) => finish(messageOf(error)),
    );
    return () => {
      cancelled = true;
    };
  }, [runner, booted, start, current, restart]);

  const ready =
    settled !== undefined &&
    settled.runner === runner &&
    settled.current === current &&
    settled.restart === restart;
  const busy = !ready || (runner !== undefined && performing === runner);

  const select = (index: number) => {
    if (busy) return;
    setCurrent(index);
    setReached((previous) => Math.max(previous, index));
    setTab(stepAt(steps, index).tab);
  };

  const restartStep = () => {
    if (busy) return;
    setRestart((previous) => previous + 1);
    setTab(step.tab);
  };

  const perform = (action: TryAction) => {
    if (busy || runner === undefined) return;
    // 닫힌 컨트롤러의 실행기가 늦게 거부해도 상태를 건드리지 않는다.
    const alive = () => liveRunner.current === runner;
    setPerforming(runner);
    setNotice(undefined);
    const before = state;
    void runner
      .perform(action)
      .then(
        (after) => {
          if (!alive()) return;
          setSettled((previous) =>
            previous !== undefined && previous.runner === runner && previous.current === current
              ? { ...previous, done: previous.done + 1, last: resultText(action, before, after) }
              : previous,
          );
        },
        (error: unknown) => {
          if (!alive()) return;
          // 오류 알림 옆에 이전 성공의 "방금" 줄이 남지 않게 한다.
          setSettled((previous) =>
            previous !== undefined && previous.runner === runner && previous.current === current
              ? { ...previous, last: undefined }
              : previous,
          );
          setNotice({ runner, current, restart, text: messageOf(error) });
        },
      )
      .finally(() => {
        if (alive()) setPerforming(undefined);
      });
  };

  const visibleNotice =
    notice !== undefined &&
    notice.runner === runner &&
    notice.current === current &&
    notice.restart === restart
      ? notice.text
      : '';

  return (
    <Box className='grid gap-6 lg:grid-cols-3'>
      <Box className='min-w-0 lg:col-span-2'>
        <EmulatorColumn
          screenRef={screenRef}
          terminalRef={terminalRef}
          controller={controller}
          state={state}
          accesses={accesses}
          changed={changed}
          tab={tab}
          onTabChange={setTab}
          busy={busy}
          status={status}
          notice={visibleNotice}
        />
      </Box>
      <Box className='min-w-0'>
        <Stack className='gap-6'>
          <StepList
            steps={steps}
            current={current}
            reached={reached}
            done={ready ? settled.done : 0}
            last={ready ? settled.last : undefined}
            busy={busy}
            onSelect={select}
            onRestart={restartStep}
            onTry={perform}
          />
          <Card>
            <Stack className='gap-4'>
              <Text heading='2' size='xl'>
                진짜 안드로이드 에뮬레이터는
              </Text>
              <Collapsible label='더 읽기'>
                <Prose className='text-fg-muted'>
                  <Android components={ANDROID_COMPONENTS} />
                </Prose>
              </Collapsible>
            </Stack>
          </Card>
        </Stack>
      </Box>
    </Box>
  );
};
