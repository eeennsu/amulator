import { Badge, Box, Button, Card, CodeBlock, Collapsible, Prose, Stack, Text } from '@eeennsu/web';
import { createContext, useContext, type ReactNode } from 'react';

import { hintText } from './tryText';
import type { ChapterStep, TryAction } from './types';

const ALL_DONE_TEXT = '다 해 봤다. 왼쪽 값을 살펴보고 아래 질문을 풀어 보자.';

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
    <Box className='rounded-xl border border-border p-4'>
      <Stack className='gap-2'>
        <Stack direction='row' align='center' className='gap-2'>
          <Text>해 보기</Text>
          <Badge>{`${state.done}/${state.actions.length}`}</Badge>
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
        {state.last !== undefined && <Text size='sm'>{state.last}</Text>}
      </Stack>
    </Box>
  );
};

// Prose의 문단 간격은 직계 자식에만 걸린다. Collapsible 패널 안의 문단은 직계가 아니라서 한 겹 더 Prose로 감싼다.
const More = ({ children }: { children?: ReactNode }) => (
  <Collapsible label='더 읽기'>
    <Prose>{children}</Prose>
  </Collapsible>
);

const Quiz = ({ question, children }: { question: string; children?: ReactNode }) => (
  <Collapsible label={question}>
    <Prose>{children}</Prose>
  </Collapsible>
);

const MDX_COMPONENTS = { Try, More, Quiz, CodeBlock };

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

export const StepList = ({
  steps,
  current,
  reached,
  done,
  last,
  busy,
  onSelect,
  onRestart,
  onTry,
}: Props) => (
  <Stack className='gap-4'>
    {steps.map((step, index) => {
      if (index === current) {
        const { Body } = step;
        const nextStep = steps[index + 1];
        return (
          <Card key={index}>
            <Stack className='gap-4'>
              <Text heading='3'>{step.title}</Text>
              <Prose>
                <TryContext value={{ actions: step.actions, done, last, busy, onTry }}>
                  <Body components={MDX_COMPONENTS} />
                </TryContext>
              </Prose>
              <Stack direction='row' wrap className='gap-2'>
                <Button
                  label='↺ 처음 상태로'
                  variant='secondary'
                  disabled={busy}
                  onClick={onRestart}
                />
                {nextStep !== undefined && (
                  <Button
                    label={`다음: ${nextStep.title} →`}
                    variant='secondary'
                    disabled={busy}
                    onClick={() => onSelect(index + 1)}
                  />
                )}
              </Stack>
            </Stack>
          </Card>
        );
      }
      if (index <= reached) {
        return (
          <Card key={index}>
            <Collapsible
              label={`✓ ${step.title}`}
              open={false}
              onOpenChange={(open) => {
                if (open && !busy) onSelect(index);
              }}
            >
              {null}
            </Collapsible>
          </Card>
        );
      }
      return (
        <Card key={index}>
          <Text tone='muted'>{step.title}</Text>
        </Card>
      );
    })}
  </Stack>
);
