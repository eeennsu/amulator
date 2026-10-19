# 읽기 가이드 03. 장치

학습 노트 `docs/learn/03-devices.md`를 쓰기 위한 읽기 가이드다. 이 파일은 노트를 대신 쓰지 않는다. 노트의 틀(질문, 진짜 에뮬레이터, 이 에뮬레이터, 차이와 이유)은 [설계 6장](../superpowers/specs/2026-10-19-amulator-design.md)을 따른다.

- 범위: 이 에뮬레이터의 메모리 버스와 UART·CLINT, 메모리 맵(M1)과, 진짜 안드로이드 에뮬레이터가 장치를 등록하고 접근을 나르는 방식(QEMU의 `MemoryRegion`, goldfish 장치)이다. 프레임버퍼는 [04 화면](04-display.md), 터치는 [05 입력](05-input.md)에서 다룬다. PLIC와 virtio-mmio는 M3 이후라 아직 코드가 없다.
- 소스 기준: AOSP `platform/external/qemu`의 브랜치 `emu-main-dev`, 커밋 `f0c183f1cc7456ecd6f3607f2f47893768ae4334`(2026-09-15 작성, 확인일 2026-10-19). 아래 줄 번호는 이 커밋의 것이다. 로컬 바이너리는 36.3.10이고 어느 커밋에서 빌드됐는지는 미확인이다.
- REA 증거: [docs/rea/03-devices.md](../rea/03-devices.md). 대상은 GPL 목록에 있는 `qemu-system-x86_64-headless.exe`다. 이 증거는 `goldfish_tty` 문자열과 그것을 참조하는 함수까지다. 콜 그래프를 얻지 못한 이유와 실행 기록은 [docs/rea/README.md](../rea/README.md) 7절에 있다.

## 1. 흐름 한눈에 보기

진짜 에뮬레이터에서 장치는 세 단계로 게스트에 닿는다.

1. 등록: 장치 코드가 `memory_region_init_io`로 주소 범위와 `MemoryRegionOps`(read/write 콜백)를 묶는다(`memory.c` 1528줄). 보드 코드가 그 범위를 게스트 물리 주소에 얹는다. x86 안드로이드 보드는 `pc_piix.c`의 `#if defined(CONFIG_ANDROID)` 블록(260~296줄)에서 goldfish 장치를 `sysbus_create_simple`로 만든다. 주소와 IRQ는 `include/hw/acpi/goldfish_defs.h`(`0xff001000`부터, IRQ 16~23)에 있다.
2. 알림: 게스트가 장치 위치를 알아야 한다. x86은 ACPI AML로 알린다. `build_goldfish_device_aml`(`acpi-build.c` 1038줄)이 장치마다 ID `GFSH0001`~`GFSH0008`(1179~1214줄)을 단 항목을 만들고, 리눅스 드라이버가 이 ID로 매칭한다.
3. 접근: 게스트의 로드·스토어가 VM exit로 올라오면 `address_space_rw`(`exec.c` 3747줄)가 주소로 영역을 찾고(`flatview_translate` 700줄), MMIO면 `memory_region_dispatch_read/write`(`memory.c` 1446, 1490줄)가 장치 콜백을 부른다. 접근 폭이 장치가 선언한 `valid` 범위 밖이면 `memory_region_access_valid`가 거부하고(`MEMTX_DECODE_ERROR`), 범위 안이면 `access_with_adjusted_size`(558줄)가 장치가 구현한 `impl` 크기(`min_access_size`~`max_access_size`)로 나눠 콜백을 부른다.

이 에뮬레이터는 같은 일을 훨씬 작게 한다.

1. 등록: `createMachine`이 UART, CLINT, 프레임버퍼, 터치를 `Device` 배열로 `createBus`에 넘긴다. 주소는 `memoryMap.ts`에 상수로 있고, 게스트 쪽 `hw.h`가 같은 값을 갖는다.
2. 알림: 없다. 게스트 코드가 주소를 상수로 안다. `hwHeader.test.ts`가 두 파일의 값이 같은지 검사한다.
3. 접근: `bus.read`/`bus.write`가 RAM을 먼저 보고, 아니면 `devices.find`로 주소·폭·정렬이 맞는 장치를 찾아 `device.read(offset, width)`를 부른다. 못 찾으면 `BusFault`를 던지고 CPU가 access fault 트랩으로 바꾼다.

## 2. 읽는 순서

이 레포의 파일을 먼저 읽고, REA 증거, AOSP 소스 순으로 간다.

| 순서 | 읽을 것 | 볼 곳 | 확인할 것 |
|---|---|---|---|
| 1 | `packages/core/src/memoryMap.ts` | 전체 | 메모리 맵의 원본이다. UART·CLINT 주소는 mini-rv32ima와 같다 |
| 2 | `packages/core/src/bus.ts` | `Device`, `createBus`의 `ramOffset`, `deviceAt`, `read`, `write`, `fetch` | RAM이 먼저고 장치는 선형 탐색이다. 장치에는 base를 뺀 offset과 폭만큼 자른 값이 간다. 명령어 가져오기는 RAM에서만 한다(장치 읽기에 부작용이 있어서다) |
| 3 | `packages/core/test/bus.test.ts` | `bus 장치`, `bus 매핑되지 않은 주소` | 정렬이 틀리거나 영역 끝을 넘으면 `BusFault`다 |
| 4 | `packages/core/src/devices/uart16550.ts` | `createUart16550`의 `read`, `write`, `receive`, `consumeWakeEvent` | 송신은 쓰는 즉시 끝나고(`LSR_TX_IDLE`), 수신은 큐다. 인터럽트는 없다(파일 안의 `shortcut:` 주석). 바이트 접근만 받는다 |
| 5 | `packages/core/test/uart.test.ts` | 전체 | DLAB 비트로 같은 오프셋이 두 레지스터를 가리키는 동작 |
| 6 | `packages/core/src/devices/clint.ts` | `createClint`의 `read`, `write`, `timerPending`, `saveState`, `loadState` | `mtime`은 시계 값에서 곧바로 계산한다. `mtimecmp`는 32비트 둘로 들고 있어 RV32 게스트가 반쪽씩 쓰는 순서를 따른다. 32비트 접근만 받는다 |
| 7 | `packages/core/test/clint.test.ts` | 전체 | 초기값(타이머 꺼짐), `mtime`이 `mtimecmp`에 닿는 시점, 상위 워드까지 합친 비교, 32비트가 아닌 접근. 저장과 복원은 `snapshot.test.ts`가 본다 |
| 8 | `packages/core/src/machine.ts` | `createMachine`, `syncInterrupts`, `clint`를 감싼 `write` | CLINT에 쓴 직후 `mip`를 맞춘다. 게스트가 `mtimecmp`를 올리면 인터럽트가 곧바로 내려가야 해서다 |
| 9 | `guest/baremetal/hw.h`, `packages/core/test/hwHeader.test.ts` | 레지스터 오프셋 매크로, `SHARED_NAMES` | 두 언어에 같은 상수를 두는 대가를 테스트로 막는다 |
| 10 | `guest/baremetal/hello.c`, `guest/baremetal/clock.c` | `put_str`, `read_mtime`, `write_mtimecmp`, `handle_trap` | 게스트가 장치를 쓰는 쪽이다. `mtimecmp` 상위 워드를 먼저 최대로 올리는 순서(가짜 인터럽트 방지)를 본다 |
| 11 | `guest/baremetal/start.S`, `guest/baremetal/trap.S`, `guest/baremetal/link.ld` | `_start`, `trap_entry` | 게스트가 `mtvec`을 세우고 트랩을 받는 최소 코드다 |
| 12 | `packages/core/test/machine.test.ts` | `hello.elf`, `clock.elf`, `nextTimerDeadlineMicros` | 장치와 CPU가 맞물려 돌아가는 통합 시험 |
| 13 | [docs/rea/03-devices.md](../rea/03-devices.md) | 전체 | 본체 바이너리에서 `goldfish_tty` 문자열을 닻으로 찾아간 주소와 참조 관계(함수가 어떤 문자열을 쓰는가). 콜 그래프는 얻지 못했다 |
| 14 | `memory.c`, `exec.c` | 1절의 줄 | 영역 등록과 접근 디스패치 |
| 15 | `hw/i386/pc_piix.c`, `include/hw/acpi/goldfish_defs.h`, `hw/i386/acpi-build.c` | 위 1절의 줄 | 안드로이드 x86 보드가 장치를 만들고 알리는 곳 |
| 16 | `hw/char/serial.c`, `hw/char/goldfish_tty.c`, `hw/riscv/sifive_clint.c`, `hw/riscv/virt.c` | 아래 4절의 줄 | 이 에뮬레이터의 UART·CLINT·메모리 맵과 나란히 놓고 볼 같은 종류의 장치 |

소스 열람 주소는 커밋으로 고정한다. 경로는 `https://android.googlesource.com/platform/external/qemu/+/f0c183f1cc7456ecd6f3607f2f47893768ae4334/<경로>`다.

## 3. 노트에서 답할 질문

1. 접근 디스패치의 같은 점과 다른 점. QEMU는 `MemoryRegionOps`에 `valid`(게스트가 해도 되는 접근 폭)와 `impl`(콜백이 구현한 폭)을 따로 선언하고, `address_space_rw`가 영역을 찾은 뒤 `valid`를 벗어나면 거부하고 `impl`과 다르면 `access_with_adjusted_size`가 나눠 부른다. 이 에뮬레이터의 `createBus`는 RAM을 먼저 보고 장치를 선형 탐색하며, 폭이나 정렬이 맞지 않으면 나누지 않고 `BusFault`를 낸다. 두 선언이 하나로 합쳐져 있는 셈이다. 이 단순화가 통하는 조건은 무엇이고, M3의 리눅스 드라이버가 들어오면 깨질 수 있는 곳은 어디인가.
2. 게스트가 장치 위치를 아는 방법. x86 안드로이드는 ACPI AML(`GFSH0001`~`0008`)로 알리고, 이 에뮬레이터는 주소를 `hw.h`에 박아 두고 테스트로 일치를 지킨다. 왜 다른가. M3a에서 DTB를 쓰게 되면 `memoryMap.ts`와 `hw.h`의 역할은 어떻게 바뀌는가.
3. 같은 문제(문자를 호스트로 내보내기)의 세 가지 답. `uart16550.ts`, QEMU의 `serial.c`(16550, 8바이트 영역), `goldfish_tty.c`(`TTY_PUT_CHAR`와 `TTY_CMD` 레지스터, 0x1000 영역). 이 에뮬레이터가 16550을 고른 이유는 무엇인가. `goldfish_tty` 문자열이 x86 본체 바이너리에 있는데, x86 보드는 이 장치를 만드는가. 소스(`pc_piix.c`의 goldfish 목록)와 REA 증거를 함께 근거로 답한다.
4. 타이머. QEMU의 `sifive_clint_write_timecmp`는 `mtimecmp`를 쓸 때 이미 지났으면 MTIP를 바로 올리고, 아니면 `timer_mod`로 만기에 콜백이 올리게 한다(이벤트 기반). 이 에뮬레이터는 `timerPending`을 `syncInterrupts`가 256명령어마다, 그리고 CLINT 쓰기 직후에 확인한다(폴링). 어떤 오차가 생기는가. `nextTimerDeadlineMicros`와 worker의 `idleDelayMs`가 이 오차를 어떻게 줄이는가.
5. 상태를 담는 방법. QEMU는 장치마다 `VMStateDescription`을 두고(`goldfish_tty.c` 66줄, `serial.c`의 `vmstate_serial`), 이 에뮬레이터는 `saveState`/`loadState`와 zod 스키마를 둔다. UART의 수신 큐와 `wake` 래치를 왜 저장해야 하는가. 이 질문은 7단계(스냅샷) 노트와 이어지므로 여기서는 장치 쪽 근거만 적는다.

## 4. 대응하는 증거와 소스 위치

| 단계 | 진짜 에뮬레이터 | 출처 | 이 에뮬레이터 |
|---|---|---|---|
| 영역 등록 | `memory_region_init_io` + `MemoryRegionOps` | `memory.c` 1528줄. REA: [docs/rea/03-devices.md](../rea/03-devices.md) | `Device` 타입과 `createBus`의 배열 |
| 접근 디스패치 | `address_space_rw` → `flatview_translate` → `memory_region_dispatch_read/write` | `exec.c` 3747, 700줄, `memory.c` 1446, 1490줄 | `bus.read`/`bus.write` |
| 보드의 장치 목록 | `pc_piix.c`의 goldfish 블록. battery, events, pipe, fb, audio, rtc, sync, rotary | `pc_piix.c` 260~296줄, `goldfish_defs.h`. REA: 같은 문서(ACPI ID 문자열) | `createMachine`의 `[uart, clint, framebuffer, touch]` |
| 게스트에 알리기 | ACPI AML `GFSH0001`~`0008` | `acpi-build.c` 1038, 1161줄, 호출 2056줄 | `hw.h` 하드코딩(M1) |
| UART | 16550: `serial_ioport_read/write`, `impl`이 1바이트 접근만 선언 | `serial.c` 333, 470, 967줄 | `uart16550.ts` |
| 안드로이드 전용 시리얼 | `goldfish_tty`: read 91줄, write 108줄, ops 220줄, 영역 0x1000(238줄) | `goldfish_tty.c`. REA: 같은 문서 | 해당 없음 |
| 타이머·CLINT | SiFive CLINT: `sifive_clint_write_timecmp`(42줄), read(77줄), write(125줄), ops(178줄, 4바이트 접근만) | `sifive_clint.c` | `clint.ts` |
| 메모리 맵 | RISC-V `virt` 보드의 `virt_memmap`: CLINT `0x2000000`, UART0 `0x10000000`, VIRTIO `0x10001000`, DRAM `0x80000000` | `hw/riscv/virt.c` 46~54줄 | `memoryMap.ts`(CLINT는 `0x11000000`) |
| 장치 상태 저장 | `VMStateDescription` | `goldfish_tty.c` 66줄 | `saveState`/`loadState` + zod |

## 5. 소스를 읽을 때 주의할 점

- internals 문서의 줄 번호는 2025-03-27 커밋 `ae9d18d` 기준이다. 이 가이드는 2026-09-15 커밋 기준이다. internals 문서가 적은 `pc_piix.c`의 goldfish 블록 줄(260~296)과 `goldfish_defs.h`의 주소·IRQ 표는 이 커밋의 것과 일치한다.
- 바이너리에 장치 문자열이 있다고 해서 x86 보드가 그 장치를 만드는 것은 아니다. `goldfish_tty.c`는 모든 타깃이 같은 소스를 빌드하므로 문자열이 들어 있지만, 이번에 읽은 `pc_piix.c`와 `hw/arm/ranchu.c`에는 `goldfish_tty`를 만드는 줄이 없다. 어느 보드가 이 장치를 만드는지는 이번에 확인하지 못했다(미확인).
- RISC-V의 `virt` 보드와 SiFive CLINT는 안드로이드 에뮬레이터가 쓰는 보드가 아니라 같은 QEMU 2.12 트리에 들어 있는 비교 대상이다. 안드로이드 SDK에는 RISC-V 본체가 없다([rea-windows.md](../research/rea-windows.md) 5.1절).
- 이 에뮬레이터의 UART·CLINT 주소는 mini-rv32ima와 같고 QEMU `virt` 보드와 다르다(`memoryMap.ts` 주석). M2에서 mini-rv32ima 이미지를 부팅하려고 맞춘 값이다.
- 이 가이드의 소스 설명은 읽은 결과다. 에뮬레이터를 실행해 확인한 것은 없다.
