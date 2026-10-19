# 읽기 가이드 04. 화면

학습 노트 `docs/learn/04-display.md`를 쓰기 위한 읽기 가이드다. 이 파일은 노트를 대신 쓰지 않는다. 노트의 틀(질문, 진짜 에뮬레이터, 이 에뮬레이터, 차이와 이유)은 [설계 6장](../superpowers/specs/2026-10-19-amulator-design.md)을 따른다.

- 범위: 이 에뮬레이터의 프레임버퍼 장치와 canvas로 그리는 경로(M1)와, 진짜 안드로이드 에뮬레이터가 게스트의 그래픽 호출을 호스트 창으로 나르는 gfxstream 경로다. 게스트 쪽(simplefb, fbcon)은 M3b라 아직 코드가 없다.
- **REA 증거가 없다.** 화면 경로의 핵심인 `libgfxstream_backend.dll`은 로컬 `NOTICE.csv`의 qemu(GPL-2.0-only) 줄에 없어서 REA로 열지 않는다([docs/rea/README.md](../rea/README.md) 4절). 그래서 `docs/rea/04-display.md`는 만들지 않았고, 이 가이드는 AOSP 소스만 근거로 한다. 헤드리스 본체 바이너리 쪽 접합부(`opengles`, `android_setOpenglesRenderer` 문자열)는 [internals](../research/android-emulator-internals.md) 5절 (c)가 이미 확인했고, REA로 따라가지는 않았다.
- 소스 기준: 에뮬레이터 쪽은 AOSP `platform/external/qemu`의 `emu-main-dev` 커밋 `f0c183f1cc7456ecd6f3607f2f47893768ae4334`(2026-09-15, 확인일 2026-10-19)다. gfxstream은 별도 저장소 `platform/hardware/google/gfxstream`의 `main` 브랜치 커밋 `d047a57228332d995d36600792fa9ccc26cf8ae6`(2025-03-26 작성, 확인일 2026-10-19)다. 로컬 바이너리(36.3.10)가 이 gfxstream 커밋과 대응하는지는 미확인이다. 아래 줄 번호는 각각 이 커밋의 것이다.

## 1. 흐름 한눈에 보기

진짜 에뮬레이터에서 게스트의 앱은 GPU를 모른다. 그래픽 호출이 호스트로 가서 그려진다.

1. 게스트의 GLES/Vulkan 라이브러리가 호출을 바이트 스트림으로 직렬화해 goldfish pipe(`pipe:opengles`)로 보낸다.
2. 호스트에서 `OpenglEsPipe`가 스트림을 받고, gfxstream의 `RenderThread::main`(`host/RenderThread.cpp` 282줄)이 게스트 스레드마다 하나씩 돌며 디코더에 넘긴다.
3. 화면에 올리는 호출은 `rcCompose`(`host/RenderControl.cpp` 1238줄), `rcFlushWindowColorBuffer`(858줄), `rcFBPost`(938줄)다. `FrameBuffer::post`(`host/FrameBuffer.cpp` 1741줄)가 색 버퍼를 화면에 보인다.
4. 에뮬레이터가 넘긴 Qt 창 핸들 아래에 gfxstream이 자식 창을 만들고(`FrameBuffer::setupSubWindow` 849줄, 윈도우는 `NativeSubWindow_win32.cpp` 60~64줄의 `CreateWindowExA`, `WS_CHILD|WS_DISABLED`) 거기에 호스트 GL/Vulkan으로 그린다. 에뮬레이터와 렌더러의 접합은 `android/android-emu/android/opengles.cpp`다(`initLibrary` 224줄, `initRenderer` 577줄, `android_showOpenglesWindow` 869줄).
5. 스크린샷·녹화는 다른 길이다. `FrameBuffer::setPostCallback`(801줄)이 post 때 픽셀을 콜백으로 넘긴다(`doPostCallback` 1899줄).

예전 방식의 `goldfish_fb`도 같은 소스 트리에 있다. 게스트가 쓴 메모리를 장치가 읽어 호스트 화면에 복사하는 단순 프레임버퍼이고, 호스트 GPU 모드가 켜지면 갱신을 건너뛴다(`hw/display/goldfish_fb.c`의 `s_use_host_gpu`, 351줄과 472줄).

이 에뮬레이터는 가장 단순한 방식이다.

1. 게스트(`paint.c`)가 `0x12000000`부터의 프레임버퍼 영역에 XRGB8888 픽셀을 직접 쓴다. 장치(`createFramebuffer`)가 그 바이트를 들고 있고 쓸 때마다 `dirty`를 올린다.
2. worker의 실행 구간 끝에서 `draw`가 `dirty`면 `toRgba`로 RGBA로 바꿔 `OffscreenCanvas`에 `putImageData`하고 `dirty`를 내린다.
3. 브리지의 screenshot 요청은 `capture`가 같은 변환 뒤 `convertToBlob`으로 PNG를 만든다.

## 2. 읽는 순서

이 레포의 파일을 먼저 읽고, AOSP 소스 순으로 간다.

| 순서 | 읽을 것 | 볼 곳 | 확인할 것 |
|---|---|---|---|
| 1 | `packages/core/src/memoryMap.ts` | `FB_BASE`, `FB_WIDTH`, `FB_HEIGHT`, `FB_STRIDE` | 320×480, 픽셀당 4바이트, 한 줄 1280바이트 |
| 2 | `packages/core/src/devices/framebuffer.ts` | `createFramebuffer`, `write`, `toRgba` | 장치가 곧 메모리다. 정렬된 1·2·4바이트 접근을 모두 받고 쓰면 `dirty`가 오른다. 픽셀은 `0x00RRGGBB`로 저장되고 `toRgba`가 R,G,B,255 순서로 바꾼다 |
| 3 | `packages/core/test/framebuffer.test.ts` | 전체 | 크기, `dirty`, 리틀엔디언 저장 |
| 4 | `guest/baremetal/paint.c` | `fill_screen`, `draw_brush`, `draw_line` | 게스트가 `volatile` 포인터로 프레임버퍼에 쓴다. 붓은 화면 밖으로 나가면 자른다 |
| 5 | `packages/core/test/paint.test.ts` | 전체 | ELF를 실제로 돌려 픽셀 값을 확인한다(흰색 채우기, 선, 모서리) |
| 6 | `apps/web/src/worker/emulatorWorker.ts` | `draw`, `capture`, `runSlice`, `start`의 `ImageData` 생성 | 한 구간(12 ms) 뒤에 한 번 그린다. 게스트가 화면을 쓰지 않아도 첫 화면은 `dirty`를 올려 그린다 |
| 7 | `apps/web/src/main.ts` | `canvas.transferControlToOffscreen`을 부르는 끝부분 | 그리기를 worker로 넘겨 메인 스레드가 입력만 받게 한다 |
| 8 | `packages/core/src/snapshot.ts` | `BUFFER_FRAMEBUFFER`, `restoreSnapshot`의 마지막 줄 | 프레임버퍼 메모리도 스냅샷에 담긴다. 복원하면 `dirty`를 올려 다시 그린다 |
| 9 | `hw/display/goldfish_fb.c` | `goldfish_fb_update_display`(223줄), `goldfish_fb_read`(388줄), `goldfish_fb_write`(451줄), `s_use_host_gpu`(25줄) | 단순 프레임버퍼 장치가 갱신 주기와 인터럽트를 어떻게 다루는지. 이 에뮬레이터의 프레임버퍼에는 없는 부분이다 |
| 10 | `android/android-emu/android/opengles.cpp` | 1절의 줄 | 에뮬레이터가 렌더러 라이브러리를 열고 창을 넘기는 접합부 |
| 11 | gfxstream `host/FrameBuffer.cpp`, `host/RenderControl.cpp`, `host/RenderThread.cpp`, `host/NativeSubWindow_win32.cpp` | 1절의 줄 | 렌더 스레드가 호출을 받아 색 버퍼를 창에 올리는 경로 |
| 12 | [internals](../research/android-emulator-internals.md) | 5절 (a)(b) | 게스트 쪽(인코더, `HostConnection`, hwc3의 `rcCompose`)까지 이어지는 전체 그림 |

소스 열람 주소는 커밋으로 고정한다.

- 에뮬레이터: `https://android.googlesource.com/platform/external/qemu/+/f0c183f1cc7456ecd6f3607f2f47893768ae4334/<경로>`
- gfxstream: `https://android.googlesource.com/platform/hardware/google/gfxstream/+/d047a57228332d995d36600792fa9ccc26cf8ae6/<경로>`

## 3. 노트에서 답할 질문

1. 픽셀이 화면에 닿는 길을 단계별로 적고 복사 횟수를 센다. 진짜 에뮬레이터는 게스트의 그래픽 명령이 호스트 GPU로 가서 자식 창에 그려지고, 이 에뮬레이터는 게스트가 쓴 바이트를 `toRgba`로 바꿔 canvas에 올린다. 각각 어디서 데이터가 복사되고 어디서 변환되는가.
2. 한 프레임의 끝을 누가 아는가. gfxstream에서는 `rcFBPost`와 `FrameBuffer::post`가 프레임 경계를 알린다. 이 에뮬레이터에는 프레임 개념이 없고 `dirty` 플래그와 worker의 12 ms 구간이 그리는 시점을 정한다. 게스트가 그리는 도중에 구간이 끝나면 어떻게 보이는가(그리다 만 화면이 그려질 수 있는가).
3. 색 형식. 이 에뮬레이터는 왜 XRGB8888로 정했고 `toRgba`가 왜 필요한가. gfxstream의 색 버퍼(`ColorBuffer`)는 어떤 형식을 쓰는지 소스(`host/ColorBuffer.h`)에서 찾아 비교한다.
4. `goldfish_fb`와 이 에뮬레이터의 프레임버퍼는 둘 다 "메모리를 장치가 들고 호스트가 읽어 간다"는 구조다. 어디가 같고 다른가. 최신 안드로이드 이미지가 `goldfish_fb` 드라이버 대신 gfxstream을 쓰는 이유는 무엇인가(internals 5절 (b)가 이 드라이버가 메인라인과 `kernel/common` android15-6.6에 없다고 적었다). M3b에서 이 에뮬레이터가 simplefb를 쓰는 이유와 이어서 적는다.
5. 스크린샷. 이 에뮬레이터의 `capture`(프레임버퍼 → canvas → PNG)와 진짜 에뮬레이터의 `setPostCallback`(post마다 픽셀을 콜백으로 전달) 중 어느 쪽이 "지금 화면"을 더 정확히 찍는가. 멈춘 상태(pause)에서도 찍히는 이유는 무엇인가.

## 4. 대응하는 증거와 소스 위치

| 단계 | 진짜 에뮬레이터 | 출처 | 이 에뮬레이터 |
|---|---|---|---|
| 게스트의 그리기 | GLES/Vulkan 호출을 직렬화해 pipe로 보낸다 | internals 5절 (a) 1~2번 | `paint.c`가 프레임버퍼에 직접 쓴다 |
| 호스트 수신 | `OpenglEsPipe`, `RenderThread::main` | gfxstream `host/RenderThread.cpp` 282줄 | `Machine.run`이 쓰기를 곧바로 처리한다 |
| 화면에 올리기 | `rcCompose`, `rcFlushWindowColorBuffer`, `rcFBPost`, `FrameBuffer::post` | `host/RenderControl.cpp` 1238, 858, 938줄, `host/FrameBuffer.cpp` 1741줄 | `draw`의 `putImageData` |
| 창 | 자식 창 `setupSubWindow` | `host/FrameBuffer.cpp` 849줄, `host/NativeSubWindow_win32.cpp` 60~64줄 | `OffscreenCanvas`(메인 스레드의 canvas에서 넘겨받음) |
| 에뮬레이터 접합 | `libgfxstream_backend`를 열고 `initRenderer` | `opengles.cpp` 224, 577, 869줄 | 해당 없음 |
| 스크린샷 | `setPostCallback` → `doPostCallback` | `host/FrameBuffer.cpp` 801, 1899줄 | `capture` |
| 단순 프레임버퍼 | `goldfish_fb` | `hw/display/goldfish_fb.c` | `createFramebuffer` |
| REA 증거 | 없음. gfxstream은 REA 대상이 아니다 | `docs/rea/README.md` 4절 | - |

## 5. 소스를 읽을 때 주의할 점

- gfxstream은 `external/qemu`와 다른 저장소이고 브랜치도 다르다. 위 gfxstream 커밋은 `+log/refs/heads/main`의 맨 위 항목이다(2025-03-26, 확인일 2026-10-19). 이 저장소의 `main`은 그 뒤 갱신이 없는 것으로 조회됐고, 그 뒤의 gfxstream 개발이 어디서 이뤄지는지는 확인하지 못했다(미확인). 에뮬레이터 `emu-main-dev`(2026-09-15)가 어느 gfxstream 커밋을 묶는지도 미확인이라 줄 번호가 어긋날 수 있다.
- internals 5절의 gfxstream 줄 번호(예: `setupSubWindow` 849줄)는 이 가이드의 번호와 같다. 에뮬레이터 쪽 줄 번호(`opengles.cpp`)는 커밋이 달라 다르다.
- 게스트가 gfxstream 대신 `goldfish_fb`를 쓰는 구성은 로컬 이미지에 없다(internals 5절 (b)). 그래서 `goldfish_fb`는 "같은 문제를 푸는 가장 단순한 장치"로 읽는다.
- 이 가이드의 소스 설명은 읽은 결과다. 에뮬레이터를 실행해 확인한 것은 없다.
