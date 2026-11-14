# amulator 챕터 화면 가독성 구현 계획: 위 띠와 동작 박자 카드

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1900x940에서 2장의 "왜" 글, 지금 누를 버튼, 바뀐 값 앞→뒤, 표에서 그 값이 있는 줄이 스크롤 없이 보이게 왼쪽 열과 해 보기 카드를 바꾸고, 2장 글을 그 틀에 맞게 고쳐 검수까지 끝낸다.

**Architecture:** 장이 `ChapterContent.screen`(`'small' | 'full'`)으로 화면 크기를 선언하고, `'small'`이면 `EmulatorColumn`이 canvas를 줄여 터미널 옆에 둔 위 띠와 4쌍 레지스터 표를 그린다(4쌍·2쌍은 CSS로 하나를 숨긴다). 동작 객체(`TryAction`)에 `line`과 `look`을 더하고, `<Try />`는 동작 목록 전체를 그리되 방금 한 동작과 다음 동작만 펼친다. 값 표의 줄은 순수 함수 `beatTable`이 만든다.

**Tech Stack:** TypeScript, React 19, `@eeennsu/web` 0.5.0, Tailwind CSS 4, MDX 3, Vitest 5, agent-browser.

**Spec:** [docs/superpowers/specs/2026-11-14-amulator-chapter-readability-design.md](../specs/2026-11-14-amulator-chapter-readability-design.md). 바꾸는 설계 [2026-10-25-amulator-site-s2-ch2-design.md](../specs/2026-10-25-amulator-site-s2-ch2-design.md) 3장(나머지 4~9장은 그대로), 이어 받는 목록 [followups/2026-10-25-amulator-site-s2-ch2.md](../followups/2026-10-25-amulator-site-s2-ch2.md).

**빌더 결정(설계 10장):**
- 4쌍·2쌍은 두 표를 모두 그리고 CSS(`hidden xl:block` / `xl:hidden`)로 하나를 숨긴다. 미디어 쿼리 훅을 만들지 않는다. 화면 크기를 바꿔도 다시 마운트되는 것이 없다.
- 줄인 canvas의 첫 크기는 `w-24`(96px 폭, 비율대로 144px 높이)다. DS 고정 폭은 96px까지라 시안의 121px는 없다. 최종 크기는 Task 5 다듬기가 정한다.
- 레지스터 배치 계산은 `registerGrid.ts`의 순수 함수로 빼서 테스트한다.
- `hintText`·`resultText`는 지우고 `tryText.ts`에 `lookText`·`beatTable`·`beatText`를 둔다. `TAB_LABELS`·`isInspectTab`은 `EmulatorColumn.tsx`에서 `format.ts`로 옮긴다(`tryText.ts`가 같은 이름을 쓴다).
- 낭독은 늘 있는 `role='status'` 영역(`sr-only`)에 `beatText` 한 줄을 넣는다. 목록 전체를 status로 감싸면 status의 `aria-atomic`이 목록을 통째로 다시 읽는다.
- "볼 곳"·"외 n개" 문구의 첫 안은 아래 테스트 값이고, 확정은 Task 4 사용자 읽기에서 한다.

**범위 밖:** 설계 2장 비목표 전부(더 읽기 재구성, 글 속 이름 누르기, 답 잠금, `'full'` 장의 새 배치, "볼 곳" 미리 표시, 글 예산 테스트, 메모리 표 8바이트 줄, 터미널 크기 옵션, 후속 목록의 다른 항목, 모바일 최적화).

## Global Constraints

- 코드를 쓰기 전에 conventions 스킬을 읽는다(레포 `CLAUDE.md`). 타입은 `type`, 화살표 함수, named export, enum 대신 `as const`, 매직넘버는 UPPER_SNAKE 상수다. MDX 파일의 default export는 예외다.
- 화면은 DS `@eeennsu/web` 0.5.0 컴포넌트(`Stack`, `Box`, `Text`, `Button`, `Badge`, `Table`, `Tabs`, `Card`, `Prose`, `Collapsible`, `Icon`)로 조립한다. 사이트 안에 범용 UI를 따로 만들지 않는다. 새 의존성을 더하지 않는다.
- className 임의값(`mt-[13px]`), 하드코딩 hex, `fontFamily` 리터럴, DS 스케일 밖 간격(허용: 0 1 2 3 4 6 8 12 16 20 24)을 쓰지 않는다. 색은 semantic 토큰 클래스만 쓴다. `style` prop을 쓰지 않는다.
- `screen: 'full'`일 때 왼쪽 열(canvas → 터미널 → 상태 → 실행 줄 → 탭, 2쌍 표)은 지금과 한 글자도 다르지 않다.
- canvas 자리(`screenRef`)와 터미널 자리(`terminalRef`)는 다시 마운트하지 않는다. 둘은 Tabs 밖에 두고, 탭 전환·동작·창 크기 변경 어느 것도 에뮬레이터를 다시 켜지 않는다.
- 왼쪽 [멈춤]·[한 단계]·[계속]은 들여다보기 탭을 바꾸지 않는다. 탭을 여는 것은 [해 보기] 버튼(그 동작의 `look.place`)과 단계 진입·처음 상태로(`step.tab`)뿐이다.
- MDX 컴포넌트 목록(`Try`, `More`, `Quiz`, `Checks`, `CodeBlock`)을 늘리지 않는다.
- 지난 단계 줄을 접거나 옮기기, 페이지 머리 줄이기, 누를 때 자동 스크롤은 사용자 결정 없이 하지 않는다.
- 놀이터(`emulator.html`, `src/emulator/*`, `emulator.css`)와 MCP 모드는 건드리지 않는다.
- `docs/learn/`은 만들거나 고치지 않는다.
- 파일은 Edit·Write 도구로 고친다. node 스크립트, `sed`, `pnpm format`, `prettier --write`로 고치지 않는다. 포맷 검사가 지적하면 Edit로 맞춘다.
- 개발 서버처럼 끝나지 않는 실행은 따로 띄우고 로그로 본다. PID는 로그 옆 파일에 적고 그 PID만 끈다. Git Bash로 띄웠으면 Git Bash `kill`로 끈다.
- 기준 화면은 1900x940(agent-browser `set viewport 1900 940`)이다.
- 문서·주석·사이트 글은 한국어 '-다'체다. 커밋 제목은 50자 안쪽 명사형이고 접두어는 `feat:` `fix:` `refactor:` `update:` `chore:` `docs:`만 쓴다.
- 태스크 완료 조건: `pnpm typecheck`, `pnpm lint`, 포맷 검사, `pnpm test` 통과. `eslint-disable`로 막지 않는다.
- 포맷 검사는 `pnpm exec prettier --check apps packages docs`로 한다. 이 체크아웃의 `pnpm format:check`는 `.claude/worktrees/`·`.superpowers/` 파일 10개 때문에 지금도 실패한다. 두 폴더는 `.git/info/exclude`로만 무시돼 prettier가 거르지 못한다. 그 10개는 고치지 않는다.
- 테스트 하나만 돌릴 때는 `pnpm --filter @amulator/web exec vitest run <이름>`을 쓴다. `pnpm --filter @amulator/web test -- <이름>`은 필터가 먹지 않아 전체가 돈다.

## Review Focus

1. **창 크기를 `xl` 경계 너머로 바꾸거나 탭을 바꾼다.** 4쌍·2쌍 전환이나 탭 전환이 canvas·터미널 자리를 다시 마운트하면 에뮬레이터가 다시 켜지고 터미널이 비워진다. 터미널 내용이 그대로 남아야 한다. → Task 1 Step 6 브라우저 확인
2. **앞 상태가 실행 중인 동작**(5단계 [trap_entry까지 실행]). 비교할 앞 값이 없다. 앞 값 없이 뒤 값만, `look.fields` 다음에 `pc`를 보여야 하고 "외 n개"를 지어내지 않는다. → Task 2 테스트 `앞 상태가 멈춘 상태가 아니면 뒤 값만 보이고 pc를 붙인다`
3. **바뀐 값이 많은 동작**(4단계 [uptime 출력까지 실행], `a0`~`a6`). 표가 일곱 줄로 불어나면 카드가 첫 화면을 넘는다. `look.fields`와 `pc` 밖은 "외 n개" 한 줄이다. → Task 2 테스트 `look.fields 밖에서 바뀐 값은 more로 센다`
4. **`look.fields`에 `pc`가 있거나, 적은 값이 안 바뀌었다.** `pc` 줄이 두 번 나오거나 적은 줄이 사라지면 "볼 곳"과 값 표가 어긋난다. → Task 2 테스트 `look.fields의 값은 안 바뀌어도 보이고 pc는 두 번 붙지 않는다`
5. **왼쪽 [한 단계]·[계속]을 누른다.** 해 보기 순번(`done`)이 오르거나 학습자가 연 탭이 바뀌면 안 된다. 값 표도 그대로다. → Task 2 Step 7 브라우저 확인

---

### Task 1: 왼쪽 열 위 띠와 4쌍 레지스터 표

**Files:**
- Modify: `apps/web/src/chapter/types.ts` (`ScreenSize`, `ChapterContent.screen`)
- Modify: `apps/web/src/chapters/ch2-cpu/content.ts` (`screen: 'small'`)
- Create: `apps/web/src/chapter/registerGrid.ts`
- Modify: `apps/web/src/chapter/RegisterTable.tsx` (`perRow` prop, `registerGrid` 사용)
- Modify: `apps/web/src/chapter/EmulatorColumn.tsx` (`screen` prop, 위 띠, 4쌍·2쌍)
- Modify: `apps/web/src/chapter/ChapterPage.tsx` (`screen` 전달)
- Test: `apps/web/test/registerGrid.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `ScreenSize = 'small' | 'full'`, `ChapterContent = { screen: ScreenSize; steps: ChapterStep[]; Android: MDXContent }`
  - `registerGrid.ts`: `Register = { key: string; name: string; value: number }`, `registerGrid(cpu: CpuView, perRow: number): (Register | undefined)[][]` — `pc`와 `INSPECTED_CSRS`를 이 순서로 `perRow`개씩 끊어 줄을 만들고, 그 아래 x 레지스터를 `perRow`개 세로 칸으로 나눈다(줄 수 `rows = 32 / perRow`, r번째 줄은 `x[r], x[r + rows], x[r + 2·rows], …`). 모자란 칸은 `undefined`. `name`은 지금처럼 `x10 a0`, `pc`, CSR 이름이다.
  - `RegisterTable` props: `{ cpu: CpuView; changed: ReadonlySet<string>; perRow: 2 | 4 }`
  - `EmulatorColumn` props: 지금 props + `screen: ScreenSize`

**design-flow 브리프** (구현 단계, 라우터가 DS 컴포넌트로 직접 한다)
- DS 규칙: `apps/web/node_modules/@eeennsu/web/README.md`의 `## 소비 규칙`. 정본 디자인 문서는 없다.
- DS가 기존 시각 체계(established world)다. 새 정본 파일·토큰 사본·로컬 디자인 시스템을 만들지 않는다.
- DS 스케일에 없는 값을 임의값으로 메우지 않는다.
- DS가 가진 축(컴포넌트 형태, 폰트, 눌림·포커스 피드백, 다크 방식)에 대한 지적은 고치지 않고 'DS 피드백'으로 돌려준다(`docs/ds-feedback.md`에 적을 거리로 보고).
- 디자인 스킬은 커밋하지 않는다. 이 태스크의 커밋은 Step 7이 한다.
- 정본 디자인 문서에 값을 적을 일이 생기면 사용자 결정이 아니라 권장안으로 적는다.
- 이번 단계가 할 일: `EmulatorColumn.tsx`의 `screen: 'small'` 배치(설계 3장 그림). 위 띠 = 줄인 canvas(`w-24 shrink-0`) + 터미널, 그 아래 상태 줄·알림·실행 줄·탭. 레지스터 탭은 `xl` 이상에서 4쌍, 미만에서 2쌍. `lg` 미만에서는 띠가 줄바꿈된다. 간격·canvas 크기의 최종값은 Task 5가 정한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`registerGrid.test.ts`)

`cpu`는 테스트 안 도우미로, `x`는 32개 0, `csr`는 `INSPECTED_CSRS` 여섯이 0인 `CpuView`다. `keys(grid)`는 각 칸을 `key`나 `undefined`로 바꾼다.

```ts
it('4쌍이면 제어 레지스터 두 줄과 x 레지스터 여덟 줄이다', () => {
  const grid = keys(registerGrid(cpu(), 4));
  expect(grid).toHaveLength(10);
  expect(grid[0]).toEqual(['pc', 'mstatus', 'mtvec', 'mepc']);
  expect(grid[1]).toEqual(['mcause', 'mie', 'mip', undefined]);
  expect(grid[2]).toEqual(['x0', 'x8', 'x16', 'x24']);
  expect(grid[9]).toEqual(['x7', 'x15', 'x23', 'x31']);
});

it('2쌍이면 지금 표와 같은 배치다', () => {
  const grid = keys(registerGrid(cpu(), 2));
  expect(grid).toHaveLength(20);
  expect(grid[3]).toEqual(['mip', undefined]);
  expect(grid[4]).toEqual(['x0', 'x16']);
  expect(grid[19]).toEqual(['x15', 'x31']);
});

it('x 레지스터 이름은 번호와 ABI 이름이다', () => {
  expect(registerGrid(cpu(), 4)[4]?.[1]).toMatchObject({ key: 'x10', name: 'x10 a0' });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @amulator/web exec vitest run registerGrid` → FAIL(`registerGrid.ts`가 없다)

- [ ] **Step 3: `registerGrid`를 구현하고 `RegisterTable`이 쓰게 한다**

`RegisterTable`의 열 머리는 `[{ label: '이름' }, { label: '값', align: 'end' }]`를 `perRow`번 되풀이한다. 지금 파일 맨 위 주석(한 줄에 둘을 놓는 이유)은 `perRow`에 맞게 고쳐 남긴다.

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `pnpm --filter @amulator/web exec vitest run registerGrid` → PASS

- [ ] **Step 5: `screen`을 배선하고 위 띠를 그린다**

`types.ts`·`content.ts`·`ChapterPage.tsx`(`content.screen`을 `EmulatorColumn`에 넘긴다)·`EmulatorColumn.tsx`. `'full'`이면 지금 JSX와 `perRow={2}` 표를 그대로 둔다. canvas·터미널 `div`는 각각 한 번만 만들고(같은 `ref`), `screen`에 따라 감싸는 틀만 다르다.

- [ ] **Step 6: 확인한다**

Run: `pnpm typecheck && pnpm lint && pnpm exec prettier --check apps packages docs && pnpm test` → 통과
개발 서버(`pnpm --filter @amulator/web dev`, 따로 띄우고 PID 파일)와 agent-browser로 `/chapter.html?n=2`:
- 1900x940: canvas(줄임)와 터미널이 한 줄, 그 아래 상태·실행 줄·탭. 레지스터 탭이 4쌍이고 표 바닥(`getBoundingClientRect().bottom`)이 940 이하다. 값을 재서 보고에 적는다.
- 1280x900: 4쌍 표가 왼쪽 열 안에 든다(표 감싸개의 `scrollWidth <= clientWidth`). 넘치면 값을 보고에 적는다. 경계는 Task 5가 정한다.
- 1200x900: 2쌍 표. 800x900: 띠가 줄바꿈되고 2쌍이다.
- `'full'` 분기: `content.ts`를 잠깐 `screen: 'full'`로 바꿔 1900x940에서 왼쪽 열을 연다. 순서(canvas → 터미널 → 상태 → 실행 줄 → 탭)와 2쌍 표, canvas 폭(`max-w-xs`)이 이 태스크 전 main과 같은지 DOM으로 비교한 뒤 `'small'`로 되돌린다.
- 5단계를 열어 터미널에 `uptime:` 줄이 찍힌 뒤 창을 1900 → 1200 → 1900으로 바꾸고 탭을 레지스터 → 메모리 → 장치 기록 → 레지스터로 돈다. 터미널 내용이 남아 있다(다시 켜지지 않았다).
- 콘솔 오류가 없다.

- [ ] **Step 7: 커밋한다**

```bash
git add apps/web/src/chapter apps/web/src/chapters/ch2-cpu/content.ts apps/web/test/registerGrid.test.ts
git commit -m "feat: 화면 안 쓰는 장의 위 띠 배치와 4쌍 레지스터 표"
```

---

### Task 2: 동작 데이터와 박자 카드

**Files:**
- Modify: `apps/web/src/chapter/types.ts` (`LookPlace`, `FieldKey`, `Look`, `TryAction`에 `line`·`look`)
- Modify: `apps/web/src/chapter/format.ts` (`TAB_LABELS`, `isInspectTab`을 `EmulatorColumn.tsx`에서 옮겨 옴)
- Modify: `apps/web/src/chapter/EmulatorColumn.tsx` (옮긴 것을 import)
- Modify: `apps/web/src/chapter/tryText.ts` (`hintText`·`resultText` 삭제, `lookText`·`beatTable`·`beatText` 추가)
- Modify: `apps/web/src/chapters/ch2-cpu/steps.ts` (모든 동작에 `line`·`look`)
- Modify: `apps/web/src/chapter/StepList.tsx` (`Try`를 동작 목록으로)
- Modify: `apps/web/src/chapter/ChapterPage.tsx` (`last`를 `BeatTable`로, 해 보기가 탭을 연다)
- Modify: `apps/web/src/site/chapters.ts` (2장 `status: 'reviewed'` → `'review'`. 새 `line`은 아직 검수 전이다. Task 4 Step 5가 되돌린다)
- Modify: `apps/web/test/runner.test.ts` (`TryAction` 리터럴 10곳에 `line: ''`, `look: { place: 'runLine' }`. 필수 필드를 선택으로 풀어 이 파일을 살리지 않는다)
- Test: `apps/web/test/tryText.test.ts` (다시 쓴다)

**Interfaces:**
- Consumes: Task 1 `ChapterContent.screen`(손대지 않는다), core `ABI_REGISTER_NAMES`, `InspectedCsr`, 기존 `changedFields`, `formatHex`
- Produces:
  - `types.ts`: `LookPlace = InspectTab | 'runLine' | 'terminal'`, ``FieldKey = 'pc' | `x${number}` | InspectedCsr``, `Look = { place: LookPlace; fields?: readonly FieldKey[] }`, `TryAction = { label: string; line: string; look: Look } & (기존 셋)`
  - `format.ts`: `TAB_LABELS: Record<InspectTab, string>`, `isInspectTab(value: string): value is InspectTab`
  - `tryText.ts`:
    - `lookText(look: Look): string` — 자리 이름(탭은 `` `${TAB_LABELS[place]} 탭` ``, `runLine`은 `실행 줄`, `terminal`은 `터미널`)에 `fields`가 있으면 `의 ` + 보이는 이름들(`, `로 잇는다)
    - `BeatRow = { key: FieldKey; name: string; before: number | undefined; after: number }`, `BeatTable = { rows: readonly BeatRow[]; more: number }`
    - `beatTable(action: TryAction, before: View | undefined, after: View): BeatTable` (`View`는 지금 파일의 그 타입)
      - `setRegister`: 고친 레지스터 한 줄(`target`이 `'pc'`면 키 `pc`, 아니면 `x{target}`), `more: 0`. `look.fields`는 보지 않는다. 앞 상태가 멈춘 상태가 아니면 앞 값은 `undefined`다(실행 중 `state`는 resume 순간의 낡은 값이다)
      - 앞 상태가 없거나 실행 중: `look.fields` 줄과 `pc` 줄(`fields`에 이미 있으면 다시 붙이지 않는다), 앞 값 `undefined`, `more: 0`
      - 그 밖: `look.fields` 줄(안 바뀌어도), 그다음 `pc`(바뀌었고 아직 없을 때), `more`는 `changedFields(before.cpu, after.cpu)` 가운데 줄에 없는 키 수
    - `beatText(label: string, table: BeatTable): string` — 낭독용 한 줄
  - `StepList` props: `last: BeatTable | undefined` (그 밖 그대로)

동작 줄 초안(설계 6장. 3단계는 설계 초안 그대로, 나머지는 이 계획의 초안이다. 확정은 Task 4):

| 단계 | 동작 | `line` | `look` |
|---|---|---|---|
| 1 | 명령어 1개 실행 | `` `pc`가 가리키는 명령어 하나를 실행한다. `` | `{ place: 'memory' }` |
| 2 | la sp 실행 | `` `sp`에 스택 꼭대기 주소를 넣는다. `` | `{ place: 'registers', fields: ['x2'] }` |
| 2 | la t0 실행 | `` `t0`에 `trap_entry`의 주소를 넣는다. `` | `{ place: 'registers', fields: ['x5'] }` |
| 2 | csrw mtvec 실행 | `` `t0`의 값을 `mtvec`에 옮긴다. `` | `{ place: 'registers', fields: ['mtvec'] }` |
| 3 | bgeu 실행 | `` `a0`이 `a1` 이상이면 반복을 빠져나간다. `` | `{ place: 'runLine' }` |
| 3 | sw 실행 | `` `a0`이 가리키는 곳에 0을 쓴다. `` | `{ place: 'runLine' }` |
| 3 | addi 실행 | `` `a0`을 4 올린다. `` | `{ place: 'registers', fields: ['x10'] }` |
| 3 | j 실행 | `맨 위로 돌아간다.` | `{ place: 'runLine', fields: ['pc'] }` (설계 4장 그림 "실행 줄의 pc") |
| 3 | 한 바퀴 더 | `네 줄을 한 번에 돈다.` | `{ place: 'registers', fields: ['x10'] }` |
| 4 | a2를 12345로 고치기 | `` `a2`를 ${FAKE_UPTIME}로 바꾼다. `` (템플릿 리터럴) | `{ place: 'registers', fields: ['x12'] }` |
| 4 | uptime 출력까지 실행 | `` 고친 값으로 `uptime:` 줄을 마저 찍는다. `` | `{ place: 'terminal' }` |
| 5 | trap_entry까지 실행 | `` 타이머 트랩이 들어와 `trap_entry`로 간다. `` | `{ place: 'registers', fields: ['mcause', 'mepc'] }` |
| 5 | mret까지 실행 | `` 핸들러가 `uptime` 줄을 찍고 `mret` 앞에 선다. `` | `{ place: 'terminal' }` |
| 5 | mret 실행 | `` `mepc`의 주소로 돌아간다. `` | `{ place: 'runLine', fields: ['pc'] }` |

카드(설계 4장). `Try`는 `actions` 전체를 순서 있는 목록으로 그린다. `done`은 해 본 동작 수다.
- `i < done - 1`: `Marker state='done' number={i + 1}`, 이름
- `i === done - 1`: `Marker state='done' number={i + 1}`, 이름, `line`, 값 표(`last`의 줄마다 이름과 `formatHex(before) → formatHex(after)`, 앞 값이 없으면 뒤 값만, `more > 0`이면 `외 {more}개` 한 줄)
- `i === done`: `Marker state='current' number={i + 1}`, `Button label={action.label}`(지금처럼 `variant='primary'`, `disabled={busy}`), `line`, `볼 곳: {lookText(look)}`
- `i > done`: `Marker state='upcoming' number={i + 1}`, 흐린 이름
- `line`은 백틱으로 나눈 홀수 조각을 `<code>`로 그린다. 다른 서식은 없다. `Try`는 `Prose` 안이라 `<code>`는 Prose 스타일을 받는다. 목록에 Prose의 목록 표지·들여쓰기가 붙으면 없앤다.
- 다 했으면 목록 아래에 `ALL_DONE_TEXT`, 버튼 없음. 머리의 `해 보기`와 `{done}/{length} 해 봄` 배지는 그대로다.
- `<div role='status' className='sr-only'>`를 늘 두고, `last`가 있으면 그 안에 `beatText(방금 동작의 label, last)`를 넣는다.
- `ChapterPage.perform`: 실행기를 부르기 전에 `isInspectTab(action.look.place)`면 `setTab(action.look.place)`. 성공하면 `last: beatTable(action, before, after)`, 실패하면 지금처럼 `last: undefined`.

**design-flow 브리프** (구현 단계, 라우터가 DS 컴포넌트로 직접 한다)
- DS 규칙: `apps/web/node_modules/@eeennsu/web/README.md`의 `## 소비 규칙`. 정본 디자인 문서는 없다.
- DS가 기존 시각 체계(established world)다. 새 정본 파일·토큰 사본·로컬 디자인 시스템을 만들지 않는다.
- DS 스케일에 없는 값을 임의값으로 메우지 않는다.
- DS가 가진 축(컴포넌트 형태, 폰트, 눌림·포커스 피드백, 다크 방식)에 대한 지적은 고치지 않고 'DS 피드백'으로 돌려준다(`docs/ds-feedback.md`에 적을 거리로 보고).
- 디자인 스킬은 커밋하지 않는다. 이 태스크의 커밋은 Step 8이 한다.
- 정본 디자인 문서에 값을 적을 일이 생기면 사용자 결정이 아니라 권장안으로 적는다.
- 이번 단계가 할 일: `StepList.tsx`의 `Try`를 위 네 상태의 동작 목록으로 바꾼다(설계 4장 그림). 기존 `Marker`를 다시 쓰고, 값 표는 `Stack`·`Text`(`font-mono`는 Tailwind 기본이라 써도 된다)로 짠다. 표의 최종 모양과 문구는 Task 5 다듬기와 Task 4 사용자 읽기가 정한다. 더 읽기, 확인 질문, 다음·처음 상태로 버튼, 지난·남은 단계 줄, 안드로이드 상자는 바꾸지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`tryText.test.ts`를 다시 쓴다)

`view(pc, x = {}, paused = true, csr = {})`는 지금 파일의 도우미를 넓힌 것으로, `x`·`csr`의 일부만 덮는다. `step(look)`·`runTo(look)`·`setRegister(target, value)`는 `label`·`line`을 채운 `TryAction`을 만든다. `setRegister`의 `look`은 일부러 고친 레지스터와 다른 `{ place: 'registers', fields: ['x10'] }`로 둔다(`setRegister` 분기가 `look.fields`를 안 보는지 지킨다).

```ts
describe('lookText', () => {
  it('탭은 탭 이름에 보이는 레지스터 이름을 붙인다', () => {
    expect(lookText({ place: 'registers', fields: ['x10'] })).toBe('레지스터 탭의 a0');
    expect(lookText({ place: 'registers', fields: ['mcause', 'mepc'] })).toBe('레지스터 탭의 mcause, mepc');
  });
  it('실행 줄과 터미널, fields 없는 탭', () => {
    expect(lookText({ place: 'runLine' })).toBe('실행 줄');
    expect(lookText({ place: 'runLine', fields: ['pc'] })).toBe('실행 줄의 pc');
    expect(lookText({ place: 'terminal' })).toBe('터미널');
    expect(lookText({ place: 'memory' })).toBe('메모리 탭');
    expect(lookText({ place: 'memory', fields: [] })).toBe('메모리 탭');
  });
});

describe('beatTable', () => {
  it('바뀐 look.fields 다음에 바뀐 pc를 놓는다', () => {
    expect(
      beatTable(step({ place: 'registers', fields: ['x10'] }), view(0x8000_002c, { 10: 0x8000_0310 }), view(0x8000_0030, { 10: 0x8000_0314 })),
    ).toEqual({
      rows: [
        { key: 'x10', name: 'a0', before: 0x8000_0310, after: 0x8000_0314 },
        { key: 'pc', name: 'pc', before: 0x8000_002c, after: 0x8000_0030 },
      ],
      more: 0,
    });
  });

  it('pc가 안 바뀌면 pc 줄을 붙이지 않는다', () => {
    // 3단계 [한 바퀴 더]: 네 줄을 돌고 bgeu로 돌아와 pc는 그대로, a0만 4 커진다
    expect(
      beatTable(step({ place: 'registers', fields: ['x10'] }), view(0x8000_0024, { 10: 0x8000_0314 }), view(0x8000_0024, { 10: 0x8000_0318 })),
    ).toEqual({
      rows: [{ key: 'x10', name: 'a0', before: 0x8000_0314, after: 0x8000_0318 }],
      more: 0,
    });
  });

  it('look.fields 밖에서 바뀐 값은 more로 센다', () => {
    // a0~a6(x10~x16) 일곱 개가 바뀐다
    const after = view(0x8000_01d4, { 10: 1, 11: 2, 12: 3, 13: 4, 14: 5, 15: 6, 16: 7 });
    expect(beatTable(runTo({ place: 'terminal' }), view(0x8000_0154), after)).toEqual({
      rows: [{ key: 'pc', name: 'pc', before: 0x8000_0154, after: 0x8000_01d4 }],
      more: 7,
    });
  });

  it('look.fields의 값은 안 바뀌어도 보이고 pc는 두 번 붙지 않는다', () => {
    expect(
      beatTable(step({ place: 'runLine', fields: ['x10', 'pc'] }), view(0x8000_0024, { 10: 5 }), view(0x8000_0028, { 10: 5 })),
    ).toEqual({
      rows: [
        { key: 'x10', name: 'a0', before: 5, after: 5 },
        { key: 'pc', name: 'pc', before: 0x8000_0024, after: 0x8000_0028 },
      ],
      more: 0,
    });
  });

  it('앞 상태가 멈춘 상태가 아니면 뒤 값만 보이고 pc를 붙인다', () => {
    const action = runTo({ place: 'registers', fields: ['mcause', 'mepc'] });
    const after = view(0x8000_004c, {}, true, { mcause: 0x8000_0007, mepc: 0x8000_0200 });
    const expected = {
      rows: [
        { key: 'mcause', name: 'mcause', before: undefined, after: 0x8000_0007 },
        { key: 'mepc', name: 'mepc', before: undefined, after: 0x8000_0200 },
        { key: 'pc', name: 'pc', before: undefined, after: 0x8000_004c },
      ],
      more: 0,
    };
    // 앞 view의 a1을 달리 둔다. 실행 중 앞 상태로 바뀐 값을 세면 more가 1이 되어 잡힌다
    expect(beatTable(action, view(0x8000_0200, { 11: 9 }, false), after)).toEqual(expected);
    expect(beatTable(action, undefined, after)).toEqual(expected);
  });

  it('레지스터를 고치면 그 레지스터 한 줄이다', () => {
    expect(beatTable(setRegister(12, 12_345), view(0x8000_0154, { 12: 1 }), view(0x8000_0154, { 12: 12_345 }))).toEqual({
      rows: [{ key: 'x12', name: 'a2', before: 1, after: 12_345 }],
      more: 0,
    });
  });

  it('pc를 고치면 pc 한 줄이다', () => {
    expect(beatTable(setRegister('pc', 0x8000_0100), view(0x8000_0000), view(0x8000_0100))).toEqual({
      rows: [{ key: 'pc', name: 'pc', before: 0x8000_0000, after: 0x8000_0100 }],
      more: 0,
    });
  });

  it('실행 중에 고치면 앞 값이 없다', () => {
    expect(beatTable(setRegister(12, 12_345), view(0x8000_0200, { 12: 1 }, false), view(0x8000_0200, { 12: 12_345 })).rows).toEqual([
      { key: 'x12', name: 'a2', before: undefined, after: 12_345 },
    ]);
  });

  it('표 밖 번호는 x{번호} 이름이다', () => {
    expect(beatTable(setRegister(40, 1), view(0x8000_0000), view(0x8000_0000)).rows[0]).toMatchObject({ key: 'x40', name: 'x40', after: 0 });
  });
});

describe('beatText', () => {
  it('줄마다 앞→뒤를 잇고 외 n개를 붙인다', () => {
    const table = {
      rows: [
        { key: 'x10', name: 'a0', before: 0x8000_0310, after: 0x8000_0314 },
        { key: 'pc', name: 'pc', before: undefined, after: 0x8000_0030 },
      ],
      more: 2,
    } as const;
    expect(beatText('addi 실행', table)).toBe('addi 실행: a0 80000310 → 80000314, pc 80000030, 외 2개');
  });

  it('more가 0이면 외 n개를 붙이지 않는다', () => {
    const table = { rows: [{ key: 'x12', name: 'a2', before: 1, after: 12_345 }], more: 0 } as const;
    expect(beatText('a2를 12345로 고치기', table)).toBe('a2를 12345로 고치기: a2 00000001 → 00003039');
  });
});
```

(위 블록은 줄 길이를 보지 않고 썼다. prettier 모양은 구현자가 맞춘다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @amulator/web exec vitest run tryText` → FAIL(`lookText`·`beatTable`·`beatText`가 없다)

- [ ] **Step 3: 타입, `format.ts` 이동, `tryText.ts`를 구현한다**

`hintText`·`resultText`와 그 테스트는 지운다. `registerName`·`fieldName`은 그대로 쓴다.

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `pnpm --filter @amulator/web exec vitest run tryText` → PASS

- [ ] **Step 5: `steps.ts`에 위 표의 `line`·`look`을 채운다**

Run: `pnpm --filter @amulator/web exec vitest run ch2Steps` → PASS(동작 실행 경로는 그대로다)

- [ ] **Step 6: 카드와 `ChapterPage` 배선을 바꾼다** (위 "카드" 목록)

주석 갱신: `TryState.last`·`Settled.last`의 "결과 한 줄" 주석과 `perform` 실패 분기의 `"방금" 줄` 주석을 값 표로 고친다. `chapters.ts`의 2장을 `status: 'review'`로 내린다.

- [ ] **Step 7: 확인한다**

Run: `pnpm typecheck && pnpm lint && pnpm exec prettier --check apps packages docs && pnpm test` → 통과
agent-browser로 `/chapter.html?n=2`, 1900x940:
- 3단계: 처음엔 1번 버튼·설명·"볼 곳: 실행 줄"이 보이고 2~5번은 흐린 이름이다. [bgeu 실행] → 1번은 ✓·설명·값 표(`pc` 앞→뒤), 2번이 버튼. [addi 실행]까지 → 값 표에 `a0`과 `pc` 줄, 레지스터 탭의 `a0` 강조와 같은 값이다.
- 4단계: [a2를 12345로 고치기] → `a2` 한 줄. [uptime 출력까지 실행] → `pc` 줄과 "외 n개".
- 5단계: [trap_entry까지 실행] → `mcause`·`mepc`·`pc`가 뒤 값만 보인다.
- 2단계에서 메모리 탭을 직접 연 뒤 [la t0 실행] → 레지스터 탭이 열린다.
- 아무 단계에서 왼쪽 [한 단계]·[계속]·[멈춤] → 탭·순번·값 표가 그대로다.
- [↺ 처음 상태로] → 값 표가 사라지고 1번 버튼으로 돌아온다. 모든 동작을 마치면 "다 해 봤다…" 안내만 남고 버튼이 없다.
- 낭독 영역(`role='status'`)에 `beatText` 한 줄이 들어간다(DOM에서 확인).
- 콘솔 오류가 없다.

- [ ] **Step 8: 커밋한다**

```bash
git add apps/web/src/chapter apps/web/src/chapters/ch2-cpu/steps.ts apps/web/src/site/chapters.ts apps/web/test/tryText.test.ts apps/web/test/runner.test.ts
git commit -m "feat: 동작 설명·볼 곳 데이터와 박자 카드"
```

---

### Task 3: 다섯 단계 첫 화면 실측

글을 다듬기 전에 잰다(설계 4장 "카드가 첫 화면을 넘을 때" 1번). 이 태스크는 코드를 바꾸지 않는다. 바꿀 수 있는 것은 넘는 단계의 MDX 본문뿐이다.

**Files:**
- Create: `docs/superpowers/followups/2026-11-14-amulator-chapter-readability.md` (`## 실측` 절)
- Modify(넘을 때만): `apps/web/src/chapters/ch2-cpu/<n>-*.mdx`

**Interfaces:**
- Consumes: Task 1·2의 화면

재는 법:
- agent-browser `set viewport 1900 940`, `/chapter.html?n=2`. 단계마다 더 읽기는 접은 채로 둔다.
- 버튼은 `eval`로 JS `click()`을 부른다. agent-browser `click`은 요소를 화면 안으로 스크롤하므로 쓰지 않는다. 재기 전마다 `window.scrollTo(0, 0)`.
- 단계마다 누르기 전 한 번, 동작마다 누른 뒤 한 번 `getBoundingClientRect()`를 잰다. 대상: 본문 첫 문단, 다음 동작 항목 전체(버튼·`line`·"볼 곳" 줄. 마지막 뒤엔 "다 해 봤다…" 안내), 방금 동작의 값 표, 방금 동작의 "볼 곳" 대상(레지스터 탭이면 4쌍 표에서 그 이름의 칸, 메모리 탭이면 강조된 바이트, 실행 줄, 터미널), 레지스터 표 전체. 요소는 글자(동작 이름, `볼 곳:`, 레지스터 이름)로 찾는다.
- 통과: 모든 대상이 `top >= 0`이고 `bottom <= 940`이다. 그 시점에 없는 대상(1단계는 메모리 탭이라 레지스터 표가 없고, 5단계 누르기 전은 실행 중이라 표 대신 안내 글이다)은 표에 "없음"으로 적고 판정에서 뺀다.

- [ ] **Step 1: 다섯 단계를 재고 `## 실측` 표에 적는다**

표: `| 단계 | 시점(누르기 전·동작 이름) | 대상 | top | bottom | 통과 |`. 1440x900에서도 같은 것을 재서 따로 적는다(보고만, 통과 기준 아님).

- [ ] **Step 2: 넘는 단계가 있으면 그 단계 본문을 줄인다**

1900x940에서 넘는 단계만, 두 번에 나눠 줄인다. 지금 본문은 고쳐 쓰기 전이라 Task 4의 예산(문단 하나, 세 문장)보다 길다.
1. 먼저 그 단계 본문을 Task 4 글 규칙대로 세 문장 이하 한 문단으로 줄이고 다시 잰다. 통과하면 여기서 멈춘다.
2. 그래도 넘으면 설계 4장대로 두 문장으로 줄이고 다시 잰다.

어느 쪽이든 뺀 사실은 그 단계 `<More>`로 옮기고, 확인 질문의 답이 기대는 사실을 잃지 않는다. 표에 단계마다 몇 문장에서 통과했는지 적는다(Task 4가 그 수를 상한으로 지킨다). 넘는 단계가 없으면 이 Step은 건너뛰고 표에 "줄이지 않음"을 적는다.

- [ ] **Step 3: 그래도 넘으면 멈춘다**

지난 단계 줄 접기·옮기기, 머리 줄이기, 자동 스크롤을 하지 않는다. 구현자는 실측 표와 함께 BLOCKED로 돌려주고, 메인이 그 값으로 사용자에게 묻는다. 사용자 결정을 받기 전에는 Task 4로 넘어가지 않는다.

- [ ] **Step 4: 커밋한다**

```bash
git add docs/superpowers/followups/2026-11-14-amulator-chapter-readability.md apps/web/src/chapters/ch2-cpu
git commit -m "docs: 챕터 첫 화면 실측 기록"
```

---

### Task 4: 2장 글 고쳐 쓰기와 검수

**Files:**
- Modify: `apps/web/src/chapters/ch2-cpu/1-fetch.mdx` … `5-trap.mdx`
- Modify: `apps/web/src/chapters/ch2-cpu/steps.ts` (`label`·`line`·`look`만. 주소·`kind`·`count`·`value`는 그대로)
- Modify: `apps/web/src/site/chapters.ts` (Step 5에서 2장을 `status: 'reviewed'`로 되돌린다)

**Interfaces:**
- Consumes: Task 2 `TryAction.line`·`look`, MDX 컴포넌트 `Try`, `More`, `Quiz`, `Checks`

글 규칙(설계 6장):
- `<Try />` 위 본문은 문단 하나, 세 문장 이하다. 이 단계가 왜 있는지와 무엇을 보게 되는지만 말한다. Task 3이 줄인 단계는 실측 표에 적힌 통과 문장 수 이하를 지킨다.
- `label`을 바꾸면 MDX 안의 `[이름]` 인용(본문·더 읽기·확인 질문)도 같이 고친다.
- 본문에서 뺄 것: 어디를 보라는 문장, 버튼이 무엇을 하는지 설명하는 문장, 3단계의 네 줄 목록, 더 읽기 안의 버튼 설명(3단계 "[한 바퀴 더]는 한 바퀴를 한 번에 돈다"). 이 일은 `line`과 "볼 곳"이 맡는다.
- 더 읽기로 옮길 것: 본문에서 빠지지만 확인 질문의 답이나 뒤 단계가 기대는 사실. 예: 1단계 "표와 `pc`는 주소를 `0x` 없이 찍는다", 5단계 "`pc`는 2단계에서 `mtvec`에 적어 둔 `8000004c`".
- `line`은 한 문장이고 카드에서 두 줄을 넘지 않는다(약 45자). 백틱 밖 다른 서식은 없다.
- 더 읽기의 나머지와 확인 질문의 글은 뜻을 바꾸지 않는다. `android.mdx`는 손대지 않는다.

- [ ] **Step 1: 다섯 단계 본문과 `label`·`line`을 고쳐 쓴다** (구현 서브에이전트)

스스로 점검: 본문마다 문장 수를 센다. Run: `git grep -nE "탭|버튼|누르|누를|\[" -- "apps/web/src/chapters/ch2-cpu/[1-5]-*.mdx"` → 나온 줄이 모두 `<More>`나 `<Quiz>` 안에 있다(`[이름]`으로 버튼을 부르는 본문 문장도 잡는다).

- [ ] **Step 2: `korean-humanizer`로 한 번 다듬는다** (구현 서브에이전트)

대상: 고친 본문, 옮긴 더 읽기 문장, `label`·`line` 14개.

- [ ] **Step 3: 확인하고 커밋한다**

Run: `pnpm exec prettier --check apps packages docs && pnpm --filter @amulator/web test` → 통과
agent-browser로 1~5단계를 넘기며 `<Try />`·`<More>`·`<Quiz>`가 제자리에 있고 `line`의 백틱이 코드로 보이는지 본다.

```bash
git add apps/web/src/chapters/ch2-cpu
git commit -m "docs: 2장 본문을 왜 한 문단으로, 동작 설명을 카드로"
```

- [ ] **Step 4: 사실 대조를 맡긴다** (메인이 opus 리뷰어를 띄운다. 이 태스크의 리뷰를 겸한다)

리뷰어에게 MDX 다섯 개, `steps.ts`, 재료(`guest/baremetal/*.S`, `guest/baremetal/clock.c`, `packages/core/src/cpu/cpu.ts`, `packages/core/src/machine.ts`, `apps/web/test/ch2Steps.test.ts`)를 넘긴다. 문장·`line`마다 코드와 맞는지, `look`이 그 동작에서 실제로 바뀌는 곳을 가리키는지, 확인 질문의 답이 기대는 사실이 본문이나 더 읽기에 남아 있는지를 보고 틀린 것 목록을 받는다. 지적을 고치고(구현 서브에이전트), 고친 diff만 다시 보게 한다. 고친 뒤 Step 3의 확인을 다시 돌리고 커밋한다(`docs: 2장 글 사실 대조 반영`).

- [ ] **Step 5: 사용자 읽기 — 메인이 사용자를 기다린다**

사용자에게 개발 서버 주소(`/chapter.html?n=2`)를 주고 학습자로서 읽어 달라고 한다. 본문, `label`·`line`, "볼 곳"·"외 n개" 문구를 함께 본다. 이해 안 되는 곳을 받으면 고치고 Step 3의 확인을 다시 돌린다. 사용자가 통과라고 하면 `apps/web/src/site/chapters.ts`의 2장을 `status: 'reviewed'`로 되돌리고 커밋한다(`docs: 2장 글 사용자 읽기 반영`, `chapters.ts` 포함).

---

### Task 5: 디자인 마무리와 최종 확인 (메인 세션)

서브에이전트에 맡기지 않는다. 메인 세션이 `apps/web`을 작업 폴더로 열고 design-flow로 돌린다(설계 7장). 화면 확인과 멈춤 질문은 메인에서만 된다.

**Files:**
- Modify: `apps/web/src/chapter/*.tsx`, `apps/web/src/site/site.css`(필요할 때만)
- Modify: `docs/superpowers/followups/2026-11-14-amulator-chapter-readability.md`, `docs/superpowers/followups/2026-10-25-amulator-site-s2-ch2.md`
- Modify(DS 피드백이 나오면): `docs/ds-feedback.md`

- [ ] **Step 1: design-flow를 켤 세션을 준비한다**

사용자에게 `apps/web`을 작업 폴더로 한 세션을 열어 달라고 한다. 스킬 목록에 design-flow가 없으면 `~/my-agent-setup/skills/design-flow/SKILL.md`와 `stages.md`를 직접 읽고 따른다(지난 Task 8과 같은 상황, 후속 목록 "그 밖"). 단계 스킬이 꺼져 있으면 라우터가 규칙만 지키며 직접 하고 기록에 "꺼짐"으로 적는다.

- [ ] **Step 2: design-flow "디자인 마무리"를 돌린다**

다듬기(`impeccable` polish) → 모션(`animate`) → 비평·감사(`impeccable` audit, 접근성 `accessibility`) → 실제 화면 확인(agent-browser) → 마무리 검사 → 기록. 스킬마다 SKILL.md 5단계 브리프와 `stages.md` 추가분을 넘긴다. 대상은 챕터 화면이다(목차·놀이터 제외). 이 단계에서 정할 것: 줄인 canvas 크기와 띠 간격, 4쌍·2쌍 경계, 동작 목록의 상태별 모양, 값 표 모양, "볼 곳"·"외 n개" 문구(사용자 읽기에서 바꾼 것은 그대로 둔다). 지난 단계 줄·머리·자동 스크롤은 Global Constraints대로 건드리지 않는다.

Expected: 마무리 검사(className 임의값, 하드코딩 hex, fontFamily 리터럴, DS 스케일 밖 간격) 0건.

- [ ] **Step 3: 성공 기준을 끝에서 끝까지 확인한다** (설계 9장)

Run: `pnpm typecheck && pnpm lint && pnpm exec prettier --check apps packages docs && pnpm test` → 통과
Run: `pnpm format:check` → 지적이 `.claude/worktrees/`·`.superpowers/`의 10개뿐이다(설계 9장의 `format:check` 기준을 이것으로 본다)
Run: `pnpm build:plugin && pnpm smoke:plugin` → 통과
Run: `pnpm e2e` → 통과
agent-browser로:
- Task 3의 재는 법으로 다섯 단계를 1900x940에서 다시 잰다. 모든 대상이 통과하고 레지스터 표 전체가 첫 화면 안이다. 1440x900 값도 잰다(보고만). 결과로 `## 실측` 표를 갱신한다. 넘으면 Task 3 Step 2·3을 따른다.
- 탭을 바꾸고 동작을 눌러도 터미널 내용이 남는다(다시 켜지지 않는다).
- 다섯 단계의 본문이 세 문장 이하이고, 어디를 보라거나 버튼이 무엇을 한다는 문장이 본문에 없다.
- 놀이터: `emulator.html?program=clock`이 부팅해 터미널에 `uptime:` 줄을 찍고, Save 뒤 다시 열면 상태 줄이 "스냅샷에서 복원했다"다.

- [ ] **Step 4: 후속 목록을 정리한다**

새 파일(`2026-11-14-…`)에 `## 지금 상태`, `## 미룬 지적`(태스크 리뷰·design-flow 비평이 남긴 것), `## 실행 중 내린 판정`을 더한다. 옛 파일(`2026-10-25-…`)에서 이번에 푼 항목을 지운다: "화면"의 해 보기 버튼과 바뀐 값의 거리, 빈 canvas, 4단계 결과 줄 길이와 "글·데이터"의 3단계 본문 길이, 1단계 버튼 이름과 안내가 같은 말이라는 항목(안내 줄이 없어졌다). "`setRegister` 안내는 10진수" 항목은 지우지 않고 고쳐 쓴다: 안내 줄은 없어졌지만 4단계 `line`·`label`의 `12345`와 값 표의 `00000001 → 00003039`가 아직 어긋난다(사용자 읽기에서 고쳤으면 지운다).

설계 리뷰가 남긴 볼 거리도 새 파일에 적는다: 값 표의 "외 1개"가 가리키는 `sp`(1단계)·`mip`(5단계 mret까지)·`mstatus`(5단계 mret 실행)는 글이 설명하지 않는 값이다. 5단계 첫 동작은 레지스터 표 강조가 없다(옛 목록의 "실행 중 상태에서 시작하는 단계" 항목). `look.fields` 키가 맞는지는 자동 검사가 없고 사실 대조만 지킨다.

- [ ] **Step 5: 커밋한다**

```bash
git add apps/web/src docs/superpowers/followups docs/ds-feedback.md
git commit -m "feat: 챕터 가독성 개편 design-flow 마무리"
```
