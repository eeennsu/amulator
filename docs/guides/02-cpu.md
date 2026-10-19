# 읽기 가이드 02. CPU

학습 노트 `docs/learn/02-cpu.md`를 쓰기 위한 읽기 가이드다. 이 파일은 노트를 대신 쓰지 않는다. 노트의 틀(질문, 진짜 에뮬레이터, 이 에뮬레이터, 차이와 이유)은 [설계 6장](../superpowers/specs/2026-10-19-amulator-design.md)을 따른다.

- 범위: 이 에뮬레이터의 RV32IM 인터프리터(`cpu/`)와, 진짜 안드로이드 에뮬레이터가 게스트 CPU를 돌리는 방식(WHPX의 VM exit 처리와 TCG)이다. 장치 쪽 디스패치는 [03 장치](03-devices.md)에서 다룬다.
- 소스 기준: AOSP `platform/external/qemu`의 브랜치 `emu-main-dev`, 커밋 `f0c183f1cc7456ecd6f3607f2f47893768ae4334`(2026-09-15 작성, 확인일 2026-10-19). 아래 줄 번호는 이 커밋의 것이다. 로컬 바이너리는 에뮬레이터 36.3.10이고 어느 커밋에서 빌드됐는지는 미확인이다([00-pipeline.md](../rea/00-pipeline.md)의 빌드 경로 문자열 `emu-36-3-release`는 공개 브랜치 목록에 없다).
- REA 증거: [docs/rea/02-cpu.md](../rea/02-cpu.md). 대상은 GPL 목록에 있는 `qemu-system-x86_64-headless.exe`다. 이 증거는 문자열과 그것을 참조하는 함수까지다. 콜 그래프를 얻지 못한 이유와 실행 기록은 [docs/rea/README.md](../rea/README.md) 7절에 있고, 호출 관계는 이 가이드의 소스 대응으로 보충한다.

## 1. 흐름 한눈에 보기

진짜 에뮬레이터에서 x86_64 게스트의 명령어는 소프트웨어가 해석하지 않는다. 윈도우에서는 하이퍼바이저(WHPX)가 실행하고, 하이퍼바이저가 소프트웨어에 돌려주는 사건(VM exit)만 소프트웨어가 처리한다.

1. vCPU 스레드 시작: `qemu_whpx_cpu_thread_fn`이 `whpx_init_vcpu`를 부르고, 실패하면 `whpx_init_vcpu failed: %s`를 찍고 종료한다(`cpus.c` 1633~1647줄). 이 문자열이 REA의 출발점이다.
2. 실행 루프: 같은 함수가 `whpx_vcpu_exec`를 반복 호출한다(`cpus.c` 1657줄). 그 안의 `whpx_vcpu_run`이 `WHvRunVirtualProcessor`를 부르고 돌아온 exit 이유를 `switch`로 가른다(`whpx-all.c` 1048~1230줄).
3. MMIO exit: `whpx_handle_mmio`(743줄)가 Windows의 명령어 에뮬레이터(`WHvEmulatorTryMmioEmulation`)에 접근 명령을 풀어 달라고 하고, 콜백이 QEMU의 메모리 디스패치를 거쳐 장치의 read/write를 부른다. 이 부분이 이 에뮬레이터의 `bus.read`/`bus.write` + `Device`에 대응한다.
4. TCG는 같은 바이너리에 들어 있다. `cpu_exec`(`accel/tcg/cpu-exec.c` 676줄)가 번역 블록(TB)을 찾아(`tb_find` 379줄) 실행하고, 인터럽트(`cpu_handle_interrupt` 531줄)와 예외(`cpu_handle_exception` 473줄)를 블록 사이에서 처리한다. x86·x86_64 게스트는 하드웨어 가속이 필수라 이 길을 쓰지 않는다([internals](../research/android-emulator-internals.md) 3절 (a) 2번).

이 에뮬레이터는 모든 명령어를 TS로 해석한다.

1. `Machine.run`이 256개 명령어마다 CLINT 상태를 `mip`에 옮기고(`syncInterrupts`) 쉬는 중인지 본다(`settleIdle`).
2. `Cpu.step`이 `wfi`로 쉬는 중이면 깨울 수 있는지 보고, 걸린 인터럽트를 먼저 받고(`takeInterrupt`), 아니면 명령어 하나를 `execute`한다.
3. `execute`는 `bus.fetch`로 RAM에서 명령어를 가져와 opcode로 가른다. 로드·스토어는 `bus.read`/`bus.write`로 가고, 버스가 던진 `BusFault`는 `step`이 잡아 access fault 트랩으로 바꾼다.

## 2. 읽는 순서

이 레포의 파일을 먼저 읽고, REA 증거, AOSP 소스 순으로 간다. 이 레포 파일은 줄 번호 대신 함수 이름으로 찾는다.

| 순서 | 읽을 것 | 볼 곳 | 확인할 것 |
|---|---|---|---|
| 1 | `packages/core/src/cpu/cpu.ts` | `Cpu.step`, `execute`, `takeInterrupt`, `trap` | 한 번에 명령어 하나를 가져와 해석하는 루프다. 트랩하면 `pc`는 핸들러로 가 있고 그 명령어는 퇴직하지 않는다. C 확장이 없어 모든 명령어는 4바이트 경계다 |
| 2 | 같은 파일 | `alu`, `mulhu`, `mulDiv`, `isTaken`, `load` | 결과가 32비트를 넘거나 음수여도 레지스터(`Uint32Array`)가 감는다. 곱셈 상위 워드는 BigInt 없이 16비트 조각으로 구한다 |
| 3 | `packages/core/src/cpu/csr.ts` | `CsrFile`의 `read`, `write`, `canAccess`, `enterTrap`, `exitTrap` | 지원하는 CSR만 있고 WARL 필드(`mtvec`의 MODE, `mstatus`의 MPP 등)를 쓸 때 걸러 낸다. 권한은 U와 M 둘뿐이다 |
| 4 | `packages/core/src/cpu/cpuState.ts` | `cpuStateSchema`, `saveCpuState`, `loadCpuState` | 스냅샷이 담는 CPU 상태의 전부다. `mip`는 장치가 쓰는 비트라 `setInterruptPending`으로만 복원한다 |
| 5 | `packages/core/src/machine.ts` | `run`, `settleIdle`, `syncInterrupts` | 시계가 명령어와 무관하게 흐르기 때문에 인터럽트 비트를 일정 간격으로 맞춘다. `wfi`를 깨우는 조건은 `mip & mie`와 UART 입력이다 |
| 6 | `packages/core/test/cpu.rv32i.test.ts` | 전체 | 명령어 단위 동작. `packages/core/test/helpers/encode.ts`가 어셈블러 역할을 한다 |
| 7 | `packages/core/test/cpu.trap.test.ts` | `ecall과 ebreak`, `mret`, `CSR 접근`, `WARL 필드`, `인터럽트`, `wfi` | 트랩 진입·복귀 때 `mstatus`가 어떻게 바뀌는지가 테스트 이름에 그대로 있다 |
| 8 | `packages/core/test/cpu.m.test.ts` | 전체 | 곱셈·나눗셈의 경계값(0으로 나누기, 최솟값 나누기 -1) |
| 9 | `packages/core/test/riscvTests.test.ts` | 전체 | 공식 riscv-tests의 ELF(`test/fixtures/riscv-tests/`)를 실제로 적재해 `tohost`에 1이 쓰일 때까지 돌린다. 건너뛴 두 개는 `skip.json`에 이유가 있다(디버그 트리거, PMP) |
| 10 | [docs/rea/02-cpu.md](../rea/02-cpu.md) | 전체 | 본체 바이너리에서 vCPU 시작(`whpx_init_vcpu failed`)과 실행 루프(`WHPX: Failed to exec a virtual processor`)의 문자열을 닻으로 찾아간 주소와 참조 관계. 실행 루프가 함수 하나(2,864 B)로 보인다. 콜 그래프와 MMIO exit 처리는 얻지 못했다 |
| 11 | `cpus.c`, `target/i386/whpx-all.c` | 위 1절의 줄 | vCPU 스레드와 exit 이유 `switch` |
| 12 | `accel/tcg/cpu-exec.c` | 676, 531, 473, 626줄 | TCG의 실행 루프. 이 에뮬레이터의 `Cpu.step`과 같은 자리다 |
| 13 | `target/riscv/helper.c`, `target/riscv/op_helper.c` | `riscv_cpu_do_interrupt`(389), `csr_write_helper`(89), `csr_read_helper`(359), `helper_mret`(640), `helper_wfi`(666) | 같은 RISC-V의 트랩·CSR을 QEMU가 어떻게 구현했는지 이 레포의 `csr.ts`와 나란히 본다 |

소스 열람 주소는 커밋으로 고정한다. 경로는 `https://android.googlesource.com/platform/external/qemu/+/f0c183f1cc7456ecd6f3607f2f47893768ae4334/<경로>`다.

## 3. 노트에서 답할 질문

1. 진짜 에뮬레이터는 게스트 명령어를 직접 해석하지 않고 VM exit만 처리한다. `whpx_vcpu_run`의 exit 이유 중 어떤 것이 이 에뮬레이터의 `execute`·`BusFault`·`wfi` 처리에 대응하는가. MMIO exit와 이 에뮬레이터의 MMIO 디스패처(`createBus`의 `deviceAt`)는 어디가 같고 다른가(03 가이드와 이어진다).
2. TCG의 `cpu_exec` 루프(번역 블록을 찾고, 실행하고, 블록 사이에서 인터럽트를 확인한다)와 이 에뮬레이터의 `Machine.run` + `Cpu.step`은 인터럽트를 확인하는 시점이 어떻게 다른가. 이 에뮬레이터가 256명령어마다 `syncInterrupts`를 부르는 이유는 무엇이고, 그 간격이 게스트에게 어떤 오차로 보이는가.
3. 이 레포의 `enterTrap`·`exitTrap`과 소스의 `riscv_cpu_do_interrupt`·`helper_mret`를 한 줄씩 대조한다. `mstatus`의 MIE·MPIE·MPP를 바꾸는 방식이 같은가. (`op_helper.c` 657줄의 `helper_mret`는 `MSTATUS_MPIE`를 0으로 쓴다. 이 레포는 1로 둔다. 어느 쪽이 스펙과 riscv-tests에 맞는지는 노트에서 확인한다.)
4. 정확성을 어떻게 확인하는가. 이 에뮬레이터는 riscv-tests로, 진짜 에뮬레이터는 하드웨어(WHPX)에 맡기거나 TCG 번역의 테스트로 확인한다. 이 에뮬레이터가 지원하지 않는 것(S 모드, MMU, PMP, A·C 확장)은 무엇이고, 어느 마일스톤에서 들어오는가(설계 5장).
5. 속도의 출처. 한 명령어를 TS로 해석하는 비용과 WHPX가 하드웨어로 실행하는 비용의 차이는 어디서 오는가. 앱 화면의 MIPS 표시(`apps/web/src/main.ts`의 `renderStatus`)가 이 질문의 숫자 근거다. 숫자는 이 PC에서 직접 보고 적는다.

## 4. 대응하는 증거와 소스 위치

| 단계 | 진짜 에뮬레이터 | 출처 | 이 에뮬레이터 |
|---|---|---|---|
| vCPU 시작 | `qemu_whpx_cpu_thread_fn`, `whpx_init_vcpu` | `cpus.c` 1633~1647줄, `whpx-all.c` 1310줄. REA: [docs/rea/02-cpu.md](../rea/02-cpu.md) | `createMachine`이 CPU를 만들고 `loadElf`가 `pc`를 `entry`로 둔다 |
| 실행 루프 | `whpx_vcpu_exec`(1370줄) → `whpx_vcpu_run`(1048줄) | `whpx-all.c`. REA: 같은 문서 | `Machine.run` → `Cpu.step` → `execute` |
| MMIO·PIO exit | `whpx_handle_mmio`(743줄), `whpx_handle_portio`(832줄) | `whpx-all.c`. REA: 같은 문서 | `bus.read`/`bus.write`(03 가이드) |
| 인터럽트 | WHPX는 실행 직전 `whpx_vcpu_pre_run`(875줄)이 대기 중인 인터럽트를 `WHvRegisterPendingInterruption`(941줄)으로 넣고, 지금 못 넣으면 `DeliverabilityNotifications`(961줄)를 걸어 `X64InterruptWindow` exit(1099줄)를 받는다. TCG는 `cpu_handle_interrupt` | `whpx-all.c`, `cpu-exec.c` 531줄 | `takeInterrupt`와 `syncInterrupts` |
| 쉬기 | `X64Halt` exit(1104줄) → `whpx_handle_halt`(857줄). RISC-V 소스는 `helper_wfi`가 `halted = 1` | `whpx-all.c`, `op_helper.c` 666줄 | `wfi`는 `cpu.idle`을 켜고 `settleIdle`이 깨운다 |
| CPU 정의 | `android64` 모델(`target/i386/cpu.c`) | internals 3절 (a) 1번 | RV32IM + Zicsr, M·U 모드 |
| 명령어 해석 | TCG 번역(`target/i386/translate.c`). RISC-V는 `target/riscv/translate.c`의 `decode_RV32_64G`(1708줄) | 소스만 | `execute`의 `switch` |
| 가속기 선택 | `CpuAccelerator.cpp`, `handleCpuAcceleration` | internals 10절 | 해당 없음 |

## 5. 소스를 읽을 때 주의할 점

- internals 문서의 줄 번호는 2025-03-27 커밋 `ae9d18d` 기준이다. 이 가이드는 2026-09-15 커밋 기준이라 `whpx_vcpu_run`이 1015줄에서 1048줄로, `whpx_handle_mmio`가 710줄에서 743줄로 옮겨 갔다.
- 이 소스의 `target/riscv`는 QEMU 2.12 시대의 초기 RISC-V 포트다. `insn32.decode`, `csr.c`는 이 트리에 없다(받아 보니 404였다). 명령어 해석은 `translate.c`, CSR 읽기·쓰기는 `op_helper.c`에 있다. 특권 사양 버전은 `cpu.c` 114줄의 `PRIV_VERSION_1_10_0` 같은 값으로 정한다. 최신 QEMU의 RISC-V 구현과 다르다.
- 안드로이드 SDK에는 RISC-V용 QEMU 본체가 없다. 로컬 `qemu\windows-x86_64\`에는 x86_64, i386, aarch64, armel만 있다([rea-windows.md](../research/rea-windows.md) 5.1절). 그래서 RISC-V 소스는 "같은 일을 QEMU가 이렇게 한다"는 비교 대상이고, REA로 열어 볼 바이너리는 아니다.
- WHPX의 Windows API(`WinHvPlatform.dll`, `WinHvEmulation.dll`)는 SDK에 없고 이름 문자열로 런타임에 해석한다(internals 3절 (c)). 이 API의 공식 문서는 조사 허용 출처 밖이라 읽지 않았다. QEMU 쪽 설명은 소스만 근거로 삼는다.
- 이 가이드의 소스 설명은 읽은 결과다. 에뮬레이터를 실행해 확인한 것은 없다.
