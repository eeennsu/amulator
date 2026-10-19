# REA 증거 02. CPU: vCPU 시작과 실행 루프

본체 `qemu-system-x86_64-headless.exe`에서 CPU 단계의 닻 문자열 둘(`whpx_init_vcpu failed`, `WHPX: Failed to exec a virtual processor`)을 따라간 증거 요약이다. 읽기 가이드는 [02-cpu.md](../guides/02-cpu.md)다. 디컴파일 원문, 어셈블리, 바이너리 조각은 싣지 않았고 주소, 문자열, 함수 크기, 참조 관계, 짧은 설명만 적었다. 대상 파일, 도구 버전, 설정, 시간은 [README.md](README.md) 7절에 있다.

- 확인일: 2026-10-19. 명령은 둘 다 `npx -y rea-agents@6.7.0 trace <대상> "<문자열>" --provider ghidra --format json`이다.

| 질의 | 시작 | 종료 | 걸린 시간 |
|---|---|---|---|
| `whpx_init_vcpu failed` | 16:25:32 | 17:32:46 | 67분 14초 |
| `WHPX: Failed to exec a virtual processor` | 16:54:12 | 17:57:42 | 63분 30초(힙 4G) |

- 소스 기준: AOSP `platform/external/qemu` `emu-main-dev` 커밋 `f0c183f1cc7456ecd6f3607f2f47893768ae4334`(2026-09-15). 바이너리(36.3.10)가 어느 커밋에서 빌드됐는지는 미확인이다(아래 4절).

## 1. 문자열과 참조

| 주소 | 문자열 | 참조하는 주소 | 포함 함수 |
|---|---|---|---|
| `0x14227c525` | `whpx_init_vcpu failed: %s\n` | `0x14001680d` 한 곳 | `FUN_1400165b0`(`0x1400165b0`~`0x140016852`, 675 B) |
| `0x1422b522a` | `WHPX: Failed to exec a virtual processor` | `0x1401332c0` 한 곳 | `FUN_140132780`(2,864 B) |
| `0x1422b568e` | `WHPX: Failed to exec a virtual processor, hr=%08lx` | `0x140133245` 한 곳 | `FUN_140132780`(같은 함수) |

- 각 `trace`는 정의된 문자열과 참조 전부를 돌려줬다(잘림 없음). 함수 이름은 Ghidra가 붙인 `FUN_<주소>`다. 바이너리에 심볼이 없다.
- 문자열 주소는 PE 헤더에서 계산한 값과 같았다(예: 파일 오프셋 `0x227b525` → 가상 주소 `0x14227c525`, `.rdata`).
- `FUN_140132780`은 구간 5개(`0x140132780`~`0x1401327da`, `0x1401327e0`~`0x1401328db`, `0x1401328e0`~`0x140132955`, `0x140132960`~`0x140132f10`, `0x140132f20`~`0x1401332d1`)로 이뤄진 2,864바이트 함수다. 구간 사이의 틈은 5~6바이트라 정렬 패딩으로 보인다. 두 오류 문자열의 참조 위치(`0x140133245`, `0x1401332c0`)는 모두 함수 끝에 가깝다. 소스에서는 오류 출력이 루프 안에 있으니, 컴파일러가 오류 경로를 뒤로 옮긴 것으로 보인다(추정).
- `FUN_1400165b0`의 참조 위치는 함수 시작에서 `0x25d`(605)바이트 뒤로 역시 끝에 가깝다.

## 2. 소스와 대응

| 바이너리 | 소스(`emu-main-dev` `f0c183f1…`) |
|---|---|
| `0x14227c525` 문자열 | `cpus.c` 1647줄의 `fprintf(stderr, "whpx_init_vcpu failed: %s\n", strerror(-r))` |
| `FUN_1400165b0`(675 B) | `cpus.c` `qemu_whpx_cpu_thread_fn`(1633줄)으로 보인다(추정). 이 함수가 `whpx_init_vcpu`를 부르고(1645줄) 실패하면 위 문자열을 찍고 끝낸 뒤, 성공하면 `whpx_vcpu_exec`를 반복 호출한다(1657줄) |
| `0x1422b568e` 문자열 | `target/i386/whpx-all.c` 1082줄(`whpx_vcpu_run` 안, `WHvRunVirtualProcessor` 호출이 실패했을 때) |
| `0x1422b522a` 문자열 | 같은 파일 1385줄(`whpx_vcpu_exec` 안, `whpx_vcpu_run`이 `fatal`을 돌려줬을 때) |
| `FUN_140132780`(2,864 B) | `whpx_vcpu_exec`(1370줄)와 `whpx_vcpu_run`(1048줄)이 한 함수로 합쳐진 것으로 보인다(추정). 소스에서 두 문자열은 서로 다른 함수에 있는데 바이너리에서는 한 함수가 둘 다 참조한다. `whpx_vcpu_exec`가 `whpx_vcpu_run`을 부르는 구조(1382줄)라 컴파일러가 안으로 펼친 것으로 읽는다. 그렇다면 이 함수 안에 `WHvRunVirtualProcessor` 호출과 exit 이유 `switch`(`whpx-all.c` 1091~1230줄)가 들어 있다 |
| (이번에 보지 않음) | `whpx_init_vcpu`(1310줄), `whpx_handle_mmio`(743줄), `whpx_handle_portio`(832줄), `whpx_handle_halt`(857줄) |

이 에뮬레이터와의 대응은 [가이드 02](../guides/02-cpu.md) 1절과 4절에 있다. 요점은 진짜 에뮬레이터의 실행 루프(`FUN_140132780`)가 "하이퍼바이저에게 실행을 맡기고, 돌아온 exit 이유로 분기하는" 한 함수이고, 이 에뮬레이터에서 같은 자리가 `Machine.run` + `Cpu.step`이라는 것이다.

## 3. 파일에서 직접 센 인접 문자열

REA 밖에서, 대상 파일의 ASCII 문자열을 읽기 전용으로 찾았다(2026-10-19). 가이드의 소스 줄과 같은 문구가 바이너리에 있다는 확인이다. 주소는 PE 헤더로 계산한 가상 주소다. 참조나 함수는 보지 않았다.

| 주소 | 문자열 | 소스 줄 |
|---|---|---|
| `0x1422b57d1` | `WHPX: Failed to parse MMIO access` | `whpx-all.c` `whpx_handle_mmio`(743줄) 안 |
| `0x1422b58fe` | `WHPX: Failed to emulate MMIO access` | 같은 함수 |
| `0x14227b842` | `tcg_accel_class_init` | TCG 가속 클래스가 같은 바이너리에 들어 있다는 표지다([가이드 02](../guides/02-cpu.md) 1절 4번) |

## 4. 바이너리와 소스의 어긋남, 한계

- 소스 경로 문자열의 빌드 트리 이름은 `emu-36-3-release`이고 공개 브랜치 목록에 없다([00-pipeline.md](00-pipeline.md) 2절). 소스(`emu-main-dev`)와 바이너리는 같은 커밋이 아니다. 어긋난 곳으로는 `whpx_vcpu_exec`와 `whpx_vcpu_run`이 바이너리에서 한 함수로 보이는 점이 있다. 다만 이것은 소스 커밋 차이가 아니라 컴파일러의 인라인 결과일 가능성이 크다(추정).
- 이번에 얻은 것은 문자열, 참조 주소, 포함 함수의 크기와 구간이다. 호출자·피호출자(콜 그래프), 함수 본체, exit 이유 `switch`는 보지 못했다. 한 번 호출이 약 65분 걸리는 본체에서 질의를 함수마다 따로 돌릴 시간이 없었다. MMIO exit 처리(`whpx_handle_mmio`, 질의 `WHPX: Failed to parse MMIO access`)는 17:14에 시작했으나 시간 상자(120분) 안에 끝나지 않을 것으로 판단해 17:25에 PID로 중단했다. 이어 가려면 `rea function <대상> 0x140132780`처럼 주소를 주고 같은 설정으로 실행한다([00-pipeline.md](00-pipeline.md) 방식).
- 함수와 소스의 대응은 문자열 내용과 크기로 맞춘 추정이다.

## 5. 노트에 쓸 수 있는 것

- 진짜 에뮬레이터의 x86_64 게스트는 vCPU를 만드는 단계(`whpx_init_vcpu`)가 실패하면 문자열을 찍고 종료하는 구조다. 이 바이너리에서 그 문자열의 참조는 한 곳, 675바이트 함수 하나다.
- 실행 루프는 2,864바이트짜리 함수 하나에 모여 있다(소스의 `whpx_vcpu_exec` + `whpx_vcpu_run`, 소스 기준 추정). 하이퍼바이저 호출의 실패 경로 두 개가 모두 이 함수에서 나온다. 게스트 명령어를 해석하는 코드는 이 루프에 없고, 돌아온 exit 이유를 처리할 뿐이다. 이 에뮬레이터는 반대로 명령어 해석(`execute`)이 루프 한가운데에 있다.
- 같은 바이너리에 TCG 클래스(`tcg_accel_class_init`)와 WHPX 클래스가 함께 있다. 어느 가속기를 쓸지는 실행 시점에 정한다([internals](../research/android-emulator-internals.md) 10절).
- 이 에뮬레이터는 vCPU 스레드, 초기화 실패 경로, exit 이유 분기가 모두 없고 `Machine.run` 하나가 해석 루프를 돈다. 그 차이가 속도(질문 5)와 정확성 확인 방식(질문 4)의 차이로 이어진다.
