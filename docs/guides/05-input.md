# 읽기 가이드 05. 입력

학습 노트 `docs/learn/05-input.md`를 쓰기 위한 읽기 가이드다. 이 파일은 노트를 대신 쓰지 않는다. 노트의 틀(질문, 진짜 에뮬레이터, 이 에뮬레이터, 차이와 이유)은 [설계 6장](../superpowers/specs/2026-10-19-amulator-design.md)을 따른다.

- 범위: 이 에뮬레이터의 포인터 → 터치 레지스터 경로(M1)와, 진짜 안드로이드 에뮬레이터의 마우스 입력이 virtio-input으로 게스트에 닿는 경로다. M3b에서 이 에뮬레이터도 virtio-input으로 바뀌므로, 그때 노트 5를 이어 쓸 수 있게 virtio-input 쪽을 함께 읽는다.
- 소스 기준: AOSP `platform/external/qemu`의 브랜치 `emu-main-dev`, 커밋 `f0c183f1cc7456ecd6f3607f2f47893768ae4334`(2026-09-15 작성, 확인일 2026-10-19). 아래 줄 번호는 이 커밋의 것이다. 로컬 바이너리는 36.3.10이고 어느 커밋에서 빌드됐는지는 미확인이다.
- REA 증거: [docs/rea/05-input.md](../rea/05-input.md). virtio-input 장치 쪽은 GPL 목록에 있는 헤드리스 본체 `qemu-system-x86_64-headless.exe`로 본다. Qt → SkinEvent 경로는 헤드리스 EXE에 없다(Qt6 문자열이 0건, [internals](../research/android-emulator-internals.md) 6절 (c)). 비-헤드리스 `qemu-system-x86_64.exe`는 열지 않았고, 이 경로는 소스로만 다뤘다. 이유는 [docs/rea/05-input.md](../rea/05-input.md) 0절에 있다.

## 1. 흐름 한눈에 보기

진짜 에뮬레이터에서 마우스 클릭은 일곱 단계를 거쳐 게스트의 `EV_ABS` 이벤트가 된다.

1. 호스트 창: 비-헤드리스 본체의 Qt 창(`EmulatorQtWindow`)이 마우스 이벤트를 받는다(`mouseMoveEvent` 1335줄, `mousePressEvent` 1435줄, `mouseReleaseEvent` 1508줄, `emulator-qt-window.cpp`). 자식 창(gfxstream)은 입력을 못 받아서 부모 Qt 창이 받는다([04 화면](04-display.md)).
2. 스킨 이벤트: 창이 `SkinEvent`(`kEventMouseButtonDown`, `kEventMouseMotion` 등)를 만들어 큐에 넣고(`handleMouseEvent` 3001줄, `queueSkinEvent` 2294줄), `skin_ui_process_events`(`ui.c` 272줄)가 종류별로 나눠 윈도 모듈로 보낸다(330~344줄).
3. 에이전트: 스킨 윈도가 함수 표 `win_funcs->mouse_event`(`window.c` 1156, 1173줄)를 부른다. 이 표가 사용자 이벤트 에이전트의 `sendMouseEvent`, 곧 `user_event_mouse`(`qemu-user-event-agent-impl.c` 112줄, 에이전트 표 215줄)로 이어진다고 보이지만 표를 채우는 곳은 이번에 따라가지 않았다(미확인). `user_event_mouse`는 VirtioInput 기능이 켜져 있고 virtio 마우스·태블릿 기능이 꺼져 있으면 `android_virtio_send_mouse_as_mt`(`virtio-input-multi-touch.c` 547줄)로 간다. 그 밖의 조합은 다른 경로로 가는데 이번에 끝까지 읽지 않았다.
4. 멀티터치 변환: 좌표를 화면 크기에서 `0..0x7FFF` 범위로 바꾸고(`qemu_input_scale_axis`, 570~573줄) `translate_mouse_event`(69줄)가 `multitouch_update_pointer`(`multitouch-screen.c` 785줄)를 부른다. 이 함수가 눌림·이동·뗌을 손가락 슬롯, 트래킹 ID, 압력, 좌표의 `EV_ABS` 이벤트 열(`ABS_MT_SLOT`, `ABS_MT_TRACKING_ID`, `ABS_MT_PRESSURE`, `ABS_MT_POSITION_X/Y`)로 풀고 마지막에 `EV_SYN`/`SYN_REPORT`를 붙인다. 이벤트 하나는 `_push_event`(125줄)가 에이전트의 `sendGenericEvent`로 내보낸다. 터치스크린 이벤트(`kEventTouch*`)는 `android_virtio_send_touch_as_mt`(93줄) → `multitouch_update`(759줄)로 같은 모양의 열이 된다.
5. 장치 선택: `sendGenericEvent`는 `user_event_generic`(`qemu-user-event-agent-impl.c` 84줄)이다. VirtioInput이 켜져 있으면 `android_virtio_send_event_as_mt`(`virtio-input-multi-touch.c` 520줄)로 virtio-input에, 아니면 `goldfish_events`에 보낸다.
6. virtio 장치: `virtio_input_send`(`hw/input/virtio-input.c` 22줄)가 이벤트를 모아 두었다가 `SYN_REPORT`가 오면 가상 큐(virtqueue)에 한꺼번에 넣고 게스트에 알린다(`virtio_notify`). 큐에 빈 칸이 모자라면 그 묶음을 통째로 버린다(`virtio_input_queue_full`, 53줄).
7. 게스트: 커널의 virtio-input 드라이버가 이벤트를 받아 Android의 입력 파이프라인으로 보낸다. 이 부분은 이 가이드의 범위 밖이다.

gRPC `sendTouch`(`EmulatorService.cpp` 502줄)는 5번 자리로 합류한다. `TouchEventSender`가 에이전트의 `sendGenericEvents`를 부른다(`TouchEventSender.cpp` 163줄). 이 에뮬레이터의 브리지 tap·drag가 가는 길과 같은 자리다.

이 에뮬레이터는 같은 일을 단순하게 한다.

1. 포인터: `main.ts`가 canvas의 `pointerdown`/`pointermove`/`pointerup`을 받고, `toFramebufferPoint`가 화면상 좌표를 프레임버퍼 좌표(0..319, 0..479)로 바꾼다. 눌린 상태에서만 움직임을 보낸다.
2. worker: 샘플 `{x, y, down}`을 `touchFeeder`에 줄 세운다. 실행 구간마다 터치 장치에 자리가 있는 만큼 넣고 게스트를 돌린다.
3. 장치: `TouchDevice`가 큐(깊이 64)의 맨 앞 샘플을 `COUNT`/`X`/`Y`/`DOWN` 레지스터로 보여 주고, `POP`을 쓰면 하나 꺼낸다. 인터럽트는 없다.
4. 게스트: `paint.c`가 `COUNT`를 폴링해 샘플을 읽고 `POP`한 뒤 선을 그린다.

## 2. 읽는 순서

이 레포의 파일을 먼저 읽고, REA 증거, AOSP 소스 순으로 간다.

| 순서 | 읽을 것 | 볼 곳 | 확인할 것 |
|---|---|---|---|
| 1 | `apps/web/src/main.ts` | `pointerdown`, `pointermove`, `pointerup`, `pointercancel` 리스너 | `isPrimary`만 받고 `setPointerCapture`로 canvas 밖에서 뗀 것도 잡는다. 취소된 포인터는 마지막 점에서 뗀다 |
| 2 | `apps/web/src/pointer.ts`, `apps/web/test/pointer.test.ts` | `toFramebufferPoint` | canvas가 화면에서 어떤 크기로 보이든 정수 좌표로 바꾸고 범위 밖은 자른다 |
| 3 | `apps/web/src/worker/emulatorWorker.ts` | `self.onmessage`의 `touch` 분기, `runSlice`, `sendGesture`, `settleTouch`, `cancelTouch` | 손으로 한 입력과 브리지의 tap·drag가 같은 줄을 지난다. 브리지 응답은 게스트가 샘플을 모두 꺼낸 뒤에 보낸다 |
| 4 | `apps/web/src/worker/touchFeeder.ts`, `apps/web/test/touchFeeder.test.ts` | `enqueue`, `feed`, `isConsumed` | 장치 큐가 차면 오래된 샘플을 버리므로, 자리가 날 때마다 나눠 넣는다. 티켓으로 "내가 넣은 마지막 샘플을 게스트가 꺼냈는가"를 판정한다 |
| 5 | `packages/core/src/devices/touch.ts` | `createTouchDevice`의 `read`, `write`, `push` | 읽기는 큐를 줄이지 않는다. `POP`을 써야 줄어든다. 빈 큐의 `X`·`Y`·`DOWN`은 0이다. 32비트 접근만 받는다 |
| 6 | `packages/core/test/touch.test.ts` | 전체 | 좌표 자르기, 큐가 차면 가장 오래된 것을 버리는 동작 |
| 7 | `guest/baremetal/paint.c` | `main` | 인터럽트가 없으니 `wfi` 없이 `COUNT`를 폴링한다. `down`이 이어지면 이전 점과 선으로 잇고, 아니면 점 하나를 찍는다 |
| 8 | `packages/core/test/paint.test.ts` | `누른 채 움직이면`, `탭은 점 하나만`, `손을 뗀 뒤 다시 누르면` | 입력 샘플 열이 그림이 되는 규칙을 테스트 이름이 말해 준다 |
| 9 | `packages/core/src/control/gestures.ts`, `packages/core/test/gestures.test.ts` | `tapEvents`, `dragEvents` | tap은 누름 + 뗌 두 샘플, drag는 `steps + 1`개의 누름 샘플 뒤 끝점의 뗌 하나다 |
| 10 | `packages/core/src/control/protocol.ts` | `bridgeRequestSchema`의 `tap`, `drag`, `pointSchema` | 호스트 단독 명령이 들어오는 좌표를 경계에서 검증한다 |
| 11 | [docs/rea/05-input.md](../rea/05-input.md) | 전체 | 본체 바이너리의 장치 타입 이름 `virtio_input_multi_touch_pci_<id>`와 멀티터치 변환 함수(`multitouch_update_pointer`로 추정)의 주소와 참조 관계. 콜 그래프는 얻지 못했다 |
| 12 | `hw/input/virtio-input.c` | `virtio_input_send`(22줄) | 이벤트를 `SYN_REPORT`까지 모아 한꺼번에 큐에 넣는 부분. 큐가 모자라면 묶음을 버리는 부분(50줄 부근) |
| 13 | `android-qemu2-glue/emulation/virtio-input-multi-touch.c` | 타입 매크로(40~60줄), `android_virtio_send_touch_as_mt`(93줄), 설정 표(179~310줄) | 장치 타입 이름 `virtio_input_multi_touch_pci_<id>`, 게스트에 알리는 `ABS_MT_*` 범위(`ABS_MT_SLOT`의 최댓값 등) |
| 14 | `android/android-emu/android/multitouch-screen.c` | `multitouch_update`(759줄), `multitouch_update_pointer`(785줄) | 눌림·이동·뗌이 슬롯과 `EV_SYN`으로 바뀌는 방식 |
| 15 | `android-qemu2-glue/qemu-user-event-agent-impl.c` | `user_event_generic`(84줄), `user_event_touch`(103줄), `user_event_mouse`(112줄) | virtio-input과 goldfish_events 중 고르는 곳 |
| 16 | `android/android-ui/modules/aemu-ui-qt/src/android/skin/qt/emulator-qt-window.cpp`, `android/android-ui/modules/aemu-ui-window/src/android/skin/ui.c` | 위 1절의 줄 | 호스트 창의 마우스 이벤트가 스킨 이벤트가 되는 곳 |

소스 열람 주소는 커밋으로 고정한다. 경로는 `https://android.googlesource.com/platform/external/qemu/+/f0c183f1cc7456ecd6f3607f2f47893768ae4334/<경로>`다.

## 3. 노트에서 답할 질문

1. 입력의 표현. 진짜 에뮬레이터는 클릭 하나를 슬롯, 트래킹 ID, 압력, 위치의 `EV_ABS` 이벤트 열과 `SYN_REPORT`로 풀어 보낸다. 이 에뮬레이터는 `{x, y, down}` 한 샘플이다. 무엇을 버렸고(멀티터치, 압력, 펜) 그 덕에 게스트 코드(`paint.c`)가 얼마나 단순해졌는가. 좌표 변환은 어디서 일어나는가(`toFramebufferPoint`와 `qemu_input_scale_axis`의 `0..0x7FFF`).
2. 전달 방식. 진짜 에뮬레이터는 virtqueue에 이벤트를 넣고 게스트에 알린다(`virtio_notify`). 이 에뮬레이터는 인터럽트 없이 게스트가 `COUNT`를 폴링한다(`touch.ts`의 `shortcut:` 주석). 이 선택의 대가는 무엇인가(CPU를 계속 쓴다). M3b에서 virtio-input으로 바꾸면 무엇이 달라지는가.
3. 흐름 제어. `virtio_input_send`는 큐에 빈 칸이 없으면 `SYN_REPORT`까지의 묶음을 통째로 버린다. `TouchDevice.push`는 큐(64)가 차면 가장 오래된 샘플을 버리고, 그래서 `touchFeeder`가 자리가 날 때마다 나눠 넣는다. 두 방식은 무엇을 지키려는가(묶음의 일관성 대 순서와 완전성). 브리지의 tap·drag가 응답을 게스트가 샘플을 꺼낸 뒤에 보내는 이유는 무엇인가.
4. 호스트 단독 명령의 합류점. 이 에뮬레이터는 브리지의 tap·drag를 `gestures.ts`가 샘플 열로 만들어 손으로 한 입력과 같은 줄에 넣는다. 진짜 에뮬레이터의 gRPC `sendTouch`는 어디서 마우스 입력과 합류하는가(`TouchEventSender`가 부르는 `sendGenericEvents`와 `user_event_generic`). 합류 지점이 늦을수록 무엇이 달라지는가.
5. REA 증거와 소스의 대응. 본체 바이너리의 장치 타입 이름 `virtio_input_multi_touch_pci_1`과 소스의 `TYPE_VIRTIO_INPUT_MULTI_TOUCH_PCI(id)` 매크로(46줄)는 어떻게 대응하는가. Qt 창에서 시작하는 앞 구간은 REA로 확인했는가, 소스로만 읽었는가. 확인하지 못한 부분을 노트에 그렇게 적는다.

## 4. 대응하는 증거와 소스 위치

| 단계 | 진짜 에뮬레이터 | 출처 | 이 에뮬레이터 |
|---|---|---|---|
| 호스트 입력 | Qt 창의 마우스 이벤트 | `emulator-qt-window.cpp` 1335, 1435, 1508줄. REA: 헤드리스 EXE에 없음([docs/rea/05-input.md](../rea/05-input.md)) | canvas의 포인터 이벤트(`main.ts`) |
| 이벤트 큐 | `SkinEvent`와 `queueSkinEvent`, `skin_ui_process_events` | `emulator-qt-window.cpp` 2294줄, `ui.c` 272줄 | worker의 `touchFeeder` |
| 변환 | 마우스는 `translate_mouse_event` → `multitouch_update_pointer`, 터치스크린은 `multitouch_update`. 둘 다 `EV_ABS` 열 + `EV_SYN`으로 푼다 | `virtio-input-multi-touch.c` 69줄, `multitouch-screen.c` 785, 759줄 | `TouchSample {x, y, down}` |
| 좌표 | `qemu_input_scale_axis`로 `0..0x7FFF` | `virtio-input-multi-touch.c` 570~573줄(마우스), 113~116줄(터치) | `toFramebufferPoint`로 `0..319`, `0..479` |
| 장치 선택 | virtio-input 또는 goldfish_events | `qemu-user-event-agent-impl.c` 78~94줄(`user_event_generic`) | 해당 없음(터치 레지스터 하나) |
| 장치 | `virtio_input_multi_touch_pci_<id>` | `virtio-input-multi-touch.c` 46, 179~310줄. REA: [docs/rea/05-input.md](../rea/05-input.md) | `createTouchDevice` |
| 전달 | virtqueue에 넣고 `virtio_notify` | `virtio-input.c` 22~70줄. REA: 같은 문서 | 레지스터 폴링(`COUNT`) |
| 호스트 단독 입력 | gRPC `sendTouch` → `TouchEventSender` | `EmulatorService.cpp` 502줄, `TouchEventSender.cpp` 163줄 | 브리지 `tap`/`drag` → `gestures.ts` |

## 5. 소스를 읽을 때 주의할 점

- internals 문서의 줄 번호는 2025-03-27 커밋 `ae9d18d` 기준이다. 이 가이드의 줄은 2026-09-15 커밋을 직접 읽어 적었으므로 둘이 다르면 이 가이드를 따른다. internals 6절은 마우스가 `multitouch-screen.c`에서 `EV_ABS` 열로 바뀐다고 적었다. 이 커밋에서 그 변환은 마우스가 `multitouch_update_pointer`(785줄), 터치스크린이 `multitouch_update`(759줄)다.
- 이 소스의 마우스 경로는 마우스를 손가락 하나로 다룬다(`translate_mouse_event`가 버튼 상태에서 압력을 정해 `multitouch_update_pointer`를 부른다). "마우스 한 번 = 손가락 하나의 down/update/up"이고, 이 에뮬레이터의 `down` 샘플과 가장 가까운 대응이다.
- 게스트 쪽(커널 virtio-input 드라이버, Android `EventHub`)은 이 가이드의 범위 밖이다. internals 6절 (a) 6번이 흐름을 적었다.
- 이 가이드의 소스 설명은 읽은 결과다. 에뮬레이터를 실행해 확인한 것은 없다.
