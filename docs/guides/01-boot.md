# 읽기 가이드 01. 실행과 부팅

학습 노트 `docs/learn/01-boot.md`를 쓰기 위한 읽기 가이드다. 이 파일은 노트를 대신 쓰지 않는다. 노트의 틀(질문, 진짜 에뮬레이터, 이 에뮬레이터, 차이와 이유)은 [설계 6장](../superpowers/specs/2026-10-19-amulator-design.md)을 따른다.

- 범위: 1~5절은 진짜 안드로이드 에뮬레이터의 **런처**(`emulator.exe`)가 `qemu-system-*` 본체를 골라 띄우는 부분까지다(M0). 본체가 QEMU 인자를 조립하고 게스트를 부팅하는 부분은 [android-emulator-internals.md](../research/android-emulator-internals.md) 1.3절과 2절이 이미 다룬다. 6절은 이 에뮬레이터의 부팅(ELF 로드, 진입)과 그 대응 소스다(M1).
- 소스 기준: AOSP `platform/external/qemu`의 브랜치 `emu-main-dev`, 커밋 `f0c183f1cc7456ecd6f3607f2f47893768ae4334`(2026-09-15 작성, 확인일 2026-10-19). 아래 줄 번호는 이 커밋의 것이다. 로컬 바이너리는 에뮬레이터 36.3.10이고, 이 바이너리가 어느 커밋에서 빌드됐는지는 미확인이다(rea-windows.md 5.5절).
- 런처는 REA로 열지 않는다. 로컬 `NOTICE.csv`의 qemu(GPL-2.0-only) 줄에 `emulator.exe`가 없기 때문이다([docs/rea/README.md](../rea/README.md) 4절). 그래서 소스를 읽는다.

## 1. 흐름 한눈에 보기

런처의 `main`은 크게 여섯 단계다. 항목 끝의 괄호는 2절 읽기 순서에서 그 단계를 읽는 번호다. 2절의 0번(배경 읽기)과 2번(OS 버전 확인)은 이 여섯 단계에 들어가지 않는다.

1. 인자 훑기: `-kill`, `-verbose`, `-qemu-top-dir`, `-engine classic` 같은 런처용 옵션을 걸러 낸다. (→ 2절 1번)
2. 옵션 해석: `-avd`/`@이름`, `-no-window`, `-accel-check`, `-list-avds` 등을 플래그로 바꾼다. (→ 2절 3·4번)
3. AVD에서 ABI 읽기: AVD의 `config.ini`에서 대상 CPU 아키텍처(`avdArch`)를 얻는다. (→ 2절 5·6번)
4. 본체 경로 조립: `<에뮬레이터 폴더>\qemu\<OS>-<호스트 CPU>\qemu-system-<게스트 CPU>[-headless].exe`를 만들고 존재하는 후보를 고른다. (→ 2절 7·8번)
5. 환경 준비: DLL 검색 경로(`lib64`, `gles_swiftshader` 또는 `gles_angle`, `vulkan`)와 환경변수를 정한다. (→ 2절 9번)
6. 본체 실행: 인자를 인용한 뒤 `safe_execv`로 본체를 띄운다. 윈도우에서는 exec이 아니라 자식 프로세스를 만들고 기다린다. (→ 2절 10·11번)

런처는 CPU 가속기(WHPX, AEHD, KVM)를 고르지 않는다. `main-emulator.cpp`에는 가속기 관련 코드가 없다(`whpx`, `aehd`, `kvm`, `hvf`로 검색해 0건). 선택은 본체 쪽이다. `android-qemu2-glue/main.cpp`의 2713줄과 2744줄이 `handleCpuAcceleration`을 부른다. 판정 로직은 internals 10.2절이 `CpuAccelerator.cpp` 기준으로 정리했다(그 절은 `emu-master-dev` 기준이다). 런처는 `-accel-check`일 때 `emulator-check accel`을 대신 실행해 줄 뿐이다.

## 2. 읽는 순서

| 순서 | 읽을 것 | 볼 곳 | 확인할 것 |
|---|---|---|---|
| 0 | [android-emulator-internals.md](../research/android-emulator-internals.md) | 1.1절 구조도, 2절 (a)(b)(c) | 런처 뒤에 무엇이 이어지는지 먼저 그린다. 2절 (a)의 1번이 이 가이드의 범위다 |
| 1 | `android/emulator/main-emulator.cpp` | 388~472줄 `main` 시작부와 첫 인자 루프 | `-qemu-top-dir`, `-engine classic`은 다른 런처 바이너리로 넘기는 분기다. 일반 실행에서는 지나간다 |
| 2 | 같은 파일 | 560줄 `checkOsVersion`(정의는 271줄) | 윈도우 7 이상인지만 본다. 하이퍼바이저 검사가 아니다 |
| 3 | 같은 파일 | 587~774줄 둘째 인자 루프 | 옵션이 어떤 플래그로 바뀌는지 표로 정리한다. 헤드리스 변형을 고르는 조건은 `-no-window`와 `-no-qt`뿐이다(691, 696줄) |
| 4 | 같은 파일 | 803~822줄 `-accel-check` | `emulator-check.exe`를 찾아 `accel` 인자로 실행하고 종료한다. 가속기 선택 로직은 여기에 없다 |
| 5 | 같은 파일 | 948~1024줄 AVD → `avdArch` | AVD 이름으로 `config.ini`를 찾고 `path_getAvdTargetArch`로 ABI를 읽는다. 못 읽으면 `x86_64`(AArch64 빌드는 `arm64`)로 가정한다(1023줄) |
| 6 | 같은 파일 | 1044~1058줄 지원 ABI 가드 | `arm64`, `x86`, `x86_64`만 허용한다(168줄 `isCpuArchSupportedByRanchu`). 시스템 이미지 경로를 못 찾으면 `ANDROID_SDK_ROOT`를 안내하며 중단한다 |
| 7 | 같은 파일 | 1287~1312줄 `getQemuArch`, 1314~1358줄 `getQemuExecutablePath` | AVD ABI → QEMU 아키텍처 이름(`x86`은 `i386`, `x86_64`는 `x86_64`) → 경로 서식. 서식은 1337~1338줄의 `qemu-system-%s%s`와 `qemu-system-%s-headless%s` |
| 8 | 같은 파일 | 1101~1135줄 후보 폴더 순회 | `progDirSystem`, `emuDirName`, `argv0DirName` 순서로 폴더를 바꿔 가며 `path_exists`로 존재를 확인한다(주석의 b/65257562는 프로그램 폴더가 틀릴 수 있어서 둔 폴백이다) |
| 9 | 같은 파일 | 1148~1162줄, 1372~1475줄 `updateLibrarySearchPath` | `ANDROID_EMULATOR_LAUNCHER_DIR` 설정, `lib64`·`gles_*`·`vulkan` 폴더를 DLL 검색 경로에 더한다. 비-헤드리스는 Qt 경로도 더한다 |
| 10 | 같은 파일 | 1166~1202줄 | 윈도우에서는 모든 인자를 `win32_cmdline_quote`로 인용하고, `-verbose`면 최종 인자를 출력(1180~1196줄)한 뒤 `safe_execv`를 부른다 |
| 11 | `android/emu/utils/src/android/utils/exec.cpp` | 전체(107줄) | `safe_execv`의 운영체제별 차이. 윈도우는 `_wspawnv(_P_NOWAIT)`로 자식을 만들고 끝날 때까지 기다린 뒤 같은 종료 코드로 `exit`한다. 그 외는 `execv`다 |

소스 열람 주소는 커밋으로 고정한다.

- 런처: `https://android.googlesource.com/platform/external/qemu/+/f0c183f1cc7456ecd6f3607f2f47893768ae4334/android/emulator/main-emulator.cpp`
- `safe_execv`: `https://android.googlesource.com/platform/external/qemu/+/f0c183f1cc7456ecd6f3607f2f47893768ae4334/android/emu/utils/src/android/utils/exec.cpp`

## 3. 노트에서 답할 질문

1. 런처는 무엇을 보고 어떤 본체 바이너리를 고르는가. 이 PC의 AVD `Pixel_4a`(x86_64)와 `-no-window` 유무에 대해 최종 경로를 직접 적어 본다. 경로 서식은 코드의 어느 줄에서 만들어지는가.
2. 런처와 본체는 책임을 어떻게 나눠 갖는가. 가속기 선택, `-accel-check`, 라이브러리 경로 준비는 각각 어느 쪽에 있고, 왜 하나로 합치지 않고 나눴다고 보는가(추정으로 쓰고 근거 줄을 단다).
3. 윈도우의 `safe_execv`는 왜 POSIX의 `execv`처럼 프로세스를 바꿔치지 않고 자식을 만들어 기다리는가. 콘솔 창을 닫을 때(`CTRL_CLOSE_EVENT`)와 Ctrl-C일 때 처리가 다른 이유는 무엇인가(`exec.cpp`의 주석이 단서다).
4. 런처는 본체가 쓸 DLL의 검색 경로를 미리 정해 준다. 이 에뮬레이터는 같은 문제(실행에 필요한 코드와 데이터를 어디서 찾는가)를 브라우저에서 어떻게 푸는가. 규모와 단순화 면에서 무엇이 다른가.
5. 진짜 에뮬레이터에서 커널·initrd·DTB 인자를 조립하는 쪽은 런처가 아니라 본체다. 이 에뮬레이터에서 같은 일(부팅 입력을 RAM에 올리고 진입)을 하는 코드는 어디인가. 6절을 읽고 답한다. `load_linux`가 하는 일(boot protocol 적재, DTB 덧붙이기, option ROM)과 `loadElf`가 하는 일(세그먼트 검증과 복사, `pc`·`a0`·`a1` 설정)을 나란히 적고, 무엇이 없는지(커널, initrd, DTB, 펌웨어)와 그 자리를 M3a에서 무엇이 채우는지 적는다.

## 4. 대응하는 증거와 소스 위치

| 단계 | 진짜 에뮬레이터 | 출처 | 이 에뮬레이터 |
|---|---|---|---|
| 본체 선택 | `main-emulator.cpp`의 `getQemuExecutablePath` | 위 2절 7번. internals 1.1절이 같은 서식 문자열을 로컬 `emulator.exe`에서 확인했다 | 해당 없음. 브라우저에는 고를 본체가 없다 |
| 본체 실행 | `safe_execv`(윈도우는 `_wspawnv` + 대기) | 위 2절 11번 | 페이지가 코어를 돌릴 worker를 시작하는 코드(`apps/web/src/main.ts`의 `run`, 6절) |
| 부팅 입력 | 본체의 `android-qemu2-glue/main.cpp`, `hw/i386/pc.c`의 `load_linux` | internals 2절 (a) 2~3번, (b), 이 가이드 6절 | `Machine.loadElf`(`machine.ts`)와 `parseElf32`·`loadElfIntoRam`(`elf.ts`) |
| REA 증거 | 없음. 런처는 REA 대상이 아니다 | `docs/rea/README.md` 4절 | - |

본체의 부팅 인자 처리(`-android-hw`, `load_linux` 문자열 등)는 M1의 REA 분석 범위에 넣지 않았다. M1의 REA 증거는 CPU, 장치, 입력 세 단계([02-cpu.md](../rea/02-cpu.md), [03-devices.md](../rea/03-devices.md), [05-input.md](../rea/05-input.md))다. 부팅 쪽 본체 분석은 커널 진입을 다루는 M3a의 노트 1에서 만든다(설계 5장). 그때까지 이 단계의 본체 쪽 근거는 internals 2절 (d)의 문자열 목록과 소스다. 파이프라인이 동작하는지는 [docs/rea/00-pipeline.md](../rea/00-pipeline.md)에 있다.

## 5. 소스를 읽을 때 주의할 점

- internals 문서의 줄 번호는 2025-03-27 커밋 `ae9d18d`(`emu-master-dev`) 기준이다. 이 가이드의 줄 번호는 2026-09-15 커밋 기준이라 다르다. 예를 들어 `emulator-check`를 찾는 줄이 774에서 806으로 옮겨 갔다.
- 두 커밋의 `main-emulator.cpp`를 `diff`로 비교했다(2026-10-19). 본체 선택과 실행 흐름은 같다. 달라진 것은 주변부다: `-fishtank` 옵션 추가, `-use-system-libs`와 `crashhandler_init` 호출 제거, 리눅스·맥의 `XDG_RUNTIME_DIR` 처리 추가, `-gpu lavapipe`·`angle` 처리 정리. 윈도우 흐름에는 영향이 없어 보인다(`XDG_RUNTIME_DIR`은 리눅스·맥 전용 블록이다).
- 이 가이드는 소스를 읽은 결과다. 에뮬레이터를 실행해 확인한 것은 없다. 최종 인자를 눈으로 보고 싶으면 `emulator -verbose @Pixel_4a -no-window`가 1180~1196줄의 출력(본체 경로와 인자 목록)을 낸다. 다만 이 명령은 AVD를 실제로 띄우므로 사용자가 정해서 실행한다. 이 가이드를 쓰는 중에는 실행하지 않았다.

## 6. 이 에뮬레이터의 부팅: ELF 로드와 진입 (M1)

진짜 에뮬레이터의 본체는 부팅 입력을 이렇게 받는다. 소스 줄은 이 가이드 위에서 쓴 커밋(`f0c183f1…`)의 것이다.

1. `android-qemu2-glue/main.cpp`가 QEMU 인자를 조립한다: `-kernel`(2879줄), `-initrd`(2885~2887줄, bootconfig를 덧붙인 사본은 3527줄의 `createRamdiskWithBootconfig`), `-dtb`(2921줄), `-append`(3573줄), `-android-hw`(3584줄).
2. `hw/i386/pc.c`의 `load_linux`(842줄)가 bzImage를 읽어 Linux x86 boot protocol로 적재한다. DTB는 `setup_data`(`SETUP_DTB`, 831줄)로 덧붙이고, 커널이 너무 오래되어 DTB를 못 받으면 `Linux kernel too old to load a dtb`(1025줄)로 종료한다. 진입은 option ROM `linuxboot_dma.bin`(1063줄)이 맡는다.

이 에뮬레이터는 커널 대신 bare-metal ELF 하나를 올린다. 순서는 다음과 같다.

1. `apps/web/src/main.ts`가 URL의 `program`(기본 `paint`)을 고르고 worker를 띄워 `start` 메시지를 보낸다. 프로그램 목록은 `programs.ts`가 Vite의 `?url` 가져오기로 `guest/baremetal/out/*.elf`에 묶는다(ELF는 `pnpm guest:build`가 만든다).
2. `emulatorWorker.ts`의 `start`가 `fetch`로 ELF를 받아 `createSession`의 `boot`에 넘긴다. `boot`는 ELF의 SHA-256을 `imageHash`로 구하고(스냅샷을 거부하는 기준이다), 새 머신을 만들어 `loadElf`를 부른 뒤 같은 해시의 스냅샷이 있으면 복원을 시도한다.
3. `Machine.loadElf`(`machine.ts`)가 `parseElf32`로 ELF를 검증해 읽는다: 매직, 32비트, 리틀엔디언, `e_machine`이 RISC-V인지, 프로그램 헤더 범위. 이어서 `loadElfIntoRam`이 모든 `PT_LOAD` 세그먼트가 RAM 안인지 먼저 검사한 뒤(일부만 올라간 채로 실패하지 않게 하려는 것이다) 복사하고, `memsz`가 `filesz`보다 크면 나머지를 0으로 채운다. 그다음 `pc`를 `entry`로, `a0`(hartid)과 `a1`(DTB 포인터)을 0으로 두고 M 모드로 시작한다.
4. 진입점 `_start`(`start.S`)는 링크 스크립트(`link.ld`)가 `.text.init`을 맨 앞에 두어 `0x80000000`(`RAM_BASE`)에 놓인다. 스택 포인터를 RAM 끝(`_stack_top`)으로 잡고, `mtvec`에 `trap_entry`(`trap.S`)를 쓰고, `.bss`를 0으로 채운 뒤 `main`을 부른다. `start.S`는 `a0`·`a1`을 읽지 않고 `.bss` 지우기에 덮어쓴다.

| 순서 | 읽을 것 | 볼 곳 | 확인할 것 |
|---|---|---|---|
| 1 | `apps/web/src/main.ts`, `apps/web/src/programs.ts` | `run`, `PROGRAMS`, `isProgramName` | 모르는 프로그램 이름은 worker를 띄우기 전에 거른다 |
| 2 | `apps/web/src/worker/emulatorWorker.ts` | `start` | 받은 바이트를 그대로 `boot`에 넘기고, 첫 화면을 위해 `dirty`를 올린다 |
| 3 | `apps/web/src/worker/session.ts` | `boot`, `startFresh`, `sha256Hex` | 부팅 입력의 해시가 스냅샷의 호환 기준이다 |
| 4 | `packages/core/src/elf.ts` | `parseElf32`, `loadElfIntoRam`, `ElfError` | 바깥에서 온 바이트를 경계에서 검증한다. 심볼 표는 테스트(`tohost`)가 쓴다 |
| 5 | `packages/core/test/elf.test.ts` | 전체 | 잘린 파일, 다른 `e_machine`, RAM 밖 세그먼트를 거부하는 동작 |
| 6 | `packages/core/src/machine.ts` | `loadElf` | 진입 상태(`pc`, `a0`, `a1`, 특권 모드, `idle`)를 한곳에서 정한다 |
| 7 | `packages/core/test/machine.test.ts` | `loadElf`, `hello.elf` | 진입 직후 상태와, 실제 ELF가 UART로 인사를 내는 것 |
| 8 | `guest/baremetal/link.ld`, `guest/baremetal/start.S` | 전체 | 링커가 정한 주소와 CPU가 시작하는 주소가 `RAM_BASE`에서 만난다 |
| 9 | `android-qemu2-glue/main.cpp`, `hw/i386/pc.c` | 위 1~2번의 줄 | 부팅 입력을 인자로 받아 적재하는 본체 쪽. 열람 주소는 `https://android.googlesource.com/platform/external/qemu/+/f0c183f1cc7456ecd6f3607f2f47893768ae4334/<경로>`다 |

이 절에는 REA 증거가 없다. 본체의 `load_linux` 쪽 REA 분석은 M3a에서 한다(위 4절).
