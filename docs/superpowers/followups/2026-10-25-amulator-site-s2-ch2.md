# amulator S2-1(챕터 틀과 2장 CPU) 인계와 후속 목록

- 작성일: 2026-11-08
- 계획: [2026-10-25-amulator-site-s2-ch2.md](../plans/2026-10-25-amulator-site-s2-ch2.md), 설계: [2026-10-25-amulator-site-s2-ch2-design.md](../specs/2026-10-25-amulator-site-s2-ch2-design.md)
- 작업 위치: Orca 워크트리 `C:/Users/xxx99/orca/workspaces/amulator/feat-s2-ch2`, 브랜치 `eeennsu/feat-s2-ch2`(base `main` e4faa1d). 다른 기기에서는 이 브랜치를 체크아웃한다.
- 이 파일은 계획서 Task 8 Step 4가 만들라는 "이번에 미룬 것" 파일이기도 하다. Task 8을 마칠 때 처리한 줄을 지운다.

## 지금 상태

- Task 1~7 완료(`git log e4faa1d..eeennsu/feat-s2-ch2`). 태스크마다 리뷰를 거쳤고 Critical·Important는 모두 고쳤다.
- 2장은 사실 대조(opus)와 사용자 읽기를 통과해 `chapters.ts`에서 `status: 'reviewed'`다(649ba25).
- 사용자 읽기 중에 계획 밖으로 더한 것:
  - 루트 DS 배경·글자색, canvas 크기와 표면, `<More>` 문단 간격, `usePeek` 대기·실패 구분(4fc9665)
  - 2장 MDX 전체에 korean-humanizer(3047ae4, b743d09)
  - 해 보기 상자: "해 보기 n/N", 동작별 안내, "✓ 방금" 줄, 완료 문구. 버튼 이름에서 "단계"를 뺐고 이동 버튼은 "↺ 처음 상태로"·"다음: {제목} →" 보조 버튼이다(97ddab9, 433c90c).
  - 글 위계: 카드 제목 h2, 해 보기 h3, 보조 글 `text-fg-muted`(e8b7b36)
- `pnpm typecheck`, `lint`, `format:check`, `test`(web 91, mcp 52)가 통과한다. 플러그인 스모크는 Task 4에서 통과했고 그 뒤로 다시 돌리지 않았다.

## 다음에 할 일 (순서대로)

1. **Task 8 디자인 마무리** — 사용자가 `apps/web`을 작업 폴더로 한 세션을 열고 design-flow를 돌린다. 서브에이전트에 맡기지 않는다. 브랜드 색을 고르는 자리에서는 사용자에게 묻는다. 계획서 Task 8 Step 1~5를 따른다.
2. **최종 전체 리뷰** — Task 8 뒤에 opus로 `git merge-base main HEAD..HEAD`를 리뷰한다. 아래 "미룬 지적"을 함께 넘겨 병합 전에 고칠 것을 가른다.
3. **브랜치 마무리** — `superpowers:finishing-a-development-branch`. Orca 워크트리는 `orca worktree rm`으로 지우고 브랜치는 그 뒤에 지운다.

## Task 8(design-flow)이 함께 볼 것

- `EmulatorColumn.tsx` 화면 칸의 `[&>canvas]:h-auto`·`[&>canvas]:w-full`은 Tailwind 임의 변형이다. 마무리 검사의 "임의값 0건"에 걸린다. 화면 칸 옵션으로 canvas에 클래스를 넘기면 없앨 수 있다.
- 접힌 ✓ 카드는 busy 중에도 활성처럼 보인다(DS `Collapsible`에 disabled가 없다). `StepList.tsx`의 `<h2>`가 `Collapsible` 루트(div)를 감싸 HTML 중첩 규칙에 어긋난다. `<div role='heading' aria-level={2}>`로 바꾸면 된다.
- "더 읽기" 트리거 이름이 모든 `<More>`와 안드로이드 상자에서 같다.
- 해 보기 안내와 버튼 글이 같은 말을 두 번 한다(예: "명령어 2개").
- 목차의 `<a>` 링크에 DS 스타일이 없다. 준비 중 챕터 제목은 heading이 아니다.
- 터미널 크기, 바뀐 값 강조 모양, 레지스터·메모리 표 모양, 두 열 비율, 간격은 아직 정하지 않았다.

## 미룬 지적 (최종 리뷰가 분류한다)

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
- pc 대상 `setRegister` 안내는 10진수, 결과 줄은 16진수다.

### 테스트
- 트랩으로 mtvec에 들어간 뒤 `breakAt`에 걸리는 경우를 지키는 core 테스트가 없다. `run`과 `runUntil` 루프 본문이 두 벌이다.
- `breakAt: null`·덮어쓰기 분기, 컨트롤러 `waitFor`의 abort 경로, `ChapterPage` 배선(last 리셋, before 포착)에 테스트가 없다.
- 실행기 시간 초과 테스트가 `pause`·`breakAt(null)`을 보지 못한다(Review Focus 2).
- wfi step 테스트가 `QUIET_MS`에 기대고, `ch2Steps` 2~5단계 테스트가 vitest 기본 5초 제한을 쓴다. 느린 CI에서 흔들릴 수 있다.
- `ch2Steps`의 `beforeEach`가 순수 테스트에도 worker를 띄운다. 2단계 t0 변화와 1단계 pc+4 단언이 없다. `stepAt(1..4)`가 매직 인덱스다.

### 글·데이터
- 2장 글에 주소가 숫자로 박혀 있다. clock을 다시 빌드하면 글과 화면이 어긋나고 테스트가 잡지 못한다.
- 안드로이드 상자의 "하이퍼바이저가 없을 때" 줄은 아키텍처가 다른 경우를 담지 않는다.
- 3단계 본문이 아직 3~4줄 목표보다 길다.
- `steps.ts`: 4단계 이유 주석 두 줄, 한 바퀴 `count: 4`와 테스트 `LOOP_STEPS`의 연결 없음, `BSS_LOOP` 타입 표기 불일치.

### 그 밖
- `?n=02` 같은 비정규형 챕터 번호는 없는 챕터로 본다.
- 구현 서브에이전트 몇이 Edit 대신 node 스크립트나 `prettier --write`로 파일을 고쳤다. 리뷰에서 diff 내용은 확인했다.
- 몇몇 커밋 트레일러가 `Claude Sonnet 5.5`다(서브에이전트가 단 것, amend하지 않았다).
- `pnpm-workspace.yaml`에 `minimumReleaseAgeExclude`(`@eeennsu/web@0.5.0`, `@eeennsu/tokens@0.5.0`)를 넣었다. 두 버전이 pnpm 릴리스 경과 기간 정책에 걸려서다.

## 실행 중 내린 판정 (틀렸으면 되돌릴 것)

1. Task 2 `startClock` 테스트 도우미는 `{ persist, paused }` 객체를 받는다. 계획서 본문과 테스트 코드가 달라 테스트 코드를 따랐다.
2. Task 7은 사실 대조를 태스크 리뷰로 쓰고 Minor 지적도 모두 고쳤다.
3. Task 3에서 두 `waitFor`(컨트롤러·하네스)에 선택 인자 `signal?: AbortSignal`을 더했다. 끝난 호출의 기다림이 다음 호출 메시지를 가로채는 문제를 막는다.
4. Task 6 메모리 탭은 앞 줄·pc 줄·뒤 줄 48바이트다. 계획서가 "앞뒤 줄"과 "32바이트"를 함께 적어 스스로 어긋났다.
5. 사용자 읽기를 막는 연결 버그(배경·canvas·문단 간격·`usePeek`)는 Task 8 전에 고쳤다. 시각 결정은 남겼다.
6. 설계·계획서가 부르는 버튼 이름 "[이 단계 처음으로]"·"[다음 단계]"는 화면에서 "↺ 처음 상태로"·"다음: {제목} →"다. 사용자가 고른 방향이다.
7. 해 보기 피드백에서 `setRegister`는 pc 구간 없이 레지스터 새 값만 보이고, 실패하면 "방금" 줄을 지운다.

## 추천 스킬

- Task 8 세션(`apps/web`): design-flow, `impeccable`(웹 UI 플러그인, 이 레포에서 켜져 있다), `agent-browser`(화면 확인), `conventions`(코드 고칠 때). 스킬이 목록에 없으면 `node ~/my-agent-setup/scripts/fix-plugin-symlinks.mjs`.
- 최종 리뷰: `superpowers:requesting-code-review`(opus).
- 마무리: `superpowers:finishing-a-development-branch`, `superpowers:verification-before-completion`.
- 후속 목록 정리 때 이 파일과 [S1 후속 목록](2026-10-22-amulator-site-s1.md)을 함께 본다. S1 목록에서 이번에 처리한 항목(공유 스냅샷 저장소, wfi 중 step, reset 뒤 booted 계약, DS Tabs와 에뮬레이터 화면 위치)은 Task 8 Step 4에서 지운다.
