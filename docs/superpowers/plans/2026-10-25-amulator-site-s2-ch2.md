# amulator 학습 사이트 S2-1 구현 계획: 챕터 틀과 2장 CPU

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 챕터가 함께 쓸 챕터 화면 틀과 목차를 만들고, 그 틀로 2장 CPU(clock 게스트, 5단계 + 비교 상자)를 사실 대조와 사용자 읽기까지 끝낸다.

**Architecture:** core `Machine.run`에 "주소에서 멈추기"를 더하고, worker는 그것을 `breakAt` 메시지와 저장하지 않는 인스턴스(`persist: false`)로 꺼내 준다. 페이지 쪽은 `EmulatorController.waitFor` 위에 단계 실행기(`createStepRunner`)를 두고, 단계마다 "멈춘 채 reset → 그 주소까지 실행"으로 시작 상태를 만든다. 챕터는 새 HTML 진입점 `chapter.html?n=2`이고, 단계의 기계 데이터는 TS(`steps.ts`), 글은 단계별 MDX다. 화면은 DS `@eeennsu/web` 0.5.0 컴포넌트로 조립하고 마지막에 design-flow로 다듬는다.

**Tech Stack:** TypeScript, pnpm 워크스페이스, Vite 8, Vitest 5, React 19, `@eeennsu/web` 0.5.0, Tailwind CSS 4(`@tailwindcss/vite`), MDX 3(`@mdx-js/rollup`), xterm.js.

**Spec:** [docs/superpowers/specs/2026-10-25-amulator-site-s2-ch2-design.md](../specs/2026-10-25-amulator-site-s2-ch2-design.md). 상위 설계 [2026-10-19-amulator-learning-site-design.md](../specs/2026-10-19-amulator-learning-site-design.md) 4.3·4.5절, 7·8장. 이어 받는 목록 [followups/2026-10-22-amulator-site-s1.md](../followups/2026-10-22-amulator-site-s1.md).

**빌더 결정(설계 9장):**
- 라우팅: 라우터 라이브러리 없이 HTML 진입점을 하나 더한다(`chapter.html?n=<번호>`). S1의 `emulator.html?program=`과 같은 방식이고, Pages에서 새로고침해도 깨지지 않는다. 새 링크는 상대경로(`chapter.html?n=2`)로 써서 Pages 하위 경로 문제(후속 목록 S3)를 새로 만들지 않는다.
- MDX: `@mdx-js/rollup`. 단계 카드의 기계 데이터(시작 상태·탭·해 보기)는 `steps.ts`에 두어 테스트로 검증하고, 글은 단계마다 MDX 파일 하나다. MDX 안에서는 `<Try />`, `<More>`, `<Quiz>`, `<CodeBlock>`을 쓴다.
- 주소에서 멈추기: `Machine.run(maxInstructions, breakAt?)`. `breakAt`이 없으면 지금 루프를 그대로 탄다. worker는 한 번 걸리면 끈다.
- 실행된 명령 수는 `state`에 싣지 않는다. 쉬는 중은 `CpuView.idle`로 보인다.
- 메모리 탭은 pc 주변만 보이고 주소 입력을 두지 않는다. 그래서 `peekMemory`의 `>>> 0` 정규화는 이번에 하지 않는다(설계 5장의 "입력을 두면").

**범위 밖:** 2장 밖의 챕터 내용, Pages 배포, 장치 기록 필터·합치기, 스냅샷 구간·기록 재생 UI(설계 2장 비목표). 단계마다 프로그램을 바꾸는 경로는 타입과 배선만 두고(2장은 clock 하나), 따로 테스트하지 않는다.

## Global Constraints

- 코드를 쓰기 전에 conventions 스킬을 읽는다(프로젝트 CLAUDE.md). 타입은 `type`, 화살표 함수, named export, enum 대신 `as const`, 매직넘버는 UPPER_SNAKE 상수다. MDX 파일의 default export는 MDX가 만드는 것이라 예외다.
- `packages/core/src`는 순수 ES2023이다. DOM·Node API를 쓰지 않는다.
- DS는 `@eeennsu/web` **0.5.0 정확한 버전**으로 설치한다(`workspace:`·로컬 경로 금지). Tailwind CSS는 4.1 이상(DS peer).
- 탭·표·코드 블록·접기·카드·버튼은 DS 0.5.0 컴포넌트를 쓴다(`Tabs`, `Table`, `CodeBlock`, `Collapsible`, `Card`, `Button`, `Prose`, `Stack`, `Box`, `Text`, `Badge`). 사이트 안에 범용 UI를 따로 만들지 않는다.
- className 임의값(`mt-[13px]`), 하드코딩 hex, `fontFamily` 리터럴, DS 스케일 밖 간격(허용: 0 1 2 3 4 6 8 12 16 20 24)을 쓰지 않는다. 색은 semantic 토큰 클래스만 쓴다.
- DS CSS(`@import "@eeennsu/web/themes/base.css"`)는 목차와 챕터 진입점만 import한다. 놀이터(`emulator.html`)는 지금 CSS 그대로 두고 화면을 바꾸지 않는다.
- 관찰·제어는 페이지와 worker 사이 메시지로만 오간다. MCP 도구를 늘리지 않는다.
- 챕터 에뮬레이터는 스냅샷 저장소(IndexedDB·HTTP)를 읽지도 쓰지도 지우지도 않는다. 놀이터와 MCP 모드(`?token=`)는 지금처럼 저장한다.
- 주소에서 멈추기가 꺼져 있을 때 실행 속도가 지금과 같아야 한다(`pnpm --filter @amulator/core bench`, 차이 5% 안).
- 주소 계산에 비트 연산(`&`, `|`, `~`)을 쓰지 않는다. `0x8000_0000` 위 주소가 음수가 된다. `pc - (pc % 16)`처럼 쓴다.
- 보조 스크립트는 node `.mjs`, 윈도우의 `python`은 쓰지 않는다.
- 문서·주석·커밋 메시지·사이트 글은 한국어 '-다'체다. 커밋 제목 접두어는 `feat:` `fix:` `refactor:` `update:` `chore:` `docs:`만 쓴다.
- 새 의존성 버전은 설치할 때 조회하고 정확한 버전을 커밋 메시지 본문에 적는다.
- 완료 조건은 `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`가 모두 통과하는 것이다. `eslint-disable`로 막지 않는다.

## Review Focus

1. **시작 상태를 만드는 중에 다른 단계나 실행 버튼을 누른다.** 앞선 준비의 reset·resume과 새 준비가 섞이면 엉뚱한 상태에서 멈추거나 영영 멈추지 않는다. 실행기는 한 번에 하나만 받고, 겹친 호출은 바로 거부한다. 화면은 그동안 버튼을 막는다. → Task 3 테스트 `준비 중에 들어온 호출은 거부한다`
2. **해 보기의 주소에 끝내 오지 않는다**(잘못 고른 주소, 게스트가 다른 길로 감). 무한히 기다리면 화면이 잠긴다. 시간 안에 못 오면 멈추고 주소를 지운 뒤 오류로 알리며, 다음 준비는 정상으로 된다. → Task 3 테스트 `주소에 오지 않으면 시간 초과로 알리고 다음 준비는 된다`
3. **이미 그 주소에 있는데 거기까지 실행한다.** 0개를 실행하고 바로 멈춰 학습자에게는 아무 일도 없어 보인다. 이 의미는 core에 못박고, 2장 데이터는 이런 해 보기를 갖지 않는다. → Task 1 테스트 `pc가 이미 breakAt이면 0개를 실행하고 멈춘다`, Task 5 테스트 `runTo 해 보기는 지금 pc와 다른 주소로 간다`
4. **wfi로 쉬는 중에 [한 단계]를 누른다.** 0개를 실행하고 조용히 끝나면 고장으로 보인다. pc는 그대로이고 상태에 쉬는 중이 실려야 한다. → Task 2 테스트 `쉬는 중의 step은 pc를 그대로 두고 idle을 알린다`
5. **챕터를 쓴 뒤 놀이터 저장본.** 챕터 인스턴스의 부팅·reset이 저장소를 건드리면 놀이터 저장본이 복원되거나 지워진다. → Task 2 테스트 `persist가 false면 저장소를 읽지도 지우지도 않는다`

---

### Task 1: core 주소에서 멈추기

**Files:**
- Modify: `packages/core/src/machine.ts` (`RunResult`, `run`)
- Test: `packages/core/test/machine.test.ts`

**Interfaces:**
- Produces:
  - `RunResult = { executed: number; idle: boolean; hitBreak: boolean }`
  - `Machine.run: (maxInstructions: number, breakAt?: number) => RunResult` — 매 명령 실행 **전에** `cpu.pc === breakAt`이면 그 명령을 실행하지 않고 `{ executed, idle: false, hitBreak: true }`로 돌아온다. 쉬다 깨어나 트랩으로 들어간 경우(`cpu.step()`이 pc를 mtvec으로 옮기고 끝남)에도 다음 차례에 mtvec에서 걸린다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`machine.test.ts`, clock.elf, 시계 `nowMicros: () => 0`)

```ts
it('breakAt에 오면 그 명령을 실행하기 전에 멈춘다', () => {
  // 0x80000000 auipc sp, 0x80000004 addi sp → 0x80000008에서 멈춘다
  const result = machine.run(1_000, 0x8000_0008);
  expect(result).toEqual({ executed: 2, idle: false, hitBreak: true });
  expect(machine.cpu.pc).toBe(0x8000_0008);
});

it('pc가 이미 breakAt이면 0개를 실행하고 멈춘다', () => {
  expect(machine.run(1_000, ENTRY)).toEqual({ executed: 0, idle: false, hitBreak: true });
});

it('breakAt이 없으면 hitBreak는 false다', () => {
  expect(machine.run(10).hitBreak).toBe(false);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @amulator/core test -- machine`
Expected: FAIL (`hitBreak` 없음)

- [ ] **Step 3: `run(maxInstructions, breakAt?)`을 구현한다**

`breakAt === undefined`이면 지금 루프를 그대로 타게 한다(루프 밖에서 한 번 갈라 지금 경로에 비교를 더하지 않는다). 검사 위치는 `settleIdle()` 다음, `cpu.step()` 앞이다. 지금 `run`을 부르는 곳(worker `runSlice`·`step`, core 테스트)은 반환값의 새 필드를 몰라도 깨지지 않는다.

- [ ] **Step 4: 테스트와 벤치를 돌린다**

Run: `pnpm --filter @amulator/core test` → PASS
Run: 바꾸기 전 커밋(`git stash`)과 후에서 `pnpm --filter @amulator/core bench`를 각각 돌린다.
Expected: `paint.elf 100만 명령어`의 hz 차이가 5% 안. 두 숫자를 커밋 메시지 본문에 적는다.

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/machine.ts packages/core/test/machine.test.ts
git commit -m "feat: Machine.run에 주소에서 멈추기를 더한다"
```

---

### Task 2: worker breakAt과 저장하지 않는 인스턴스

**Files:**
- Modify: `apps/web/src/messages.ts`
- Modify: `apps/web/src/worker/emulatorWorker.ts`
- Modify: `apps/web/src/worker/snapshotStore.ts` (메모리 저장소. `session.test.ts`의 테스트용 저장소는 `entries`를 들여다보므로 그대로 둔다)
- Modify: `apps/web/src/emulator/mountEmulator.ts`, `apps/web/src/emulator/useEmulator.ts`, `apps/web/src/emulator/EmulatorPage.tsx`
- Test: `apps/web/test/emulatorWorker.test.ts` (기존 `start` 3곳에 `persist: true`)

**Interfaces:**
- Consumes: Task 1 `Machine.run(max, breakAt?)`, `RunResult.hitBreak`
- Produces:
  - `MainToWorker`의 `start`: `{ type: 'start'; program: ProgramName; canvas: OffscreenCanvas; token?: string; persist: boolean }`
  - `MainToWorker`에 `{ type: 'breakAt'; address: number | null }`
  - `createMemorySnapshotStore(): SnapshotStore` — `snapshotStore.ts`, `Map` 기반
  - `mountEmulator`의 `Options`에 `persist: boolean; startPaused: boolean`. `startPaused`면 `start` 앞에 `pause`를 보낸다(부팅 전 pause 계약).
  - `useEmulator(options: { program: ProgramName; token: string | null; persist: boolean; startPaused: boolean })`. 놀이터는 `persist: true, startPaused: false`.

`messages.ts`에 적을 계약 주석(설계 5장, 후속 목록):
- `reset` 뒤에는 `booted`를 기다린 다음 `inspect`한다. 그 전의 `state`는 이전 머신의 것이다.
- `breakAt`은 주소 하나다. 실행 루프에서 pc가 그 주소에 오면(그 명령 실행 전) 멈추고 `state`를 보낸 뒤 꺼진다. 새 `breakAt`, `null`, `reset`, `start`도 끈다. `step`은 이 주소를 보지 않는다. 이미 그 주소에 있는데 `resume`하면 바로 멈춘다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`emulatorWorker.test.ts`, clock 게스트용 `startClock(persist)` 도우미를 더한다)

```ts
it('breakAt에서 멈추고 state를 보낸 뒤 꺼진다', async () => {
  const current = await startClock({ persist: true, paused: true });
  current.send({ type: 'breakAt', address: 0x8000_0008 });
  current.send({ type: 'resume' });
  const hit = await current.waitFor('state', ({ state }) => state.paused);
  expect(hit.state.cpu.pc).toBe(0x8000_0008);
  // 한 번 걸리면 꺼진다: 다시 계속하면 그 주소를 지나 달린다
  await control(current, { type: 'resume' });
  await sleep(QUIET_MS);
  expect((await pause(current)).cpu.pc).not.toBe(0x8000_0008);
});

it('reset은 걸어 둔 주소를 지운다', async () => {
  const current = await startClock({ persist: true, paused: true });
  current.send({ type: 'breakAt', address: 0x8000_0008 });
  current.send({ type: 'reset' });
  await current.waitFor('booted');
  await control(current, { type: 'resume' });
  await sleep(QUIET_MS);
  expect((await pause(current)).cpu.pc).not.toBe(0x8000_0008);
});

it('쉬는 중의 step은 pc를 그대로 두고 idle을 알린다', async () => {
  const current = await startClock({ persist: true, paused: false });
  await sleep(QUIET_MS); // clock은 main의 wfi에서 쉰다
  const before = await pause(current);
  expect(before.cpu.idle).toBe(true);
  const after = await control(current, { type: 'step', count: 1 });
  expect(after.cpu).toMatchObject({ pc: before.cpu.pc, idle: true });
});

it('persist가 false면 저장소를 읽지도 지우지도 않는다', async () => {
  // Node에는 IndexedDB가 없어 persist: true면 booted에 warning이 실린다
  const current = await startClock({ persist: false, paused: true });
  const booted = current.messages.find((message) => message.type === 'booted');
  expect(booted).toMatchObject({ restored: false, warning: undefined });
  current.send({ type: 'reset' });
  await current.waitFor('booted');
  expect(console.warn).not.toHaveBeenCalledWith(
    expect.stringContaining('스냅샷을 지우지 못했다'),
    expect.anything(),
  );
});
```

`startClock`은 `paused`면 `start` 앞에 `pause`를 보낸다. 하네스가 `console.warn`을 spy하므로 마지막 단언이 그 spy를 본다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @amulator/web test -- emulatorWorker`
Expected: FAIL (`breakAt`·`persist` 없음, 타입 오류)

- [ ] **Step 3: worker를 구현한다**

- 모듈 상태 `breakpoint: number | undefined`. `breakAt` 메시지가 바꾸고, `start`·`reset`이 지운다.
- `runSlice`는 `machine.run(CLOCK_CHECK_INSTRUCTIONS, breakpoint)`. `hitBreak`면 루프를 빠져 지금처럼 `settleTouch`·`draw`·`flush*`를 한 뒤 `breakpoint = undefined`, `pause()`, `postState`하고 다음 구간을 예약하지 않는다.
- 저장소 선택: `persist`가 false면 `createMemorySnapshotStore()`, 아니면 지금처럼 token 유무로 IndexedDB·HTTP.
- `mountEmulator`·`useEmulator`·`EmulatorPage`에 `persist`·`startPaused`를 잇는다.

- [ ] **Step 4: 테스트를 돌린다**

Run: `pnpm --filter @amulator/web test` → PASS (기존 테스트 포함)

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src apps/web/test
git commit -m "feat: worker에 주소에서 멈추기와 저장하지 않는 인스턴스를 더한다"
```

---

### Task 3: 단계 실행기

**Files:**
- Modify: `apps/web/src/emulator/mountEmulator.ts` (`waitFor`)
- Create: `apps/web/src/chapter/types.ts`
- Create: `apps/web/src/chapter/runner.ts`
- Test: `apps/web/test/runner.test.ts`

**Interfaces:**
- Consumes: Task 2 `breakAt`, `start.persist`, `startPaused`
- Produces:
  - `EmulatorController.waitFor: <T extends WorkerToMain['type']>(type: T, predicate?: (message: Extract<WorkerToMain, { type: T }>) => boolean) => Promise<Extract<WorkerToMain, { type: T }>>` — 부른 뒤에 오는 메시지만 본다. 시간 제한은 없고, `dispose`하면 `에뮬레이터가 닫혔다`로 거부한다. 시그니처는 테스트 하네스 `WorkerHarness.waitFor`와 같다.
  - `types.ts` (`RegisterTarget`은 `../messages`, `ProgramName`은 `../programs`에서 가져온다):
    ```ts
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
    ```
  - `runner.ts`:
    - `type WorkerPort = Pick<EmulatorController, 'send' | 'waitFor'>`
    - `createStepRunner(port: WorkerPort, options?: { timeoutMs?: number }): { prepare: (start: StepStart) => Promise<MachineView>; perform: (action: TryAction) => Promise<MachineView> }` — 기본 `timeoutMs`는 `RUN_TIMEOUT_MS = 10_000`(5단계의 타이머가 1초 뒤에 온다).

동작:
- `prepare`: `pause` → `reset` → `booted`를 기다린다. 그다음 `entry`면 `inspect`, `runTo`면 주소까지 실행, `running`이면 `resume`. 마지막 `state`의 `MachineView`를 돌려준다.
- `perform`: `step`·`setRegister`는 보내고 다음 `state`를 기다린다. `runTo`는 주소까지 실행.
- 주소까지 실행: `breakAt(address)` → `resume` → `state.paused && state.cpu.pc === address`를 기다린다. `timeoutMs` 안에 못 오면 `breakAt(null)`과 `pause`를 보내고 `0x…까지 가지 못했다` 오류로 거부한다.
- 모든 기다림은 `waitFor('error')`와 경주한다. worker가 id 없는 오류를 보내면 그 글로 거부한다.
- 한 번에 하나만 받는다. 앞선 호출이 끝나기 전의 `prepare`·`perform`은 `이전 동작이 아직 끝나지 않았다`로 바로 거부한다. 앞선 호출이 실패해도 다음 호출은 받는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`runner.test.ts`, `startWorker()` 하네스를 `WorkerPort`로 쓴다. clock을 `persist: false`로 멈춘 채 시작하고 첫 `booted`를 소비한 뒤 실행기를 만든다)

```ts
it('entry는 멈춘 채 진입 주소에 둔다', async () => {
  const view = await runner.prepare({ kind: 'entry' });
  expect(view).toMatchObject({ paused: true, cpu: { pc: ENTRY } });
});

it('runTo는 다시 시작해 그 주소에서 멈춘다', async () => {
  await runner.perform({ kind: 'step', count: 5, label: '' }); // 상태를 흐트러뜨린다
  const view = await runner.prepare({ kind: 'runTo', address: 0x8000_0010, expect: '' });
  expect(view).toMatchObject({ paused: true, cpu: { pc: 0x8000_0010 } });
});

it('running은 실행 중으로 둔다', async () => {
  expect((await runner.prepare({ kind: 'running' })).paused).toBe(false);
});

it('준비 중에 들어온 호출은 거부한다', async () => {
  const first = runner.prepare({ kind: 'entry' });
  await expect(runner.perform({ kind: 'step', count: 1, label: '' })).rejects.toThrow(
    '이전 동작이 아직 끝나지 않았다',
  );
  await first;
});

it('주소에 오지 않으면 시간 초과로 알리고 다음 준비는 된다', async () => {
  const slow = createStepRunner(worker, { timeoutMs: 300 });
  // 정렬이 어긋난 주소에는 pc가 오지 않는다
  await expect(slow.prepare({ kind: 'runTo', address: 0x8000_0002, expect: '' })).rejects.toThrow(
    '0x80000002까지 가지 못했다',
  );
  expect((await slow.prepare({ kind: 'entry' })).cpu.pc).toBe(ENTRY);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @amulator/web test -- runner`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: `waitFor`와 `createStepRunner`를 구현한다**

`mountEmulator`는 `worker.onmessage`에서 기다리는 쪽 목록을 돌린다(`onMessage` 호출 전). `dispose`가 남은 기다림을 거부한다.

- [ ] **Step 4: 테스트를 돌린다**

Run: `pnpm --filter @amulator/web test` → PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/emulator/mountEmulator.ts apps/web/src/chapter apps/web/test/runner.test.ts
git commit -m "feat: 단계 시작 상태를 만드는 단계 실행기를 더한다"
```

---

### Task 4: DS·MDX 설치와 목차

**Files:**
- Modify: `apps/web/package.json`, `pnpm-lock.yaml`
- Modify: `apps/web/vite.config.ts` (MDX·Tailwind 플러그인, `chapter` 진입점)
- Modify: `apps/web/tsconfig.app.json` (`types`에 `"mdx"`)
- Create: `apps/web/chapter.html`, `apps/web/src/chapter/main.tsx`
- Create: `apps/web/src/site/site.css`
- Create: `apps/web/src/site/chapters.ts`
- Modify: `apps/web/src/site/SiteHome.tsx`, `apps/web/src/site/main.tsx`
- Create: `.claude/settings.json`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 3 `StepPlan`
- Produces:
  - `ChapterContent = { steps: ChapterStep[]; Android: MDXContent }`, `ChapterStep = StepPlan & { Body: MDXContent }` — `chapter/types.ts`에 더한다(`MDXContent`는 `mdx/types`).
  - `chapters.ts`:
    ```ts
    export type ChapterEntry = {
      number: number;
      title: string;
      summary: string;
      // 검수(사실 대조·사용자 읽기)를 마쳐야 reviewed다. 그 전에는 목차에 "검수 중"으로 보인다.
      status: 'soon' | 'review' | 'reviewed';
      load?: () => Promise<ChapterContent>;
    };
    export const CHAPTERS: readonly ChapterEntry[];
    ```
    0~7장 제목·요약은 상위 설계 2장 표 그대로다. 이 태스크에서는 모두 `'soon'`이고 `load`가 없다.
  - `chapter.html?n=<번호>`: 번호가 없거나 `CHAPTERS`에 없으면 "없는 챕터다"와 목차 링크, `load`가 없으면 "준비 중"을 보인다. 챕터 화면 자체는 Task 6.

- [ ] **Step 1: 의존성을 설치한다**

`npm view`로 버전을 조회한 뒤 `apps/web`에 설치한다. `@eeennsu/web`는 `--save-exact`로 `0.5.0`.
- dependencies: `@eeennsu/web@0.5.0`, `tailwindcss`(4.1 이상)
- devDependencies: `@tailwindcss/vite`, `@mdx-js/rollup`, `@types/mdx`

2026-10-25 조회 기준 최신은 tailwindcss·@tailwindcss/vite 4.3.3, @mdx-js/rollup 3.1.1, @types/mdx 2.0.14다. 설치할 때 다시 조회한다.

- [ ] **Step 2: Vite·TS 설정과 진입점을 만든다**

- `vite.config.ts`: `{ enforce: 'pre', ...mdx() }`를 `react()` 앞에, `tailwindcss()`를 더한다. `rollupOptions.input`에 `chapter: 'chapter.html'`.
- `site.css`는 `@import "@eeennsu/web/themes/base.css";` 한 줄이다. 브랜드 색 재선언은 Task 8에서 사용자가 고른다. `site/main.tsx`와 `chapter/main.tsx`만 import한다.
- `SiteHome`: `CHAPTERS`를 목록으로 보인다. `'soon'`은 "준비 중"(링크 없음), `'review'`는 링크 + "검수 중" `Badge`, `'reviewed'`는 링크. 놀이터 링크(`emulator.html`)를 남긴다. DS `Stack`·`Text`·`Card`·`Badge`로 조립하고 시각 결정은 하지 않는다(Task 8).

- [ ] **Step 3: 웹 UI 플러그인과 스킬 선택표를 켠다** (전역 지시, 설계 6장)

- `.claude/settings.json`: `{ "enabledPlugins": { "impeccable@impeccable": true, "ui-ux-pro-max@ui-ux-pro-max-skill": true } }`
- `CLAUDE.md`에 두 줄: `@~/my-agent-setup/docs/web.md`, "디자인 작업(design-flow)은 `apps/web`에서 세션을 연다. 훅이 처음 만나는 `package.json`만 본다."

- [ ] **Step 4: 확인한다**

Run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` → 통과
Run: `pnpm --filter @amulator/web build` → `dist/index.html`, `dist/emulator.html`, `dist/chapter.html`이 생긴다
Run: `pnpm build:plugin && pnpm smoke:plugin` → 통과(놀이터가 그대로다)
개발 서버를 띄워 `agent-browser`로 `/`(목차 8개, 모두 준비 중), `/chapter.html?n=2`(준비 중), `/chapter.html?n=9`(없는 챕터), `/emulator.html`(지금과 같은 모습)을 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add apps/web .claude/settings.json CLAUDE.md pnpm-lock.yaml
git commit -m "feat: DS 0.5.0과 MDX를 들이고 목차와 챕터 진입점을 만든다"
```

본문에 설치한 정확한 버전들을 적는다.

---

### Task 5: 2장 단계 데이터

**Files:**
- Create: `apps/web/src/chapters/ch2-cpu/steps.ts`
- Test: `apps/web/test/ch2Steps.test.ts`

**Interfaces:**
- Consumes: Task 3 `StepPlan`, `createStepRunner`, 하네스
- Produces: `CH2_STEPS: readonly StepPlan[]` — 5개, 순서와 뜻은 설계 4장 표 1~5행이다. 모두 `program: 'clock'`.

설계 4장에서 데이터로 옮기는 것:

| # | title | start | tab | actions |
|---|---|---|---|---|
| 1 | 명령어 하나 꺼내기 | `entry` | `memory` | 한 단계 1개 |
| 2 | 해석하고 실행하기 | `la sp` 앞(= 진입 주소, `entry`) | `registers` | `la sp`(auipc·addi), `la t0`, `csrw mtvec`을 한 단계씩 |
| 3 | 반복과 분기 | `.bss` 반복 첫 `bgeu` 앞 | `registers` | 반복 한 바퀴(`bgeu`·`sw`·`addi`·`j`)를 한 단계씩, 이어서 한 바퀴 더 |
| 4 | 값을 바꿔 보기 | 고른 주소 앞 | `registers` | 레지스터 하나를 `setRegister`로 고치고, 결과가 보이는 주소까지 `runTo` |
| 5 | 트랩 | `running` | `registers` | `runTo trap_entry` → `runTo mret` → 한 단계 1개(mepc로 돌아감) |

- 주소와 `expect`는 clock.elf의 실제 역어셈블에서 고른다. `findToolchain()`의 clang 폴더에 있는 `llvm-objdump -d -M no-aliases guest/baremetal/out/clock.elf`로 목록을 보고, `expect`에는 core `disassemble(word, address)`가 내는 글을 그대로 적는다(테스트가 대조한다). 주소 상수 옆에 그 명령을 주석으로 단다.
- 4단계는 "고친 값이 터미널 글자나 레지스터로 바로 보이는 것"을 고른다. 예: `handle_trap`에서 `put_uint`를 부르기 직전 인자 레지스터를 고쳐 `uptime:` 숫자가 달라지게 한다. 고른 이유를 주석 한 줄로 단다.
- `label`은 버튼 글이다("한 단계", "트랩까지 실행" 등). 다듬기는 Task 7에서 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`ch2Steps.test.ts`, clock.elf 바이트를 읽어 core `disassemble`로 대조하고, 하네스 + `createStepRunner`로 실제로 돌린다)

```ts
it.each(codeAddresses(CH2_STEPS))('$address는 $expect다', ({ address, expect: text }) => {
  expect(disassemble(wordAt(CLOCK, address), address)).toBe(text);
});

it.each(CH2_STEPS.map((step, index) => [index + 1, step] as const))(
  '%i단계는 시작 상태를 만들고 해 보기가 모두 된다',
  async (_, step) => {
    const start = await runner.prepare(step.start);
    expectStart(start, step.start); // entry: 멈춤 + ENTRY, runTo: 멈춤 + 그 주소, running: 실행 중
    let view = start;
    for (const action of step.actions) {
      if (action.kind === 'runTo') {
        // runTo 해 보기는 지금 pc와 다른 주소로 간다
        expect(view.paused ? view.cpu.pc : undefined).not.toBe(action.address);
      }
      view = await runner.perform(action);
      if (action.kind === 'runTo') expect(view.cpu.pc).toBe(action.address);
    }
  },
);

it('3단계 반복은 a0을 4씩 키우고 pc를 되돌린다', ...); // 한 바퀴 전후 a0 차이 4, 끝의 pc가 bgeu 주소
it('5단계는 mcause가 타이머 인터럽트이고 mepc가 돌아올 주소다', ...); // trap_entry에서 mcause = 0x80000007, mret 뒤 한 단계의 pc = 그때의 mepc
```

`codeAddresses`는 각 단계의 `start`와 `actions`에서 `runTo`를 모은다. `wordAt`은 ELF 세그먼트에서 주소의 4바이트를 리틀엔디언으로 읽는다(`parseElf32` 사용).

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @amulator/web test -- ch2Steps`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: `CH2_STEPS`를 쓴다**

- [ ] **Step 4: 테스트를 돌린다**

Run: `pnpm --filter @amulator/web test` → PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/chapters/ch2-cpu/steps.ts apps/web/test/ch2Steps.test.ts
git commit -m "feat: 2장 CPU 단계의 시작 상태와 해 보기를 정한다"
```

---

### Task 6: 챕터 화면 틀

**Files:**
- Create: `apps/web/src/chapter/ChapterPage.tsx` (두 열 배치, 단계 상태, 실행기 배선)
- Create: `apps/web/src/chapter/EmulatorColumn.tsx` (화면·터미널 자리, 실행 줄, 들여다보기 탭)
- Create: `apps/web/src/chapter/RegisterTable.tsx`, `MemoryView.tsx`, `DeviceLog.tsx`
- Create: `apps/web/src/chapter/StepList.tsx` (단계 카드, `Try`·`More`·`Quiz` MDX 컴포넌트와 그 context)
- Create: `apps/web/src/chapter/changes.ts`
- Create: `apps/web/src/chapters/ch2-cpu/content.ts`, `1-fetch.mdx` … `5-trap.mdx`, `android.mdx` (본문은 한 줄 자리표시, 글은 Task 7)
- Modify: `apps/web/src/chapter/main.tsx`, `apps/web/src/site/chapters.ts` (2장: `status: 'review'`, `load`)
- Test: `apps/web/test/changes.test.ts`

**Interfaces:**
- Consumes: Task 2 `useEmulator({ persist, startPaused })`, Task 3 `createStepRunner`·`waitFor`, Task 4 `ChapterContent`·`CHAPTERS`, Task 5 `CH2_STEPS`, core `disassemble`·`ABI_REGISTER_NAMES`·`INSPECTED_CSRS`
- Produces:
  - `changedFields(previous: CpuView | undefined, next: CpuView): ReadonlySet<string>` — 키는 `'pc'`, `'x0'`~`'x31'`, `InspectedCsr` 이름. `previous`가 없으면 빈 집합.
  - `content.ts`: `CH2_CONTENT: ChapterContent` (`CH2_STEPS[i]`에 `Body`를 붙이고 `Android`)

화면 동작(설계 3·4장):
- `useEmulator({ program: steps[current].program, token: null, persist: false, startPaused: true })`. 에뮬레이터 화면은 Tabs **밖**에 둔다.
- 첫 `booted`(= `elf`가 생김) 뒤와 `current`·"처음으로" 요청이 바뀔 때마다 `prepare(steps[current].start)`를 부르고, 그 단계의 `tab`을 연다. effect 의존성에는 `elf` 객체가 아니라 `elf !== undefined`를 쓴다(reset마다 `booted`가 새 객체를 만든다).
- 실행기를 부르는 동안 `busy`. 그동안 단계 전환, [이 단계 처음으로], [해 보기], 실행 줄 버튼을 모두 막는다. 실행기의 거부·시간 초과는 상태 줄에 글로 보인다.
- 실행 줄: [멈춤]·[한 단계]·[계속](`pause`·`step 1`·`resume`), 현재 pc(8자리 hex)와 그 명령의 역어셈블 한 줄. 멈춘 상태가 올 때마다 `peek(pc, 4)` → `DataView.getUint32(0, true)` → `disassemble`. 실행 중이면 "실행 중", `cpu.idle`이면 "쉬는 중(wfi)" `Badge`.
- 강조: 연속한 **멈춘** 상태 둘을 `changedFields`로 비교한다. `state`가 `undefined`가 되면(booted) 기준을 버린다. 그래서 시작 상태를 만든 직후에는 강조가 없다. 바뀐 칸은 `font-semibold text-fg-brand`와 화면 낭독기용 `(바뀜)`(`sr-only`)이다. 모양은 Task 8에서 다듬는다.
- 레지스터 탭: DS `Table`. pc, x0~x31(`x5 t0`처럼 번호와 ABI 이름), `INSPECTED_CSRS`. 값은 8자리 hex.
- 메모리 탭: pc가 든 16바이트 줄과 그 앞뒤 줄, 32바이트를 `max(RAM_BASE, pc - (pc % 16) - 16)`부터 `peek`한다. 주소·16바이트 hex 표, pc의 4바이트를 강조한다.
- 장치 기록 탭: 이 탭이 열려 있을 때만 `trace: true`, 닫으면 `false`. `accesses`의 최근 32개를 `Table`(장치, 읽기·쓰기, 주소, 폭, 값)로 보인다.
- 단계 카드: `current`만 펼친다. `reached`(가 본 가장 뒤 단계) 이하의 다른 카드는 `✓ 제목`으로 접혀 있고 펼치면 그 단계가 `current`가 된다. 그 뒤 카드는 제목만 흐리게 보이고 열 수 없다. 펼친 카드는 `Prose` 안에 `Body`를 `components={{ Try, More, Quiz, CodeBlock }}`로 그리고, 아래에 [이 단계 처음으로]와 [다음 단계](마지막 단계는 없음).
- `Try`: 그 단계 `actions`의 다음 하나를 `label`로 보이는 `Button`. 누르면 `perform`하고 다음으로 넘어간다. 다 했으면 숨는다. "처음으로"가 순번을 되돌린다.
- `More`: `Collapsible label='더 읽기'`. `Quiz`: `question` prop을 `label`로 쓰는 `Collapsible`, `children`이 답.
- 단계 목록 아래 `Card` 안 `Collapsible label='진짜 안드로이드 에뮬레이터는'`에 `Android`. 기본 접힘.
- 데스크톱은 왼쪽 넓게·오른쪽 좁게 두 열, 좁은 화면은 에뮬레이터 열 → 단계 흐름 순으로 쌓는다. 레이아웃 유틸리티(`grid`, `lg:grid-cols-*`, `gap-*`)만 쓰고 간격 값은 Task 8에서 정한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`changes.test.ts`)

```ts
it('이전 상태가 없으면 아무것도 강조하지 않는다', () => {
  expect(changedFields(undefined, view({ pc: ENTRY }))).toEqual(new Set());
});

it('바뀐 pc, 레지스터, CSR만 고른다', () => {
  const before = view({ pc: ENTRY, x: { 2: 0 }, csr: { mtvec: 0 } });
  const after = view({ pc: ENTRY + 4, x: { 2: 0x8400_0000 }, csr: { mtvec: 0x8000_0044 } });
  expect(changedFields(before, after)).toEqual(new Set(['pc', 'x2', 'mtvec']));
});
```

`view`는 테스트 안 도우미로, 빈 `CpuView`에 일부만 덮는다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @amulator/web test -- changes` → FAIL

- [ ] **Step 3: `changedFields`와 화면을 구현한다**

- [ ] **Step 4: 확인한다**

Run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` → 통과
개발 서버 + `agent-browser`로 `/chapter.html?n=2`에서 확인한다(개발 모드 StrictMode 이중 마운트 포함):
- 1단계: 멈춘 채 pc `80000000`, 메모리 탭이 열려 있고 그 4바이트가 강조된다. [해 보기] → pc `80000004`, 역어셈블 줄이 바뀐다.
- 2·3·5단계 [해 보기]를 끝까지 누른다. 5단계에서 트랩 진입 때 멈추고 mcause·mepc가 레지스터 탭에 보이며, 터미널에 `uptime:` 줄이 이어진다.
- 아무 단계에서 [계속] → [멈춤]으로 흐트러뜨린 뒤 [이 단계 처음으로] → 시작 상태로 돌아온다. 지난 카드를 펼쳐도 같다.
- 시작 상태를 만드는 동안 버튼이 막혀 있다.
- 콘솔에 오류가 없다.

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src apps/web/test/changes.test.ts
git commit -m "feat: 챕터 화면 틀과 2장 화면을 만든다"
```

---

### Task 7: 2장 글 작성과 검수

**Files:**
- Modify: `apps/web/src/chapters/ch2-cpu/1-fetch.mdx` … `5-trap.mdx`, `android.mdx`
- Modify: `apps/web/src/chapters/ch2-cpu/steps.ts` (버튼 `label` 다듬기만, 주소·동작은 그대로)
- Modify: `apps/web/src/site/chapters.ts` (검수를 마치면 2장 `status: 'reviewed'`)

**Interfaces:**
- Consumes: Task 6 MDX 컴포넌트 `Try`, `More`, `Quiz`(`question` prop), `CodeBlock`

글 규칙(설계 4·7장, 상위 설계 1장):
- 독자는 저수준 지식이 없는 웹·앱 개발자다. 목표는 "CPU는 명령어를 하나씩 꺼내 해석하고 실행한다", "트랩은 하던 일을 멈추고 정해진 주소로 갔다가 돌아오는 것"을 자기 말로 설명하는 수준이다. 사양 세부(mret 뒤 MPIE 값 등)는 다루지 않는다.
- 카드 하나는 짧은 설명 3~4줄 + 필요하면 `<More>` + `<Try />` + 확인 질문 1~2개(`<Quiz question='…'>답</Quiz>`).
- 재료: 이 레포 코드(`guest/baremetal/*.S`·`clock.c`, `packages/core/src/cpu/cpu.ts`·`machine.ts`), `docs/guides`, `docs/rea`, `docs/research`.
- `android.mdx`: QEMU의 TCG(명령어 묶음을 호스트 코드로 번역)와 이 에뮬레이터의 한 개씩 해석을 비교한다. QEMU·AOSP 소스 링크마다 확인일(작성한 날)을 단다. 링크와 문장은 작성할 때 조회하고, 확인하지 못한 것은 쓰지 않는다.

- [ ] **Step 1: 다섯 단계 글과 비교 상자를 쓴다** (sonnet 서브에이전트에 맡길 수 있다)

- [ ] **Step 2: `korean-humanizer`로 한 번 다듬는다** (전역 지시)

- [ ] **Step 3: 사실 대조를 맡긴다** (opus 리뷰어, 설계 7장)

리뷰어에게 MDX 6개, `steps.ts`, 위 재료 경로를 넘긴다. 문장마다 코드·출처와 맞는지, 외부 사실에 URL과 확인일이 있는지를 보고 틀린 문장 목록을 받는다. 지적을 고치고, 고친 diff만 다시 보게 한다.

- [ ] **Step 4: 확인한다**

Run: `pnpm format:check && pnpm test` → 통과(MDX가 prettier를 통과한다)
`agent-browser`로 2장을 처음부터 끝까지 넘기며 `<Try />`·`<Quiz>`·`<More>`가 제자리에 있는지 본다.

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/chapters/ch2-cpu
git commit -m "docs: 2장 CPU 글과 확인 질문, 비교 상자를 쓴다"
```

- [ ] **Step 6: 사용자 읽기 — 사용자를 기다린다**

사용자에게 개발 서버 주소(`/chapter.html?n=2`)를 주고 학습자로서 읽어 달라고 한다. 이해 안 되는 곳을 받으면 고치고 Step 4를 다시 돌린다. 사용자가 통과라고 하면 `chapters.ts`의 2장을 `status: 'reviewed'`로 바꾼다.

```bash
git add apps/web/src/chapters/ch2-cpu apps/web/src/site/chapters.ts
git commit -m "docs: 사용자 읽기를 반영하고 2장을 검수 완료로 표시한다"
```

---

### Task 8: 디자인 마무리와 최종 확인 (메인 세션)

**Files:**
- Modify: `apps/web/src/site/site.css` (브랜드 색 재선언), `apps/web/src/chapter/*.tsx`, `apps/web/src/site/SiteHome.tsx` (다듬기)
- Modify: `docs/superpowers/followups/2026-10-22-amulator-site-s1.md` (처리한 항목 지우기), Create: `docs/superpowers/followups/2026-10-25-amulator-site-s2-ch2.md`

서브에이전트에 맡기지 않는다. design-flow는 사용자와 주고받는 단계(브랜드 색)가 있다.

- [ ] **Step 1: design-flow를 켤 세션을 준비한다**

design-flow 훅은 세션 폴더에서 처음 만나는 `package.json`만 본다(설계 6장). 사용자에게 `apps/web`을 작업 폴더로 한 세션을 열어 달라고 한다. 그 세션에서 design-flow와 impeccable 스킬이 목록에 뜨는지 본다. 안 뜨면 `node ~/my-agent-setup/scripts/fix-plugin-symlinks.mjs`를 돌리고, 그래도 안 뜨면 `apps/web/.claude/settings.json`에도 Task 4의 `enabledPlugins`를 넣는다.

- [ ] **Step 2: design-flow "디자인 마무리"를 돌린다**

다듬기 → 모션 → 비평·감사 → 실제 화면 확인 → 마무리 검사 → 기록. 대상은 목차와 챕터 화면이다(놀이터 제외). 브랜드 색은 그 자리에서 멈추고 사용자에게 묻는다. 정한 색은 `site.css`에 DS README의 3블록(라이트 `:root`, `.dark`, `prefers-color-scheme: dark`) 형식으로 넣는다. 터미널 크기, 바뀐 값 강조, 레지스터·메모리 표 모양도 이 단계에서 정한다.

Expected: 마무리 검사(className 임의값, 하드코딩 hex, fontFamily 리터럴, DS 스케일 밖 간격) 0건.

- [ ] **Step 3: 성공 기준을 끝에서 끝까지 확인한다** (설계 8장)

Run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` → 통과
Run: `pnpm build:plugin && pnpm smoke:plugin` → 통과
Run: `pnpm e2e` → 통과
`agent-browser`로:
- 목차 → 2장 → 1~5단계 [해 보기]를 차례로 끝까지, 비교 상자를 펼친다. 5단계에서 트랩 진입 때 멈추고 mcause·mepc가 보인다.
- 아무 단계에서 [계속]으로 흐트러뜨린 뒤 [이 단계 처음으로], 지난 단계 다시 펼치기 → 시작 상태로 돌아온다.
- 놀이터 저장본: `emulator.html?program=clock`에서 Save → 2장을 열고 단계 몇 개를 쓴다 → `emulator.html?program=clock`을 다시 열면 상태 줄이 "스냅샷에서 복원했다"다.
- 좁은 화면(모바일 폭)에서 에뮬레이터 열 → 단계 흐름 순으로 쌓이고 [해 보기]가 된다.

- [ ] **Step 4: 후속 목록을 정리한다**

S1 후속 목록에서 이번에 처리한 항목(공유 스냅샷 저장소, wfi 중 step, reset 뒤 booted 계약, DS Tabs와 에뮬레이터 화면 위치, design-flow 세션 위치)을 지운다. 새 파일에는 이번에 미룬 것(장치 기록 필터, `peekMemory` `>>> 0`, 단계별 프로그램 전환 미검증, 리뷰가 남긴 지적)을 적는다.

- [ ] **Step 5: 커밋**

```bash
git add apps/web docs/superpowers/followups
git commit -m "feat: 목차와 챕터 화면을 design-flow로 다듬는다"
```
