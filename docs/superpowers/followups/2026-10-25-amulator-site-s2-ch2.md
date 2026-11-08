# amulator S2-1(챕터 틀과 2장 CPU) 후속 목록

- 작성일: 2026-11-08
- 계획: [2026-10-25-amulator-site-s2-ch2.md](../plans/2026-10-25-amulator-site-s2-ch2.md), 설계: [2026-10-25-amulator-site-s2-ch2-design.md](../specs/2026-10-25-amulator-site-s2-ch2-design.md)
- 출처: 태스크 리뷰와 사용자 읽기가 남긴 지적 가운데 고치지 않고 미룬 것, 실행 중 내린 판정. [S1 후속 목록](2026-10-22-amulator-site-s1.md)에서 옮겨 온 항목도 있다.

## 지금 상태

- Task 1~8 완료. 2장은 사실 대조(opus)와 사용자 읽기를 통과해 `chapters.ts`에서 `status: 'reviewed'`다.
- Task 8(design-flow 디자인 마무리, 2026-11-08): 목차 폭·링크, 챕터 두 열 비율 3:2, 터미널 폭, 레지스터 표 두 항목씩, ✓ 카드를 ghost Button으로, 중복 문구 정리. 마무리 검사(임의값·hex·fontFamily·스케일 밖 간격) 0건. 브랜드 색은 사용자 결정으로 DS 기본 파랑을 그대로 쓴다(`site.css` 재선언 없음). DS 피드백은 `docs/ds-feedback.md`.
- 오른쪽 열 가독성(design-flow 2차, 2026-11-08): impeccable critique 26/40·audit 13/16에서 짚은 단계 목록과 펼친 글을 고쳤다. 단계는 번호 목록과 지금 카드, 접힌 글은 왼쪽 세로줄이다(실행 중 내린 판정 11~15). 범위 밖 지적은 아래 "미룬 지적"의 "화면"에 적었다. critique 기록은 `apps/web/.impeccable/critique/`에 남기고 커밋하지 않았다.
- `pnpm typecheck`, `lint`, `format:check`, `test`, `build:plugin`, `smoke:plugin`, `e2e`가 통과한다(2026-11-08).
- 최종 리뷰(opus, 2026-11-08): Critical 0, Important 4를 병합 전에 고쳤다. 실행 중에 실행 줄·레지스터 표가 resume 순간 값을 지금 값처럼 보이던 것(worker는 실행 중 `state`를 보내지 않는다), 목차·챕터 링크를 상대경로로(S1 후속의 `/emulator.html` 항목도 함께 풀림), `CLAUDE.md`의 `web.md` import 경로, Review Focus 2 테스트의 `breakAt(null)`·`pause` 단언. 아래 미룬 지적은 리뷰어가 "남김"으로 판정한 것이다.

## 다음 챕터 전에 정할 것

- 장치 접근 기록 창(256)이 그림판의 폴링 읽기로 가득 찬다. `trace`에 장치·종류 필터를 두거나 연속된 같은 접근을 합친다.
- `peekMemory`가 부호 있는 주소를 RangeError로 거부한다. 첫 hex 입력 위젯 때 `>>> 0`으로 정규화한다.
- 한 챕터 안에서 단계마다 다른 프로그램으로 바꾸는 경우(`step.program`이 바뀌어 `useEmulator`가 다시 마운트되는 경로)를 확인하지 않았다. 2장은 모두 clock이다.
- 터미널은 놀이터와 같은 60열 12줄(`terminal.ts`)이다. 챕터마다 크기를 달리 하려면 `createTerminal`에 크기 옵션을 더한다.

## 미룬 지적

### 동작
- 메시지 계약: `breakpoint`는 `start`·`reset` 메시지가 도착할 때가 아니라 큐의 작업이 돌 때 지워진다. `messages.ts` 주석 문구와 어긋난다. reset 뒤 `booted` 전에 `breakAt`을 보내면 사라진다(실행기는 `booted` 뒤에 보내 안전하다).
- `persist: false`와 token이 함께 오면 메모리 저장소가 쓰인다는 규칙이 `pickStore` 주석에만 있다.
- `worker.onerror`가 waiter 루프를 건너뛴다. worker가 죽으면 실행기의 `booted`·`state` 기다림에 시간 제한이 없어 busy가 풀리지 않는다.
- `waitFor`의 predicate가 던지면 그 메시지의 나머지 waiter와 `onMessage`가 건너뛰어진다.
- 하네스 `waitFor`는 공유 cursor부터 훑어 호출 전 메시지도 집는다. 실제 컨트롤러는 호출 뒤 메시지만 본다.
- `booted`와 다음 `state`가 한 렌더로 묶이면 강조 기준이 버려지지 않는다(`elf` 객체 정체성으로도 리셋하면 된다).
- `perform` 재진입 때 다른 호출의 `finally`가 `performing`을 지울 수 있다(지금은 도달하지 않는다).
- pc가 RAM 마지막 16바이트에 있으면 메모리 탭의 48바이트 읽기가 RAM 끝을 넘어 "읽을 수 없다"가 보인다.
- 실행 줄은 읽는 동안 pc만 있고 역어셈블이 비는 순간이 있다(의도한 선택).
- `setRegister` 안내는 10진수, 결과 줄과 레지스터 표는 16진수다. pc뿐 아니라 모든 대상이 그렇다(4단계에서 a2에 12345를 넣으면 표에 `00003039`). `4-edit.mdx`에 한 문장 더하면 풀린다.
- 5단계처럼 실행 중 상태에서 시작하는 단계는 첫 멈춤(trap_entry)에서 바뀐 값 강조가 없다. 강조는 연속한 멈춘 상태 둘을 비교하기 때문이다. 글은 값이 "적힌다"고만 말해 어긋나지는 않는다.

### 테스트
- 트랩으로 mtvec에 들어간 뒤 `breakAt`에 걸리는 경우를 지키는 core 테스트가 없다. `run`과 `runUntil` 루프 본문이 두 벌이다.
- `breakAt: null`·덮어쓰기 분기, 컨트롤러 `waitFor`의 abort 경로, `ChapterPage` 배선(last 리셋, before 포착)에 테스트가 없다.
- wfi step 테스트가 `QUIET_MS`에 기대고, `ch2Steps` 2~5단계 테스트가 vitest 기본 5초 제한을 쓴다. 느린 CI에서 흔들릴 수 있다.
- `ch2Steps`의 `beforeEach`가 순수 테스트에도 worker를 띄운다. 2단계 t0 변화와 1단계 pc+4 단언이 없다. `stepAt(1..4)`가 매직 인덱스다.
- 챕터 화면 컴포넌트(`StepList`, `RegisterTable`, `SiteHome`)에는 렌더 테스트가 없다. Task 8의 표 재배치와 ✓ 버튼은 브라우저(agent-browser)로만 확인했다. 최종 리뷰 뒤 고친 실행 중 표시(`EmulatorColumn`)는 타입 검사만 거쳤다.
- `ch2Steps` 테스트 이름이 주소를 10진수로 찍는다("주소 2147483684: …").

### 글·데이터
- 2장 글에 주소가 숫자로 박혀 있다. clock을 다시 빌드하면 글과 화면이 어긋나고 테스트가 잡지 못한다.
- 안드로이드 상자의 "하이퍼바이저가 없을 때" 줄은 아키텍처가 다른 경우를 담지 않는다.
- 3단계 본문이 아직 3~4줄 목표보다 길다.
- `steps.ts`: 4단계 이유 주석 두 줄, 한 바퀴 `count: 4`와 테스트 `LOOP_STEPS`의 연결 없음, `BSS_LOOP` 타입 표기 불일치.
- 1단계는 버튼 이름("명령어 1개 실행")과 안내("명령어 하나를 실행한다")가 아직 같은 말이다. 동작 자체가 그것이라 남겼다.
- `android.mdx`의 외부 링크가 같은 탭에서 열린다. 뒤로 오면 1단계로 돌아갈 수 있다(bfcache는 확인하지 않았다). `ANDROID_COMPONENTS`에 `a`를 `target='_blank' rel='noreferrer'`로 넘기면 된다.

### 화면 (design-flow 2차 critique가 남긴 것)
- 해 보기 버튼과 바뀐 값이 수백 px 떨어져 있다(1440폭에서 3단계 a0은 버튼보다 약 700px 아래, 모바일은 위로 약 650px). 결과 줄에 바뀐 값 이름을 붙여 줄였지만 값 자체는 왼쪽 표에서만 보인다.
- 2장 clock은 canvas에 아무것도 그리지 않는데 320x480 화면이 첫 화면에서 가장 크다. 설계 3장의 "화면은 늘 보인다"와 부딪혀 손대지 않았다. 화면을 안 쓰는 챕터에서 canvas를 줄이거나 실행 줄·탭을 올릴지 정해야 한다.
- 멈춘 상태에도 상태 줄에 "새로 부팅했다 · 0.0 MIPS"가 남는다.
- 오류 문구(`0x…까지 가지 못했다`)가 고치는 법(처음 상태로)을 말하지 않고, 버튼 반대편 열에 뜬다.
- 확인 질문의 답을 해 보기 전에도 열 수 있다. 지난 단계를 다시 열면 경고 없이 시작 상태를 다시 만든다.
- `← 목차`와 안드로이드 상자 출처 링크 둘의 터치 타깃이 21px로 24px(WCAG 2.5.8)에 못 미친다. 랜드마크가 `main`뿐이고 접기 트리거에 `aria-controls`가 없다.
- 4단계 [uptime 출력까지 실행]의 결과 줄은 바뀐 값이 a0~a6 일곱 개로 길다.

### 그 밖
- `?n=02` 같은 비정규형 챕터 번호는 없는 챕터로 본다.
- 구현 서브에이전트 몇이 Edit 대신 node 스크립트나 `prettier --write`로 파일을 고쳤다. 리뷰에서 diff 내용은 확인했다.
- 커밋 트레일러가 `Claude Sonnet 5.5`(서브에이전트)와 `Claude Fable 5.1`(메인)로 섞여 있다. amend하지 않았다.
- `pnpm-workspace.yaml`에 `minimumReleaseAgeExclude`(`@eeennsu/web@0.5.0`, `@eeennsu/tokens@0.5.0`)를 넣었다. 두 버전이 pnpm 릴리스 경과 기간 정책에 걸려서다.
- design-flow 세션 위치: 세션 폴더가 레포 루트면 skill-filter 모드가 `design-flow`·`accessibility`·`animate`를 숨기고(한 단계 아래 `package.json`만 본다), design-flow 훅도 DS 줄을 넣지 않는다. Task 8은 `apps/web`을 작업 폴더로 열었는데도 하네스 cwd가 루트라 스킬 목록에 없었고, `~/.claude/skills/design-flow/SKILL.md`를 직접 읽어 따랐다. 단계 스킬(impeccable polish·audit, animate, accessibility)은 꺼짐으로 라우터가 직접 했다. my-agent-setup 쪽에서 `apps/*` 두 단계 탐색을 넣으면 풀린다.

## 실행 중 내린 판정 (틀렸으면 되돌릴 것)

1. Task 2 `startClock` 테스트 도우미는 `{ persist, paused }` 객체를 받는다. 계획서 본문과 테스트 코드가 달라 테스트 코드를 따랐다.
2. Task 7은 사실 대조를 태스크 리뷰로 쓰고 Minor 지적도 모두 고쳤다.
3. Task 3에서 두 `waitFor`(컨트롤러·하네스)에 선택 인자 `signal?: AbortSignal`을 더했다. 끝난 호출의 기다림이 다음 호출 메시지를 가로채는 문제를 막는다.
4. Task 6 메모리 탭은 앞 줄·pc 줄·뒤 줄 48바이트다. 계획서가 "앞뒤 줄"과 "32바이트"를 함께 적어 스스로 어긋났다.
5. 사용자 읽기를 막는 연결 버그(배경·canvas·문단 간격·`usePeek`)는 Task 8 전에 고쳤다. 시각 결정은 남겼다.
6. 설계·계획서가 부르는 버튼 이름 "[이 단계 처음으로]"·"[다음 단계]"는 화면에서 "↺ 처음 상태로"·"다음: {제목} →"다. 사용자가 고른 방향이다.
7. 해 보기 피드백에서 `setRegister`는 pc 구간 없이 레지스터 새 값만 보이고, 실패하면 "방금" 줄을 지운다.
8. Task 8 권장안으로 진행한 시각 결정: 목차 `max-w-3xl`, 챕터 `max-w-7xl`에 `lg:grid-cols-5`(에뮬레이터 3 : 단계 2), 페이지 여백 `p-4 lg:p-8`, 바뀐 값 강조는 `font-semibold text-fg-brand` 유지, 화면 칸 `rounded-lg`, 터미널은 `w-fit` + `border`. 접힌 ✓ 단계는 Collapsible 대신 `variant='ghost'` Button(`disabled={busy}`), 안드로이드 상자 트리거는 "어떻게 다른지 읽기".
9. 링크는 DS에 Link가 없어 `Prose`의 `a` 스타일을 빌린다(목차 제목, "에뮬레이터 열기", "← 목차"). 새 클래스나 로컬 컴포넌트를 만들지 않았다.
10. 해 보기 버튼 이름에서 괄호 안 명령어 수("(명령어 2개)")를 뺐다. 안내 줄이 같은 수를 말한다. 3단계 글의 "[한 바퀴 더 (명령어 4개 실행)]"도 "[한 바퀴 더]"로 맞췄다.
11. 단계 목록은 지금 단계만 카드로 펼치고 지난·남은 단계는 표면 없이 번호 원과 제목 한 줄로 둔다. 접힌 글(더 읽기, 확인 질문의 답)은 흐린 색과 왼쪽 세로줄(`border-s-4 border-border ps-4`)이다. 사용자가 실제 화면 시안 넷(위 진행 줄 + 카드 하나, 바닥색 상자 포함)을 보고 골랐다(2026-11-08). 판정 8의 ✓ ghost Button은 이 목록의 지난 단계 줄로 남았다.
12. 해 보기·확인 질문은 카드 안 상자 대신 구분선과 h3 제목을 단 구역이다(검출기 nested-cards). Quiz는 MDX `<Checks>`로 묶어 5단계의 질문 둘도 한 구역에 든다. 해 보기를 다 하면 "다음"이 primary가 되고 "처음 상태로"는 ghost로 뒤에 선다. 배지는 `n/m 해 봄`이다.
13. 바뀐 값 강조는 `font-semibold` 대신 `<strong>`이다. DS가 굵기 스케일을 비워 `font-semibold`가 생성되지 않았고, 1·2단계 글의 "굵게 강조"가 화면과 어긋나 있었다.
14. 사용자가 승인한 문구·동작 변경: 결과 줄 끝에 바뀐 값 이름(pc 제외, 앞 상태가 멈춘 상태일 때만), 안내의 "왼쪽"을 "에뮬레이터"로, 5단계를 다 하면 "이 장의 단계를 모두 마쳤다. ← 목차".
15. 글은 구조만 바꿨다. 3단계 네 줄 설명을 목록으로, 안드로이드 상자를 본문색으로 바꾸고 소제목 넷(하이퍼바이저가 있을 때와 없을 때, QEMU의 번역 블록, 이 에뮬레이터와 다른 점, 출처)과 작은 흐린 출처 글로 나눴다. 문장 뜻은 그대로다. 챕터 화면 전체에 `break-keep wrap-break-word`를 걸었다.
