# REA 증거 03. 장치: goldfish_tty

본체 `qemu-system-x86_64-headless.exe`에서 장치 단계의 닻 문자열 `goldfish_tty`를 따라간 증거 요약이다. 읽기 가이드는 [03-devices.md](../guides/03-devices.md)다. 디컴파일 원문, 어셈블리, 바이너리 조각은 싣지 않았고 주소, 문자열, 함수 크기, 참조 관계, 짧은 설명만 적었다. 대상 파일, 도구 버전, 설정, 시간은 [README.md](README.md) 7절에 있다.

- 확인일: 2026-10-19. 명령: `npx -y rea-agents@6.7.0 trace <대상> "goldfish_tty" --provider ghidra --format json`. 시작 16:25:32, 종료 17:32:22(66분 50초).
- 소스 기준: AOSP `platform/external/qemu` `emu-main-dev` 커밋 `f0c183f1cc7456ecd6f3607f2f47893768ae4334`(2026-09-15). 바이너리(36.3.10)가 어느 커밋에서 빌드됐는지는 미확인이다(아래 4절).

## 1. 문자열

`goldfish_tty`를 포함한 정의된 문자열은 9개다(REA `matches`, 잘림 없음). 주소는 `.rdata`(`0x14227b000`~)에 있다. PE 헤더를 읽어 파일 오프셋을 가상 주소로 바꾼 값(`0x142283800`)과 REA가 보고한 주소가 같았다.

| 주소 | 문자열 | 소스(`hw/char/goldfish_tty.c`) |
|---|---|---|
| `0x142283800` | `goldfish_tty` | `TYPE_GOLDFISH_TTY`(63줄) |
| `0x14228380d` | `goldfish_tty_class_init` | 함수 이름(255줄) |
| `0x142283825` | `C:/buildbot/src/googleplex-android/emu-36-3-release/external/qemu/hw/char/goldfish_tty.c` | 소스 경로(`__FILE__`) |
| `0x14228388b` | `goldfish_tty_realize` | 함수 이름(225줄) |
| `0x1422838a0` | `goldfish_tty: MAX_SERIAL_PORTS(%d) reached\n` | `cpu_abort` 메시지(232줄) |
| `0x1422838cc` | `goldfish_tty_read: Bad offset %llx\n` | `cpu_abort` 메시지(102줄) |
| `0x1422838f0` | `goldfish_tty_write: reading more data than available %d %d\n` | 156줄 |
| `0x14228392c` | `goldfish_tty_write: Bad command %llx\n` | 174줄 |
| `0x142283952` | `goldfish_tty_write: Bad offset %llx\n` | 197줄 |

함수 이름 문자열과 소스 경로 문자열이 바이너리에 있는 까닭은 소스의 QOM 형변환 매크로로 설명된다. `OBJECT_CHECK(type, obj, name)`가 `name`, `__FILE__`, `__LINE__`, `__func__`를 함께 넘기고(`include/qom/object.h` 521~523줄), `goldfish_tty.c`의 `GOLDFISH_TTY(obj)`(64줄)와 `DEVICE_CLASS`가 그 매크로를 쓴다. 이 설명은 소스를 읽은 결과이고, 바이너리에서 매크로 전개를 확인한 것은 아니다.

## 2. 참조 관계

REA가 이 문자열들을 참조하는 주소 18곳(`references`)을 찾았다. 그중 16곳은 함수 4개 안에 있고, 2곳은 `.rdata`의 데이터다. 함수 이름은 모두 Ghidra가 붙인 `FUN_<주소>`다. 바이너리에 심볼이 없기 때문이다.

| 함수 | 크기 | 참조하는 문자열 | 소스에서 가장 가까운 함수(추정) |
|---|---|---|---|
| `0x1400545f0` | 96 B | `goldfish_tty_class_init`, 소스 경로 | `goldfish_tty_class_init`(255줄) |
| `0x140054650` | 368 B | `goldfish_tty` 3곳, 소스 경로 3곳, `goldfish_tty_realize` 3곳, `MAX_SERIAL_PORTS(%d) reached` | `goldfish_tty_realize`(225줄) |
| `0x140054830` | 79 B | `goldfish_tty_read: Bad offset` | `goldfish_tty_read`(91줄) |
| `0x140054880` | 90 B | `goldfish_tty_write: Bad offset` 2곳 | `goldfish_tty_write`(108줄)의 일부(아래 참고) |
| (함수 밖) `0x1422836b0`, `0x142283718` | - | `goldfish_tty`(타입 이름) | `.rdata`의 구조체로 보인다. 소스의 `TypeInfo`(265줄)와 `VMStateDescription`(66줄)이 이름에 같은 문자열을 쓴다(추정) |

- 대응은 문자열 내용과 크기로 맞춘 추정이다. 함수 본체(의사코드)는 읽지 않았다.
- `goldfish_tty_write` 쪽은 불완전하다. 90바이트 함수는 `Bad offset` 문자열만 참조하고, `reading more data than available`과 `Bad command` 문자열에는 코드 참조가 하나도 회수되지 않았다. 소스의 `goldfish_tty_write`는 이 세 메시지를 한 함수에서 낸다(`TTY_CMD` 분기와 `default`). 그래서 이 90바이트를 쓰기 핸들러 전체로 읽지 않는다. Ghidra가 함수 몸체를 이어 붙이지 못했거나 분기 표로만 닿는 코드일 수 있다(추정).
- 이 문자열 주소 `0x142283800`로 향하는 코드 참조는 `0x140054650`(realize) 하나뿐이다. 보드 코드가 이름 `goldfish_tty`로 장치를 만들었다면 호출한 쪽에서도 참조가 있어야 하는데 REA 참조 목록에는 없다. 이는 소스에서 읽은 것(`pc_piix.c`의 goldfish 목록에 tty가 없다)과 맞는다. 단, 같은 문자열을 다른 문자열과 합쳐 쓰는 경우나 명령행(`-device goldfish_tty`)으로 만드는 경우는 이 증거로 배제하지 못한다.
- 호출자·피호출자 관계(콜 그래프)는 이번에 얻지 못했다. 한 번 호출이 67분 걸리는 본체에서 `function`/`xrefs`를 함수마다 따로 돌릴 시간이 없었다. 다음에 이어 가려면 `rea function <대상> 0x140054830`처럼 주소를 주고 같은 설정으로 실행한다([00-pipeline.md](00-pipeline.md) 방식).

### 파일에서 직접 센 인접 문자열

REA 밖에서, 대상 파일의 ASCII 문자열을 읽기 전용으로 찾았다(2026-10-19). 참조나 함수는 보지 않았다. 주소는 PE 헤더로 계산한 가상 주소다.

| 주소 | 문자열 | 소스 |
|---|---|---|
| `0x14227d585` | `goldfish_address_space_area`(1건) | `include/hw/acpi/goldfish_defs.h`의 `GOLDFISH_ADDRESS_SPACE_AREA_NAME` |
| `0x1422c1125` | `GFSH0003`(1건) | `hw/i386/acpi-build.c` 1189줄, 게스트에 goldfish pipe를 알리는 ACPI ID |

- 문자열 `goldfish_pipe`는 7건, `goldfish_events`는 2건 있다. 이 문서는 `goldfish_tty`만 참조 관계까지 따라갔다. 같은 방식으로 `goldfish` 전체(`trace <대상> "goldfish"`)를 한 번에 돌리는 호출은 17:33에 시작했으나 마지막 분석 단계에서 시간 상자(120분)가 끝나 18:25에 중단했다([README.md](README.md) 7절).

## 3. 소스와 대응

| 바이너리 | 소스(`emu-main-dev` `f0c183f1…`) |
|---|---|
| `FUN_1400545f0` | `hw/char/goldfish_tty.c` `goldfish_tty_class_init`(255줄). `dc->realize`, `dc->vmsd`, `dc->props`를 채운다 |
| `FUN_140054650` | 같은 파일 `goldfish_tty_realize`(225줄). `memory_region_init_io(..., 0x1000)`로 영역을 등록하고(238줄) IRQ를 만든다 |
| `FUN_140054830` | 같은 파일 `goldfish_tty_read`(91줄). `TTY_BYTES_READY`, `TTY_VERSION`만 읽는다 |
| `FUN_140054880` | 같은 파일 `goldfish_tty_write`(108줄)의 시작 부분(추정) |
| `.rdata` 구조체 둘 | `goldfish_tty_info`(`TypeInfo`, 265줄), `vmstate_goldfish_tty`(66줄) |

이 에뮬레이터와의 대응은 [가이드 03](../guides/03-devices.md) 4절에 있다. 요점은 `FUN_140054650`이 `memory_region_init_io`로 영역을 등록하는 자리이고, 이 에뮬레이터에서는 `createMachine`이 `Device` 배열을 `createBus`에 넘기는 자리라는 것이다.

## 4. 바이너리와 소스의 어긋남, 한계

- 소스 경로 문자열의 빌드 트리 이름은 `emu-36-3-release`다. 공개 브랜치 목록에 이 이름이 없어서 소스(`emu-main-dev`)와 바이너리는 같은 커밋이 아니다([00-pipeline.md](00-pipeline.md) 2절). 이 파일의 함수 이름과 메시지 문자열은 소스와 같았다.
- 문자열 주소와 참조는 Ghidra의 자동 분석 결과다. 함수 경계가 틀릴 수 있다는 점은 위 `goldfish_tty_write`가 보여 준다.
- 콜 그래프, 함수 본체, 호출 인자는 이번에 보지 않았다.

## 5. 노트에 쓸 수 있는 것

- 바이너리에 장치 코드와 이름 문자열이 있어도 보드가 그 장치를 만든다는 증거는 아니다. 이 바이너리에서 `goldfish_tty`는 자기 realize 함수와 타입 정보 데이터에서만 참조된다.
- 영역 등록 함수(`goldfish_tty_realize` 대응 `FUN_140054650`, 368바이트)와 read 콜백(`FUN_140054830`, 79바이트)은 `MemoryRegionOps` 패턴을 그대로 따른다. 이 에뮬레이터의 `Device.read`/`Device.write`와 같은 역할이다.
- 이 PC에서 49 MiB 바이너리의 REA 호출 하나는 약 67분이 걸렸다(최대 6개를 병렬로 돌린 상태의 값이다). 같은 바이너리를 질의마다 다시 열기 때문이다.
