import type { StepPlan } from '../../chapter/types';

// 레지스터 번호(ABI 이름의 x 번호)
const A2 = 12;
// 4단계에서 uptime 자리에 찍히게 할 값이다.
const FAKE_UPTIME = 12_345;

// .bss를 0으로 채우는 반복의 첫 명령이다. clock은 .bss가 16바이트라 4번 돈다.
const BSS_LOOP: { address: number; expect: string } = {
  address: 0x8000_0024, // bgeu a0, a1, 0x80000034
  expect: 'bgeu a0, a1, 0x80000034',
};
// handle_trap에서 uptime_seconds를 다시 읽은 직후다. 이 값이 a2에 있고 put_uint가 a2를 그대로 십진수로 찍으므로,
// a2를 고치면 터미널의 `uptime:` 숫자가 바로 바뀐다.
const BEFORE_PRINT_UPTIME = {
  address: 0x8000_0154, // addi a1, sp, 0x6
  expect: 'addi a1, sp, 0x6',
};
// " s\n"까지 찍고 나서 다음 기한을 쓰기 직전이다. 이때 터미널에 고친 숫자가 보인다.
const AFTER_PRINT_UPTIME = {
  address: 0x8000_01d4, // lui a0, 0x80000
  expect: 'lui a0, 0x80000',
};
const TRAP_ENTRY = {
  address: 0x8000_004c, // addi sp, sp, -0x40
  expect: 'addi sp, sp, -0x40',
};
const MRET = {
  address: 0x8000_00e4, // mret
  expect: 'mret',
};

export const CH2_STEPS: readonly StepPlan[] = [
  {
    title: '명령어 하나 꺼내기',
    program: 'clock',
    start: { kind: 'entry' },
    tab: 'memory',
    actions: [{ label: '한 단계', kind: 'step', count: 1 }],
  },
  {
    title: '해석하고 실행하기',
    program: 'clock',
    start: { kind: 'entry' }, // 진입 주소(0x80000000)가 곧 `la sp` 앞이다
    tab: 'registers',
    actions: [
      { label: 'la sp 실행', kind: 'step', count: 2 }, // auipc sp + addi sp
      { label: 'la t0 실행', kind: 'step', count: 2 }, // auipc t0 + addi t0
      { label: 'csrw mtvec 실행', kind: 'step', count: 1 },
    ],
  },
  {
    title: '반복과 분기',
    program: 'clock',
    start: { kind: 'runTo', ...BSS_LOOP },
    tab: 'registers',
    actions: [
      // 한 바퀴(bgeu, sw, addi, j)를 한 단계씩 돈 다음 한 바퀴를 한 번에 더 돈다.
      { label: 'bgeu 실행', kind: 'step', count: 1 },
      { label: 'sw 실행', kind: 'step', count: 1 },
      { label: 'addi 실행', kind: 'step', count: 1 },
      { label: 'j 실행', kind: 'step', count: 1 },
      { label: '한 바퀴 더', kind: 'step', count: 4 },
    ],
  },
  {
    title: '값을 바꿔 보기',
    program: 'clock',
    start: { kind: 'runTo', ...BEFORE_PRINT_UPTIME },
    tab: 'registers',
    actions: [
      { label: 'a2를 12345로 고치기', kind: 'setRegister', target: A2, value: FAKE_UPTIME },
      { label: '출력까지 실행', kind: 'runTo', ...AFTER_PRINT_UPTIME },
    ],
  },
  {
    title: '트랩',
    program: 'clock',
    start: { kind: 'running' },
    tab: 'registers',
    actions: [
      { label: '트랩까지 실행', kind: 'runTo', ...TRAP_ENTRY },
      { label: 'mret까지 실행', kind: 'runTo', ...MRET },
      { label: '한 단계', kind: 'step', count: 1 },
    ],
  },
];
