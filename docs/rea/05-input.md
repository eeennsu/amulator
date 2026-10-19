# REA 증거 05. 입력: virtio-input 멀티터치

본체 `qemu-system-x86_64-headless.exe`에서 입력 단계의 닻 문자열 둘을 따라간 증거 요약이다. 읽기 가이드는 [05-input.md](../guides/05-input.md)다. 디컴파일 원문, 어셈블리, 바이너리 조각은 싣지 않았고 주소, 문자열, 함수 크기, 참조 관계, 짧은 설명만 적었다. 대상 파일, 도구 버전, 설정, 시간은 [README.md](README.md) 7절에 있다.

## 0. Qt 경로는 소스로만 다뤘다

마우스가 `SkinEvent`가 되기까지의 Qt 구간(`EmulatorQtWindow`, `skin_ui_process_events`)은 헤드리스 EXE에 없다([internals](../research/android-emulator-internals.md) 6절 (c): `Qt6` 문자열 0건). 비-헤드리스 `qemu-system-x86_64.exe`(61,264,024 B)는 **REA로 열지 않았다**. 호출 하나가 헤드리스 본체(51,576,472 B)에서도 약 66~67분 걸렸고, 더 큰 이 파일이 같은 시간 상자(120분) 안에 끝난다는 보장이 없어서 헤드리스 쪽 증거를 우선했다. 그래서 Qt → `SkinEvent` → `EV_ABS` 구간은 `emu-main-dev` 소스만 근거다([가이드 05](../guides/05-input.md) 1절의 1~3번).

REA 밖에서, 비-헤드리스 EXE의 ASCII 문자열을 읽기 전용으로 센 결과(2026-10-19)는 다음과 같다. 문자열이 있다는 확인이고 참조나 함수는 보지 않았다.

| 문자열 | 헤드리스 | 비-헤드리스 |
|---|---|---|
| `EmulatorQtWindow` | 0건 | 78건 |
| `virtio_input_multi_touch_pci_1` | 3건 | 3건 |
| `Unexpected MTS pointer update` | 1건 | 1건 |

멀티터치 변환 코드(`multitouch-screen.c`)와 virtio-input 장치 코드는 두 변형에 모두 있고, Qt 창 코드는 비-헤드리스에만 있다.

## 1. 장치 타입 이름: `virtio_input_multi_touch_pci_1`

- 확인일: 2026-10-19. 명령: `npx -y rea-agents@6.7.0 trace <대상> "virtio_input_multi_touch_pci_1" --provider ghidra --format json`. 시작 16:34:00, 종료 17:39:19(65분 19초). 같은 질의를 16:25에 한 번 시작했다가 메모리 압박으로 16:30에 중단하고 다시 돌린 값이다([README.md](README.md) 7절).
- 소스 기준: AOSP `platform/external/qemu` `emu-main-dev` 커밋 `f0c183f1cc7456ecd6f3607f2f47893768ae4334`(2026-09-15). 바이너리(36.3.10)가 어느 커밋에서 빌드됐는지는 미확인이다.

질의는 부분 문자열이라 `pci_1`로 시작하는 `pci_1`, `pci_10`, `pci_11`이 모두 걸렸다. 정의된 문자열 3개와 참조 6곳이다(잘림 없음).

| 문자열 | 주소 | 코드 참조(함수, 크기) | 데이터 참조(함수 밖 `.rdata`) |
|---|---|---|---|
| `virtio_input_multi_touch_pci_1` | `0x142440cef` | `0x14054ac04`, `FUN_14054abf0`(78 B) | `0x1424405e8` |
| `virtio_input_multi_touch_pci_10` | `0x142440e06` | `0x14054aed4`, `FUN_14054aec0`(78 B) | `0x142440990` |
| `virtio_input_multi_touch_pci_11` | `0x142440e26` | `0x14054af24`, `FUN_14054af10`(78 B) | `0x1424409f8` |

- 문자열 주소는 PE 헤더에서 계산한 값과 같았다(`.rdata`).
- 세 함수는 모두 78바이트이고, `pci_1`과 `pci_10`의 시작 주소 간격이 `0x2d0`, `pci_10`과 `pci_11`의 간격이 `0x50`이다. `0x2d0`은 `0x50`(80바이트 정렬)의 9배라서, 같은 크기의 함수가 `id` 순서대로 80바이트 간격으로 붙어 있다는 뜻이다. 소스에서는 매크로 `VIRTIO_INPUT_MT_PCI_INSTANCE_INIT(id)`(`android-qemu2-glue/emulation/virtio-input-multi-touch.c` 449줄)가 `id` 1~11마다 인스턴스 초기화 함수 `virtio_input_multi_touch_pci_init<id>`를 찍어 낸다. 이 함수는 `OBJECT_CHECK`로 형변환하고(`TYPE_VIRTIO_INPUT_MULTI_TOUCH_PCI(id)` 문자열이 거기 쓰인다, 48~50줄) `virtio_instance_init_common`을 부른다(추정: 크기와 문자열 사용에서 맞춘 것이다).
- 데이터 참조 세 곳은 `.rdata`의 구조체 항목으로 보인다. `pci_10`(`0x142440990`)과 `pci_11`(`0x1424409f8`)은 `0x68`(104)바이트, `pci_1`(`0x1424405e8`)과 `pci_10`은 `0x3a8`(= 9 × `0x68`) 떨어져 있다. 소스의 `TypeInfo`(`include/qom/object.h` 467줄)는 64비트에서 포인터 크기 필드 13개(`name`부터 `interfaces`까지)라 104바이트이고, 소스의 `types[]`(481줄)가 `VIRTIO_INPUT_MT_PCI_TYPE_INFO(id)`(473줄)를 `id` 순서로 연달아 놓는다. 간격이 모두 104의 배수인 것은 이 항목들이 `TypeInfo`라는 추정과 맞는다.
- 바이너리에 `_2`~`_9`는 이 질의에 걸리지 않았다(문자열이 `pci_1`을 포함하지 않아서다). 11개가 모두 있는지는 이번에 확인하지 않았다.

## 2. 멀티터치 변환: `Unexpected MTS pointer update`

- 명령: `npx -y rea-agents@6.7.0 trace <대상> "Unexpected MTS pointer update" --provider ghidra --format json`. 시작 16:42:33, 종료 17:47:24(64분 51초). 힙은 `GHIDRA_HEADLESS_MAXMEM=4G`였다.

| 문자열 | 주소 | 참조 | 포함 함수 |
|---|---|---|---|
| `Unexpected MTS pointer update for tracking id: %d` | `0x14244000d` | `0x140548d8f` 한 곳 | `FUN_140548930`(`0x140548930`~`0x140549039`, 1,802 B) |

- 소스에서 이 문자열은 `multitouch_update_pointer`(`android/android-emu/android/multitouch-screen.c` 785줄)가 "처음 보는 포인터인데 압력이 0"일 때 찍는 디버그 메시지다(799줄). 그래서 `FUN_140548930`을 `multitouch_update_pointer`로 본다(추정). 이 함수는 가이드 05의 4번 단계, 곧 마우스를 손가락 슬롯·압력·좌표의 `EV_ABS` 열로 바꾸는 함수다. 소스에서 이 함수는 `_mts_pointer_down`, `_mts_pointer_up`, `_mts_pointer_move`를 부르는데, 바이너리의 함수가 1,802바이트로 큰 것은 그 정적 함수들이 안으로 들어와 있기 때문으로 보인다(추정, 확인하지 않았다).
- 참조 위치는 함수 시작에서 `0x45f`(1,119)바이트 뒤다.

## 3. 소스와 대응

| 바이너리 | 소스(`emu-main-dev` `f0c183f1…`) |
|---|---|
| `FUN_14054abf0`, `FUN_14054aec0`, `FUN_14054af10`(각 78 B) | `virtio-input-multi-touch.c` `virtio_input_multi_touch_pci_init<id>`(449줄 매크로). 타입 `virtio_input_multi_touch_pci_<id>`의 인스턴스 초기화 |
| `.rdata`의 세 항목(`0x1424405e8`, `0x142440990`, `0x1424409f8`) | `types[]`의 `VIRTIO_INPUT_MT_PCI_TYPE_INFO(id)`(473, 481줄). `.name`이 타입 이름 문자열이다(추정) |
| `FUN_140548930`(1,802 B) | `multitouch-screen.c` `multitouch_update_pointer`(785줄). 마우스 눌림·이동·뗌을 `EV_ABS` 열로 푼다 |
| (이번에 보지 않음) | `virtio-input.c` `virtio_input_send`(22줄). 문자열 `virtio_input_send`가 파일에 2건 있으나 참조는 따라가지 않았다 |

이 에뮬레이터와의 대응은 [가이드 05](../guides/05-input.md) 4절에 있다. 요점은 두 가지다. 진짜 에뮬레이터는 마우스 하나를 `FUN_140548930` 같은 변환 함수가 여러 `EV_ABS` 이벤트로 풀어 virtio 장치로 보내고, 이 에뮬레이터는 `{x, y, down}` 한 샘플을 장치 큐에 넣는다. 그리고 장치 타입은 슬롯 개수(11개)만큼 복제되어 있다.

## 4. 바이너리와 소스의 어긋남, 한계

- 소스 경로 문자열의 빌드 트리 이름은 `emu-36-3-release`이고 공개 브랜치 목록에 없다([00-pipeline.md](00-pipeline.md) 2절). 소스와 바이너리는 같은 커밋이 아니다. 이 문서에서 어긋난 곳은 찾지 못했다. 이름 매크로와 함수 모양은 소스와 같았다.
- 얻은 것은 문자열, 참조 주소, 포함 함수의 크기다. 호출자·피호출자(콜 그래프), 함수 본체는 보지 못했다. 그래서 `virtio_input_send`로 이어지는 호출은 바이너리에서 확인하지 못했고 소스(`multitouch_update_pointer` → `_push_event` → `user_event_generic` → `android_virtio_send_event_as_mt` → `virtio_input_send`)만 근거다.
- 함수와 소스의 대응은 문자열 내용과 크기로 맞춘 추정이다.
- Qt 구간은 위 0절대로 REA로 열지 않았다.

## 5. 노트에 쓸 수 있는 것

- virtio-input 장치 타입은 `virtio_input_multi_touch_pci_<1..11>`로 11개가 슬롯처럼 복제되어 등록된다. 바이너리에서는 같은 모양의 78바이트 인스턴스 초기화 함수가 타입마다 하나씩 보인다. 이 에뮬레이터는 터치 장치가 하나이고 한 손가락(`down` 플래그)이다.
- 마우스를 `EV_ABS` 열로 바꾸는 함수(`FUN_140548930`)는 1,802바이트로, 78바이트짜리 초기화 함수들보다 훨씬 크다. 슬롯, 트래킹 ID, 압력 처리가 들어 있어서다(소스 기준). 이 에뮬레이터에는 이 구간에 해당하는 코드가 없고 `{x, y, down}` 샘플이 곧바로 장치 큐로 간다.
- Qt 구간을 소스로만 읽었다는 점과 그 이유를 노트에 그대로 적는다.
