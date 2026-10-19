# 브라우저 TS RISC-V 미니 에뮬레이터 리서치

- 작성일·확인일: 2026-10-18. 아래 모든 출처는 이 날짜에 확인했다.
- 목적: TypeScript로 브라우저에서 도는 미니 에뮬레이터를 만들어 작은 리눅스(또는 직접 만든 미니 OS)를 부팅하고, 안드로이드 에뮬레이터의 7단계(부팅, CPU, 메모리·MMIO, 화면, 입력, 호스트↔게스트 통신, 스냅샷)를 작게나마 모두 거친다.
- 표기: 문장 끝의 `[Sn]`은 맨 아래 출처 표의 번호다. 출처 없이 내린 결론은 "판단:"으로 시작한다. 확인하지 못한 값은 "미확인"이라고 쓴다.
- 줄 수는 원격 소스 파일을 받아 `wc -l`로 센 값이다(공백·주석 포함). 아무것도 설치하거나 빌드하지 않았다.

## 0. 결론

추천은 **B안: RV32IMA + Sv32 MMU + S/U 모드 + 에뮬레이터가 SBI를 직접 처리하는 구성**이다. semu와 같은 계열이다. 장치는 16550 UART, CLINT, PLIC, simple-framebuffer, 그리고 virtio-mmio 위의 virtio-input(터치)과 virtio-console(제어 채널)이다. 게스트는 Buildroot로 직접 빌드한 MMU 리눅스다.

가는 길에 A안(nommu 리눅스)을 중간 마일스톤으로 쓴다. bare-metal 단계에서 어차피 M 모드 트랩을 만들기 때문에, 여기에 A 확장만 더하면 mini-rv32ima가 배포하는 1.5MB 남짓한 nommu 이미지가 부팅된다. MMU를 붙이기 전에 정수 코어와 트랩을 리눅스로 검증할 수 있다.

근거 요약(자세한 내용은 6장):

1. JS 비트 연산은 피연산자를 32비트 정수로 바꿔 계산한다 [S60]. RV32 레지스터는 JS 숫자 하나에 맞고, RV64는 BigInt나 32비트 쌍이 필요하다. 판단: TS 구현에서는 RV32가 코드량과 속도 모두 유리하다.
2. RV32IMA + MMU로 리눅스가 실제로 돈다. semu는 RV32IMA, RV32 MMU, S/U 모드, 자체 SBI로 리눅스를 부팅하고 virtio-input·virtio-gpu까지 갖췄다 [S16][S17]. 커널 설정에서 압축 명령어(C)와 FPU를 끈다 [S17].
3. nommu는 업스트림 전망이 불안하다. 2024년에 "2027년 초 제거 예정" 문구를 넣는 폐기 패치가 올라왔고 [S29], LWN은 NOMMU 제거가 2028년 무렵으로 잡혀 있다고 전했다 [S30]. 2026-10-18 기준 메인라인(7.3-rc7)의 `config MMU`에는 폐기 문구가 없다 [S27][S28]. 또 simpledrm과 virtio-gpu 드라이버는 MMU를 요구한다 [S33][S34].
4. 안드로이드 에뮬레이터 구조와 바로 대응된다. 안드로이드 에뮬레이터는 2019년부터 멀티터치용 virtio input 장치를 쓴다 [S49]. 호스트 쪽 제어(에뮬레이터 콘솔)와 게스트 쪽 데몬(adb)을 나누는 방식도 그대로 옮길 수 있다 [S50][S52].

## 1. 기존 사례

### 1.1 한눈에 보기

| 프로젝트 | 브라우저 실행 방식 | 게스트 ISA | MMU | 주요 장치 | 규모 | 라이선스 | 성능·부팅 | 최근 push |
|---|---|---|---|---|---|---|---|---|
| mini-rv32ima (cnlohr) | 없음. C 단일 헤더이고 README에 JS/WASM 포팅 언급이 없다 [S1] | rv32ima + Zifencei + Zicsr, su 일부. README는 Zifencei와 RV32A를 "stubbed"라고 적는다 [S1] | 없음. nommu, M 모드 커널 [S1][S4][S5] | 16550 UART, CLINT, SYSCON, DTB 로딩 [S1][S4] | 핵심 "약 400줄", 데모 래퍼 약 250줄 [S1]. wc 기준 `.h` 548줄, `.c` 520줄 [S2][S3] | MIT [S26] | 노트북에서 약 450 coremark, QEMU의 절반 [S1]. `make testdlimage`로 "약 2.5초"(인터넷 속도에 따라) [S1] | 2025-12-21 [S26] |
| TinyEMU / JSLinux (Bellard) | C를 Emscripten으로 JS·WASM 빌드 [S9][S11] | RV128IMAFDQC까지(32/64/128비트), 사용자 ISA 2.2, 특권 1.10 [S8] | sv32/sv39/sv48 [S9] | CLINT, PLIC, HTIF, virtio-mmio(console·net·block·input·9P), simple-framebuffer [S8][S9] | 최상위 `.c/.h` 합계 26,972줄(x86 포함). RISC-V CPU 약 3,100줄, `virtio.c` 2,650줄, `simplefb.c` 127줄 [S9] | MIT [S8] | x86 에뮬은 2017년 데스크톱 Firefox에서 약 100 MIPS [S11]. RISC-V 부팅 시간은 미확인 | 마지막 릴리스 2019-12-21 [S8] |
| v86 | x86 기계어를 런타임에 WASM 모듈로 JIT [S12][S13] | x86(펜티엄 4급, 64비트 확장 없음) [S12] | x86 페이징 | VGA/SVGA, PS/2, IDE, NE2000, virtio(파일시스템·네트워크·balloon) 등 [S12] | 미확인 | BSD-2-Clause [S12] | README에 수치 없음 [S12] | 2026-10-09 [S26] |
| semu (sysprog21) | 없음. 네이티브 C이고 README에 WASM 언급이 없다 [S16] | RV32IMA [S16] | RV32 MMU, S/U 모드 [S16] | 8250/16550 UART, PLIC(32 IRQ, 우선순위 없음), ACLINT, virtio-blk·net·snd·input·gpu(2D scanout만) [S16][S17] | `riscv.c` 2,031줄, `main.c` 2,044줄, `virtio-input.c` 949줄, `virtio-gpu.c` 1,198줄 + `virtio-gpu-sw.c` 1,340줄, `uart.c` 296줄, `plic.c` 132줄, `aclint.c` 238줄 [S17] | MIT [S16] | 미확인 | 2026-08-09 [S26] |
| rv32emu (sysprog21) | C를 WASM으로 빌드. 시스템 에뮬 데모 페이지가 있다 [S18] | RV32I/E + M, A, F, C, Zba/Zbb/Zbc/Zbs, V 일부 [S18] | 미확인. README와 system.md에 언급이 없다 [S18][S19] | src/devices에 uart, plic, virtio-blk·net·rng·snd, rtc 파일이 있다 [S26] | 미확인 | MIT [S18] | tier-1 JIT가 인터프리터보다 리눅스 부팅이 약 2배 빠르다(절대값 없음) [S19] | 2026-10-18 [S26] |
| riscv-rust (takahirox) | Rust → WASM. npm 패키지 `riscv_emu_rust_wasm` [S20] | RV32/64 IMAFDQC(일부 "almost") [S20] | Sv32/39/48 [S20] | src/device에 clint, plic, uart, virtio_block_disk [S26] | 미확인 | MIT [S20] | README에 수치 없음 [S20] | 2023-04-06 [S26] |
| rvemu (d0iasm) | Rust → WASM, CLI와 웹 [S21] | RISC-V(상세 미확인) | 미확인 | 미확인 | 미확인 | MIT [S21] | 미확인. 저장소 설명은 "xv6 and Linux (ongoing)" [S21] | 2024-05-29 [S21] |
| r2 (bokuweb) | Rust → wasm32. Web Worker에서 돌고 xterm.js를 쓴다 [S22] | rv32ima + Zifencei + Zicsr [S22] | 없음 [S22] | CLINT, UART(0x1000_0000), DTB. mini-rv32ima 이미지를 쓴다 [S22] | 저자 추정 약 1,000줄 [S22] | 미확인. 저장소 루트에 LICENSE가 없다 [S26] | 미확인 | 2026-10-04 [S26] |
| ANGEL (Berkeley) | 순수 JS [S23] | RV64, 2014년 말 초안 스펙 [S23] | 미확인 | 미확인 | 미확인 | BSD 계열 문구의 LICENSE [S23] | 미확인. "not under active development" [S23] | 2020-08-25 [S26] |
| Cartesi Machine | C++를 Emscripten으로 WASM [S24][S25] | RV64GC [S24] | 미확인 | virtio 네트워크, 공유 파일시스템 [S24] | 브라우저 데모는 커널과 Alpine을 포함한 32 MiB WASM 하나 [S25] | LGPL-3.0 [S24] | 미확인 | 2026-10-17 [S26] |

순수 TypeScript로 리눅스를 부팅하는 RISC-V 에뮬레이터는 웹·GitHub 검색에서 찾지 못했다. 판단: 이 점이 포트폴리오의 차별점이 된다.

### 1.2 프로젝트별 메모

**mini-rv32ima**

- DTS: `riscv,isa = "rv32ima"`, `mmu-type = "riscv,none"`, RAM은 0x80000000부터 0x3ffc000바이트, UART 0x10000000(`ns16850`), CLINT 0x11000000, SYSCON 0x11100000(poweroff 0x5555, reboot 0x7777), timebase 1MHz(0xf4240). UART 노드에 interrupts 속성이 없다 [S4].
- 커널 설정: Linux 6.8.0-rc1, `# CONFIG_MMU is not set`, `CONFIG_RISCV_M_MODE=y`, ELF FDPIC와 FLAT 바이너리, `CONFIG_VIRTIO_MMIO=y` [S5]. Buildroot는 cnlohr 포크를 받아 쓰고 C 라이브러리는 uClibc다 [S6].
- CPU 상태 구조체는 정수 레지스터 32개와 pc·mstatus·cycle·timer·mtvec·mie·mip·mepc·mtval·mcause 등 u32 16개로, 주석대로 "12 x uint4"(192바이트)다 [S2]. 판단: 스냅샷의 CPU 부분이 이만큼 작다.
- 래퍼는 0x10000000 쓰기를 stdout으로 내보내고, 0x10000005(LSR) 읽기로 수신 데이터 여부를 알린다. 스냅샷 기능은 없다 [S3]. 기본 RAM은 64 MiB다 [S3].
- 받아 쓰는 이미지는 `linux-6.1.14-rv32nommu-cnl-1.zip`(1,507,463바이트)이고 mini-rv32ima-images 저장소에 있다 [S6][S7].
- baremetal 예제는 `-march=rv32ima_zicsr -mabi=ilp32`, 링커 스크립트, 디버그용 커스텀 CSR(0x136~0x139)로 출력한다. 툴체인은 Buildroot가 만든 것을 쓴다 [S74].
- 판단: TS로 옮길 첫 참조 구현이다. 인터프리터·트랩·CLINT가 한 파일에 있어 대조 디버깅이 쉽다. 다만 PLIC가 없어서 IRQ가 필요한 장치(virtio, goldfish_events)는 그대로 붙일 수 없다.

**TinyEMU / JSLinux**

- RISC-V 메모리 맵: RAM 0x80000000, CLINT 0x02000000, HTIF 0x40008000, virtio 0x40010000부터 0x1000 간격, PLIC 0x40100000, 프레임버퍼 0x41000000 [S9].
- 프레임버퍼는 DT에 `simple-framebuffer`로 넣고 `width`·`height`·`stride`·`format = "a8r8g8b8"`을 적는다 [S9].
- 입력은 virtio-input(키보드, 마우스, 태블릿)이다. JS 빌드는 `_console_queue_char`, `_vm_start`, `_display_key_event`, `_display_mouse_event`, `_display_wheel_event`, `_net_write_packet` 등을 내보낸다 [S9]. 판단: 브라우저 에뮬레이터의 호스트 API 표면을 설계할 때 참고하기 좋다.
- `-rw`가 없으면 디스크가 원본에 쓰지 않는 "snapshot" 모드로 열린다. VM 전체 상태를 저장하는 기능은 소스에서 찾지 못했다 [S9].
- JSLinux는 TinyEMU 기반이고 riscv64 Buildroot와 Fedora 33을 콘솔·X Window로 제공한다 [S10][S11]. 32비트 RISC-V 이미지는 더 이상 유지하지 않는다 [S11].
- 판단: "브라우저 RISC-V 리눅스 + 프레임버퍼 + virtio 입력"은 이미 된 일이다. 차별점은 TS로 직접 만든 과정, 제어 채널, 스냅샷, MCP 연동에서 나와야 한다.

**v86**

- `save_state()`와 `restore_state()`는 async이고 ArrayBuffer를 주고받는다 [S15].
- 상태 포맷은 매직·버전(`STATE_VERSION = 6`)·전체 길이·info 길이를 담은 헤더, JSON info 블록, 4바이트 정렬된 바이너리 버퍼들로 이뤄진다. 각 장치 객체가 `get_state()` 배열을 내고, TypedArray는 별도 버퍼로 뺀다 [S14]. 상태 이미지용 zstd 압축을 지원한다 [S12].
- JIT는 인터프리터로 진입점과 페이지별 실행 횟수를 모으다가, 뜨거운 페이지를 WASM 모듈로 만든다. 모듈 사이 링크는 없고 모듈 생성은 느리지만 비동기다 [S13].
- 판단: 스냅샷 포맷과 "인터프리터 먼저, WASM JIT는 나중" 순서의 참조로 쓴다.

**semu**

- SBI 호출을 에뮬레이터 안에서 처리한다. `main.c`에 TIMER, RST, HSM, IPI 등의 핸들러가 있다 [S17]. README는 "Standard SBI, with the timer extension"이라고 적는다 [S16]. 그래서 OpenSBI 없이 S 모드 커널을 바로 띄운다.
- CSR은 S 모드용(sstatus, sie, sip, stvec, satp, scounteren, sscratch, sepc, scause, stval)과 time·instret만 다룬다 [S17].
- Buildroot 설정: `BR2_riscv_custom`에 I·M·A, `BR2_RISCV_32`, `BR2_RISCV_ABI_ILP32`, glibc, GCC 14, cpio rootfs [S17].
- 커널 설정: `CONFIG_MMU=y`, `CONFIG_ARCH_RV32I=y`, `CONFIG_NONPORTABLE=y`, `# CONFIG_RISCV_ISA_C is not set`, `# CONFIG_FPU is not set`, `CONFIG_DRM_VIRTIO_GPU=y`, `CONFIG_VIRTIO_INPUT=y`, `CONFIG_INPUT_EVDEV=y` [S17].
- 판단: B안의 설계도다.

## 2. 화면과 입력

### 2.1 화면: simple-framebuffer와 virtio-gpu

| 항목 | simple-framebuffer | virtio-gpu (2D) |
|---|---|---|
| 정체 | 펌웨어나 부트로더가 잡아 둔 프레임버퍼를 DT로 알리는 바인딩 [S31] | virtio 장치 ID 16 [S44] |
| 장치 쪽 구현 | 레지스터가 없다. DT 노드에 `reg`, `width`, `height`, `stride`, `format`을 넣고 [S31], 그 메모리를 호스트가 주기적으로 읽어 canvas에 그린다 [S9] | virtio-mmio 전송과 제어 큐. 설정은 RESOURCE_CREATE_2D → RESOURCE_ATTACH_BACKING → SET_SCANOUT, 갱신은 TRANSFER_TO_HOST_2D → RESOURCE_FLUSH 순서다 [S44] |
| 리눅스 드라이버 | `FB_SIMPLE`(fbdev, `!DRM_SIMPLEDRM` 조건) 또는 `DRM_SIMPLEDRM`(`DRM && MMU` 의존) [S32][S33] | `DRM_VIRTIO_GPU`(`DRM && VIRTIO_MENU && MMU` 의존) [S34] |
| nommu에서 | `FB_SIMPLE`로 가능하다. nommu에서도 프레임버퍼는 mmap으로 직접 접근할 수 있다 [S41] | 불가(MMU 의존) [S34] |
| 픽셀 포맷 | a8r8g8b8, x8r8g8b8, r5g6b5 등 11종 [S31] | 리소스 생성 때 지정 [S44] |
| 참조 구현 규모 | TinyEMU `simplefb.c` 127줄 [S9] | semu `virtio-gpu.c` 1,198줄 + `virtio-gpu-sw.c` 1,340줄 [S17] |
| 변경 감지 | 없다. 호스트가 매 프레임 복사하거나 dirty 추적을 직접 한다 | RESOURCE_FLUSH가 갱신을 알린다 [S44] |
| 스냅샷 | 프레임버퍼가 게스트 메모리에 있어 RAM 저장에 따라 들어간다 | 호스트 쪽 리소스 표도 직렬화해야 한다 |
| TS 난이도(판단) | 하 | 중상. virtqueue를 먼저 만들어야 한다 |

판단: simple-framebuffer로 시작한다. "게스트 메모리 → canvas" 경로 하나만 만들면 되고, bare-metal 단계에서도 같은 영역에 직접 그릴 수 있다. virtio-gpu는 virtqueue가 생긴 뒤의 선택 과제로 둔다.

호스트 쪽 그리기: CPU 루프를 Web Worker에 두고, `transferControlToOffscreen()`으로 넘긴 OffscreenCanvas에 worker가 직접 그리면 메인 스레드로 픽셀을 보낼 필요가 없다. OffscreenCanvas는 2023년 3월부터 주요 브라우저에서 쓸 수 있다 [S63]. RAM을 SharedArrayBuffer로 메인 스레드와 공유하려면 문서가 cross-origin isolated여야 하고, 이를 위해 `Cross-Origin-Opener-Policy: same-origin`과 `Cross-Origin-Embedder-Policy: require-corp`(또는 `credentialless`) 헤더가 필요하다 [S61][S62]. 판단: 정적 호스팅에서는 헤더를 못 바꿀 수 있으니 OffscreenCanvas 방식을 기본으로 한다.

### 2.2 입력: virtio-input과 직접 만든 MMIO 장치

| 항목 | virtio-input | goldfish_events (안드로이드 옛 장치) | 직접 설계한 MMIO 터치 레지스터 |
|---|---|---|---|
| 리눅스 드라이버 | 메인라인 `VIRTIO_INPUT`(`VIRTIO`, `INPUT` 의존) [S35] | 메인라인 `goldfish_events.c`. DT compatible `google,goldfish-events-keypad`, `GOLDFISH \|\| COMPILE_TEST` 의존 [S38][S39] | 없다. 리눅스에서 쓰려면 커널 드라이버를 직접 써야 한다 |
| 장치 쪽 프로토콜 | 이벤트 `{le16 type; le16 code; le32 value;}`를 eventq 버퍼에 쓴다. 설정 공간으로 이름, EV 비트, 축 범위(`VIRTIO_INPUT_CFG_ABS_INFO`)를 알린다 [S44]. 속성 비트용 `VIRTIO_INPUT_CFG_PROP_BITS`(0x10)도 있다 [S9] | 4KB MMIO. 0x00 READ/SET_PAGE, 0x04 LEN, 0x08 DATA. IRQ마다 type·code·value 세 워드를 읽는다. EV_ABS 축 범위도 장치에 물어본다 [S38] | 자유 |
| IRQ | 필요하다(virtio-mmio 인터럽트) | 필요하다(`platform_get_irq`) [S38] | 폴링이면 필요 없다 |
| 다른 장치와 공유 | virtio-mmio 전송과 virtqueue 코드를 virtio-console과 같이 쓴다 | 없음 | 없음 |
| 안드로이드와의 관계 | 안드로이드 에뮬레이터가 2019년부터 쓰는 멀티터치 virtio input 장치 [S49] | 옛 goldfish 플랫폼에서 터치스크린 등 입력을 보내던 장치 [S48] | - |
| 참조 규모 | semu `virtio-input.c` 949줄 [S17] | 드라이버 파일 하나 [S38] | - |
| TS 난이도(판단) | 중. virtqueue 포함 | 하 | 하. 리눅스용이면 드라이버 작성이 더해진다 |

터치스크린으로 인식시키려면 `BTN_TOUCH`로 접촉 여부를, `ABS_X`/`ABS_Y`로 위치를 보고한다. 새 하드웨어라면 `INPUT_PROP_DIRECT`를 켜고, 한 묶음 끝에 `EV_SYN`/`SYN_REPORT`를 보낸다 [S40].

판단:

- bare-metal 미니 OS 단계는 폴링하는 직접 만든 레지스터(x, y, down)로 충분하다.
- 리눅스 단계는 virtio-input(태블릿형: EV_ABS + BTN_TOUCH)을 고른다. 커널 드라이버를 쓰지 않아도 되고, 제어 채널(virtio-console)과 virtio-mmio 코드를 공유하며, 지금의 안드로이드 에뮬레이터와 같은 방식이다.
- goldfish_events는 virtqueue를 만들기 전에 리눅스 터치를 먼저 보고 싶을 때의 지름길이다. 어느 쪽이든 PLIC는 필요하다.

### 2.3 게스트에서 화면을 그리는 것

| 단계 | 무엇이 그리나 | 필요한 것 |
|---|---|---|
| 커널만 | fbcon이 부팅 로그를 프레임버퍼에 그린다. `LOGO`를 켜면 부팅 로고도 나온다 [S43] | `FRAMEBUFFER_CONSOLE`(`FB_CORE` 의존), `LOGO` [S43] |
| BusyBox | `fbsplash`가 PPM 이미지와 진행 막대를 프레임버퍼에 그린다. GPLv2 이상이다 [S70] | BusyBox 설정 |
| 직접 만든 C 앱 | `/dev/fb0`를 mmap해 픽셀을 쓰고 `/dev/input/eventN`을 읽는 그림판 | 판단: 짧은 C 프로그램 하나로 4·5단계를 한 화면에서 보여 준다 |
| LVGL | `LV_USE_LINUX_FBDEV`를 켜고 `lv_linux_fbdev_create()` + `lv_linux_fbdev_set_file(disp, "/dev/fb0")`. 입력은 `LV_USE_EVDEV`와 `lv_evdev_create(LV_INDEV_TYPE_POINTER, "/dev/input/event0")`. 32bpp는 XRGB8888로 잡힌다 [S67][S68] | LVGL은 MIT, 최신 릴리스 v9.6.0(2026-09-16) [S69]. Buildroot master에 lvgl 패키지가 없다 [S56]. LVGL 문서는 최신 시스템이면 fbdev보다 DRM/KMS를 권한다 [S67] |

Buildroot master에 있는 관련 패키지는 fbv, fbgrab, evtest, fb-test-app, tslib, sdl2, fbterm이다 [S56].

판단: 데모 임팩트는 "리눅스 위 LVGL 화면을 마우스로 터치하고, AI 에이전트가 같은 화면을 MCP로 조작"하는 장면이 가장 크다. LVGL은 Buildroot의 br2-external로 패키지를 직접 만들거나 [S54], Buildroot 툴체인으로 lv_port_linux(MIT) [S69]를 크로스 컴파일한다.

## 3. 호스트↔게스트 제어 채널

### 3.1 안드로이드에서 가져올 구조

안드로이드 에뮬레이터는 제어를 두 갈래로 나눈다.

- 에뮬레이터 콘솔: 에뮬레이터 프로세스가 직접 처리한다. localhost 5554~5585 포트 telnet과 인증 토큰을 쓴다. `event send EV_ABS:ABS_MT_POSITION_X:400 ... EV_SYN:0:0`으로 터치를 주입하고, `avd snapshot save/load`, `screenrecord start/stop`을 한다. `adb emu`는 이 콘솔 명령을 한 번 보내고 끝내는 지름길이다 [S50].
- adb: 게스트의 adbd와 호스트가 메시지로 통신한다. 메시지는 24바이트 헤더(command, arg0, arg1, data_length, data_crc32, magic = command ^ 0xffffffff, 리틀엔디언 32비트 6워드)와 페이로드다. CONNECT(A_CNXN), OPEN(A_OPEN), READY(A_OKAY), WRITE(A_WRTE), CLOSE(A_CLSE) 메시지로 여러 스트림을 한 전송로 위에 다중화하고, AUTH와 STLS도 정의돼 있다 [S52].

판단: 이 분리를 따른다. AI 에이전트가 주로 쓰는 탭, 스크린샷, 스냅샷은 게스트 협조 없이 에뮬레이터가 직접 한다(호스트 단독 명령). 셸 실행이나 파일 전송처럼 게스트 안에서만 할 수 있는 일만 게스트 에이전트를 거친다. 그러면 게스트가 멈춰도 탭과 스냅샷은 동작한다.

### 3.2 게스트 채널 후보

| 후보 | 게스트에서 보이는 것 | 장치 구현 | 판단 |
|---|---|---|---|
| 콘솔 UART 다중화 | `/dev/ttyS0` 하나 | 추가 없음 | 커널 로그·셸 출력과 섞여 틀이 깨지기 쉽다. 쓰지 않는다 |
| 두 번째 16550 UART | `/dev/ttyS1` | 이미 만든 UART를 다른 주소에 하나 더 둔다. mini-rv32ima DTS의 UART는 interrupts 속성 없이 동작한다 [S4] | 가장 싸다. 처리량은 낮다. bare-metal과 nommu 단계용 |
| virtio-console 멀티포트 | `/dev/vportNpn`과 sysfs `name` 속성 [S36] | `VIRTIO_CONSOLE_F_MULTIPORT`(비트 1)로 제어 큐를 쓰고, `VIRTIO_CONSOLE_PORT_NAME`(7)으로 포트에 이름을 붙인다 [S44] | virtio-input과 virtqueue 코드를 공유한다. 리눅스 단계의 최종안 |
| virtio-vsock | AF_VSOCK 소켓(`VIRTIO_VSOCKETS`) [S37], 장치 ID 19 [S44] | 연결 관리까지 구현해야 한다 | 게스트 앱은 편하지만 장치 쪽이 가장 복잡하다. 선택 과제 |

### 3.3 프로토콜

- 판단: 줄 단위 JSON-RPC로 한다. MCP 스펙(2026-07-28판)은 바이트 스트림 위의 사용자 정의 전송이 stdio 틀, 즉 줄바꿈으로 구분한 JSON-RPC를 재사용해야 한다(SHOULD)고 적는다 [S53]. 게스트 에이전트와 MCP 서버가 같은 틀을 쓰면 변환 코드가 줄어든다.
- 스트림 여러 개를 동시에 열어야 하면 adb 메시지 헤더 방식을 참고한다 [S52].
- 판단: 게스트 에이전트 첫 판은 `/dev/ttyS1`(나중에 `/dev/vport0p1`)을 읽어 명령을 실행하는 BusyBox 셸 스크립트로 시작할 수 있다.

명령 예(판단):

| 명령 | 처리 위치 | 구현 |
|---|---|---|
| `tap {x, y}` | 호스트 | 입력 장치에 ABS_X, ABS_Y, BTN_TOUCH, SYN_REPORT 주입 |
| `screenshot` | 호스트 | 프레임버퍼 영역을 PNG로 인코딩 |
| `snapshot.save` / `snapshot.load` | 호스트 | 4장 |
| `shell {cmd}` | 게스트 | 에이전트가 실행하고 stdout을 돌려준다 |
| `push` / `pull` | 게스트 | base64 청크 |

### 3.4 MCP 연결

MCP 표준 전송은 stdio와 Streamable HTTP이고, 메시지는 UTF-8 JSON-RPC다 [S53]. 브라우저 탭은 stdio 서브프로세스가 될 수 없다. 판단: `AI 클라이언트 ⇄(stdio) Node MCP 서버 ⇄(WebSocket) 브라우저 탭의 에뮬레이터 ⇄(virtio-console 포트) 게스트 에이전트` 구조로 한다.

## 4. 스냅샷

### 4.1 저장할 것

| 부분 | 내용 | 크기 |
|---|---|---|
| CPU | x0~x31, pc, M 모드 CSR(mstatus, mtvec, mepc, mcause, mtval, mie, mip, mscratch), B안이면 S 모드 CSR과 satp, 현재 특권 모드, LR/SC 예약 | mini-rv32ima 상태 구조체가 192바이트다 [S2] |
| RAM | 게스트 물리 메모리 전체 | mini-rv32ima 기본값 64 MiB [S3] |
| 장치 | UART 레지스터와 FIFO, CLINT mtimecmp, PLIC pending·enable·threshold·claim, virtio 장치별 status·features·큐 주소·마지막 avail 인덱스, 입력 대기열 | 판단: 작다. virtqueue 링 자체는 게스트가 할당한 메모리에 있으므로 RAM 저장에 들어간다 [S44] |
| 메타 | 포맷 버전, 커널·DTB 해시, 에뮬레이터 버전 | 안드로이드도 시스템 이미지, AVD 설정, 에뮬레이터 기능이 바뀌면 스냅샷을 무효로 본다 [S51] |

### 4.2 포맷과 저장소

- v86 포맷을 따른다. 헤더(매직, 버전, 길이), JSON info, 정렬된 바이너리 버퍼 순서다 [S14].
- 압축: `CompressionStream`은 2023년 5월부터 주요 브라우저에서 쓸 수 있고 worker에서도 된다 [S64]. 스펙은 brotli, deflate, deflate-raw, gzip을 정의한다(2026-04-20 갱신) [S65]. brotli의 브라우저 지원은 미확인이다. 판단: gzip을 기본으로 한다. 압축률은 RAM 내용에 따라 달라 미확인이다.
- 저장소: IndexedDB. 기본(best-effort) 한도는 Chrome·Edge가 디스크 전체의 최대 60%, Firefox가 디스크의 10%와 10 GiB 중 작은 쪽이다. `navigator.storage.persist()`가 승인되면 저장 공간 부족 때 자동 삭제 대상에서 빠진다 [S66].
- 판단: 64 MiB 원본이어도 한도 안이다. 가장 큰 덩어리가 RAM 하나의 ArrayBuffer라 TypedArray 그대로 저장하고 되살린다.

### 4.3 주의점(판단)

- CPU 루프를 명령 경계에서 멈춘 뒤 저장한다. worker에 pause 메시지를 보내고 save한다.
- mtime을 호스트 시계로 만들면 복원 뒤 시간이 튄다. 저장할 때 mtime 값을 넣고, 복원 때 호스트 시계와의 오프셋을 다시 잡는다.
- canvas, xterm 화면, WebSocket 같은 호스트 쪽 상태는 저장하지 않고 복원 뒤 다시 그린다. simple-framebuffer는 화면이 RAM에 있어서 복원 즉시 같은 그림이 나온다. virtio-gpu를 쓰면 호스트 리소스 표도 저장해야 한다.
- 안드로이드 Quick Boot는 콜드 부팅보다 최대 10배 빨리 켜진다고 한다 [S51]. 같은 장면("스냅샷에서 바로 재개")을 데모로 만들 수 있다.

판정: 현실적이다.

## 5. 게스트 이미지 빌드

### 5.1 윈도우에서 Buildroot 돌리기

- Buildroot는 리눅스 시스템에서 돌도록 만들어졌다 [S54]. 윈도우에서는 Docker 컨테이너 안에서 돌린다.
- 매뉴얼은 `utils/docker-run` 스크립트와 공식 이미지 `registry.gitlab.com/buildroot.org/buildroot/base:YYYYMMDD.HHMM`을 안내한다. 현재 태그는 소스 트리 최상위의 `.gitlab-ci.yml`에 있다 [S54]. 판단: `utils/docker-run`은 셸 스크립트라 Git Bash나 WSL에서 돌리거나, 같은 이미지를 `docker run`으로 직접 띄운다.
- Docker Desktop은 기본으로 WSL 2 백엔드(WSL 2.1.5 이상)를 쓰고, Hyper-V 백엔드는 관리자 권한의 전체 사용자 설치가 필요하다 [S57]. 이 PC의 WSL 상태는 미확인이다.
- 바인드 마운트는 리눅스 파일시스템에서 할 때 훨씬 빠르고, `/mnt/c`처럼 윈도우에서 마운트한 경로는 피하라고 한다 [S58]. 판단: Buildroot 소스와 출력은 Docker named volume(또는 WSL 홈)에 두고, `output/images`의 결과물만 윈도우로 복사한다.
- 빌드 시간: mini-rv32ima README는 `make everything`이 "약 20분"이라고 적는다(저자 기계 기준) [S1]. 이 PC에서의 시간은 미확인이다.
- 최신 Buildroot 매뉴얼은 2026.08판(2026-09-04 생성)이다 [S54].

### 5.2 시작 설정

Buildroot master에 RV32 defconfig가 둘 있다 [S55].

- `qemu_riscv32_nommu_virt_defconfig`: MMU 끔, 커널 6.18.7, nommu 전용 커널 설정, ext2 rootfs.
- `qemu_riscv32_virt_defconfig`: 커널 6.18.7, 커널 defconfig `rv32`, OpenSBI 1.6(generic 플랫폼).
- RISC-V 아키텍처 변형 기본값은 `BR2_riscv_g`이고, 도움말은 "IMAFD와 같다"고 적는다 [S55]. 커널의 `RISCV_ISA_C`와 `FPU`도 기본값이 y다 [S27].

판단: 그대로 쓰면 에뮬레이터가 F, D, C를 지원해야 한다. semu처럼 바꾼다 [S17].

- Buildroot: `BR2_riscv_custom` + I·M·A, `BR2_RISCV_32`, `BR2_RISCV_ABI_ILP32`. rootfs는 cpio(initramfs)로 해서 블록 장치 없이 부팅한다.
- 커널: `CONFIG_RISCV_ISA_C=n`, `CONFIG_FPU=n`, `CONFIG_FB_SIMPLE=y`, `CONFIG_FRAMEBUFFER_CONSOLE=y`, `CONFIG_LOGO=y`, `CONFIG_VIRTIO_MMIO=y`, `CONFIG_VIRTIO_INPUT=y`, `CONFIG_INPUT_EVDEV=y`, `CONFIG_VIRTIO_CONSOLE=y`.
- RV32 커널은 `ARCH_RV32I`가 `NONPORTABLE`에 의존하므로 `CONFIG_NONPORTABLE=y`도 켠다 [S27]. M 모드 nommu 커널은 `RISCV_M_MODE`(`!MMU` 의존)를 쓴다 [S27].
- 커널 진입 규약은 a0 = hartid, a1 = DTB 주소, satp = 0이다 [S42]. 에뮬레이터가 DTB를 RAM에 놓고 a1에 주소를 넣는다. mini-rv32ima와 r2가 이렇게 한다 [S3][S22]. dtc는 Buildroot 호스트 도구로 나온다(mini-rv32ima Makefile이 `buildroot/output/host/bin/dtc`를 쓴다) [S6].
- 구현 기준 스펙은 RISC-V 비준 ISA v20260120(Machine-Level ISA 1.13, Supervisor-Level ISA 1.13 포함) [S45]과 SBI 스펙 v3.0 비준판 [S46]이다.

### 5.3 bare-metal 툴체인과 ISA 테스트

- Buildroot가 만든 크로스 툴체인을 쓴다. mini-rv32ima baremetal 예제가 이 방식이다 [S74].
- LLVM은 RV32I를 완전 지원하고 M과 A도 지원한다 [S72]. 판단: 윈도우용 clang으로 Docker 없이 bare-metal 바이너리를 만들 수 있을 가능성이 높지만, 링크까지 되는지는 미확인이다.
- Ubuntu 24.04에 `gcc-riscv64-unknown-elf` 13.2.0 패키지가 있다 [S73]. rv32 multilib 포함 여부는 미확인이다.
- riscv-tests에 rv32ui, rv32um, rv32ua, rv32mi, rv32si 묶음이 있다 [S47]. 위 툴체인으로 빌드해 단계별 통과표를 만든다.

### 5.4 빌드된 이미지 재사용과 라이선스

- 리눅스 커널이나 BusyBox 같은 GPLv2 바이너리를 포트폴리오 사이트에 올리면 배포다. GPLv2 3조는 (a) 대응 소스를 함께 주거나, (b) 3년 이상 유효한 서면 제안을 주거나, (c) 비상업 배포이고 받은 바이너리에 그런 제안이 붙어 있었을 때만 그 정보를 전달하라고 한다. "완전한 소스"에는 컴파일과 설치를 제어하는 스크립트도 들어간다 [S59].
- mini-rv32ima-images 저장소는 GitHub에서 GPL-3.0으로 표시된다 [S26]. README는 이미지별 설정 커밋을 가리킬 뿐 서면 제안은 없다 [S7]. 판단: 이 이미지는 로컬 개발과 검증에만 쓰고, 공개 데모에는 직접 빌드한 이미지를 쓴다.
- JSLinux 페이지와 기술 노트는 디스크 이미지 라이선스를 밝히지 않는다 [S10][S11]. 재사용하지 않는다.
- Buildroot `make legal-info`는 각 패키지 소스, 라이선스 텍스트, 재현용 설정을 `legal-info/`에 모은다 [S54]. 판단: 데모 사이트에 이 묶음이나 그 링크를 같이 둔다.
- 코드 참조: mini-rv32ima, semu, TinyEMU, rv32emu, riscv-rust는 MIT [S26][S16][S8][S18][S20], v86은 BSD-2-Clause다 [S12]. MIT는 저작권 표시와 허가 문구를 사본에 포함하라고 한다(TinyEMU 소스 헤더의 MIT 문구) [S9]. 판단: TS로 옮겨 적은 부분이 있으면 그 파일 상단에 원 저작권 표시를 남긴다. r2는 라이선스 파일이 없어 코드를 가져오지 않는다 [S26].

## 6. 선택지 비교와 추천

### 6.1 비교표

| 항목 | A. RV32IMA nommu (M 모드 리눅스) | B. RV32IMA + Sv32 (S/U 모드, SBI 자체 처리) | C. RV64GC + Sv39 |
|---|---|---|---|
| 참조 구현 | mini-rv32ima [S1], r2 [S22] | semu [S16][S17] | TinyEMU/JSLinux [S8][S9], riscv-rust [S20] |
| CPU 범위 | RV32IMA + Zicsr, M 모드, MMU 없음 | A안 + S/U 모드, Sv32 페이지 테이블과 TLB, time CSR | 64비트 레지스터, F/D, C 압축 명령, Sv39 |
| JS 적합성 | 32비트 연산이 JS 비트 연산과 맞는다 [S60] | 같다 | 64비트 정수에 BigInt나 32비트 쌍이 필요하다 [S60] |
| 필수 장치 | UART, CLINT. 터치나 virtio를 쓰려면 PLIC를 더한다 | UART, CLINT, PLIC, simplefb, virtio-mmio | B안과 같고 보통 virtio-blk를 더한다 |
| 화면 드라이버 | `FB_SIMPLE`만. simpledrm과 virtio-gpu는 MMU가 필요하다 [S32][S33][S34] | `FB_SIMPLE`, simpledrm, virtio-gpu 모두 | 모두 |
| 게스트 | 받은 nommu 이미지로 바로 시작한다 [S7]. 사용자 공간은 FLAT/FDPIC이고 fork가 없다 [S5][S41] | Buildroot 직접 빌드(IMA, C와 FPU 끔) [S17] | Buildroot 기본 riscv64 설정이나 배포판 그대로 [S55][S10] |
| 업스트림 전망 | 폐기 패치가 "2027년 초 제거"를 제안했다 [S29]. LWN은 NOMMU 제거를 2028년 무렵으로 전했다 [S30]. 현재 메인라인에는 남아 있다 [S27] | RV32 커널은 `NONPORTABLE` 뒤에 있다 [S27]. 32비트 전반이 장기적으로 줄어드는 흐름이다 [S30] | 안정 |
| 학습 가치 | 중. 가상 메모리와 특권 분리를 건너뛴다 | 상. 특권 모드, 페이지 테이블, 인터럽트 컨트롤러, virtio가 안드로이드 에뮬레이터 구조와 맞물린다 | 상. 다만 시간이 ISA 폭(F, D, C)에 쓰인다 |
| 2026 데모 임팩트(판단) | 중. 콘솔 리눅스와 fbdev 그림판 | 상. MMU 리눅스, LVGL 터치 UI, MCP 조작, 스냅샷 재개 | 중. JSLinux가 이미 riscv64 X Window를 보여 준다 [S10] |
| 완성 가능성(판단) | 상 | 중 | 하 |

x86(v86 계열)은 후보에서 뺀다. v86이 이미 x86→WASM JIT까지 한다 [S12]. 판단: x86 명령어 디코딩에 드는 노력이 7단계 학습 목표와 다른 곳으로 쏠린다.

### 6.2 추천: B안, A안을 거쳐서

1. 학습 가치: Sv32, S 모드, PLIC, virtio는 안드로이드 에뮬레이터(virtio input 사용 [S49])가 하는 일을 작게 재현한다. A안만으로는 MMU를 배우지 못한다.
2. 데모 임팩트: B안에서만 simpledrm, virtio-gpu, fork가 되는 일반 사용자 공간이 열린다 [S33][S34][S41]. 판단: "TS로 만든 에뮬레이터 위 리눅스에서 LVGL 화면을 AI 에이전트가 MCP로 조작하고, 스냅샷으로 바로 재개"가 2026년에 보여 줄 만한 장면이다.
3. 완성 가능성: semu가 같은 구성(RV32IMA + MMU + 자체 SBI + virtio-input/gpu)으로 리눅스를 띄운다 [S16][S17]. 참조할 C 코드가 MIT다.
4. A안을 중간에 두는 이유: bare-metal 단계에서 M 모드 트랩이 어차피 필요하다. 여기에 A 확장만 더하면 받은 이미지로 리눅스가 뜬다 [S7]. Buildroot를 만지기 전에 코어를 검증한다. 판단: 1~8단계는 mini-rv32ima와 같은 메모리 맵(UART 0x10000000, CLINT 0x11000000, SYSCON 0x11100000)을 써서 그 이미지와 DTB를 그대로 부팅하고, 9단계부터 자체 DT로 옮긴다.
5. 위험: RV32와 NOMMU 모두 업스트림에서 줄어드는 쪽이다 [S29][S30]. 판단: 커널 버전을 고정(Buildroot master defconfig 기준 6.18.x [S55])하면 포트폴리오 수명 동안에는 문제가 되지 않는다. 6.18이 LTS인지는 미확인이다.

### 6.3 단계별 로드맵

각 단계 끝에 화면에 보이는 결과가 있다. 오른쪽 열은 7단계(1 부팅, 2 CPU, 3 메모리·MMIO, 4 화면, 5 입력, 6 통신, 7 스냅샷) 중 무엇을 다루는지다.

| # | 구현 | 눈에 보이는 결과 | 7단계 |
|---|---|---|---|
| 1 | Vite + TS 페이지, Web Worker 실행 루프, xterm.js(MIT, `@xterm/xterm` 6.0.0 [S71]). RV32I 인터프리터, RAM(Uint8Array/DataView), UART 송신 MMIO | bare-metal 바이너리가 xterm에 "hello"를 찍는다 | 1, 2, 3 |
| 2 | riscv-tests rv32ui 실행 하네스 [S47] | 페이지에 테스트 통과표가 나온다 | 2 |
| 3 | M 확장, Zicsr, M 모드 트랩(mtvec, mepc, mcause), CLINT 타이머 인터럽트, UART 수신 | 타이머 인터럽트로 초가 올라가는 시계, 키 입력 에코. rv32um과 rv32mi 통과 | 2, 3 |
| 4 | 프레임버퍼 영역 → OffscreenCanvas 블릿 [S63] | bare-metal 프로그램이 그린 그라디언트와 움직이는 상자 | 4 |
| 5 | 직접 만든 터치 레지스터(x, y, down, 폴링), canvas 포인터 이벤트 연결 | bare-metal 그림판. 여기까지가 "직접 만든 미니 OS"다 | 5 |
| 6 | 호스트 명령(tap, screenshot, pause/resume), 두 번째 UART로 ping/info에 답하는 게스트 루틴, 스냅샷 v1(CPU + RAM + 장치 → IndexedDB) | 그림판을 저장하고 새로고침한 뒤 그대로 되살린다. tap 명령으로 선이 그려진다 | 6, 7 |
| 7 | A 확장(LR/SC, AMO), mini-rv32ima 이미지 부팅 [S7] | xterm에 nommu 리눅스 부팅 로그와 BusyBox 셸. 부팅 시간과 coremark를 잰다 | 1, 2 |
| 8 | 리눅스 셸 상태 스냅샷 | 새로고침 후 셸에서 바로 이어 간다("Quick Boot" 데모 [S51]) | 7 |
| 9 | S/U 모드, Sv32와 TLB, 자체 SBI(TIMER와 RST부터) [S46], time CSR, PLIC. Docker에서 Buildroot로 IMA 커스텀 이미지(initramfs) 빌드 | MMU 리눅스가 xterm에 부팅한다 | 1, 2, 3 |
| 10 | DT에 simple-framebuffer, 커널에 FB_SIMPLE, fbcon, LOGO [S31][S32][S43] | canvas에 펭귄 로고와 커널 로그 | 4 |
| 11 | virtio-mmio 전송과 split virtqueue, virtio-input(태블릿형) [S44] | evtest 출력, C 그림판을 클릭으로 그린다 | 5 |
| 12 | LVGL(fbdev + evdev) 데모 앱 [S67][S68] | 터치로 조작하는 위젯 화면 | 4, 5 |
| 13 | virtio-console 멀티포트와 게스트 에이전트, Node MCP 서버와 WebSocket 브리지 [S44][S53] | AI 에이전트가 MCP로 화면을 탭하고, 셸 명령을 돌리고, 스냅샷을 찍는다 | 6, 7 |
| 14 (선택) | virtio-gpu 2D, 실제 OpenSBI 펌웨어, 핫 루프의 WASM JIT(v86 방식 [S13]) | 성능과 정확도 개선 | - |

### 6.4 단계별 크기 가늠

TS 줄 수는 미확인이다. 참고할 C 구현의 크기만 적는다: mini-rv32ima 핵심 약 400줄(1~3, 7단계) [S1], semu `riscv.c` 2,031줄(9단계, MMU와 트랩 포함) [S17], semu `plic.c` 132줄 [S17], TinyEMU `simplefb.c` 127줄(10단계) [S9], semu `virtio-input.c` 949줄(11단계) [S17].

## 7. 미확인 목록

- TS/JS 인터프리터로 RV32 리눅스를 부팅하는 데 걸리는 시간. 공개된 수치를 찾지 못했다. 7단계에서 직접 잰다.
- TinyEMU RISC-V의 브라우저 부팅 시간, v86 성능 수치.
- rv32emu 시스템 에뮬레이션의 MMU 지원 여부와 장치 상세.
- semu가 쓰는 커널 버전. 리눅스 6.18의 LTS 여부.
- nommu 폐기 패치의 최종 처리. 메인라인 Kconfig에 문구가 없어 병합되지 않은 것으로 보이지만, 거절이나 보류 기록은 확인하지 못했다.
- Ubuntu `gcc-riscv64-unknown-elf`의 rv32 multilib, 윈도우 clang으로 bare-metal 링크까지 되는지.
- 이 PC의 WSL 설치 여부와 이 PC에서의 Buildroot 빌드 시간.
- CompressionStream의 brotli 브라우저 지원, 64 MiB RAM 스냅샷의 압축률.
- mini-rv32ima-images의 GPL-3.0 표시가 이미지 전체를 뜻하는지.
- 지금의 안드로이드 에뮬레이터가 화면에 virtio-gpu를 쓰는지. 입력이 virtio input인 것은 확인했다 [S49].

## 출처

모든 항목의 확인일은 2026-10-18이다.

| # | 출처 | URL | 확인일 |
|---|---|---|---|
| S1 | mini-rv32ima README | https://github.com/cnlohr/mini-rv32ima | 2026-10-18 |
| S2 | mini-rv32ima.h | https://github.com/cnlohr/mini-rv32ima/blob/master/mini-rv32ima/mini-rv32ima.h | 2026-10-18 |
| S3 | mini-rv32ima.c | https://github.com/cnlohr/mini-rv32ima/blob/master/mini-rv32ima/mini-rv32ima.c | 2026-10-18 |
| S4 | mini-rv32ima sixtyfourmb.dts | https://github.com/cnlohr/mini-rv32ima/blob/master/mini-rv32ima/sixtyfourmb.dts | 2026-10-18 |
| S5 | mini-rv32ima custom_kernel_config | https://github.com/cnlohr/mini-rv32ima/blob/master/configs/custom_kernel_config | 2026-10-18 |
| S6 | mini-rv32ima Makefile, mini-rv32ima/Makefile, configs/buildroot_config | https://github.com/cnlohr/mini-rv32ima/blob/master/Makefile , https://github.com/cnlohr/mini-rv32ima/blob/master/mini-rv32ima/Makefile , https://github.com/cnlohr/mini-rv32ima/blob/master/configs/buildroot_config | 2026-10-18 |
| S7 | mini-rv32ima-images | https://github.com/cnlohr/mini-rv32ima-images | 2026-10-18 |
| S8 | TinyEMU 페이지 | https://bellard.org/tinyemu/ | 2026-10-18 |
| S9 | TinyEMU 소스 2019-12-21 (readme.txt, riscv_machine.c, riscv_cpu.c, virtio.c, simplefb.c, temu.c, Makefile.js) | https://bellard.org/tinyemu/tinyemu-2019-12-21.tar.gz | 2026-10-18 |
| S10 | JSLinux | https://bellard.org/jslinux/ | 2026-10-18 |
| S11 | JSLinux 기술 노트 | https://bellard.org/jslinux/tech.html | 2026-10-18 |
| S12 | v86 README | https://github.com/copy/v86 | 2026-10-18 |
| S13 | v86 how-it-works | https://github.com/copy/v86/blob/master/docs/how-it-works.md | 2026-10-18 |
| S14 | v86 src/state.js | https://github.com/copy/v86/blob/master/src/state.js | 2026-10-18 |
| S15 | v86 src/browser/starter.js | https://github.com/copy/v86/blob/master/src/browser/starter.js | 2026-10-18 |
| S16 | semu README | https://github.com/sysprog21/semu | 2026-10-18 |
| S17 | semu 소스와 설정 (riscv.c, main.c, virtio-*.c, plic.c, minimal.dts, configs/linux.config, configs/buildroot.config) | https://github.com/sysprog21/semu/tree/master | 2026-10-18 |
| S18 | rv32emu README | https://github.com/sysprog21/rv32emu | 2026-10-18 |
| S19 | rv32emu docs/system.md | https://github.com/sysprog21/rv32emu/blob/master/docs/system.md | 2026-10-18 |
| S20 | riscv-rust README | https://github.com/takahirox/riscv-rust | 2026-10-18 |
| S21 | rvemu 저장소 메타데이터 | https://api.github.com/repos/d0iasm/rvemu | 2026-10-18 |
| S22 | r2 저자 글과 저장소 | https://bokuweb.github.io/undefined/articles/20230523.html , https://github.com/bokuweb/r2 | 2026-10-18 |
| S23 | riscv-angel README, LICENSE | https://github.com/riscv-software-src/riscv-angel | 2026-10-18 |
| S24 | Cartesi machine-emulator README | https://github.com/cartesi/machine-emulator | 2026-10-18 |
| S25 | cartesi-wasm-term README | https://github.com/edubart/cartesi-wasm-term | 2026-10-18 |
| S26 | GitHub REST API 저장소 메타데이터(license, pushed_at, contents) | https://api.github.com/repos/{owner}/{repo} | 2026-10-18 |
| S27 | Linux arch/riscv/Kconfig (master) | https://github.com/torvalds/linux/blob/master/arch/riscv/Kconfig | 2026-10-18 |
| S28 | Linux 최상위 Makefile (7.3-rc7) | https://github.com/torvalds/linux/blob/master/Makefile | 2026-10-18 |
| S29 | [PATCH] riscv: deprecate CONFIG_MMU=n (2024-02) | https://lkml.iu.edu/hypermail/linux/kernel/2402.3/02122.html | 2026-10-18 |
| S30 | LWN, The future of 32-bit support in the kernel (2025-09-01) | https://lwn.net/Articles/1035727/ | 2026-10-18 |
| S31 | DT 바인딩 simple-framebuffer.yaml | https://github.com/torvalds/linux/blob/master/Documentation/devicetree/bindings/display/simple-framebuffer.yaml | 2026-10-18 |
| S32 | drivers/video/fbdev/Kconfig (FB_SIMPLE) | https://github.com/torvalds/linux/blob/master/drivers/video/fbdev/Kconfig | 2026-10-18 |
| S33 | drivers/gpu/drm/sysfb/Kconfig (DRM_SIMPLEDRM) | https://github.com/torvalds/linux/blob/master/drivers/gpu/drm/sysfb/Kconfig | 2026-10-18 |
| S34 | drivers/gpu/drm/virtio/Kconfig | https://github.com/torvalds/linux/blob/master/drivers/gpu/drm/virtio/Kconfig | 2026-10-18 |
| S35 | drivers/virtio/Kconfig (VIRTIO_INPUT, VIRTIO_MMIO) | https://github.com/torvalds/linux/blob/master/drivers/virtio/Kconfig | 2026-10-18 |
| S36 | drivers/char/Kconfig (VIRTIO_CONSOLE) | https://github.com/torvalds/linux/blob/master/drivers/char/Kconfig | 2026-10-18 |
| S37 | net/vmw_vsock/Kconfig | https://github.com/torvalds/linux/blob/master/net/vmw_vsock/Kconfig | 2026-10-18 |
| S38 | drivers/input/keyboard/goldfish_events.c | https://github.com/torvalds/linux/blob/master/drivers/input/keyboard/goldfish_events.c | 2026-10-18 |
| S39 | drivers/input/keyboard/Kconfig, drivers/platform/goldfish/Kconfig | https://github.com/torvalds/linux/blob/master/drivers/input/keyboard/Kconfig , https://github.com/torvalds/linux/blob/master/drivers/platform/goldfish/Kconfig | 2026-10-18 |
| S40 | Documentation/input/event-codes.rst | https://github.com/torvalds/linux/blob/master/Documentation/input/event-codes.rst | 2026-10-18 |
| S41 | Documentation/admin-guide/mm/nommu-mmap.rst | https://github.com/torvalds/linux/blob/master/Documentation/admin-guide/mm/nommu-mmap.rst | 2026-10-18 |
| S42 | Documentation/arch/riscv/boot.rst | https://github.com/torvalds/linux/blob/master/Documentation/arch/riscv/boot.rst | 2026-10-18 |
| S43 | drivers/video/logo/Kconfig, drivers/video/console/Kconfig | https://github.com/torvalds/linux/blob/master/drivers/video/logo/Kconfig , https://github.com/torvalds/linux/blob/master/drivers/video/console/Kconfig | 2026-10-18 |
| S44 | OASIS VIRTIO 1.4 Committee Specification 01 (2026-04-08) | https://docs.oasis-open.org/virtio/virtio/v1.4/cs01/virtio-v1.4-cs01.html | 2026-10-18 |
| S45 | RISC-V 비준 ISA v20260120 | https://docs.riscv.org/reference/isa/v20260120/index.html | 2026-10-18 |
| S46 | RISC-V SBI 스펙 v3.0 (Ratified) | https://github.com/riscv-non-isa/riscv-sbi-doc/releases/tag/v3.0 | 2026-10-18 |
| S47 | riscv-tests | https://github.com/riscv-software-src/riscv-tests | 2026-10-18 |
| S48 | Android GOLDFISH-VIRTUAL-HARDWARE.TXT | https://android.googlesource.com/platform/external/qemu/+/refs/heads/emu-master-dev/android/docs/GOLDFISH-VIRTUAL-HARDWARE.TXT | 2026-10-18 |
| S49 | AOSP 커밋 "[Virtio Input] Add .idc File for Emulator Multi-Touch Virtio Device" (2019) | https://android.googlesource.com/device/generic/goldfish/+/41c6d92%5E%21/ | 2026-10-18 |
| S50 | Android 에뮬레이터 콘솔 | https://developer.android.com/studio/run/emulator-console | 2026-10-18 |
| S51 | Android 에뮬레이터 스냅샷 | https://developer.android.com/studio/run/emulator-snapshots | 2026-10-18 |
| S52 | adb 프로토콜 문서 | https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/docs/dev/protocol.md | 2026-10-18 |
| S53 | MCP 스펙 Transports (2026-07-28판) | https://modelcontextprotocol.io/specification/latest/basic/transports | 2026-10-18 |
| S54 | Buildroot 매뉴얼 (2026.08) | https://buildroot.org/downloads/manual/manual.html | 2026-10-18 |
| S55 | Buildroot configs, board/qemu/riscv32-virt/readme.txt, arch/Config.in.riscv (master) | https://github.com/buildroot/buildroot/tree/master/configs , https://github.com/buildroot/buildroot/blob/master/board/qemu/riscv32-virt/readme.txt , https://github.com/buildroot/buildroot/blob/master/arch/Config.in.riscv | 2026-10-18 |
| S56 | Buildroot package 디렉터리 (master) | https://github.com/buildroot/buildroot/tree/master/package | 2026-10-18 |
| S57 | Docker Desktop 윈도우 설치 요구사항 | https://docs.docker.com/desktop/setup/install/windows-install/ | 2026-10-18 |
| S58 | Docker Desktop WSL 모범 사례 | https://docs.docker.com/desktop/features/wsl/best-practices/ | 2026-10-18 |
| S59 | GNU GPL v2 | https://www.gnu.org/licenses/old-licenses/gpl-2.0.html | 2026-10-18 |
| S60 | MDN Bitwise AND | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Bitwise_AND | 2026-10-18 |
| S61 | MDN SharedArrayBuffer | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer | 2026-10-18 |
| S62 | MDN Window.crossOriginIsolated | https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated | 2026-10-18 |
| S63 | MDN OffscreenCanvas | https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas | 2026-10-18 |
| S64 | MDN CompressionStream | https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream | 2026-10-18 |
| S65 | WHATWG Compression Standard | https://compression.spec.whatwg.org/ | 2026-10-18 |
| S66 | MDN Storage quotas and eviction criteria | https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria | 2026-10-18 |
| S67 | LVGL Linux Framebuffer 드라이버 문서 | https://lvgl.io/docs/open/integration/embedded_linux/drivers/fbdev | 2026-10-18 |
| S68 | LVGL evdev 드라이버 문서 | https://lvgl.io/docs/open/integration/embedded_linux/drivers/evdev | 2026-10-18 |
| S69 | LVGL, lv_port_linux 저장소(라이선스, 릴리스) | https://github.com/lvgl/lvgl , https://github.com/lvgl/lv_port_linux | 2026-10-18 |
| S70 | BusyBox miscutils/fbsplash.c (GitHub 미러) | https://github.com/mirror/busybox/blob/master/miscutils/fbsplash.c | 2026-10-18 |
| S71 | xterm.js 저장소, npm @xterm/xterm | https://github.com/xtermjs/xterm.js , https://www.npmjs.com/package/@xterm/xterm | 2026-10-18 |
| S72 | LLVM RISC-V 지원 문서 | https://llvm.org/docs/RISCVUsage.html | 2026-10-18 |
| S73 | Ubuntu noble gcc-riscv64-unknown-elf | https://packages.ubuntu.com/noble/gcc-riscv64-unknown-elf | 2026-10-18 |
| S74 | mini-rv32ima baremetal 예제 | https://github.com/cnlohr/mini-rv32ima/tree/master/baremetal | 2026-10-18 |
