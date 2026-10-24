# amulator S1(가) 후속 작업 목록

- 작성일: 2026-10-22
- 출처: S1(가) 계획 실행 중 태스크 리뷰와 최종 전체 리뷰(Opus)가 남긴 지적 가운데 고치지 않고 미룬 것.
- 계획: [2026-10-21-amulator-site-s1.md](../plans/2026-10-21-amulator-site-s1.md)

## S2 첫 위젯 전에 정할 것

- 스냅샷 저장소를 모든 인스턴스가 함께 쓴다(token이 없으면 IndexedDB, 열쇠는 이미지 해시). 챕터 위젯이 놀이터 저장본으로 복원되고, 위젯의 Reset이 놀이터 저장본을 지운다. `start`에 저장하지 않는 옵션이나 메모리 저장소를 고를 수 있게 한다.
- 장치 접근 기록 창(256)이 그림판의 폴링 읽기로 가득 찬다. `trace`에 장치·종류 필터를 두거나 연속된 같은 접근을 합친다.
- 실행 중 `describeSnapshot`은 64 MiB gzip이 실행 루프와 경쟁해 느리다. UI는 멈춘 뒤 요청하고 계약 주석을 단다.
- wfi로 쉬는 CPU에서 `step`이 0개를 실행하고 조용히 `state`만 보낸다. `state`에 executed를 실을지 정한다.
- `peekMemory`가 부호 있는 주소를 RangeError로 거부한다. 첫 hex 입력 위젯 때 `>>> 0`으로 정규화한다.
- `describeSnapshot` 구간 합이 align4 패딩만큼 파일 크기보다 작다. 챕터 6 위젯에서 설명하거나 padding 구간을 둔다.
- `emulatorWorker.ts`가 약 500줄이다. 메시지가 늘면 관찰·제어 핸들러를 나눈다.
- reset 뒤에는 `booted`를 기다린 다음 inspect한다. 이 계약을 `messages.ts`에 적는다.
- 인스턴스마다 64 MiB RAM과 worker가 따로 든다. 챕터 페이지의 인스턴스 수를 정할 때 함께 본다.
- 기록 형식의 `atMs` 상한(`setTimeout` 2^31-1). 7장 기록 도구를 만들 때 더한다.
- DS Tabs는 숨은 패널을 마운트하지 않는다(R27). 에뮬레이터 화면을 Tabs 패널 안에 두면 탭을 바꿀 때마다 다시 마운트되므로(OffscreenCanvas는 한 번만 넘긴다), 에뮬레이터 화면은 Tabs 밖에 두고 보기만 탭으로 바꾼다.
- design-flow 훅은 세션 폴더에서 처음 만나는 `package.json`만 본다(2026-10-24 확인). 설계 6장의 모노레포 대응이 들어가기 전에는 DS 의존성이 있는 `apps/web`에서 세션을 열어야 design-flow가 켜진다.

## S3 공개 전에 확인할 것

- worker `postMessage(message, { transfer })` 옵션 형식을 Safari가 지원하는지 확인한다(2026-10-22 MDN BCD에서 판정하지 못했다). 안 되면 배열 형식으로 되돌린다.
- `SiteHome`의 `/emulator.html` 절대경로는 Pages 하위 경로에서 깨진다. Vite `base`와 `import.meta.env.BASE_URL`로 처리한다.

## 다듬기(급하지 않음)

- `vite.config.ts`의 `build.rollupOptions`는 Vite 8에서 deprecated다(`rolldownOptions`).
- worker `onerror`의 상태 문구가 "오류: worker 오류: …"로 바뀌었다(예전 "worker 오류: …").
- 알 수 없는 프로그램일 때 예전에는 320x480 테두리 canvas가 보였는데, 지금은 빈 상자다.
- 역어셈블러: 기대값 대조 줄 수에 하한 단언이 없다. 건너뛴 csr 23줄의 나머지 피연산자를 대조하지 않는다. `fence.tso`를 해석하지 않는다. 기대값 스크립트의 오류 메시지가 불친절하다.
- 스모크의 `id="root"` 검사가 두 진입점을 구분하지 못한다.
- 테스트: RAM 끝 경계에서 성공하는 경우, 빈 `events`, 재생이 끝난 뒤 `cancel`, `waitFor('error')`의 predicate.
