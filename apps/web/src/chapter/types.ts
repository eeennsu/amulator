import type { MDXContent } from 'mdx/types';

import type { RegisterTarget } from '../messages';
import type { ProgramName } from '../programs';

export type InspectTab = 'registers' | 'memory' | 'devices';

// expect는 그 주소의 disassemble() 결과 전체다. Task 5 테스트가 대조한다.
export type CodeAddress = { address: number; expect: string };

export type StepStart = { kind: 'entry' } | ({ kind: 'runTo' } & CodeAddress) | { kind: 'running' };

export type TryAction = { label: string } & (
  | { kind: 'step'; count: number }
  | ({ kind: 'runTo' } & CodeAddress)
  | { kind: 'setRegister'; target: RegisterTarget; value: number }
);

export type StepPlan = {
  title: string;
  program: ProgramName;
  start: StepStart;
  tab: InspectTab;
  actions: TryAction[];
};

export type ChapterStep = StepPlan & { Body: MDXContent };

export type ChapterContent = { steps: ChapterStep[]; Android: MDXContent };
