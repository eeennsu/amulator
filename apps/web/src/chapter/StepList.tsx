import {
  Badge,
  Box,
  Button,
  Card,
  CodeBlock,
  Collapsible,
  Icon,
  Prose,
  Stack,
  Text,
} from '@eeennsu/web';
import { createContext, useContext, type ReactNode } from 'react';

import { hintText } from './tryText';
import type { ChapterStep, TryAction } from './types';

const ALL_DONE_TEXT = '다 해 봤다. 에뮬레이터의 값을 살펴보고 아래 질문을 풀어 보자.';
const END_TEXT = '이 장의 단계를 모두 마쳤다.';

// 해 보기·확인 질문은 위 글과 구분선으로 나눈다. 카드 안에 상자를 겹치지 않는다.
const SECTION_CLASS = 'mt-8 border-t border-border pt-6';

// [해 보기]가 읽는, 펼친 단계의 동작 목록이다. MDX의 Try는 props 없이 이 context에서 다음 동작을 찾는다.
type TryState = {
  actions: readonly TryAction[];
  done: number;
  busy: boolean;
  // 방금 한 동작의 결과 한 줄이다. 처음 상태로 돌리면 사라진다.
  last: string | undefined;
  onTry: (action: TryAction) => void;
};

const TryContext = createContext<TryState | undefined>(undefined);

const Try = () => {
  const state = useContext(TryContext);
  if (state === undefined) throw new Error('Try는 단계 카드 안에서만 쓴다');
  const action = state.actions[state.done];
  return (
    <Box className={SECTION_CLASS}>
      <Stack className='gap-3'>
        <Stack direction='row' align='center' justify='between' className='gap-2'>
          <Text heading='3' size='lg'>
            해 보기
          </Text>
          <Badge>{`${state.done}/${state.actions.length} 해 봄`}</Badge>
        </Stack>
        <Text size='sm' tone='muted'>
          {action === undefined ? ALL_DONE_TEXT : hintText(action)}
        </Text>
        {action !== undefined && (
          <Box>
            <Button
              label={action.label}
              variant='primary'
              disabled={state.busy}
              onClick={() => state.onTry(action)}
            />
          </Box>
        )}
        {/* 낭독 영역은 내용이 바뀌기 전에 있어야 읽힌다. 그래서 래퍼는 늘 두고 안의 Text만 조건으로 그린다. */}
        <div role='status'>{state.last !== undefined && <Text size='sm'>{state.last}</Text>}</div>
      </Stack>
    </Box>
  );
};

// 접어 둔 글은 흐린 색과 왼쪽 줄(Prose 인용문과 같은 모양)로 본문과 가른다.
// Prose의 문단 간격은 직계 자식에만 걸린다. Collapsible 패널 안의 문단은 직계가 아니라서 한 겹 더 Prose로 감싼다.
const Aside = ({ children }: { children?: ReactNode }) => (
  <Prose className='border-s-4 border-border ps-4 text-fg-muted'>{children}</Prose>
);

// 트리거와 패널의 px-3만큼 당겨 접힌 글이 본문 문단과 같은 줄에서 시작하게 한다.
const More = ({ children }: { children?: ReactNode }) => (
  <Collapsible label='더 읽기' className='-mx-3'>
    <Aside>{children}</Aside>
  </Collapsible>
);

const Quiz = ({ question, children }: { question: string; children?: ReactNode }) => (
  <Collapsible label={question} className='-mx-3'>
    <Aside>{children}</Aside>
  </Collapsible>
);

// 한 단계의 Quiz들을 "확인 질문" 구역 하나로 묶는다.
const Checks = ({ children }: { children?: ReactNode }) => (
  <Box className={SECTION_CLASS}>
    <Stack className='gap-2'>
      <Text heading='3' size='lg'>
        확인 질문
      </Text>
      <div>{children}</div>
    </Stack>
  </Box>
);

const MDX_COMPONENTS = { Try, More, Quiz, Checks, CodeBlock };

type StepState = 'done' | 'current' | 'upcoming';

const MARKER_CLASS = 'flex size-6 shrink-0 items-center justify-center rounded-full';

const Marker = ({ state, number }: { state: StepState; number: number }) => {
  if (state === 'done') {
    return (
      <Box className={`${MARKER_CLASS} bg-brand`}>
        <Icon name='check' size='sm' className='text-fg-on-brand' />
      </Box>
    );
  }
  return (
    <Box
      className={`${MARKER_CLASS} ${state === 'current' ? 'border-2 border-brand' : 'border border-border'}`}
    >
      <Text size='sm' tone='muted' className={state === 'current' ? 'text-fg-brand' : undefined}>
        {String(number)}
      </Text>
    </Box>
  );
};

type Props = {
  steps: readonly ChapterStep[];
  current: number;
  // 가 본 가장 뒤 단계다. 이 단계 이하만 다시 열 수 있다.
  reached: number;
  // 현재 단계에서 해 본 동작 수
  done: number;
  last: string | undefined;
  busy: boolean;
  onSelect: (index: number) => void;
  onRestart: () => void;
  onTry: (action: TryAction) => void;
};

const CurrentStep = ({
  steps,
  current,
  done,
  last,
  busy,
  onSelect,
  onRestart,
  onTry,
}: Omit<Props, 'reached'>) => {
  const step = steps[current];
  if (step === undefined) throw new Error(`${current}번 단계가 없다`);
  const { Body } = step;
  const nextStep = steps[current + 1];
  const allDone = done >= step.actions.length;
  return (
    <div aria-current='step'>
      <Card>
        <Stack className='gap-4'>
          <Stack direction='row' align='center' className='gap-4'>
            <Marker state='current' number={current + 1} />
            <Text heading='2' size='xl'>
              {step.title}
            </Text>
          </Stack>
          <Prose>
            <TryContext value={{ actions: step.actions, done, last, busy, onTry }}>
              <Body components={MDX_COMPONENTS} />
            </TryContext>
          </Prose>
          <Stack direction='row' align='center' wrap className='gap-2'>
            {nextStep !== undefined && (
              <Button
                label={`다음: ${nextStep.title} →`}
                variant={allDone ? 'primary' : 'secondary'}
                disabled={busy}
                onClick={() => onSelect(current + 1)}
              />
            )}
            {nextStep === undefined && allDone && (
              <>
                <Text tone='muted'>{END_TEXT}</Text>
                {/* DS에 링크 컴포넌트가 없어 Prose의 a 스타일을 빌린다(목차 링크와 같다). */}
                <Prose>
                  <a href='./'>← 목차</a>
                </Prose>
              </>
            )}
            <Button label='↺ 처음 상태로' variant='ghost' disabled={busy} onClick={onRestart} />
          </Stack>
        </Stack>
      </Card>
    </div>
  );
};

// 지난 단계는 다시 펼치는 버튼이라 시작 상태를 만드는 동안은 비활성이다. 접힌 제목도 제목 목차에 남도록 h2로 감싼다.
const DoneRow = ({
  title,
  number,
  busy,
  onOpen,
}: {
  title: string;
  number: number;
  busy: boolean;
  onOpen: () => void;
}) => (
  <Stack direction='row' align='center' className='gap-4 px-6'>
    <Marker state='done' number={number} />
    <h2 className='min-w-0 flex-1'>
      <span className='sr-only'>완료: </span>
      {/* 버튼 안쪽 px-4만큼 당겨 남은 단계 제목과 같은 줄에서 시작하게 한다. */}
      <Button
        label={title}
        variant='ghost'
        disabled={busy}
        className='-ms-4 w-full justify-start'
        onClick={onOpen}
      />
    </h2>
  </Stack>
);

const UpcomingRow = ({ title, number }: { title: string; number: number }) => (
  <Stack direction='row' align='center' className='gap-4 px-6 py-2'>
    <Marker state='upcoming' number={number} />
    <h2>
      <span className='sr-only'>남은 단계: </span>
      <Text tone='muted'>{title}</Text>
    </h2>
  </Stack>
);

// 지금 단계만 카드로 펼치고, 지난·남은 단계는 표면 없이 번호와 제목 한 줄로 둔다.
export const StepList = (props: Props) => {
  const { steps, current, reached, busy, onSelect } = props;
  return (
    <Stack className='gap-2'>
      {steps.map((step, index) => {
        if (index === current) return <CurrentStep key={index} {...props} />;
        if (index <= reached) {
          return (
            <DoneRow
              key={index}
              title={step.title}
              number={index + 1}
              busy={busy}
              onOpen={() => onSelect(index)}
            />
          );
        }
        return <UpcomingRow key={index} title={step.title} number={index + 1} />;
      })}
    </Stack>
  );
};
