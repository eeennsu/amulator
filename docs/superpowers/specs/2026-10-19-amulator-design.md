# amulator 설계: TypeScript로 만드는 브라우저 RISC-V 미니 에뮬레이터

- 작성일: 2026-10-19
- 근거 조사: [rea-windows.md](../../research/rea-windows.md), [browser-riscv-linux.md](../../research/browser-riscv-linux.md), [android-emulator-internals.md](../../research/android-emulator-internals.md)
- 표기
  - "(사용자 결정)": 사용자가 정한 것
  - "(설계자 판단)": 설계자가 정했고 사용자가 반대하지 않은 것
  - "(사용자 환경)", "(로컬 조회, 날짜)": 조사 문서가 아니라 사용자 설정이나 직접 조회에서 온 사실
  - 표시가 없는 사실: 위 조사 문서에 출처가 있다. 이 문서에서 새로 확인한 사실에는 출처와 확인일을 직접 단다.

## 1. 의도

이 프로젝트의 목적은 두 가지다.

1. **에뮬레이터 작동 원리를 전 과정에 걸쳐 배운다.** (사용자 결정) RN 개발자가 매일 띄우는 안드로이드 에뮬레이터를 REA로 뜯어 보고, 같은 원리를 작은 규모로 구현한다. 사용자는 "에뮬레이터의 대부분의 프로세스"가 궁금하다고 했다.
2. **"AI에 관심이 많은 RN 개발자"로 보이는 포트폴리오를 만든다.** (사용자 결정) 판단 기준은 "요즘 AI 개발 흐름이 보이는가"다. 나머지 선택은 사용자가 설계자에게 맡겼다.

목표 수준은 현실적인 범위로 제한한다. (사용자 결정) 직접 만든 에뮬레이터 위에서 진짜 안드로이드를 부팅하지는 않는다. 대신 작은 리눅스와 직접 만든 미니 OS를 부팅하고, 화면과 터치까지 동작시킨다.

만드는 방식도 정해 두었다. (사용자 결정)

- 코드와 테스트는 에이전트가 짠다.
- 사용자는 마일스톤마다 코드를 읽고 학습 노트를 직접 쓴다.
- 이 진행 방식 자체가 "에이전트와 함께 만들며 배운다"는 AI 개발 흐름의 사례가 된다.

### 완성된 모습 (설계자 판단)

데모 영상은 다음 순서로 진행된다.

1. 브라우저 탭에서 TypeScript로 만든 에뮬레이터가 리눅스를 부팅한다. canvas에 커널 로그와 로고가 나오고, xterm에 셸이 뜬다.
2. LVGL로 만든 터치 UI가 뜨고, 마우스로 누르면 반응한다.
3. Claude Code에게 "버튼을 눌러 보고 화면을 캡처해 줘"라고 말한다. Claude가 MCP로 탭하고, 스크린샷을 찍고, 셸 명령을 실행하고, 스냅샷을 저장한다.
4. 페이지를 새로고침하면 부팅 없이 스냅샷에서 바로 재개한다. 안드로이드 에뮬레이터의 퀵부트에 해당하는 장면이다.

공개 사이트는 MCP 없이 혼자 돈다. 방문자가 들어오면 미리 찍어 둔 스냅샷에서 시작하므로 부팅을 기다리지 않는다.

레포에는 사용자가 쓴 단계별 학습 노트가 함께 있다. 각 노트는 먼저 "진짜 안드로이드 에뮬레이터는 이렇게 한다"를 REA 증거와 소스로 보이고, 이어서 "이 에뮬레이터는 이렇게 했다"를 설명한다.

## 2. 목표, 비목표, 반목표

### 목표

- 아래 7단계를 모두 작게나마 구현한다. 각 단계가 끝날 때 눈에 보이는 결과가 있어야 한다.

  | # | 단계 | 이 프로젝트에서의 대응 |
  |---|---|---|
  | 1 | 실행과 부팅 | 커널과 DTB를 RAM에 올리고, a0 = hartid, a1 = DTB 주소 규약으로 진입한다 |
  | 2 | CPU | 순수 TS로 짠 RV32IMA 인터프리터. M/S/U 모드와 Sv32 MMU를 갖춘다 |
  | 3 | 메모리와 가상 장치 | 주소 범위를 장치 콜백으로 보내는 MMIO 디스패처. 진짜 에뮬레이터의 VM exit 처리에 해당한다. UART, CLINT, PLIC, virtio-mmio |
  | 4 | 화면 | simple-framebuffer 메모리를 OffscreenCanvas로 옮긴다 |
  | 5 | 입력 | canvas 포인터 이벤트를 터치 이벤트로 바꾼다. bare-metal은 래치 레지스터, 리눅스는 virtio-input |
  | 6 | 호스트↔게스트 통신 | 호스트 단독 명령과, virtio-console 위의 게스트 에이전트 |
  | 7 | 스냅샷 | CPU, RAM, 프레임버퍼, 장치 상태를 저장하고 복원한다 |

- MCP 서버를 만들어 AI 에이전트가 에뮬레이터를 조작하게 하고, Claude Code 플러그인으로 묶는다. (설계자 판단)
  - 호스트 단독 명령(tap, drag, screenshot, snapshot, pause/resume)은 M1 끝에 붙인다. 가장 위험한 M3가 늘어지더라도 AI 부분은 남게 하기 위해서다.
  - 게스트 경유 명령(shell, push, pull)은 M4에 붙인다.
- 에이전트와 함께 만든 과정을 레포에 남긴다. 설계 문서, 계획서, REA 증거 기록이 해당한다. (설계자 판단)
- 공개 데모에 쓰는 게스트 이미지와 스냅샷은 직접 빌드한다.

### 비목표

- 진짜 안드로이드 부팅 (사용자 결정)
- ARM·x86 게스트, F/D/C 확장, 멀티코어, 네트워크, 블록 장치
- 성능 경쟁. WASM JIT는 기본적으로 마지막 선택 과제이고, M2 측정 결과에 따라 앞당길 수 있다(5장).
- 공개 사이트에서 MCP로 조작하는 것. MCP 조작은 플러그인이 로컬에 띄운 페이지에서만 한다. (설계자 판단)
- RN 앱만 돌리는 "RN 가상 폰"(iOS 시뮬레이터 방식). 원리가 다른 별도 프로젝트라 이 프로젝트 다음으로 미룬다. (설계자 판단)
- REA를 이용한 동적 분석. 윈도우에서 검증된 경로가 없다.

### 반목표 (동작하더라도 실패로 보는 것)

- 남의 에뮬레이터 코드나 이미지를 가져다 붙여 동작만 시키는 것. 코드는 이 프로젝트에서 새로 짜야 하고, 사용자가 각 부분이 왜 그렇게 동작하는지 학습 노트로 설명할 수 있어야 한다.
- 에이전트가 학습 노트를 대신 쓰는 것. 에이전트는 읽기 가이드와 REA 증거만 준비한다.
- 라이선스 위반. 남이 빌드한 리눅스 이미지를 공개 배포하는 것, REA 디컴파일 출력이나 바이너리 사본을 게시하는 것이 해당한다.
- 마지막에 한꺼번에 동작하는 구조. 마일스톤마다 그 시점의 데모가 혼자 돌아야 한다.

## 3. 제약

- **개발 환경:** 윈도우 11 개인 PC에서 개발하고, 맥 없이 완성할 수 있어야 한다. 개발 명령과 스크립트는 맥에서도 돌아야 한다. (사용자 환경)
- **언어와 도구:** pnpm + TypeScript를 쓴다. 관례가 없는 새 프로젝트이므로 코드를 쓰기 전에 conventions 스킬을 읽고 그 프리셋을 깐다. (사용자 환경)
- **스크립트:** 윈도우의 `python`은 Store 스텁이라 쓸 수 없다. 보조 스크립트는 node로 쓴다. (사용자 환경)
- **REA (윈도우):** 이 프로젝트에서 쓸 수 있는 것은 Ghidra 엔진으로 x64 PE를 읽기 전용 정적 분석하는 기능이다. 지원 등급은 "실험적 P0"다.
  - 64비트 full JDK 21 이상(javac 포함)과 Ghidra 12.1.x를 직접 설치해야 한다. 로컬에는 JDK 17만 있고 Ghidra는 없다.
  - `rea doctor`는 사용자 전역 MCP 항목만 읽는다. 그래서 local scope로 등록하면 doctor가 그 `env`를 보지 못한다.
  - 일부 윈도우 호스트에서 Ghidra 공급자가 막히는 이슈 #1701이 열려 있다. 이 PC와 같은 빌드(10.0.26200)에서도 실패 보고가 있다.
  - 49 MiB급 바이너리의 분석 시간은 실측이 없다.
- **게스트 빌드:** Buildroot는 리눅스에서 돌려야 하므로 Docker Desktop(WSL 2 백엔드)으로 빌드한다. (로컬 조회, 2026-10-19) Docker Desktop은 설치되어 있지만 실행 중이 아니다. WSL 2에는 docker-desktop과 Ubuntu가 있고 둘 다 정지 상태다.
- **라이선스:**
  - 공개하는 게스트 이미지와 미리 찍은 스냅샷(GPL 바이너리가 든 RAM 이미지)에는 Buildroot `make legal-info` 결과를 함께 공개한다.
  - MIT 코드를 참고해 옮긴 파일에는 원 저작권 표시를 남긴다. r2는 LICENSE 파일이 없어 라이선스를 확인할 수 없으므로 코드를 가져오지 않는다.
  - 안드로이드 에뮬레이터 분석 결과를 게시하기 전에 Android SDK 라이선스 3.4·3.5와 REA DISCLAIMER를 다시 확인한다.
- **문서:** 모든 문서는 한국어 '-다'체로 쓴다. (사용자 환경)

## 4. 구조 (설계자 판단)

### 4.1 런타임

```
Claude Code ⇄(stdio, MCP) MCP 서버 (Node, 세션마다 하나)
                           └─ 127.0.0.1의 빈 포트에 HTTP 서버를 띄운다: 웹 앱 정적 파일 + WebSocket 브리지
                                     ⇅ (같은 origin, 실행마다 바뀌는 토큰)
                           브라우저 탭
                           ├─ 메인 스레드: UI, xterm.js, 포인터 입력, WebSocket 클라이언트 → worker로 중계
                           └─ Web Worker: CPU 루프(구간 단위 실행) + 버스 + 장치 + OffscreenCanvas
                                     ⇅ (virtio-console 포트)
                           게스트 에이전트 (리눅스 안)
```

- **MCP 서버와 페이지:** MCP 서버는 Claude Code 세션마다 하나씩 뜬다. 각 서버는 127.0.0.1의 빈 포트에 자기 페이지와 브리지를 띄우고, 그 URL을 도구 결과로 돌려준다. 같은 폴더에서 세션 여러 개를 돌려도 포트가 겹치지 않고, 세션마다 에뮬레이터 탭이 하나씩 생긴다.
- **브리지 보안:** 브리지는 실행마다 새로 만드는 토큰과 Origin이 맞는 연결만 받는다. 페이지가 브리지와 같은 origin의 localhost에서 열리므로, 공개 사이트에서 로컬로 접속할 때 걸리는 브라우저 로컬 네트워크 접근 제한을 피할 수 있다.
- **CPU 루프:** worker 안에서 정해진 명령 수만큼 실행한 뒤 이벤트 루프에 양보한다. 양보하는 사이에 tap, screenshot, pause, snapshot 메시지를 처리한다. SharedArrayBuffer(COOP/COEP 헤더 필요)에는 기대지 않는다. 그래서 "게스트가 멈춰도 호스트 단독 명령은 동작한다"는 성질이 이 구간 실행에 달려 있다.
- **화면과 스크린샷:** 화면은 `transferControlToOffscreen()`으로 넘긴 OffscreenCanvas에 worker가 직접 그린다. core는 프레임버퍼를 RGBA로 내보내고, 스크린샷 PNG 인코딩은 호스트 쪽이 한다. worker에서는 `OffscreenCanvas.convertToBlob`을 쓸 수 있다(MDN, 확인 2026-10-19, https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/convertToBlob).
- **제어 명령:** 안드로이드의 콘솔과 adb 구조를 따라 두 갈래로 나눈다.
  - **호스트 단독:** tap, drag, screenshot, snapshot save/load, pause/resume. 에뮬레이터가 게스트의 협조 없이 처리한다.
  - **게스트 경유:** shell, push, pull. 게스트 안의 에이전트가 virtio-console 포트로 받아 처리한다.
- **메시지 형식:** 줄 단위 JSON-RPC로 한다. MCP stdio와 같은 틀이다.
- **공개 사이트:** 정적 사이트로 배포하고 MCP 없이 혼자 돈다. 미리 찍은 스냅샷을 정적 URL에서 받아 시작한다.

### 4.2 레포 구성

| 위치 | 내용 |
|---|---|
| `packages/core` | CPU, 버스, 장치, 스냅샷 직렬화. DOM에 의존하지 않아 Node에서도 돈다. riscv-tests 하네스도 여기서 돌린다 |
| `apps/web` | Vite 페이지. worker 호스트, xterm.js, 포인터 입력, WebSocket 클라이언트 |
| `packages/mcp` | MCP 서버(stdio). 로컬 HTTP·WebSocket 브리지를 포함하고, `apps/web` 빌드 결과를 서빙한다 |
| `guest/baremetal` | 단계 1~6의 bare-metal 프로그램: hello, 시계, 그림판, 게스트 응답 루틴 |
| `guest/buildroot` | br2-external 트리: 커널 설정, DTS, 게스트 에이전트, LVGL 앱, Docker 빌드 스크립트 |
| `plugin` | Claude Code 플러그인: MCP 등록과 사용 스킬 |
| `docs/guides` | 에이전트가 쓰는 마일스톤별 읽기 가이드 |
| `docs/rea` | 에이전트가 남기는 REA 증거 요약. 디컴파일 원문은 넣지 않는다 |
| `docs/learn` | 사용자가 쓰는 7단계 학습 노트 |
| `docs/research`, `docs/superpowers` | 조사 문서, 설계 문서, 계획서 |

### 4.3 CPU와 장치 구성

추천안은 B안이고, 중간에 A안을 거친다. android-emulator-internals.md 14절은 RV64·Sv39를 제안하지만, 이 설계는 browser-riscv-linux.md의 근거(JS 비트 연산이 32비트로 계산된다)에 따라 RV32·Sv32로 간다.

- **A안 (중간 마일스톤):** RV32IMA에 M 모드만 쓰는 nommu 리눅스다. 메모리 맵은 mini-rv32ima와 같게 잡는다(UART 0x10000000, CLINT 0x11000000, SYSCON 0x11100000). 그 이미지와 DTB는 로컬 검증용으로만 부팅한다.
- **B안 (최종):** RV32IMA에 Sv32 MMU와 S/U 모드를 넣는다. semu 계열 구성이다.
  - **SBI:** 에뮬레이터가 직접 처리한다. 먼저 BASE(버전 조회와 확장 probe), TIME, SRST를 넣고, 커널이 요구하면 IPI·RFENCE·HSM을 더한다. BASE가 없으면 커널이 SBI v0.1 경로로 빠지는데, `CONFIG_RISCV_SBI_V01`이 꺼져 있으면 타이머가 동작하지 않는다(https://github.com/torvalds/linux/blob/master/arch/riscv/kernel/sbi.c, 확인 2026-10-19).
  - **장치:** 16550 UART, CLINT, PLIC, simple-framebuffer, virtio-mmio 위의 virtio-input(태블릿형 터치, 좌표 0..0x7FFF)과 virtio-console(멀티포트). 선택 장치로 goldfish RTC를 둔다. QEMU `virt` 보드에도 있는, 안드로이드와 같은 계열의 장치다.
  - **게스트:** Buildroot로 직접 빌드한다. 설정은 `BR2_riscv_custom` I·M·A, ILP32, initramfs다. 커널은 C와 FPU를 끄고 `NONPORTABLE`, `FB_SIMPLE`, `FRAMEBUFFER_CONSOLE`, `LOGO`, `VIRTIO_MMIO`, `VIRTIO_INPUT`, `INPUT_EVDEV`, `VIRTIO_CONSOLE`을 켠다. 커널은 6.18 LTS로 고정한다(kernel.org, 예상 EOL 2028-12, 확인 2026-10-19, https://www.kernel.org/category/releases.html).
- **bare-metal 터치 레지스터:** 눌림 상태를 게스트가 읽을 때까지 유지한다(래치). tap은 점을, drag는 선을 그린다.
- **스냅샷:**
  - 담는 것: CPU, RAM, 프레임버퍼 메모리(RAM 밖에 두면 별도 버퍼), 장치 상태
  - 포맷: v86 방식(헤더 + JSON info + 정렬된 바이너리 버퍼)을 따르고, `CompressionStream`(gzip)으로 압축한다
  - 메타: 포맷 버전, 에뮬레이터 버전, 게스트 이미지 해시(커널·DTB 또는 bare-metal 바이너리). 맞지 않는 스냅샷은 거부한다
  - 저장 시점: 명시적인 save 명령으로만 저장한다. 페이지를 닫을 때 저장하지 않는다. 비동기 압축과 IndexedDB 쓰기가 끝까지 완료된다는 보장이 없어서다
  - 저장 위치: 사용자 스냅샷은 IndexedDB에 저장한다. 공개 사이트의 시작 스냅샷은 정적 URL에서 읽는다
  - 복원: CPU 루프를 명령 경계에서 멈춘 뒤 저장하고, 복원할 때 타이머 오프셋을 다시 잡는다. xterm 버퍼는 호스트 메타로 함께 저장하거나, 복원 뒤 줄바꿈을 보내 프롬프트를 다시 띄운다

## 5. 마일스톤

단계 번호는 [browser-riscv-linux.md 6.3절](../../research/browser-riscv-linux.md)의 로드맵을 따른다. 모든 마일스톤은 같은 순서로 끝난다.

1. 에이전트가 구현과 테스트를 끝낸다.
2. 에이전트가 읽기 가이드(`docs/guides`)와 REA 증거(`docs/rea`)를 준비한다.
3. 사용자가 코드를 읽고 학습 노트(`docs/learn`)를 쓴다. 이 단계는 사용자 작업이다.

| 마일스톤 | 구현 (로드맵 단계) | 끝났을 때 보이는 것 | 학습 노트 |
|---|---|---|---|
| M0 준비 | 모노레포 스캐폴드. 윈도우 clang으로 rv32 bare-metal hello 링크 시험(실패하면 Docker의 Buildroot 툴체인 준비). JDK 21과 Ghidra 12.1.x 설치. 셸에서 `JAVA_HOME`·`GHIDRA_INSTALL_DIR`을 지정하고 `npx -y rea-agents@6.7.0 doctor --provider ghidra --json`으로 #1701 확인. REA를 이 프로젝트 local scope로 등록(`claude mcp add --scope local --env ...`로 JDK 21 경로 지정) | REA로 `emulator.exe`를 열어 런처가 qemu 바이너리를 고르는 흐름을 확인한다 | 1 실행과 부팅(런처 부분) |
| M1 미니 OS + AI 조작 | 1~6: RV32I + UART → riscv-tests → M·Zicsr·트랩·CLINT → 프레임버퍼 → 래치 터치 레지스터와 페이지 입력 → 호스트 명령과 스냅샷 v1. 이어서 MCP 서버(호스트 단독 도구), 로컬 브리지, 플러그인 골격 | bare-metal 그림판. drag로 선을 그리고, snapshot save 뒤 새로고침하면 그림이 그대로 살아난다. Claude가 MCP로 그림을 그리고 스크린샷을 찍는다 | 2 CPU, 3 장치, 4 화면, 5 입력 |
| M2 nommu 리눅스 | 7~8: A 확장, mini-rv32ima 이미지 부팅(로컬 전용), 셸 스냅샷 | xterm에 리눅스 셸이 뜨고, 새로고침 뒤 셸에서 이어 간다. 부팅 시간을 잰다 | 7 스냅샷 |
| M3 MMU 리눅스 | 9~12: S/U, Sv32, TLB, SBI(BASE·TIME·SRST), PLIC, Buildroot 이미지(6.18 LTS), simplefb·fbcon, virtio-mmio·virtio-input, LVGL 앱. MCP의 tap이 virtio-input으로 들어간다 | canvas에 펭귄 로고와 LVGL 터치 UI가 나오고, Claude가 탭으로 조작한다 | 1 부팅(커널 진입), 3 장치(virtio), 5 입력(virtio-input) |
| M4 게스트 통신 | 13: virtio-console 멀티포트, 게스트 에이전트, MCP의 shell·push·pull 도구, 플러그인 완성 | 1장의 데모 장면 전체 | 6 호스트↔게스트 통신 |
| M5 공개 | README(한국어, 영문판을 더할지는 빌더 재량), 데모 영상, 공개용 시작 스냅샷, legal-info 묶음(스냅샷 포함), 정적 사이트 배포, 학습 노트 목차 | 공개 레포와 데모 링크 | 전체 목차 |
| 선택 | 14: virtio-gpu 2D, 실제 OpenSBI, 핫 루프 WASM JIT | 성능과 정확도 개선 | - |

**M2 관문:** 이 PC의 Chrome에서 리눅스 셸까지 60초를 넘기면, M3에 들어가기 전에 인터프리터 최적화나 JIT를 앞당길지 다시 정한다. 60초 이내면 계획대로 간다.

## 6. 학습 트랙

학습 노트(`docs/learn/NN-<단계>.md`)는 사용자가 쓴다. 노트마다 같은 틀을 쓴다.

1. **질문:** 이 단계에서 풀려는 궁금증
2. **진짜 안드로이드 에뮬레이터:** AOSP 소스 위치와 REA 증거 요약(함수, 문자열, 호출 관계). 디컴파일 원문은 싣지 않는다
3. **이 에뮬레이터:** 핵심 코드 위치와 동작
4. **차이와 이유:** 규모, 성능, 단순화한 부분

에이전트가 마일스톤마다 준비하는 읽기 가이드(`docs/guides/NN-<단계>.md`)에는 다음이 들어간다.

- 읽을 파일과 읽는 순서
- 노트에서 답할 질문
- 대응하는 REA 증거와 AOSP 소스 위치

단계별 대응은 다음과 같다. 진짜 에뮬레이터 칸의 출처는 android-emulator-internals.md의 해당 절이다.

| 단계 | 진짜 안드로이드 에뮬레이터 | REA·소스 출발점 | 이 에뮬레이터 |
|---|---|---|---|
| 1 부팅 | `emulator.exe`가 `qemu-system-x86_64` 본체를 띄우고, `-kernel`·`-initrd`·`-dtb`로 직접 부팅한다 | `emulator.exe`의 `qemu-system-%s` 실행 서식 문자열 | 커널·DTB를 fetch로 받아 RAM에 올리고 a0/a1로 진입 |
| 2 CPU | WHPX로 게스트를 직접 실행하고, VM exit만 소프트웨어가 처리한다. 바이너리에 TCG 코드(`tcg_accel_class_init`)는 있지만 x86 대상이라 실행 경로에 거의 나오지 않는다 | `whpx_init_vcpu failed`. 해석기 설계는 AOSP `external/qemu`의 `tcg/`, `target/riscv/` 소스 | TS 인터프리터. VM exit 처리는 MMIO 디스패처에 대응 |
| 3 장치 | i440FX pc 보드에 goldfish MMIO 장치와 virtio PCI 장치를 얹는다 | `goldfish_tty` | 주소 범위 테이블, UART·CLINT·PLIC·virtio-mmio |
| 4 화면 | 게스트 GLES/Vulkan을 goldfish pipe로 보내 gfxstream(`libgfxstream_backend.dll`)이 호스트 GPU로 그린다 | 같은 문서 5절 (d) | simplefb 메모리 → canvas. API 포워딩은 하지 않는다 |
| 5 입력 | Qt 이벤트 → SkinEvent → EV_ABS/EV_KEY → virtio-input | 같은 문서 6절 (d) | 포인터 → 래치 레지스터 / virtio-input |
| 6 통신 | 콘솔 5554, adb, gRPC, goldfish pipe, virtio-vsock | 같은 문서 7절 (d) | 호스트 단독 명령 + virtio-console |
| 7 스냅샷 | 퀵부트 = QEMU savevm + 파일 기반 RAM(`ram.img`) + GPU 텍스처 + `snapshot.pb` 호환 검사 | 같은 문서 8절 (d) | IndexedDB / 정적 URL + 메타 호환 검사 |

REA를 쓰는 방식은 다음과 같다.

- 본체는 `qemu\windows-x86_64\qemu-system-x86_64-headless.exe`를 연다.
- 큰 바이너리는 MCP보다 CLI와 증거 JSON으로 다루고, 수십 분 걸리는 것을 전제로 한다.
- 공개 소스는 2025-03(35.6.3)에서 멈췄고, 로컬 바이너리는 36.3.10이다. 소스와 바이너리가 어긋나는 곳은 노트에 적는다.

## 7. 성공 기준

- 1장의 데모 장면이 실패 없이 한 번에 진행된다. 부팅 구간은 배속으로 편집해도 되고, 배속은 화면에 표시한다.
- riscv-tests의 rv32ui, rv32um, rv32ua, rv32mi, rv32si 묶음을 통과하고, 통과표가 페이지나 CI에 나온다.
- 사용자가 쓴 7단계 학습 노트가 모두 있고, 각 노트에 REA 증거나 소스 근거가 하나 이상 있다.
- 공개 데모의 게스트 이미지와 시작 스냅샷이 직접 빌드한 것이고, legal-info가 함께 공개된다.
- 마일스톤마다 그 시점의 데모가 혼자 돈다.

## 8. 빌더에게 맡기는 것

- TS 내부 구조: 디코더 방식, 모듈 경계, 클래스와 함수 중 무엇을 쓸지
- CPU 루프 한 구간의 명령 수
- 테스트 프레임워크, UI 디자인과 페이지 구성
- 단계 4~6에서 더하는 장치(프레임버퍼, 터치 레지스터, 두 번째 UART)의 주소, 9단계 이후의 자체 메모리 맵과 DTS 세부
- 제어 프로토콜의 메시지 세부와 MCP 도구 이름
- 정적 사이트 호스팅 선택. COOP/COEP 헤더를 쓰지 않는다는 전제를 지킨다
- core를 Node에서 헤드리스로 돌려 MCP가 브라우저 없이 쓰는 모드를 둘지. 두면 PNG 인코딩을 Node 쪽에서 따로 처리해야 한다

## 9. 위험과 대응

| 위험 | 대응 |
|---|---|
| 이 PC에서 REA가 막힌다(#1701) | M0에서 doctor로 먼저 확인한다. 막히면 #1701 보고에 있는 MCP `open_binary` 경로를 시도한다. 그것도 안 되면 소스 중심으로 학습하고, 노트에 그 사실을 적는다. 맥에서 돌리는 방안은 조사하지 않았다(미확인) |
| TS 인터프리터로 리눅스를 부팅하는 시간을 모른다 | M2에서 잰다. 60초 관문을 적용하고, 공개 사이트는 시작 스냅샷으로 부팅을 피한다 |
| Buildroot 빌드가 Docker에 의존한다 | Docker named volume에서 빌드하고 결과물만 윈도우로 복사한다. 빌드 시간은 첫 빌드에서 잰다 |
| RV32와 nommu가 업스트림에서 줄어들고 있다 | 커널은 6.18 LTS로 고정한다. nommu는 중간 마일스톤에만 쓴다 |
| 세션 여러 개가 동시에 MCP 서버를 띄운다 | 세션마다 빈 포트와 자기 페이지를 쓴다(4.1) |
| 공개 사이트에서 로컬로 접속할 때 브라우저 제한에 걸린다 | 공개 사이트는 로컬에 접속하지 않는다. MCP 조작은 로컬 페이지에서만 한다(4.1) |
| 소스와 바이너리의 버전 차이(35.6.3 vs 36.3.10) | 어긋나는 곳을 노트에 적는다 |
| 라이선스 | 공개 이미지와 스냅샷은 직접 빌드하고 legal-info를 첨부한다. 분석 결과는 결론과 증거 요약만 게시한다 |

## 10. 남은 미확인 사항

설계에 영향을 주는 것만 옮긴다. 나머지는 각 조사 문서의 미확인 목록을 따른다.

- TS/JS 인터프리터로 RV32 리눅스를 부팅하는 시간 (M2에서 잰다)
- 이 PC에서의 Buildroot 빌드 시간
- 윈도우 clang으로 rv32 bare-metal 링크까지 되는지 (M0에서 확인한다)
- REA로 49 MiB 바이너리를 분석하는 시간과 #1701 재현 여부 (M0에서 확인한다)
