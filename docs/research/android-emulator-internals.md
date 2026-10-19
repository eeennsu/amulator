# 안드로이드 에뮬레이터 내부 구조 조사 (REA 분석·RISC-V 미니 에뮬레이터 설계용)

- 확인일: 2026-10-18. 아래 출처의 확인일은 따로 적지 않으면 이 날짜다. 2026-10-19에 새로 읽은 것은 "11.3 `ANDROID_I_WANT_MY_TCG` 문자열 조회"와 같은 폴더의 두 조사 파일(`browser-riscv-linux.md`, `rea-windows.md`)뿐이고, 해당 위치에 2026-10-19로 적었다.
- 대상: 로컬 Android Emulator 36.3.10(`Pkg.BuildId=14472402`, `C:\Users\xxx99\AppData\Local\Android\Sdk\emulator`). 시스템 이미지는 `android-35\{default,google_apis,google_apis_playstore}\x86_64`, `android-36.1\google_apis_playstore\x86_64`.
- 조사 방식: **에뮬레이터를 실행하지 않았고 아무것도 설치하지 않았다.** 로컬은 `ls`, PowerShell 조회(`Get-Service`, `sc query`, CIM), 파일 헤더·문자열 검색, 내가 scratchpad에 쓴 읽기 전용 node 스크립트(PE 내보내기, bzImage 헤더, LZ4+cpio 목록)만 썼다. 원격은 `curl`·WebFetch·`git clone --filter=blob:none`(AOSP·QEMU 소스를 scratchpad로 받음)이다. 과거 실행 로그 `C:\Users\xxx99\AppData\Local\Temp\argent-emulator-Pixel_4a.log`(2026-10-17 13:22, 다른 도구가 남김)는 읽기만 했다. 로그의 IP·adb 키는 옮기지 않았다.
- 표기: **[확인]** 소스·문서·로컬 파일에서 직접 읽음. **[추정]** 읽은 근거에서 내가 추론함. **[미확인]** 근거를 못 읽음. 출처 태그(`G1`, `D2` 등)는 13절 표에 URL·확인일·기준 판을 적었다. 소스 인용은 `(태그 경로)` 형식이고, 줄 번호는 G1 기준 커밋 `ae9d18d`의 것이다.
- 같은 폴더의 조사 파일과 겹치는 부분은 다시 조사하지 않고 가리킨다: virtio-input 비교와 콘솔·adb 메시지 구조는 `browser-riscv-linux.md`(2.2, 3.1), 로컬 바이너리 크기 목록·PE 헤더·REA 열람 순서는 `rea-windows.md`(5.1~5.3). 이 파일은 거기에 없는 단계별 동작, 소스 위치, 바이너리 대응, 진입점 힌트를 다룬다.

## 0. 핵심 결론

1. 호스트는 `emulator.exe`(런처)가 `qemu\windows-x86_64\qemu-system-x86_64[-headless].exe`를 띄우는 구조다. QEMU 포크와 안드로이드 에뮬레이터 코드(콘솔·gRPC·스냅샷·파이프 서비스)가 이 EXE 하나에 들어 있고, 그래픽만 `lib64\libgfxstream_backend.dll`로 분리돼 있다. [확인]
2. 기반은 **QEMU 2.12.0**(2018-04-24 릴리스)이다. 바이너리 문자열 `QEMU emulator version 2.12.0 (v2.12.0-19097-g85fa07f04ef)`, 소스 `QEMU_VERSION`=`2.12.0`. 최신 upstream은 11.1.2(2026-09-28)다. 공유 경로 6,040개 중 5,652개(93.6%)가 v2.12.0과 blob이 같다. [확인]
3. x86_64 게스트는 하드웨어 가속이 필수다. 이 PC에서는 Hyper-V 하이퍼바이저가 떠 있고, 과거 실행 로그에 `Windows Hypervisor Platform accelerator is operational`이 있으므로 **WHPX**로 돈다. AEHD 드라이버는 설치돼 있으나 서비스가 STOPPED다. [확인]
4. 게스트 보드는 새 머신 타입이 아니라 **기본 i440FX PC에 goldfish 장치(MMIO 0xff001000~, IRQ 16~23, ACPI `GFSH0001`~`GFSH0008`)와 virtio PCI 장치를 얹은 것**이다. x86에서 `ranchu`는 Android의 hardware 이름(`androidboot.hardware=ranchu`)이고, ARM·MIPS에서는 QEMU 머신 이름(`-machine type=ranchu`)이기도 하다. [확인]
5. 부팅은 QEMU 직접 부팅이다. `kernel-ranchu`(bzImage, boot protocol 2.15, 커널 6.6.x/6.12.x)와, 시스템 `ramdisk.img`에 bootconfig를 덧붙인 `<AVD>\initrd`를 올리고, first-stage init이 ramdisk의 virtio `.ko`를 적재해 디스크를 마운트한다. [확인]
6. 화면은 게스트 GLES/Vulkan 명령을 goldfish pipe(`opengles`)로 호스트에 흘려 보내고 gfxstream이 호스트 GPU로 그린다. 로컬 설정은 `hw.gltransport=pipe`, 그래픽 백엔드 `gfxstream`, GPU는 NVIDIA(Vulkan)다. 결과는 Qt 창 안의 자식 창(`WS_CHILD`)에 직접 그려진다. [확인]
7. 입력은 Qt 이벤트가 `SkinEvent`를 거쳐 `EV_ABS`/`EV_KEY` 이벤트가 되고 virtio-input(멀티터치·키보드)으로 들어간다. goldfish_events는 폴백이다. [확인]
8. 호스트↔게스트는 콘솔 5554, adb 5555, gRPC(콘솔 포트+3000, 관측 8554)와 goldfish pipe·virtio-serial·virtio-vsock(adb)이다. [확인]
9. 퀵부트 스냅샷은 `default_boot`이고 QEMU savevm(디스크는 qcow2 내부 스냅샷) + 파일 기반 RAM(`ram.img`) + gfxstream 텍스처(`textures.bin`) + 메타(`snapshot.pb`)로 이뤄진다. 로그상 로드에 528 ms 걸렸다. [확인]
10. **공개 소스(emu-master-dev 마지막 커밋 2025-03-27)는 로컬 바이너리(36.3.10, 2026-01 빌드)보다 약 10개월 오래됐다.** 사례: 소스의 HAXM 탐색과 `-savevm-on-exit`이 로컬 바이너리에는 없다. 구조와 파일명은 바이너리 문자열·내보내기와 교차 확인했지만 세부는 어긋날 수 있다. [확인]

## 1. 구조 한눈에 보기

### 1.1 호스트 프로세스와 파일

```
emulator.exe (런처, 1.9 MiB)
  └─ CreateProcess ─> qemu\windows-x86_64\qemu-system-x86_64[-headless].exe   (QEMU 2.12 포크 + 에뮬레이터 코드)
        ├─ vCPU 스레드 ── WHPX (WinHvPlatform.dll / WinHvEmulation.dll, 이름으로 런타임 해석)
        ├─ 장치 모델  ── goldfish_* (MMIO) · virtio-* (PCI) · 게스트 RAM에 직접 접근
        ├─ AndroidPipe 서비스 ── opengles · GLProcessPipe · qemud(boot-properties …) · adb · logcat · refcount · QemuMiscPipe
        ├─ 서버 ── 콘솔 5554 · adb 5555 · gRPC 8554(관측) · 광고 파일 %TEMP%\avd\running\pid_<PID>.ini
        ├─ 스냅샷 ── Quickboot / Snapshotter / RamSaver / RamLoader / TextureSaver
        └─ LoadLibrary ─> lib64\libgfxstream_backend.dll ─> 호스트 GPU (Vulkan / OpenGL)
                          (비-헤드리스는 Qt6*AndroidEmu.dll로 창과 확장 컨트롤 UI를 만든다)
```

- 런처가 ABI로 바이너리를 고르는 코드: `QEMU_BINARY_PATTERN "qemu-system-%s%s"`, 헤드리스는 `qemu-system-%s-headless%s`, 경로 `<emulator>\qemu\<OS>-<arch>\...`. 지원 CPU는 arm64·x86·x86_64이고 `-engine classic`은 폐기 경고만 남는다. (G1 `android/emulator/main-emulator.cpp`: `getQemuExecutablePath`, `isCpuArchSupportedByRanchu`) [확인]
- 로컬에도 `qemu-system-x86_64.exe`(61,264,024 B)와 `-headless`(51,576,472 B), i386·aarch64·armel 변형이 있다. 비-헤드리스만 `Qt6*AndroidEmu.dll`, `d3d9.dll`, `MFPlat.DLL`을 임포트한다(PE 임포트 표 조회). [확인-로컬]
- `lib64\qt\lib`에 `Qt6*AndroidEmu.dll`(Core, Gui, Widgets, Network, WebEngine 등)이 있고 `platforms\qwindowsAndroidEmu.dll`이 Qt 플랫폼 플러그인이다. [확인-로컬]

### 1.2 게스트 쪽 구성

- 커널: `kernel-ranchu`. GKI 계열 커널(`kernel/common`)이고, goldfish 모듈(`goldfish_pipe`, `goldfish_sync`, `goldfish_address_space`)과 virtio 설정 프래그먼트는 `kernel/common-modules/virtual-device`에 있다. 이 저장소의 `build.config.virtual_device.x86_64`는 이미지를 만들지 않고 `.ko`만 만든다고 적는다. `kernel-ranchu` 자체가 어느 빌드 타깃에서 나오는지는 읽지 않았다 [미확인]. 로컬 버전은 6.6.30/6.6.50-android15, 6.12.38-android16이다(11절). (G5 `build.config.virtual_device.x86_64`, `virtual_device_core.fragment`; L3)
- 사용자 공간: `device/generic/goldfish`의 `init.ranchu.rc`, `qemu-props`, 각종 HAL, `device/generic/goldfish-opengl`의 `gralloc`·`hwc3`, `hardware/google/gfxstream/guest`의 EGL·GLES 인코더·`qemupipe`. (G3, G4, G2)

### 1.3 부팅 한 번의 QEMU 인자 (소스에서 재구성, 실행으로 확인하지 않음)

(G1 `android-qemu2-glue/main.cpp`. 줄 번호는 `ae9d18d` 기준) [추정: 소스와 바이너리 시차 때문에 세부 인자는 다를 수 있다]

```
qemu-system-x86_64.exe
  -android-hw <AVD>\hardware-qemu.ini                 (4690 줄 부근 vl.c: 없으면 "Missing -android-hw <file> option!")
  -android-ports <콘솔>,<adb>                          (-port/-ports 지정 시. 1726·2147 줄)
  -cpu android64  -enable-whpx  -smp cores=4  -m 2048  (2589·2637·2713·2717 줄)
  -nodefaults  -vga none                              (2761, kTarget x86_64 표)
  -kernel <sysimg>\kernel-ranchu  -initrd <AVD>\initrd  -dtb <AVD>\default.dtb   (2767~2825 줄)
  -append "<kernel_cmdline.txt> no_timer_check … bootconfig …"                    (3472~3509 줄)
  -drive id=system(read-only)/cache/userdata/encrypt/vendor/sdcard + -device virtio-blk-pci   (x86_64 순서: system, cache, userdata, encryptionkey, vendor, sdcard)
  -netdev user,id=mynet -device virtio-net-pci ; -device virtio-rng-pci ; -device virtio-wifi-pci
  -device virtio-vsock-pci,guest-cid=77               (VirtioVsockPipe 기능이 켜졌을 때. 3118 줄)
  -device virtio-keyboard-pci ; -device virtio_input_multi_touch_pci_1..N   (VirtioInput. 822~860 줄)
  -device virtio-serial-pci -device virtconsole,chardev=forhvc0/forhvc1   (logcat용. VirtconsoleLogcat. 2880~2925 줄)
  -device goldfish_pstore,addr=…,size=…  (2233 줄)   -L <emulator>\lib\pc-bios
  -mem-path <ram.img> -mem-file-shared                 (QuickbootFileBacked. 2054~2075 줄)
```

## 2. 단계 1. 실행과 부팅

### (a) 실제 동작

1. `emulator.exe`는 AVD의 ABI를 읽고 `qemu\windows-x86_64\qemu-system-x86_64[-headless].exe`를 골라 띄운다. `lib64`와 GPU 백엔드 폴더를 DLL 검색 경로에 넣는다. (G1 `main-emulator.cpp`) [확인]
2. QEMU 쪽 진입점이 AVD 설정을 `hardware-qemu.ini`로 쓰고 `-android-hw`로 넘기며 위 1.3의 인자를 조립한다. x86_64 디스크는 전부 `virtio-blk-pci`이고 system·vendor는 읽기 전용 원본, cache·userdata·encryptionkey·sdcard는 AVD 폴더의 `*.qcow2` 오버레이다. (G1 `main.cpp` `PartitionParameters`) [확인]
3. 커널은 QEMU 직접 부팅이다. `load_linux()`가 bzImage를 읽어 Linux x86 boot protocol로 적재하고 fw_cfg와 option ROM(`linuxboot_dma.bin`)을 쓴다. DTB는 setup_data(`SETUP_DTB`)로 덧붙인다. 로컬 `kernel-ranchu`는 오프셋 0x202에 `HdrS`, 프로토콜 0x020f(2.15)인 bzImage이고 페이로드는 LZ4 legacy(`02 21 4c 18`)다. (G1 `hw/i386/pc.c`:845, 1025~1050; K3; L3) [확인]
4. `ramdisk.img`(LZ4 legacy)는 cpio 두 개를 이은 것이다. 첫째는 `/init`(4,132,440 B)와 빈 디렉터리, 둘째는 `first_stage_ramdisk/fstab.ranchu`와 `virtio_blk`·`virtio_pci`(+`_legacy_dev`·`_modern_dev`)·`virtio_console`·`virtio-rng`·`virtio_dma_buf`·`vmw_vsock_virtio_transport` `.ko` 8개(`modules.load`)다. (L3: node 스크립트로 목록만 출력) 반대로 `kernel-ranchu`(android-35 google_apis)를 메모리에서 풀어 `virtio_blk`·`virtio_pci`·`virtio_input`·`goldfish_pipe` 문자열을 찾으면 0건이다. 이 드라이버들이 커널에 내장돼 있지 않고 `.ko`로 적재된다는 설명과 맞는다(`virtio_vsock`은 8건, 코어 소켓 부분으로 [추정]). [확인]
5. 에뮬레이터는 이 ramdisk에 bootconfig(`androidboot.*` 텍스트 + 패딩 + 크기·체크섬 + `#BOOTCONFIG\n`)를 덧붙인 사본을 `<AVD>\initrd`로 만들어 `-initrd`로 준다. 로컬 `initrd`는 원본보다 1,885 B 크고(2,156,476 − 2,154,591) 끝 12바이트가 `#BOOTCONFIG\n`이다. 커널 cmdline에는 `bootconfig`가 들어간다. 형식은 커널 문서와 같고, Android 12부터 `androidboot.*`를 cmdline 대신 bootconfig로 옮긴다. (G1 `createRamdiskWithBootconfig`; K2; D6; L2) [확인]
6. cmdline의 기본은 이미지의 `kernel_cmdline.txt`(`8250.nr_uarts=1 clocksource=pit`)이고 에뮬레이터가 `no_timer_check`, 시리얼 포트 설정 등을 덧붙인다. (G1 `android/android-emu/android/main-kernel-parameters.cpp`; L1) [확인]
7. 게스트의 first-stage init(`/init`)은 `/proc`·`/sys`·`/dev`를 마운트하고 `/proc/bootconfig`를 읽은 뒤 `/lib/modules/modules.load`의 모듈을 적재하고, DT fstab(`ReadFstabFromDt`) 또는 기본 fstab(`first_stage_ramdisk/fstab.ranchu`)으로 system·vendor 등을 마운트한다. 에뮬레이터는 vendor 위치를 담은 `default.dtb`(`/firmware/android/fstab/vendor`)를 만들어 `-dtb`로 넘긴다. 이후 SELinux 설정 → second-stage init이고, bootconfig 값은 `ro.boot.*` 속성이 된다. (G7 `init/first_stage_init.cpp`, `first_stage_mount.cpp`:150~153, `property_service.cpp` `ProcessBootconfig`; G1 `android-qemu2-glue/dtb.cpp`) [확인]
8. `init.ranchu.rc`가 `qemu-props`(qemud `boot-properties` 서비스에서 속성 수신), `ranchu-adb-setup`(`ro.boot.qemu.adb.pubkey`를 `/data/misc/adb/adb_keys`에 저장), `goldfish-logcat`(`/dev/hvc1`로 logcat)을 시작한다. 부팅이 끝나면 `qemu-props bootcomplete`가 `QemuMiscPipe`로 호스트에 알린다. (G3 `init.ranchu.rc`, `qemu-props/qemu-props.cpp`, `init.ranchu.adb.setup.sh`) [확인]

### (b) 소스 위치

- 런처: G1 `android/emulator/main-emulator.cpp`. QEMU 인자 조립: G1 `android-qemu2-glue/main.cpp`, `android/android-emu/android/main-kernel-parameters.cpp`, `android/android-emu/android/bootconfig.cpp`, `android-qemu2-glue/dtb.cpp`. QEMU 본체 진입은 G1 `vl.c`(`#define main qemu_main`, `run_qemu_main`)이다.
- 직접 부팅: G1 `hw/i386/pc.c`(`load_linux`), `pc-bios/linuxboot_dma.bin`. 머신: `hw/i386/pc_piix.c`.
- 게스트 부팅: G7 `init/first_stage_*.cpp`, `init/README.md`(early init 3단계 설명), G3 `init.ranchu.rc`·`qemu-props/`. 커널: G5 `kernel/common-modules/virtual-device`, G6 `kernel/common`.
- 시스템 이미지 파일 설명은 D2("AVD system directory" 표)와 이 파일 11절이다.

### (c) 로컬 바이너리·DLL

| 파일 | 역할 | 근거 |
|---|---|---|
| `emulator\emulator.exe` | 런처 | 문자열 `qemu-system-`, `lib64`, `emulator-check`, `-ranchu`, `ANDROID_SDK_ROOT` [확인-로컬] |
| `emulator\qemu\windows-x86_64\qemu-system-x86_64[-headless].exe` | QEMU 본체. 부팅 인자 처리, 직접 부팅, bootconfig 생성 | 문자열 `-android-hw`, `hardware-qemu.ini`, `createRamdiskWithBootconfig`, `linuxboot_dma.bin`, `Linux kernel too old to load a dtb`, `kernel-ranchu` [확인-로컬] |
| `emulator\lib\pc-bios\` (`linuxboot_dma.bin`, `linuxboot.bin`, `bios-256k.bin`, `bios.bin`, `kvmvapic.bin`, `vgabios-*.bin`, `efi-*.rom`, `multiboot.bin`) | QEMU 펌웨어·option ROM | `ls` 확인. 이 중 `linuxboot_dma.bin`만 소스와 문자열로 사용 확인. 나머지는 [추정] |
| `emulator\emulator-check.exe` | 하이퍼바이저·시스템 점검 도구 | 런처가 `findBundledExecutable("emulator-check")`로 찾음(G1 `main-emulator.cpp`:774) [확인]. 세부 기능은 [미확인] |
| `emulator\qemu-img.exe`, `mksdcard.exe` | qcow2 오버레이·SD 이미지 생성 | 이름과 AVD의 `*.qcow2`·`sdcard.img` 존재에서 [추정] |
| `emulator\bin64\` (`e2fsck.exe`, `resize2fs.exe`, `tune2fs.exe`, `cyg*.dll`) | ext4 도구(Cygwin 빌드) | 이름에서 [추정] |
| `system-images\...\kernel-ranchu`, `ramdisk.img`, `kernel_cmdline.txt`, `advancedFeatures.ini`, `VerifiedBootParams.textproto`, `build.prop`, `data\` | 게스트 부팅 입력 | 11절 [확인-로컬] |
| `.android\avd\Pixel_4a.avd\` (`initrd`, `hardware-qemu.ini`, `config.ini`, `*.qcow2`) | 실행 때 생성되는 부팅 입력 | 11.4절 [확인-로컬] |

### (d) REA 진입점·힌트 (정적 분석 기준. 본체는 헤드리스 EXE를 권장: `rea-windows.md` 5.3)

모든 문자열은 `qemu-system-x86_64-headless.exe`에서 ASCII로 존재함을 확인했다. [확인-로컬]

- 인자·파일: `-android-hw`, `Missing -android-hw` , `hardware-qemu.ini`, `kernel-ranchu`, `bootconfig`, `createRamdiskWithBootconfig`, `androidboot.verifiedbootstate`, `no_timer_check`, `8250.nr_uarts=1`, `android64`, `Android virtual processor`.
- 직접 부팅: `linuxboot_dma.bin`, `Linux kernel too old to load a dtb`(→ `load_linux`), 함수 이름 문자열 `load_linux`, `pc_init1`, `pc_piix`가 남아 있다.
- 시작점 후보: 문자열 `qemu_android_emulation_setup`, `handleCpuAcceleration`의 xref → 에뮬레이터 초기화 순서. 런처는 `emulator.exe`의 `qemu-system-%s%s` 서식 문자열의 xref.
- 게스트 쪽 확인 거리: `ramdisk.img`를 LZ4로 풀어 cpio 두 개를 보면 first-stage 입력이 전부 나온다(L3 스크립트 방식).

## 3. 단계 2. CPU: 게스트 명령어 실행

### (a) 실제 동작

1. x86_64 AVD는 `-cpu android64`(qemu64 변형: SSSE3·SSE4.1·SSE4.2·POPCNT 추가, 모델명 `Android virtual processor`)로 정의되고, 가속 백엔드는 `-enable-whpx|aehd|kvm|hvf` 중 하나가 붙는다. vCPU는 최대 6개로 제한하고, 현대 x86 가상화 기능이 없으면 1개로 낮춘다. (G1 `target/i386/cpu.c`:849, `main.cpp`:2589~2650, 2690~2715) [확인]
2. **x86/x86_64 게스트는 하드웨어 가속이 필수다.** 가속이 안 되면 `... emulation currently requires hardware acceleration!`로 종료한다. 공식 문서도 `-accel off`는 "not supported and is very slow"이고 환경변수 `ANDROID_I_WANT_MY_TCG=yes`가 있어야 시작한다고 한다. arm64 AVD는 x86_64 호스트에서 API 28 이상이면 거부한다. 즉 TCG는 이 경로에서 사실상 쓰지 않는다. (G1 `main-common.c` `handleCpuAcceleration`, `main-emulator.cpp`; D2) [확인]
3. WHPX 경로: QEMU 가속 클래스 `whpx`가 `WHvCreatePartition` → `WHvSetupPartition` → vCPU별 `WHvCreateVirtualProcessor`로 파티션을 만들고, 게스트 RAM을 `WHvMapGpaRange`로 매핑한다. vCPU 스레드는 `WHvRunVirtualProcessor`를 반복 호출하고, VM exit 이유(`MemoryAccess`, `X64IoPortAccess`, `X64Cpuid`, `X64MsrAccess`, `X64Halt`, `X64InterruptWindow`, `Canceled`)를 `switch`로 처리한다. MMIO·PIO exit는 `WHvEmulatorTryMmioEmulation` 등 Windows 명령어 에뮬레이터로 해석하고 콜백(`whpx_emu_mmio_callback` 등)에서 QEMU 장치 모델을 호출한다. (G1 `target/i386/whpx-all.c`:1015 `whpx_vcpu_run`, 710 `whpx_handle_mmio`, 1703 `whpx_accel_init`; Q4) [확인]
4. AEHD는 KVM 소스를 복제해 심볼 이름만 바꾼 것이다(`AEHD_CREATE_VM`, `AEHD_RUN`, `AEHD_EXIT_IO/MMIO …`). 커널 쪽 IRQ 칩(apic·i8259·ioapic)용 사용자 공간 코드가 `hw/i386/aehd/`에 있다. (G1 `docs/devel/aehd.txt`, `target/i386/aehd-all.c`) [확인]
5. 가속기 선택은 `CpuAccelerator.cpp`가 한다(10절). 선택 결과가 `-enable-<accel>` 인자가 된다. (G1 `android/emu/feature/src/android/emulation/CpuAccelerator.cpp`) [확인]
6. TCG 자체는 바이너리에 들어 있다(`tcg_accel_class_init`). 개념: 게스트 코드를 번역 블록(TB) 단위로 호스트 코드로 바꾸고 캐시·체이닝한다. 공식 개발 문서는 [Q1]이고, 이 저장소의 옛 문서 `CPU-EMULATION.TXT`는 ARM 용어로 쓰여 있어 개념 참고용이다. (G1 `android/docs/CPU-EMULATION.TXT`; Q1) [확인]

### (b) 소스 위치

- 가속 선택: G1 `android/emu/feature/src/android/emulation/CpuAccelerator.cpp`, `android/android-emu/android/main-common.c`(`handleCpuAcceleration`), `android-qemu2-glue/main.cpp`(`handleCpuAccelerationForMinConfig`, `-enable-*`).
- 가속 백엔드: G1 `target/i386/whpx-all.c`, `target/i386/whp-dispatch.h`(WinHvPlatform 동적 로딩), `target/i386/aehd-all.c`·`aehd.c`, `hw/i386/aehd/`, `target/i386/hvf-all.c`·`hvf-utils/`(macOS), `accel/kvm/`(Linux), `accel/stubs/`.
- 소프트웨어 CPU: G1 `tcg/`, `accel/tcg/`(`cpu-exec.c`, `translate-all.c`, `cputlb.c`), `target/i386/translate.c`.
- CPU 모델: G1 `target/i386/cpu.c`(`android64`, `android64-xts`).
- Windows API 표면(WHP)의 Microsoft 공식 문서는 조사 허용 출처 밖이라 읽지 않았다. QEMU 쪽 설명은 Q4다.

### (c) 로컬 바이너리·DLL

| 파일 | 역할 | 근거 |
|---|---|---|
| `qemu-system-x86_64[-headless].exe` | CPU 가속·TCG·장치 모델이 한 EXE | 문자열 `whpx-all.c`, `whpx_accel_class_init`, `WHvRunVirtualProcessor`, `WHvEmulatorTryMmioEmulation`, `WHvMapGpaRange`, `WHvCreatePartition`, `AEHD_CREATE_VM`, `tcg_accel_class_init`, `whpx_init_vcpu failed`, `aehd_init_vcpu failed` [확인-로컬] |
| `qemu-system-i386.exe`, `qemu-system-aarch64.exe`, `qemu-system-armel.exe` (+headless) | 다른 ABI용 QEMU | 이름·`QEMU_BINARY_PATTERN`에서 [추정]. 32비트 x86과 ARM AVD용으로 보이나 AVD로 실행해 보지 않았다 |
| `extras\google\Android_Emulator_Hypervisor_Driver\` (`aehd.sys`, `aehd.Inf`, `aehd.cat`, `silent_install.bat`, `README.txt`) | AEHD 드라이버 패키지 2.2.0 | `package.xml` major/minor/micro=2.2.0 [확인-로컬]. 서비스 `aehd`는 STOPPED, 종료 코드 31 |
| `WinHvPlatform.dll`, `WinHvEmulation.dll` | WHPX 사용자 모드 DLL | SDK에 없고 Windows 제공. EXE는 PE 임포트가 아니라 이름 문자열로 런타임에 해석 [확인-로컬: 임포트 표에 없음, 문자열 있음] |
| `drivers\UsbAssist.sys` | USB 패스스루 드라이버 | CPU와 무관. `ls`만 [추정] |

HAXM 관련 문자열(`HAXM is deprecated`, `Opening HAX kernel module failed`)은 로컬 바이너리에 없다. 공식 문서도 36.2.x.x부터 HAXM을 쓰지 않는다고 한다. (D1) [확인]

### (d) REA 진입점·힌트

- 가속 선택 메시지: `Please disable Hyper-V before using the Android Emulator`, `Hyper-V detected and Windows Hypervisor Platform`, `WinHvPlatform.dll found`, `is installed and usable`, `Unable to open AEHD device`, `Android Emulator requires an Intel or AMD processor`, `emulation currently requires hardware` → xref로 `GetCurrentCpuAccelerator`/`ProbeWHPX` 상당 함수. 함수 이름 문자열은 없다(`GetCurrentCpuAccelerator` 0건, `ProbeWHPX` 0건). 대신 `handleCpuAcceleration` 문자열이 2건 있다.
- vCPU 루프: `WHPX: Failed to exec a virtual processor`(`whpx_vcpu_run` 안의 오류 문자열)에서 위로 올라가면 `WHvRunVirtualProcessor` 호출과 exit 이유 `switch`가 나온다. `WHvRunVirtualProcessor` 등 API 이름 문자열의 xref는 `whp_dispatch` 테이블 초기화다.
- MMIO 경로: `WHvEmulatorTryMmioEmulation`의 호출부 → `whpx_emu_mmio_callback` → QEMU 메모리 디스패치(`address_space_rw` 계열) → 장치의 read/write 콜백. 장치 쪽은 4절(단계 3) (d)의 이름을 쓴다.
- `android64` 문자열 xref → CPUID 모델 정의 표.

## 4. 단계 3. 메모리와 가상 장치

### (a) 실제 동작

1. 게스트 RAM은 `-m <hw.ramSize>`(Pixel_4a는 2048 MB)로 만든다. QEMU의 `MemoryRegion` 트리에서 RAM과 MMIO 영역이 리프이고, MMIO는 `memory_region_init_io` + `MemoryRegionOps`(read/write 콜백)로 등록한다(Q2). 퀵부트 파일 기반 RAM이 켜지면 `-mem-path <ram.img> -mem-file-shared`로 RAM을 파일에 매핑한다. (G1 `main.cpp`:2054~2075; Q2) [확인]
2. x86 보드는 새 머신이 아니라 **i440FX `pc` 머신**이다. `pc_init1()`의 `#if defined(CONFIG_ANDROID)` 블록이 goldfish 장치를 `sysbus_create_simple`로 만든다: battery, events, pipe, fb, audio, rtc, sync, rotary와 PCI `goldfish_address_space`(슬롯 11). (G1 `hw/i386/pc_piix.c`:260~296) [확인]
3. goldfish 장치의 주소·IRQ 표(`include/hw/acpi/goldfish_defs.h`): pipe `0xff001000`(IRQ 18), battery `0xff010000`(16), events `0xff011000`(17), fb `0xff012000`(19), audio `0xff013000`(20), sync `0xff014000`(21), rtc `0xff016000`(22), rotary `0xff017000`(23). 게스트에는 **ACPI AML**로 알린다(`GFSH0001` battery, `0002` events, `0003` pipe, `0004` fb, `0005` audio, `0006` sync, `0007` rtc, `0008` rotary). 리눅스 드라이버는 이 ACPI ID로 매칭한다(`goldfish_pipe.c` `GFSH0003`, `goldfish_events.c` `GFSH0002`, `goldfish_battery.c` `GFSH0001`). (G1 `hw/i386/acpi-build.c`:1038~1217; K1) [확인]
4. 나머지는 **virtio PCI**다: blk(디스크), net, rng, serial(+virtconsole·virtserialport), vsock(guest-cid 77), input(멀티터치 최대 11개·키보드), wifi, snd, 필요하면 gpu. ARM `ranchu` 보드는 장치 트리(DT)를 만들어 커널에 넘기고, x86은 PCI + ACPI로 알린다는 점이 다르다(ARM 보드의 virtio 전송 방식은 읽지 않았다). (G1 `main.cpp`, `hw/arm/ranchu.c`) [확인]
5. `goldfish_pipe`는 게스트 물리 주소를 `cpu_physical_memory_map`으로 호스트 포인터로 바꿔 복사 없이 읽고 쓴다. 드라이버 v2는 파이프마다 명령 버퍼(`goldfish_pipe_command`)를 호스트와 공유하고 한 번의 MMIO 쓰기로 여러 버퍼를 넘긴다. AOSP 가상 장치 모듈은 `PIPE_DRIVER_VERSION=4`, 디바이스 노드 이름 `goldfish_pipe_dprctd`이고, 메인라인은 버전 2, 노드 `goldfish_pipe`다. (G1 `hw/misc/goldfish_pipe.c`:633; K1 `goldfish_pipe.c`; G5 `goldfish_drivers/goldfish_pipe.c`:70, 84) [확인]
6. 호스트와 메모리를 공유하는 두 길이 더 있다: `goldfish_dma`(파이프 fd에 ioctl + mmap으로 연속 물리 영역을 호스트에 노출)와 PCI `goldfish_address_space`(vendor `0x607D`, device `0xF153`, BAR1 영역 16 GiB; 그래픽 호스트 메모리·ASG용). (G1 `android/docs/ANDROID-QEMU-PIPE.TXT`, `include/hw/acpi/goldfish_defs.h`; G5 `goldfish_address_space.c`:63~64) [확인]
7. 디바이스 상태 저장은 QEMU의 VMState 매크로 방식(`vmstate_*`)을 따른다(Q9). `goldfish_pstore`는 ramoops용 장치이고 AVD의 `data\misc\pstore\pstore.bin`(65,536 B)과 이름이 맞다 [추정].
8. 로컬 AVD(Pixel_4a)의 실제 값: `hw.ramSize=2048`, `hw.cpu.ncore=4`, `hw.gltransport=pipe`, `hw.lcd.vsync=60`, `disk.dataPartition.size=6g`, 기능 플래그 `VirtioInput`·`VirtioVsockPipe`·`GLDirectMem`·`GLDMA`·`HostComposition`·`AndroidbootProps2`가 `on`이다. (L2: `hardware-qemu.ini`, 이미지의 `advancedFeatures.ini`) [확인]

### (b) 소스 위치

- 머신·장치 생성: G1 `hw/i386/pc_piix.c`, `hw/i386/acpi-build.c`, `include/hw/acpi/goldfish_defs.h`, `hw/arm/ranchu.c`.
- goldfish 장치: G1 `hw/misc/goldfish_pipe.c`, `goldfish_sync.c`, `goldfish_battery.c`, `goldfish_pstore.c`, `hw/pci/goldfish_address_space.c`, `hw/input/goldfish_events.c`, `hw/display/goldfish_fb.c`, `hw/audio/goldfish_audio.c`, `hw/timer/goldfish_timer.c`, `hw/intc/goldfish_pic.c`, `hw/char/goldfish_tty.c`. 사양 문서: G1 `android/docs/GOLDFISH-VIRTUAL-HARDWARE.TXT`(옛 ARM 시절 기준이라 레지스터 예시용), `ANDROID-QEMU-PIPE.TXT`, `QEMU-MEMORY-MANAGEMENT.TXT`.
- virtio: G1 `hw/virtio/virtio-vsock.c`, `virtio-snd-pci.c`, `hw/input/virtio-input-hid.c`, `android-qemu2-glue/emulation/virtio-input-multi-touch.c`, `virtio-goldfish-pipe.cpp`, `hw/display/virtio-gpu.c`.
- 호스트 쪽 파이프 레지스트리: G1 `android/emu/hardware/src/android/emulation/AndroidPipe.cpp`, `android_pipe_host.cpp`, `android-qemu2-glue/emulation/android_pipe_device.cpp`.
- 게스트 드라이버: K1 메인라인 `drivers/platform/goldfish/goldfish_pipe.c`, `drivers/input/keyboard/goldfish_events.c`, `drivers/power/supply/goldfish_battery.c`, `drivers/rtc/rtc-goldfish.c`, `drivers/tty/goldfish.c`; G5 `goldfish_drivers/{goldfish_pipe,goldfish_sync,goldfish_address_space}.c`. `goldfish_fb.c`는 메인라인과 `kernel/common` android15-6.6에 없다(404). 즉 최신 이미지는 fb 드라이버가 아니라 gralloc/HWC로 그린다. 호스트의 `goldfish_fb`는 `s_use_host_gpu`가 켜지면 프레임 복사를 건너뛴다(vsync 인터럽트용으로 남는 것으로 [추정]). (G1 `hw/display/goldfish_fb.c`:25~29, 349~351)
- 메모리 모델 공식 문서: Q2. 직접 부팅·fw_cfg: Q3.

### (c) 로컬 바이너리·DLL

| 파일 | 역할 | 근거 |
|---|---|---|
| `qemu-system-x86_64[-headless].exe` | 모든 장치 모델 | 문자열 `GFSH0001`~`GFSH0008`(각 1건), `goldfish_pipe.c`, `goldfish_fb.c`, `goldfish_address_space`(5건), `goldfish_battery_*`, `goldfish_audio_*`, `goldfish_fb_*`, `goldfish_pic_*`, `virtio-blk-pci`, `virtio-net-pci`, `virtio-rng-pci`, `virtio-serial-pci`, `virtconsole`, `virtserialport`, `virtio-vsock.c`, `virtio-vsock-pci`, `virtio-snd-pci`, `virtio-wifi-pci`, `virtio-gpu-pci`, `qemu-xhci`, `usb-host` [확인-로컬] |
| `lib64\libandroid-emu-shared.dll` (2,473,624 B) | 호스트 메모리 ID 매핑·goldfish address space VM 연산 | 내보내기 `HostmemIdMapping::add/get/remove`, `goldfish_address_space_{get,set}_vm_operations`, `AudioCaptureEngine`, `TextureSaver/Loader` [확인-로컬] |
| `lib64\libemugl_common.dll` (155,800 B) | gfxstream과 에뮬레이터 사이 공용 함수 테이블 | 내보내기 `get_emugl_address_space_device_control_ops`, `get_emugl_vm_operations`, `get_emugl_window_operations`, `get_emugl_multi_display_operations` [확인-로컬] |
| `lib64\libandroid-emu-agents.dll` (30,360 B) | 에뮬레이터 기능 에이전트(`QAndroid*Agent`) 테이블 | 크기와 이름. 소스의 `getConsoleAgents()`와 대응 [추정] |
| `lib64\liblibprotobuf.dll`, `libandroid-emu-protos.dll`, `libabseil_dll.dll`, `libglib2_windows_msvc-x86_64.dll` | 라이브러리 | 이름 [추정] |
| AVD `data\misc\pstore\pstore.bin` | goldfish_pstore 데이터 | 파일 존재와 장치 이름 [추정] |

### (d) REA 진입점·힌트

- ACPI 문자열 `GFSH0001`~`GFSH0008`의 xref → `build_goldfish_aml`/`build_goldfish_device_aml` 상당 함수 → 주소·IRQ 상수 표(0xff0xxxxx).
- 장치 클래스 이름 문자열: `goldfish_pipe_class_init`, `goldfish_pipe_realize`, `pipe_dev_write`(2건), `goldfish_fb_update_display`, `goldfish_battery_read_prop`, `goldfish_audio_*`, `goldfish_pic_*`, `goldfish_events`, `android-pipe`, `android_pipe_lookup_by_id`. 각 `*_class_init` → `MemoryRegionOps` 포인터 → read/write 콜백.
- 파이프 레지스터 오프셋은 K1 `goldfish_pipe_qemu.h`(`PIPE_REG_CMD=0`, `SIGNAL_BUFFER_HIGH=4`, `SIGNAL_BUFFER=8`, `SIGNAL_BUFFER_COUNT=12`, `OPEN_BUFFER_HIGH=20`, `OPEN_BUFFER=24`, `VERSION=36`, `GET_SIGNALLED=48`)와 비교한다. 이 헤더는 "QEMU의 `goldfish_pipe.h`와 같아야 한다"고 적는다.
- virtio: `virtio-input-hid.c`, `virtio-vsock.c`, `virtio_input_multi_touch_pci_1`~`11` 문자열.

## 5. 단계 4. 화면: 게스트 렌더링이 호스트 창으로 오는 경로

### (a) 실제 동작

1. 게스트의 앱은 일반 GLES/Vulkan을 부른다. 게스트의 에뮬레이션용 EGL/GLES 라이브러리와 Vulkan ICD(`androidboot.hardware.vulkan=ranchu`)가 호출을 **바이트 스트림으로 직렬화**(인코더)해 호스트로 보낸다. 호스트가 실제 그리고, 게스트는 GPU를 모른다. 설계 문서의 구성은 guest 인코더 → QEMU pipe → 에뮬레이터(프로토콜을 해석하지 않는 프록시) → 렌더러 → 호스트 GL/Vulkan이다. (G1 `android/android-emugl/DESIGN`; G2 `guest/`, `host/`) [확인]
2. 전송로는 AVD 속성 `hw.gltransport`로 정한다. 로컬은 `pipe`이고 게스트 `HostConnection`이 `ro.boot.hardware.gltransport=pipe`를 읽어 `QemuPipeStream`(4 MiB 버퍼)을 쓴다. 이 스트림은 `/dev/goldfish_pipe_dprctd`를 열고 `pipe:opengles\0`를 써서 호스트 서비스에 연결한다. `virtio-gpu*`/`asg` 변형은 다른 전송이다. (G2 `guest/OpenglSystemCommon/HostConnection.cpp`, `guest/qemupipe/qemu_pipe_guest.cpp`; L2, L4) [확인]
3. 호스트에서 `OpenglEsPipe`("opengles" 서비스)가 스트림을 받고, gfxstream의 `RenderThread::main`이 게스트 스레드마다 하나씩 돌며 읽은 바이트를 `VkDecoder`, GLES1/GLES2 디코더, `renderControl` 디코더(`rc*` 호출)에 넘긴다. 화면에 올리는 호출이 `rcCompose`, `rcFlushWindowColorBuffer`, `rcFBPost`다. (G1 `android/android-emu/android/opengl/OpenglEsPipe.cpp`; G2 `host/RenderThread.cpp`, `host/RenderControl.cpp`) [확인]
4. 합성: 게스트 SurfaceFlinger가 레이어를 모으고 HWC에 합성 방식을 묻는다(D7). 이 이미지는 `HostComposition=on`이라 게스트 `hwc3`가 레이어 목록을 호스트로 보내(`rcCompose`) 호스트가 합성한다. (D7; G4 `system/hwc3`; G2 `host/RenderControl.cpp` `rcCompose`; L1 `advancedFeatures.ini`) [확인: 호스트 합성 플래그와 `rcCompose`] [추정: 게스트 `hwc3`가 이 호출 주체]
5. 표시: `FrameBuffer::post`가 ColorBuffer를 보여 준다. 에뮬레이터가 `android_showOpenglesWindow`(= `showOpenGLSubwindow`)로 넘긴 Qt 창 핸들 아래에 gfxstream이 **자식 창**(Windows는 `CreateWindowExA(... WS_CHILD|WS_DISABLED ...)`)을 만들고 거기에 호스트 GL로 그린다. 자식 창은 입력을 못 받으므로 마우스·키는 부모 Qt 창이 받는다. (G1 `android/android-emu/android/opengles.cpp`:621; G2 `host/FrameBuffer.cpp`:849 `setupSubWindow`, `host/NativeSubWindow_win32.cpp`:60~64) [확인]
6. 스크린샷·녹화·gRPC `streamScreenshot`는 다른 길이다. `FrameBuffer::setPostCallback`이 디스플레이별로 읽기 스레드를 두고 post 때 RGBA 픽셀을 콜백으로 넘긴다. (G2 `host/FrameBuffer.cpp`:801, 1899 `doPostCallback`; G1 `opengles.cpp`:507 `android_setPostCallback`) [확인]
7. 에뮬레이터↔gfxstream 연결: 에뮬레이터가 `libgfxstream_backend`를 `SharedLibrary`로 열고 `initLibrary()`로 `RenderLib`을 얻어 로거·DMA·VM 연산·윈도우 연산을 심은 뒤 `initRenderer(width, height, features, useSubWindow, egl2egl)`를 부른다. 같은 DLL이 virtio-gpu용 C API(`stream_renderer_*`)도 내보낸다. (G1 `opengles.cpp`:63, 205, 404; L3 내보내기) [확인]
8. 로컬 실제값(2026-10-17 로그): `Graphics backend: gfxstream`, `library_mode host gpu mode host`, NVIDIA GeForce RTX 4060 Ti를 Vulkan 장치로 선택, GLES는 `Opengl32.dll` 경유 `OpenGL ES 3.0 (4.5.0 NVIDIA 610.88)`, `libshadertranslator.dll` 로드. `Failed to load opengl32sw`는 소프트웨어 GL이 없어 시스템 OpenGL로 폴백했다는 경고다. 공식 문서 기준 `-gpu` 모드는 `auto`·`host`·`software`·`lavapipe`·`swiftshader`·`swangle`이고 `guest`·`swiftshader_indirect`·`swangle_indirect`는 36.4.9부터 폐기다(로컬은 36.3.10). (L4; D1) [확인]

### (b) 소스 위치

- 호스트 렌더러: G2 `hardware/google/gfxstream/host/`(`FrameBuffer.cpp`, `RenderThread.cpp`, `RenderControl.cpp`, `PostWorker.cpp`, `NativeSubWindow_win32.cpp`, `RenderWindow.cpp`, `ColorBuffer.cpp`, `vulkan/VkDecoder*.cpp`, `gl/`, `virtio-gpu-gfxstream-renderer.cpp`). 빌드 산출물 `libgfxstream_backend.(dll|so|dylib)`는 G2 `README.md`가 적는다.
- 에뮬레이터 접합부: G1 `android/android-emu/android/opengles.cpp`, `android/android-emu/android/opengl/{OpenglEsPipe,GLProcessPipe}.cpp`, `android-qemu2-glue/emulation/virtio-gpu-gfxstream-renderer.cpp`, `android/android-emugl/`(`DESIGN`, `README`).
- 게스트: G2 `guest/{egl,GLESv2_enc,GLESv1_enc,renderControl_enc,OpenglSystemCommon,qemupipe,gralloc_cb}`, G4 `system/{gralloc,hwc3}`, G3 `hals/`.
- AOSP 일반 그래픽 구조(SurfaceFlinger·HWC): D7.
- 옛 설계 문서: G1 `android/docs/GPU-EMULATION.TXT`(GPU 모드 개념), `android/android-emugl/DESIGN`. 둘 다 번역기(translator) 시절 용어가 많다.

### (c) 로컬 바이너리·DLL

| 파일 | 역할 | 근거 |
|---|---|---|
| `lib64\libgfxstream_backend.dll` (22,437,016 B) | gfxstream 호스트 렌더러 본체 | 내보내기 355개 중 C API: `initLibrary`, `android_setOpenglesRenderer`, `android_stopOpenglesRenderer`, `gfxstream_backend_setup_window`, `gfxstream_backend_set_screen_mask`, `gfxstream_backend_set_screen_background`, `stream_renderer_{init,teardown,submit_cmd,flush,resource_create,…,snapshot,restore,suspend,resume,fill_caps,create_fence,…}`. 나머지는 `translator::gles1`/`gles2`의 GL 함수 [확인-로컬]. 문자열 `rcFBPost`, `rcCompose`, `rcCreateColorBuffer`, `rcFlushWindowColorBuffer`, `RenderThread`, `VkDecoder`, `setupSubWindow`, `CreateWindowExA` [확인-로컬] |
| `lib64\libshadertranslator.dll` (1,525,912 B) | 셰이더 변환 | 로그에서 로드됨. 역할은 이름 [추정] |
| `lib64\gles_angle\` (`libEGL.dll`, `libGLESv2.dll`, `d3dcompiler_47.dll`, `vk_swiftshader.dll`, `vulkan-1.dll`, `vk_swiftshader_icd.json`) | ANGLE + SwiftShader(Vulkan) 소프트웨어/변환 경로 | 폴더·파일 이름과 `-gpu swangle` 모드 설명에서 [추정]. 2026-10-17 실행에서는 쓰이지 않음 |
| `lib64\gles_swiftshader\` (`libEGL.dll`, `libGLES_CM.dll`, `libGLESv2.dll`), `lib64\gles_mesa\mesa_opengl32.dll` (69,828,592 B) | 소프트웨어 GL 백엔드 | 이름 [추정]. G1 `GPU-EMULATION.TXT`가 `gles_<name>\` 구조를 설명 |
| `lib64\vulkan\` (`vulkan-1.dll`, `vk_swiftshader.dll`, `libvulkan_lvp.dll`, `glslangValidator.exe`, `lvp_icd.json`, `vk_swiftshader_icd.json`) | Vulkan 로더·소프트웨어 ICD(SwiftShader, lavapipe) | 이름 [추정]. `-gpu lavapipe`/`swiftshader` 모드가 문서에 있음(D1) |
| `qemu-system-x86_64[-headless].exe` | 에뮬레이터 접합부(pipe 서비스, 렌더러 초기화) | 문자열 `libgfxstream_backend`, `initLibrary`, `android_setOpenglesRenderer`, `opengles`, `GLProcessPipe` [확인-로컬] |
| 비-헤드리스 EXE + `lib64\qt\lib\*.dll` | 창(부모 Qt 창) | PE 임포트 표 [확인-로컬] |

### (d) REA 진입점·힌트

- `libgfxstream_backend.dll`의 내보내기에서 시작한다: `initLibrary` → `RenderLib` 생성, `android_setOpenglesRenderer`, `gfxstream_backend_setup_window`, `stream_renderer_init`/`submit_cmd`/`snapshot`. 비-C 이름은 MSVC 장식 이름(`?gl…@gles1@translator@@…`)이다.
- 문자열 `rcFBPost`, `rcCompose`, `rcFlushWindowColorBuffer`, `rcCreateColorBuffer`, `rcGetRendererVersion`의 xref → 디코더 함수 포인터 테이블(`initRenderControlContext` 상당). `RenderThread` 문자열 → 스레드 메인 루프, `vkQueueSubmit` 문자열(6건)은 Vulkan 경로.
- 표시 경로: `setupSubWindow`, `CreateWindowExA` xref → 자식 창 생성. 에뮬레이터 쪽은 `qemu-system…`의 `android_setOpenglesRenderer` 문자열(3건) xref.
- 안드로이드 쪽 접합: `opengles`, `GLProcessPipe`, `pipe:` 문자열 xref → `AndroidPipe` 서비스 등록·연결 코드.
- 주의: `rea-windows.md` 5.3은 `libgfxstream_backend.dll`을 학습 목적에서 우선순위를 낮췄다. 이 단계를 따라가려면 본체(헤드리스 EXE)를 한 번 훑은 뒤 필요할 때 열면 된다.

## 6. 단계 5. 입력

### (a) 실제 동작

1. 호스트에서 마우스·키 입력은 비-헤드리스 EXE의 Qt 창(`EmulatorQtWindow`)이 받는다. 이벤트는 `SkinEvent`(`kEventMouseButtonDown/Up`, `kEventMouseMotion`, `kEventKeyDown`, `kEventTouchBegin/Update/End`, `kEventGeneric` 등)로 큐에 들어가고 `skin_ui_process_events`가 종류별로 키보드·윈도우 모듈로 나눈다. (G1 `android/android-ui/modules/aemu-ui-qt/src/android/skin/qt/emulator-qt-window.cpp`:1267~1495; `aemu-ui-window/src/android/skin/ui.c`:272~) [확인]
2. 마우스는 `multitouch-screen.c`가 손가락 슬롯, 트래킹 ID, 압력, 위치를 `EV_ABS` 이벤트(`ABS_MT_SLOT`, `ABS_MT_TRACKING_ID`, `ABS_MT_PRESSURE`, `ABS_MT_POSITION_X/Y`, `ABS_MT_TOUCH_MAJOR/MINOR`, `ABS_MT_TOOL_TYPE`)로 바꾼다. 좌표는 화면 크기에서 QEMU 입력 절대 좌표 범위 0x0000~0x7FFF로 `qemu_input_scale_axis` 한다. 펜은 `BTN_TOOL_RUBBER`/`BTN_STYLUS`를 쓴다. (G1 `android/android-emu/android/multitouch-screen.c`:179~345; `virtio-input-multi-touch.c`:80~95) [확인]
3. 변환된 이벤트를 `user_event_generic`이 **VirtioInput 기능이 켜져 있으면 virtio-input으로, 아니면 goldfish_events로** 보낸다("Both ... are maintained in order to be backward compatible"). 로컬 이미지는 `VirtioInput = on`이다. (G1 `android-qemu2-glue/qemu-user-event-agent-impl.c`:78~94; L1) [확인]
4. 멀티터치 장치는 `virtio_input_multi_touch_pci_<1..11>`로 QEMU 타입이 따로 있고, virtio 설정 공간에 `ABS_MT_POSITION_X/Y` 최대값 0x7FFF, `ABS_MT_SLOT` 최대 `MTS_POINTERS_NUM`, `ABS_MT_PRESSURE` 등을 담아 게스트에 알린다. 키보드는 `virtio-keyboard-pci`이다. 키는 안드로이드 키코드를 QEMU `QCode` 키 이벤트로 만들어 `qemu_input_event_enqueue`에 넣는다. (G1 `virtio-input-multi-touch.c`:186~262; `qemu-user-event-agent-impl.c`:32~55; `main.cpp`:822~860) [확인]
5. gRPC `sendTouch`/`sendKey`/`sendMouse`와 `streamInputEvent`도 같은 에이전트(`TouchEventSender` → `user_event->sendGenericEvents`)로 합류한다. (G1 `android/android-grpc/services/emulator-controller/server/src/android/emulation/control/EmulatorService.cpp`:458~500, `keyboard/TouchEventSender.cpp`:163) [확인]
6. 게스트: 커널 `virtio_input`(모듈)과 evdev가 이벤트를 받아 Android `EventHub` → `InputReader` → `InputDispatcher` → 창으로 전달한다(D8). virtio-input 모듈 적재 주체는 first-stage ramdisk 목록에 없으므로 이후 단계(`vendor.dlkm_loader` 등)로 [추정]. (D8; L3) [확인: EventHub 흐름]
7. virtio-input 프로토콜 세부, goldfish_events와의 비교, 미니 에뮬레이터 선택 판단은 `browser-riscv-linux.md` 2.2에 이미 있다(2026-10-19 재확인). 이 파일은 안드로이드 쪽 구현 위치만 보탠다.

### (b) 소스 위치

- 호스트 UI: G1 `android/android-ui/modules/aemu-ui-qt/src/android/skin/qt/emulator-qt-window.cpp`, `event-qt.cpp`, `aemu-ui-window/src/android/skin/{ui.c,window.c}`, `aemu-ui-common/src/android/skin/{keyboard.c,generic-event.cpp}`.
- 변환·주입: G1 `android/android-emu/android/multitouch-screen.c`, `multitouch-port.c`, `android-qemu2-glue/qemu-user-event-agent-impl.c`, `android-qemu2-glue/emulation/virtio-input-multi-touch.c`·`virtio-input-rotary.c`, `hw/input/{virtio-input-hid.c,goldfish_events.c,goldfish_events_common.c}`.
- 게스트 커널: K1 `drivers/input/keyboard/goldfish_events.c`, 메인라인 `drivers/virtio/virtio_input.c`(`kernel/common` android15-6.6에서 200 확인). `CONFIG_VIRTIO_INPUT=m` (G5 `virtual_device_core.fragment`).
- Android 입력 파이프라인 문서: D8.

### (c) 로컬 바이너리·DLL

| 파일 | 역할 | 근거 |
|---|---|---|
| `qemu-system-x86_64.exe`(비-헤드리스) + `lib64\qt\lib\Qt6GuiAndroidEmu.dll`·`Qt6WidgetsAndroidEmu.dll` + `lib64\qt\plugins\platforms\qwindowsAndroidEmu.dll` | 호스트 창과 마우스·키 수신 | PE 임포트 표 [확인-로컬] |
| `qemu-system-x86_64[-headless].exe` | 이벤트 변환·virtio-input 장치 | 문자열 `virtio_input_multi_touch_pci_1`~`11`, `virtio-keyboard-pci`, `virtio-input-hid.c`, 함수 이름 `virtio_input_send`(2건), `android_virtio_input_send` [확인-로컬] |
| `emulator\lib\emulator_controller.proto` (56,453 B) | gRPC 입력 API 정의(`sendKey`, `sendTouch`, `sendMouse`, `injectWheel`, `streamInputEvent`) | 파일 내용 [확인-로컬] |
| 비-헤드리스 EXE만의 Qt 의존 | 헤드리스에는 창이 없어 UI 입력 경로가 없다. gRPC·콘솔 입력만 가능 | `Qt6` 문자열이 헤드리스에 0건 [확인-로컬] |

### (d) REA 진입점·힌트

- 헤드리스 EXE 기준: `virtio_input_multi_touch_pci_*` 타입 이름 → `type_init` 등록 → `VIRTIO_INPUT_CFG_ABS_INFO` 설정 표(0x7FFF 등 상수).
- `android_virtio_input_send`, `virtio_input_send` 문자열의 xref → 이벤트를 virtqueue로 넣는 경로.
- 이벤트 소스: gRPC 서비스 쪽 `android.emulation.control.EmulatorController` 문자열 xref → `sendTouch` 구현(`TouchEventSender`).
- `kEventMouseButtonDown` 같은 이름은 바이너리에 남아 있는지 확인하지 않았다 [미확인]. Qt 이벤트는 비-헤드리스 EXE에서 본다.

## 7. 단계 6. 호스트↔게스트 통신

콘솔·adb 메시지 구조의 일반론은 `browser-riscv-linux.md` 3.1을 본다. 여기서는 구현 위치와 로컬 값을 다룬다.

### (a) 실제 동작

1. **콘솔**: 에뮬레이터는 localhost의 5554~5585(명령줄 문서는 5554~5682)에서 텔넷 콘솔을 연다. `-port N`은 콘솔 N, adb N+1을 뜻한다. 인증 토큰은 `~/.emulator_console_auth_token`이다. `avd snapshot save|load|list|delete` 같은 명령이 있다. 두 공식 문서의 포트 상한이 다르다(5585 vs 5682). (D2; D3; G1 `android/android-emu/android/console.cpp`) [확인]
2. **adb**: 호스트 adb 서버(5037)가 홀수 포트 5555~5585를 스캔해 에뮬레이터를 찾고, 에뮬레이터 프로세스가 그 포트(콘솔+1)에서 연결을 받는다. 게스트 `adbd`와는 두 길이 있다. 옛 길은 goldfish pipe 서비스(`qemud:adb`, `AdbGuestPipe`)이고, **로컬처럼 `VirtioVsockPipe`가 켜져 있으면 virtio-vsock(`guest-cid=77`)을 통한 `AdbVsockPipe`**다. 에뮬레이터가 호스트 소켓과 게스트 스트림 사이를 중계하고 메시지를 로그로 볼 수 있는 sniffer(`HOST==>GUEST`, `HOST<==GUEST`)가 있다. adb 공개키는 bootconfig `androidboot.qemu.adb.pubkey`로 게스트에 주입된다. (D5; G1 `AdbGuestPipe.cpp`, `AdbVsockPipe.cpp`, `main.cpp`:3118; G3 `init.ranchu.adb.setup.sh`; L1; L4) [확인]
3. **gRPC**: 에뮬레이터가 `EmulatorController`·`SnapshotService`·`UiController`·`Adb` 등을 한 서버로 연다. 기본 포트는 시리얼(콘솔) 포트 + 3000부터 1000개 범위이고 `-grpc <port>`로 고정한다. 로컬 로그는 `Started GRPC server at 127.0.0.1:8554, security: Local, auth: +token`이다. 접근 제어는 JWT와 허용 목록 `lib\emulator_access.json`(iss `android-studio`, `icebox` 등)이다. 광고 파일 `%TEMP%\avd\running\pid_<PID>.ini`에 포트 정보를 적는다(`port.serial`, `port.adb` 등). 로컬은 지금 `running` 폴더가 비어 있다. (G1 `android-qemu2-glue/qemu-setup.cpp`:366~, `EmulatorService.cpp`; L2 `emulator_access.json`; L4) [확인]
4. **qemu pipe**: 게스트가 `/dev/goldfish_pipe*`를 열고 `pipe:<서비스>[:인자]\0`를 쓰면 호스트 `AndroidPipe`가 이름으로 서비스를 찾는다(`qemud:<name>`은 먼저 전용 서비스를 찾고 없으면 `qemud` 하나로 폴백). 등록된 서비스는 `opengles`, `GLProcessPipe`, `logcat`, `refcount`, `QemuMiscPipe`, `qemud` 계열 등이다. (G1 `AndroidPipe.cpp`:205~260; `OpenglEsPipe.cpp`:82; `GLProcessPipe.cpp`:59; `LogcatPipe.cpp`:97; `RefcountPipe.cpp`:87; G2 `qemu_pipe_guest.cpp`) [확인]
5. **virtio-serial / vsock**: `virtconsole` 두 개가 `hvc0`(커널 콘솔)·`hvc1`(logcat)이다. 모뎀·GNSS·블루투스·UWB는 `virtserialport`에 TCP/netsim 소켓(chardev)을 붙인다. `virtio-vsock`은 guest-cid 77에서 adb 등에 쓰인다. 그래픽 파이프는 보안상 vsock을 쓰지 않는다. (G1 `main.cpp`:2880~3030, 3118; G2 `qemu_pipe_guest.cpp` 주석 "We can't use vsock for grapshics for security reasons") [확인]
6. **부팅 속성/신호**: 게스트 `qemu-props`가 `qemud:boot-properties` 서비스에 `list`를 보내 속성을 받고, `bootcomplete`/heartbeat를 `QemuMiscPipe`로 호스트에 보낸다. (G3 `qemu-props/qemu-props.cpp`; G1 `QemuMiscPipe.cpp`) [확인]
7. 옛 문서와 현재 코드의 경로 차이: `ANDROID-QEMU-PIPE.TXT`는 `./hw/android/goldfish/pipe.c`를 말하지만 현재 트리에는 `hw/misc/goldfish_pipe.c`가 있다. 문서의 레지스터 설명(v1 CMD_*, v2 명령 버퍼, goldfish_dma)은 개념으로 유효하다. (G1; K1) [확인]

### (b) 소스 위치

- 콘솔: G1 `android/android-emu/android/console.cpp`, `android/emu/telnet/auth/` (토큰), `android/android-emu/android/adb-server.cpp`.
- adb: G1 `android/android-emu/android/emulation/{AdbGuestPipe,AdbVsockPipe,AdbHostListener,AdbHub,AdbMessageSniffer}.cpp`, `android/emu/adb/interface/`, `android/android-grpc/services/adb/`(`pullAdbKey`, `forwardAdb`), `hw/virtio/virtio-vsock.c`.
- gRPC: G1 `android-qemu2-glue/qemu-setup.cpp`, `android/android-grpc/`(`services/emulator-controller/`, `services/snapshot/`, `services-stack/`), 정의 파일 로컬 `emulator\lib\*.proto`와 `emulator_access.json`.
- pipe: G1 `hw/misc/goldfish_pipe.c`, `android/emu/hardware/src/android/emulation/AndroidPipe.cpp`, `android-qemu2-glue/emulation/android_pipe_device.cpp`, `android/docs/ANDROID-QEMU-PIPE.TXT`; 게스트 G2 `guest/qemupipe/`, K1 `goldfish_pipe.c`, G5 `goldfish_drivers/goldfish_pipe.c`.
- 공식 문서: D2(`-port`, `-ports`, `-grpc` 옵션), D3(콘솔), D5(adb 구조).

### (c) 로컬 바이너리·DLL

| 파일 | 역할 | 근거 |
|---|---|---|
| `qemu-system-x86_64[-headless].exe` | 콘솔·adb 리스너·gRPC 서버·pipe 서비스 전부 | 문자열 `Started GRPC server`, `android.emulation.control.EmulatorController`, `emulator_access.json`, `emulator-grpc.cer`, `port.serial`, `pid_`, `AdbGuestPipe`, `AdbVsockPipe`, `QemuMiscPipe`, `boot-properties`, `pipe:`, `GLProcessPipe`, `opengles` [확인-로컬] |
| `emulator\lib\{emulator_controller,snapshot,snapshot_service,adb_service,ui_controller_service,grpc_endpoint_description,emulated_bluetooth*}.proto`, `emulator_access.json` | gRPC API 정의·접근 규칙 | 파일 내용 [확인-로컬] |
| `lib64\liblibprotobuf.dll`, `libandroid-emu-protos.dll`, `libabseil_dll.dll` | protobuf·abseil | gRPC 코어 DLL은 없으므로 gRPC 라이브러리는 EXE에 정적 링크된 것으로 [추정] |
| `platform-tools\adb.exe` | 호스트 adb | `ls` [확인-로컬] |
| `emulator\netsimd.exe`, `nimble_bridge.exe` | 네트워크·블루투스 시뮬레이터 | 문자열 `netsim.model.`, `netsim.frontend.`(Rust) [확인-로컬]. 에뮬레이터와의 연결은 소스의 `-chardev netsim` [확인] |
| `emulator\qsn.exe` (30,636,184 B) | 용도 [미확인]. Go 바이너리이고 `Quickboot`, `QuickbootLoad`, `QuickbootSave` 문자열이 있다 | 문자열 조회 |

### (d) REA 진입점·힌트

- 문자열 `Started GRPC server` → `qemu_setup_grpc` 상당 함수(함수 이름 문자열은 없음, `qemu_setup_grpc` 0건) → 포트 범위 계산(`serial + 3000`), `port.serial`/`port.adb` 속성 표.
- `android.emulation.control.EmulatorController` 같은 서비스 이름 문자열 → protobuf 메서드 표(`/android.emulation.control.EmulatorController/sendTouch` 등)와 `emulator_controller.proto` 대조.
- `emulator_access.json` → 접근 허용 로직. `emulator-grpc.cer`/`.key` → TLS 옵션.
- `pipe:` 문자열과 `AndroidPipe` 서비스 이름(`opengles`, `GLProcessPipe`, `refcount`, `logcat`) → 서비스 레지스트리 `findServiceByName`. `goldfish_pipe.c`, `pipe_dev_write` → 레지스터 쓰기 분기(`PIPE_REG_CMD` 등).
- `AdbGuestPipe`, `AdbVsockPipe` → 호스트 소켓과 게스트 스트림 중계. `virtio-vsock-pci`, `virtio-vsock.c`.

## 8. 단계 7. 스냅샷과 퀵부트

### (a) 실제 동작

1. 퀵부트는 AVD당 하나의 자동 스냅샷 `default_boot`이다. 종료 때 저장하고 시작 때 불러온다. 첫 시작은 콜드 부팅이다. 설정 `fastboot.forceFastBoot=yes`(로컬 `config.ini`), 저장 여부는 `quickbootChoice.ini`의 `saveOnExit`이다. 공식 문서는 퀵부트가 콜드 부팅보다 최대 10배 빠르다고 한다. (D4; G1 `Quickboot.cpp`; L2) [확인]
2. 호출 사슬: `Quickboot::load(name)` → `Snapshotter::load(isQuickboot, name)` → VM 연산 `snapshotLoad` → QEMU `load_snapshot`(`migration/savevm.c`). 저장은 `Quickboot::save` → `Snapshotter::save` → `snapshotSave`. `savevm.c`에는 `qemu_set_snapshot_callbacks`로 에뮬레이터가 시작·종료·실패 지점에 끼어드는 훅(`QEMUSnapshotCallbacks`)이 있다. (G1 `Quickboot.cpp`:324, 621; `Snapshotter.cpp`:315, 327, 751, 769; `migration/savevm.c`:1062, 2345) [확인]
3. QEMU 표준 VM 스냅샷은 CPU·RAM·장치 상태와 쓰기 가능한 모든 디스크 내용을 담고, 최소 하나의 qcow2 쓰기 가능 블록 장치가 필요하다(Q5). 이 에뮬레이터의 userdata 등이 qcow2 오버레이인 이유다. 장치 상태는 VMState(Q9)로 직렬화된다. [확인]
4. RAM은 따로 다룬다. `QuickbootFileBacked`가 켜지면 RAM을 파일(`ram.img`)에 공유 매핑(`-mem-path`, `-mem-file-shared`)해 RAM 변경이 파일에 직접 남게 한다 [추정]. 별도 `RamSaver`는 "8바이트 인덱스 오프셋 + 0이 아닌 페이지들 + `FileIndex`" 형식의 파일을 쓰고, `RamLoader`는 그 파일 또는 `ram.img`에서 즉시/지연(`MemoryWatch`로 페이지 폴트 시 로드) 로드한다. 2026-10-17 로그는 `-no-snapshot-save`로 실행했고 종료 때 `Not saving state: RAM not mapped as shared`가 찍혔다. 코드상 `-no-snapshot-save`면 `mapAsShared`가 꺼지므로 그 경우 RAM 상태 저장을 건너뛴 것으로 읽힌다 [추정: 로그 문구와 `main.cpp` 조건의 대응]. (G1 `main.cpp`:2054~2075; `RamSaver.h`:94~101; `RamLoader.h`; L4) [확인: 형식과 인자] [추정: `ram.bin`이 인덱스]
5. GPU 상태: gfxstream이 텍스처를 `textures.bin`으로 저장·복원한다(`TextureSaver`/`TextureLoader`는 `libandroid-emu-shared.dll`이 내보내고, `stream_renderer_snapshot/restore/suspend/resume`, `FrameBuffer::onSave/onLoad`가 호출한다). (G2 `host/FrameBuffer.cpp`:2248, 2381, `host/virtio-gpu-gfxstream-renderer.cpp`:410; L3) [확인]
6. 호환성 검사: `snapshot.pb`(`Snapshot`: images, host(`gpu_driver`, `hypervisor`), config(`enabled_features`, `selected_renderer`, `cpu_core_count`, `ram_size_bytes`) 등)와 `hardware.ini`를 비교해 맞지 않으면 무효로 보고 콜드 부팅한다. 공식 문서도 "시스템 이미지, AVD 구성, 에뮬레이터 기능이 바뀌면 모든 스냅샷이 무효"라고 한다. (L2 `lib\snapshot.proto`; G1 `Snapshot.cpp`; D4) [확인]
7. 로컬 실제 `default_boot`: `ram.img` 2,147,549,184 B(= 2048 MiB + 65,536 B), `ram.bin` 337 B, `textures.bin` 13,658,612 B, `snapshot.pb` 1,112 B, `hardware.ini` 4,407 B, `screenshot.png` 1,816,238 B, `compatible.pb` 0 B. 디스크 쪽은 AVD의 `*.qcow2`(userdata 6,787,956,736 B). 2026-10-17 로그: `Successfully loaded snapshot 'default_boot' using 528 ms`. (L2; L4) [확인]
8. 외부 제어: 콘솔 `avd snapshot ...`, gRPC `SnapshotService`(`ListSnapshots`, `LoadSnapshot`, `SaveSnapshot`, `DeleteSnapshot`, `PullSnapshot`, `PushSnapshot`, `UpdateSnapshot`, `GetScreenshot`, `TrackProcess`). (D3; L2 `snapshot_service.proto`) [확인]

### (b) 소스 위치

- 에뮬레이터 스냅샷: G1 `android/android-emu/android/snapshot/`(`Quickboot.cpp`, `Snapshotter.cpp`, `Snapshot.cpp`, `Saver.cpp`, `Loader.cpp`, `RamSaver.cpp`, `RamLoader.cpp`, `TextureSaver.cpp`, `TextureLoader.cpp`, `MemoryWatch_windows.cpp`, `Compressor.cpp`, `PathUtils.cpp`), `android/emu/protos/snapshot.proto`, `android-qemu2-glue/snapshot_compression.cpp`, `android-qemu2-glue/qemu-vm-operations-impl.cpp`.
- QEMU 훅: G1 `migration/savevm.c`(`qemu_set_snapshot_callbacks`, `save_snapshot`/`load_snapshot`), `migration/ram.c`, `migration/vmstate.c`.
- gfxstream 쪽: G2 `host/FrameBuffer.cpp`(`onSave`, `onLoad`), `host/virtio-gpu-gfxstream-renderer.cpp`(`stream_renderer_snapshot`, `restore`), `host/VirtioGpu*Snapshot.proto`.
- gRPC: G1 `android/android-grpc/services/snapshot/`.
- 공식 문서: D4(사용법), D3(콘솔 명령), Q5(VM snapshots), Q9(VMState).

### (c) 로컬 바이너리·DLL

| 파일 | 역할 | 근거 |
|---|---|---|
| `qemu-system-x86_64[-headless].exe` | Quickboot, Snapshotter, RamSaver/Loader, 인자 처리 | 문자열 `default_boot`, `quickbootChoice.ini`, `bootcompleted.ini`, `snapshot_deps.pb`, `textures.bin`, `ram.img`, `ram.bin`, `Not saving state: RAM not mapped as shared`, `-mem-path`, `-mem-file-shared`, `-loadvm`, `Quickboot`(12건), `Snapshotter`, `RamSaver`, `RamLoader`, `TextureSaver` [확인-로컬] |
| `lib64\libandroid-emu-shared.dll` | `TextureSaver`/`TextureLoader` | 내보내기 `saveTexture`, `loadTexture`, `diskSize`, `getDuration` [확인-로컬] |
| `lib64\libgfxstream_backend.dll` | 렌더러 상태 저장 | 내보내기 `stream_renderer_snapshot/restore/suspend/resume`, 문자열 `onSave` [확인-로컬] |
| `emulator\qemu-img.exe` | qcow2 도구 | 이름과 AVD의 `*.qcow2`에서 [추정] |
| `emulator\qsn.exe` | 용도 [미확인] | 7절 (c) 참고 |
| `emulator\lib\snapshot.proto`, `snapshot_service.proto` | 스냅샷 메타·gRPC 정의 | 파일 내용 [확인-로컬] |
| AVD `snapshots\default_boot\*`, `quickbootChoice.ini`(`saveOnExit = true`), `bootcompleted.ini`(0 B) | 스냅샷 데이터 | `ls`, 파일 내용 [확인-로컬] |

로컬 바이너리에는 소스에 있는 `-savevm-on-exit` 문자열이 없다. 저장이 로그상 동작하므로(`Saving snapshot 'default_boot'`) 저장 호출 방식이 바뀌었을 수 있다 [추정].

### (d) REA 진입점·힌트

- 파일 이름 문자열 `default_boot`, `quickbootChoice.ini`, `bootcompleted.ini`, `snapshot_deps.pb`, `textures.bin`, `ram.bin`, `ram.img`의 xref → `PathUtils`·`Snapshot`·`RamSaver` 코드. `Not saving state: RAM not mapped as shared`의 xref → 저장 여부 결정 분기.
- 인자 문자열 `-mem-path`, `-mem-file-shared`, `-loadvm` → QEMU 인자 처리(`vl.c`)와 `qemu_ram_alloc` 계열.
- gfxstream: 내보내기 `stream_renderer_snapshot`, `stream_renderer_restore`, `stream_renderer_suspend`, `resume`과 `onSave`/`onLoad`.
- `libandroid-emu-shared.dll`의 `TextureSaver::saveTexture` 등 내보내기가 가장 작은 진입점이다(67개 내보내기).

## 9. QEMU 베이스 버전과 upstream 차이

### 9.1 베이스 버전

- 로컬 바이너리 문자열: `QEMU emulator version 2.12.0 (v2.12.0-19097-g85fa07f04ef)`(x86_64와 헤드리스 모두). [확인-로컬]
- 소스: `QEMU_VERSION` 파일 내용이 `2.12.0`이다(`emu-master-dev`, `emu-36-1-release`, `emu-master-qemu` 모두). (G1; G8) [확인]
- upstream `v2.12.0` 태그 커밋은 `4743c23509a51bd4ee85cc272287a41917d1be35`, 2018-04-24 "Update version for v2.12.0 release"이다. (Q8) [확인]
- 최신 upstream 안정판은 11.1.2(2026-09-28)이고 11.0.5, 10.2.4, 10.1.5, 10.0.14가 병행 유지된다. QEMU 문서 master는 11.1.50이다. (Q7; Q3) [확인]
- 따라서 포크는 upstream 2.12에서 갈라져 8년 넘게 별도 진화했다. `19097`은 `v2.12.0` 이후 커밋 수이며 대부분 `android/` 아래 에뮬레이터 코드의 이력으로 보인다 [추정].

### 9.2 upstream 2.12.0과의 경로 비교 (내가 만든 계산)

방법: G1 `ae9d18d`와 upstream `v2.12.0`을 각각 `git ls-tree -r`로 받아 경로와 blob SHA를 비교했다. blob 내용을 내려받지 않았으므로 어떤 줄이 바뀌었는지는 모른다. 공백 변경도 "다름"으로 센다. [확인: 계산 결과] [추정: 해석]

| 항목 | 값 |
|---|---|
| 포크 파일 수 / upstream v2.12.0 파일 수 | 18,533 / 6,066 |
| 공유 경로 | 6,040 (SHA 동일 5,652 = 93.6%, 다름 388) |
| 포크에만 있는 경로 | 12,493 (이 중 `android/third_party` 8,599, `android/android-ui` 1,429, `android/emu` 671, `android/android-emu` 376, `android/android-grpc` 286 …) |
| 포크에만 있는 경로 중 `android/`·`android-qemu2-glue/` 밖 | 222 |
| upstream에만 있는 경로 | 26 (`target/i386/hvf/*` 24개: 포크는 `target/i386/hvf-utils/`로 옮김, `ui/keycodemapdb`, `VERSION`) |

QEMU 코어를 건드린 쪽(공유 경로 중 다른 파일 388개)은 `tests/tcg` 18, `target/i386` 17, `include/qemu` 16, `include/sysemu` 12, `include/hw` 12, `target/arm` 11, `target/mips` 9, `hw/i386` 7, `hw/display` 7, `hw/pci` 6, `hw/intc` 6, `hw/audio` 6, `hw/virtio` 5 순이다.

### 9.3 눈에 띄는 차이 (경로 이름 기준)

- 안드로이드 전용 장치 추가: `hw/misc/goldfish_{pipe,sync,battery,pstore}.c`, `hw/pci/goldfish_address_space.c`, `hw/input/goldfish_{events,events_common,rotary}.c`, `hw/display/goldfish_fb.c`, `hw/audio/goldfish_audio.c`, `hw/timer/goldfish_timer.c`, `hw/intc/goldfish_pic.c`, `hw/char/goldfish_tty.c`, `hw/arm/ranchu.c`, `hw/mips/mips_ranchu.c`.
- 새 virtio: `hw/virtio/virtio-vsock.c`(+stub), `hw/virtio/virtio-snd-pci.c`, `hw/audio/virtio-snd.c`; `hw/input/virtio-input-hid.c`·`hw/display/virtio-gpu*.c`·`hw/virtio/virtio-pci.c`는 수정됨.
- 가속기: AEHD 추가(`target/i386/aehd*.c`, `hw/i386/aehd/`, `accel/stubs/aehd-stub.c`), WHPX는 upstream 2.12에도 `whpx-all.c`가 있으나 포크가 `whp-dispatch.h`(DLL 동적 로딩)·`whpx-headers/`를 추가, HVF 코드 재배치.
- 안드로이드 CPU 모델 `android64`(`target/i386/cpu.c`), `android32`.
- 스냅샷 훅: `migration/savevm.c`, `migration/ram.c`, `migration/qemu-file.c`, `migration/compression.h`, `android-qemu2-glue/snapshot_compression.cpp`.
- 빌드·임베딩: CMake(`CMakeLists.txt`, `cmake-main.*.inc`)와 `vl.c`의 `qemu_main`/`run_qemu_main`(QEMU를 라이브러리처럼 호출), 오디오 포워더(`audio/audio_forwarder.c`, `winaudio.c`), `util/abort.c`.
- `block/cat.c`(`cat:` 블록 프로토콜; 소스상 ChromeOS 단일 디스크 경로에서 쓰임)와 vmnet(`net/vmnet-*.c`, macOS).
- 소스에는 `// ANDROID_BEGIN` 표식이 코어 파일에 남아 있다(`target/i386/cpu.c`에서 확인). 표식 전체를 센 것은 아니다.
- 2.12 이후 upstream 기능(예: 이후의 빌드 시스템·머신 모델 개편)은 대부분 없다고 보면 된다. 근거는 코어 공유 경로의 93.6%가 v2.12.0과 같다는 위 계산이다 [추정].

## 10. 윈도우에서 x86_64 이미지는 어떤 가속기로 도는가

### 10.1 결론

**WHPX(Windows Hypervisor Platform)다.** 근거 셋: (1) 2026-10-17 실행 로그에 `WHPX on Windows 10.0.26200 detected.`와 `Windows Hypervisor Platform accelerator is operational`이 있다. (2) 이 PC는 Hyper-V 하이퍼바이저가 실행 중이고, 소스의 선택 로직은 그 경우 WHPX만 시도한다. (3) AEHD 서비스는 STOPPED이고 HAXM은 코드에서 제거됐다. (L4; L5; G1) [확인]

### 10.2 선택 로직 (G1 `CpuAccelerator.cpp`, `GetCurrentCpuAccelerator`)

1. Linux/KVM이 있으면 KVM. Windows·macOS 빌드는 아래로 간다.
2. `GetHyperVStatus()`: CPUID `0x40000003`의 EBX 비트 0(CreatePartitions)으로 "Hyper-V 루트 파티션이 실행 중인가"를 본다.
3. 실행 중이면 `WindowsHypervisorPlatform` 기능 플래그가 켜져 있고 Windows 10 빌드 17134 이상일 때 `ProbeWHPX`(`WinHvPlatform.dll`과 `WHvGetCapability` 확인)를 해서 WHPX를 고른다. 아니면 "Hyper-V를 끄거나 Windows Hypervisor Platform을 켜라"는 안내를 낸다.
4. 실행 중이 아니면 CPU 벤더가 Intel/AMD인지 보고 `ProbeAEHD`(`\\.\AEHD` 장치 열기, 버전 IOCTL)를 먼저, 안 되면(Intel만) HAXM을 시도한다. macOS는 HVF다.
5. 선택 결과는 `-enable-whpx`/`-enable-aehd`/`-enable-kvm`/`-enable-hvf` 중 하나로 QEMU에 전달된다.

로컬 바이너리에는 위 메시지 중 WHPX·AEHD 것은 있고(`Please disable Hyper-V …`, `Hyper-V detected and Windows Hypervisor Platform …`, `WinHvPlatform.dll found`, `Unable to open AEHD device`) HAXM 것(`HAXM is deprecated`, `Opening HAX kernel module failed`)은 없다. [확인-로컬]

### 10.3 로컬 상태 (2026-10-18, 읽기 전용 조회)

| 항목 | 값 |
|---|---|
| CPU | AMD Ryzen 5 7500F, `VirtualizationFirmwareEnabled=True` |
| `Win32_ComputerSystem.HypervisorPresent` | True |
| 서비스 | `hvservice` Running, `vmcompute` Running, `HvHost` Running, `vmms` 없음 |
| AEHD | 드라이버 패키지 2.2.0이 SDK `extras`에 있고 서비스 `aehd`는 STOPPED(WIN32_EXIT_CODE 31) |
| HAXM / gvm | 서비스 없음 |
| 과거 실행(2026-10-17) | `WHPX on Windows 10.0.26200 detected.` + `Windows Hypervisor Platform accelerator is operational`, `hasCompatibleHypervisor`: Ok |

### 10.4 공식 문서의 요점

- Windows에서는 WHPX를 권장하고 Windows 10 1803 이상이 필요하다. AEHD는 2026-12-31에 지원이 종료되고 그때까지 WHPX로 옮겨야 한다. 36.2.x.x부터 HAXM은 쓰지 않는다. Hyper-V 하이퍼바이저를 쓰는 기능(Core Isolation 등)은 AEHD와 함께 쓸 수 없고 그럴 때 WHPX를 쓰라고 한다. (D1) [확인]
- QEMU 문서의 WHPX 항: Windows Hypervisor Platform은 Hyper-V 위의 서드파티 VMM용 API이고, QEMU는 x86_64에서 Windows 10 2004 이상을 테스트한다. 알려진 문제에 MMIO에 MMX/SSE/AVX 명령을 쓰는 게스트가 있다. (Q4) [확인]

## 11. 로컬 시스템 이미지 폴더 구성

### 11.1 공통 파일 (모든 이미지 폴더, `ls`로 확인)

`NOTICE.txt`, `VerifiedBootParams.textproto`, `advancedFeatures.ini`, `build.prop`, `data\`, `encryptionkey.img`(18,874,368 B), `kernel-ranchu`, `kernel_cmdline.txt`(32 B), `package.xml`, `ramdisk.img`, `source.properties`, `system.img`, `vendor.img`. `userdata.img`는 없고 `data\`(`empty_data_disk`, `local.prop`, `misc\{apns,emulator,modem_simulator,pixel_*fold}`)가 있다. [확인-로컬]

### 11.2 이미지별 차이

| 경로 (`...\Sdk\system-images\`) | `kernel-ranchu` | `ramdisk.img` | `system.img` | `vendor.img` | 커널 버전 문자열 |
|---|---:|---:|---:|---:|---|
| `android-35\default\x86_64` | 19,137,536 | 2,141,835 | 1,622,147,072 | 110,100,480 | 6.6.30-android15-8-gdd9c02ccfe27-ab11987101 |
| `android-35\google_apis\x86_64` | 20,374,528 | 2,154,591 | 3,576,692,736 | 116,391,936 | 6.6.50-android15-8-g8adecb593e9b-ab12525588 |
| `android-35\google_apis_playstore\x86_64` | 19,137,536 | 1,860,748 | 2,154,823,680 | 51,380,224 | 6.6.30-android15-8-gdd9c02ccfe27-ab11987101 |
| `android-36.1\google_apis_playstore\x86_64` | 22,635,520 | 1,622,780 | 2,421,161,984 | 60,817,408 | 6.12.38-android16-5-gbb9513914902-ab13996879 |

- 커널 버전은 `kernel-ranchu` 안의 문자열을 읽은 것이다(`kernel-ranchu`는 bzImage이고 페이로드가 LZ4 legacy라 메모리에서 풀어 `Linux version` 문자열을 읽었다. L3). `google_apis`(35)와 36.1 이미지는 `HdrS`, boot protocol 0x020f를 확인했다. 나머지 둘은 버전 문자열만 읽었다. [확인-로컬]
- `kernel_cmdline.txt`는 모두 `8250.nr_uarts=1 clocksource=pit`. 이미지별 `advancedFeatures.ini`는 `PlayStoreImage`(playstore만), `VirtioInput`, `VirtioVsockPipe`, `GLDirectMem`, `GLDMA`, `HostComposition`, `DynamicPartition`, `AndroidbootProps2`, `VirtioWifi`, `VirtioSndCard`, `MultiDisplay` 등이 `on`이다. 36.1 이미지는 추가로 `Uwb`, `VulkanVirtualQueue`가 `on`이다. `source.properties`의 `Pkg.Dependencies=emulator#...`(35: #29.1.11, #33.1.24, 36.1: #35.4.9)는 이미지가 요구하는 최소 에뮬레이터 버전이다. [확인-로컬]
- 공식 문서 표(D2): `kernel-ranchu`(커널, 옵션 `-kernel`), `ramdisk.img`(`-ramdisk`), `system.img`(`-system`), `userdata.img`(`-initdata`; 이 이미지에는 없고 `data\`가 대신함). [확인]
- `ramdisk.img`의 내용: cpio 2개 연결(2절 (a) 4). `/init` 4,132,440 B, `first_stage_ramdisk/fstab.ranchu`(system·vendor·product·system_ext는 erofs/ext4 `logical`, `/data`는 `/dev/block/vdc`, `/metadata`는 PCI 0000:00:06.0, sdcard는 `vdf`), 모듈 8개. [확인-로컬: android-35 google_apis 이미지에서 확인]
- `fstab.ranchu`의 `vdc`(/data), `vdf`(sdcard)는 QEMU 인자의 디스크 순서(system, cache, userdata, encryptionkey, vendor, sdcard)에서 세 번째와 여섯 번째와 맞는다. `encryptionkey.img`가 `/metadata`로 쓰이는지는 [추정]이다.

### 11.3 에뮬레이터 쪽 세부 (2026-10-18; 마지막 줄만 2026-10-19)

- `emulator\lib\advancedFeatures.ini`(26,322 B)는 에뮬레이터 기본 기능 플래그(예: `FastSnapshotV1 = on`, `QuickbootFileBacked = on`, `WindowsHypervisorPlatform = on`, `HVF = on`, `KVM = off`, `HYPERV = off`, `OnDemandSnapshotLoad = off`, `WindowsOnDemandSnapshotLoad = on`)이다. 이미지의 파일이 덮어쓰는 것으로 [추정]. `~/.android\emu-last-feature-flags.protobuf`는 마지막 실행의 플래그이나 열지 않았다.
- `emulator\lib\hardware-properties.ini`(30,569 B)는 AVD 설정 키 정의(`hw.gltransport` 등)다.
- 소스에 `ANDROID_I_WANT_MY_TCG` 처리가 있다는 공식 문서(D2) 설명과 달리, 로컬 `emulator.exe`와 `qemu-system-x86_64-headless.exe`에서 이 이름을 ASCII로는 찾지 못했다(0건). UTF-16이나 다른 DLL일 수 있어 [미확인]이다. (2026-10-19 확인)

### 11.4 AVD 폴더 (`C:\Users\xxx99\.android\avd\Pixel_4a.avd`, `config.ini`의 `image.sysdir.1=system-images\android-35\google_apis\x86_64\`)

`config.ini`, `hardware-qemu.ini`(실행마다 생성), `initrd`(2,156,476 B = ramdisk + bootconfig), `userdata-qemu.img.qcow2`(6,787,956,736 B), `cache.img`·`cache.img.qcow2`(73,728,000 B), `encryptionkey.img.qcow2`(2,883,584 B), `sdcard.img`(536,870,912 B)·`sdcard.img.qcow2`(1,114,112 B), `snapshots\default_boot\`(8절), `quickbootChoice.ini`, `bootcompleted.ini`, `emu-launch-params.txt`, `emulator-user.ini`, `multiinstance.lock`, `data\misc\pstore\pstore.bin`(65,536 B), `modem_simulator\`, `AVD.conf`, `snapshot.trace`, `read-snapshot.txt`. 같은 폴더의 `Medium_Phone.avd`(`android-36.1`)는 열지 않았다. [확인-로컬]

## 12. 미확인과 한계

1. **공개 소스와 로컬 바이너리의 시차.** G1~G4·G7의 `main`/`emu-master-dev`는 2025-03(35.6.3 canary)에서 멈춰 있고, 로컬은 36.3.10(2026-01 빌드)이다. 36.3.x에 대응하는 공개 브랜치는 찾지 못했다(`emu-36-1-release`는 2024-10-30 마지막 커밋). 줄 번호와 세부 분기는 어긋날 수 있다. 확인된 어긋남: `-savevm-on-exit`, HAXM 탐색. 커널 저장소(`android16-6.12`)는 2026-09-01에도 갱신되고 있다. [확인]
2. QEMU의 **최종 커맨드라인**은 에뮬레이터를 실행해야 알 수 있다(`-verbose`/`-show-kernel`). 이번에는 소스 재구성(1.3)만 했다.
3. 디스크가 **논리 파티션(`super`)**으로 노출되는 방식(`DynamicPartition`, fstab의 `logical`)은 읽지 않았다. 소스에는 `cat:` 블록 프로토콜(`block/cat.c`)과 동적 파티션 코드가 있으나 연결을 확인하지 못했다.
4. 게스트 Vulkan이 이 설정(`gltransport=pipe`)에서 ASG(`goldfish_address_space`)를 쓰는지는 읽지 않았다.
5. `ram.bin`의 정확한 역할, `bootcompleted.ini`의 의미, `qsn.exe`·`emulator-check.exe`의 세부, `encryptionkey.img`의 파티션 역할은 [추정] 또는 [미확인]이다.
6. 게스트 HWC가 `rcCompose`를 호출하는 주체인지(5절 (a) 4)와 virtio-input 모듈의 적재 시점(6절 (a) 6)은 [추정]이다.
7. Windows Hypervisor Platform API의 Microsoft 공식 문서는 허용 출처에 없어 읽지 않았다. WHPX 동작은 QEMU 문서와 AOSP 소스로만 설명했다.
8. 옛 `android/docs/*.TXT`는 ARM·goldfish 시절 설명이 많다. 개념은 유효하지만 경로·상수는 현재 코드와 다르다(예: `hw/android/goldfish/pipe.c` → `hw/misc/goldfish_pipe.c`).
9. `rea-windows.md` 6절의 REA 한계(Ghidra 요건 미충족 등)는 이 파일의 REA 힌트에도 그대로 적용된다. 힌트는 "정적 문자열·내보내기·xref로 도달 가능한 지점"만 적었고 실제로 REA에서 열어 확인하지는 않았다.

## 13. 출처

확인일은 표에 적은 날짜다(적지 않으면 2026-10-18). G1~G7의 URL은 커밋 해시로 고정한 주소이며 뒤에 `<경로>`를 붙이면 파일이 된다(예: `.../+/ae9d18d.../android-qemu2-glue/main.cpp`).

### 13.1 공식 문서

| 태그 | 출처 | 비고 |
|---|---|---|
| D1 | [emulator-acceleration](https://developer.android.com/studio/run/emulator-acceleration) | 문서 표기 "Last updated 2026-03-06 UTC" |
| D2 | [emulator-commandline](https://developer.android.com/studio/run/emulator-commandline) | "Last updated 2026-10-05 UTC". `-port`·`-ports`·`-accel`·AVD system directory 표 |
| D3 | [emulator-console](https://developer.android.com/studio/run/emulator-console) | "Last updated 2026-07-17 UTC" |
| D4 | [emulator-snapshots](https://developer.android.com/studio/run/emulator-snapshots) | "Last updated 2026-03-06 UTC" |
| D5 | [adb](https://developer.android.com/tools/adb) | "Last updated 2026-09-25 UTC" |
| D6 | [Implement bootconfig in Android 12](https://source.android.com/docs/core/architecture/bootloader/implementing-bootconfig) | "Last updated 2026-10-09 UTC" |
| D7 | [SurfaceFlinger and WindowManager](https://source.android.com/docs/core/graphics/arch-sf-hwc) | "Last updated 2026-10-09 UTC" |
| D8 | [Input](https://source.android.com/docs/core/interaction/input) | "Last updated 2026-10-09 UTC" |

### 13.2 AOSP 소스

| 태그 | 출처 | 기준 판 |
|---|---|---|
| G1 | [platform/external/qemu](https://android.googlesource.com/platform/external/qemu/+/ae9d18d2b6261179fbd57fffec720a04f7bfb053/) | `emu-master-dev` 커밋 `ae9d18d2b6261179fbd57fffec720a04f7bfb053`(2025-03-27 "Bump Emulator to 35.6.3 Canary") |
| G2 | [platform/hardware/google/gfxstream](https://android.googlesource.com/platform/hardware/google/gfxstream/+/d047a57228332d995d36600792fa9ccc26cf8ae6/) | `main` `d047a57…`(2025-03-26) |
| G3 | [device/generic/goldfish](https://android.googlesource.com/device/generic/goldfish/+/3ce87694caeb4a330280bb1284d9ad050fe28263/) | `main` `3ce8769…`(2025-03-13) |
| G4 | [device/generic/goldfish-opengl](https://android.googlesource.com/device/generic/goldfish-opengl/+/5cd042c8586a38b408f390fcef979d58ace3da23/) | `main` `5cd042c…`(2025-03-14) |
| G5 | [kernel/common-modules/virtual-device](https://android.googlesource.com/kernel/common-modules/virtual-device/+/211d96f861e1d6061ecb6bbe6e289ce8bf144290/) | `android15-6.6` `211d96f…`(2025-02-11) |
| G6 | [kernel/common](https://android.googlesource.com/kernel/common/+/150617c4d667a241e52441e855befac0c5d6702b/) | `android15-6.6` `150617c…` |
| G7 | [platform/system/core](https://android.googlesource.com/platform/system/core/+/a3b721a32242006b59cb12bd62c9133632af3a2d/) | `main` `a3b721a…`(2025-03-26) |
| G8 | [external/qemu 브랜치 목록](https://android.googlesource.com/platform/external/qemu/+refs) | `emu-35-*`, `emu-36-1-release`, `emu-master-dev` 등 |

### 13.3 QEMU와 Linux 커널

| 태그 | 출처 | 비고 |
|---|---|---|
| Q1 | [TCG Translator Internals](https://www.qemu.org/docs/master/devel/tcg.html) | |
| Q2 | [The memory API](https://www.qemu.org/docs/master/devel/memory.html) | |
| Q3 | [Direct Linux Boot](https://www.qemu.org/docs/master/system/linuxboot.html) | 문서 푸터 "QEMU version 11.1.50" |
| Q4 | [Windows Hypervisor Platform](https://www.qemu.org/docs/master/system/whpx.html) | |
| Q5 | [Disk Images: VM snapshots](https://www.qemu.org/docs/master/system/images.html) | |
| Q6 | [RISC-V `virt` board](https://www.qemu.org/docs/master/system/riscv/virt.html) | 14절 근거 |
| Q7 | [Download QEMU](https://www.qemu.org/download/) | 11.1.2 / 2026-09-28 |
| Q8 | [gitlab.com/qemu-project/qemu 태그 v2.12.0](https://gitlab.com/qemu-project/qemu) | 커밋 `4743c23509a51bd4ee85cc272287a41917d1be35`, 2018-04-24 (`git clone --depth 1 --branch v2.12.0`) |
| Q9 | [Migration: VMState](https://www.qemu.org/docs/master/devel/migration/main.html) | |
| K1 | [torvalds/linux.git](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/) | `drivers/platform/goldfish/goldfish_pipe.c`, `goldfish_pipe_qemu.h`, `drivers/input/keyboard/goldfish_events.c`, `drivers/power/supply/goldfish_battery.c`, `drivers/rtc/rtc-goldfish.c`, `drivers/tty/goldfish.c` 확인일의 HEAD. 커밋 해시는 기록하지 못했다(재조회 시 git.kernel.org 접속 실패) |
| K2 | [Boot Configuration](https://docs.kernel.org/admin-guide/bootconfig.html) | initrd 끝에 `[bootconfig][padding][size][checksum]#BOOTCONFIGn` |
| K3 | [The Linux/x86 Boot Protocol](https://docs.kernel.org/arch/x86/boot.html) | Protocol 2.15 |

### 13.4 로컬 (읽기·조회만)

| 태그 | 대상 | 방법 |
|---|---|---|
| L1 | `C:\Users\xxx99\AppData\Local\Android\Sdk\{emulator,system-images,extras,platform-tools}` | `ls`, 작은 텍스트 파일 읽기(`source.properties`, `package.xml`, `kernel_cmdline.txt`, `advancedFeatures.ini`, `*.proto`, `emulator_access.json`) |
| L2 | `C:\Users\xxx99\.android\avd\Pixel_4a.avd\`(`config.ini`, `hardware-qemu.ini`, `snapshots\`, `initrd` 등)와 `C:\Users\xxx99\.android\` | `ls`, 텍스트 읽기 |
| L3 | 로컬 EXE·DLL·`kernel-ranchu`·`ramdisk.img`·`initrd` | `grep -a`로 문자열 조회, 내가 쓴 node 스크립트(PE 내보내기/임포트 목록, bzImage 헤더 `HdrS`·페이로드 압축 확인, LZ4 legacy 해제 + cpio 목록, 커널 `Linux version` 문자열). 스크립트는 scratchpad에 있고 파일을 수정하지 않는다 |
| L4 | `C:\Users\xxx99\AppData\Local\Temp\argent-emulator-Pixel_4a.log` | 2026-10-17 13:22 실행 로그 읽기(다른 도구가 만든 것). 내가 에뮬레이터를 실행한 것이 아니다 |
| L5 | PowerShell `Get-Service`, `Get-CimInstance Win32_ComputerSystem/Win32_Processor`, `sc query aehd` | 상태 조회만 |

### 13.5 같은 폴더의 조사 파일 (2026-10-19 재확인)

- `browser-riscv-linux.md` 2.2(virtio-input·goldfish_events 비교), 3.1(콘솔·adb 구조).
- `rea-windows.md` 5.1~5.3(로컬 바이너리 크기·PE 헤더·REA 열람 순서), 5.2(`emulator.exe`·헤드리스 EXE 문자열), 6절(한계).

## 14. 미니 에뮬레이터에 옮길 때의 대응표

이 절은 조사 사실이 아니라 **설계 제안**이다. 진짜 에뮬레이터 칸은 위 각 절의 사실이고, 미니 칸은 브라우저 RISC-V 에뮬레이터에 대응시키는 판단이다. QEMU의 RISC-V `virt` 보드가 참고 모델이다. 문서상 `virt`는 CLINT, PLIC, NS16550 UART, **Google Goldfish RTC 1개**, virtio-mmio 8개, PCIe 호스트 브리지, fw_cfg를 갖고, DTB를 자동 생성해 게스트에 넘기며 `-kernel`로 리눅스를 직접 올린다(Q6).

| 단계 | 진짜 안드로이드 에뮬레이터(이 파일의 사실) | 브라우저 RISC-V 미니 버전의 대응 |
|---|---|---|
| 1. 실행과 부팅 | `emulator.exe`가 QEMU를 띄우고 `-kernel`(bzImage)·`-initrd`(ramdisk + bootconfig)·`-dtb`로 직접 부팅한다. first-stage init이 ramdisk의 `.ko`와 fstab으로 디스크를 마운트한다 | 페이지가 `fetch`로 커널 이미지·initramfs(·DTB)를 받아 `ArrayBuffer`의 정해진 주소에 올리고 PC와 레지스터(hartid, DTB 주소)를 정해 진입한다. DTB는 에뮬레이터가 만든다(`virt` 방식). `androidboot.*`에 해당하는 값은 DTB `chosen/bootargs`나 initramfs 파일로 넘긴다 |
| 2. CPU | 호스트 CPU가 게스트 x86_64를 직접 실행하고(WHPX 등) VM exit(MMIO·PIO·CPUID·HLT)만 소프트웨어가 처리한다. TCG는 쓰지 않는다 | 브라우저에는 하이퍼바이저가 없으므로 TCG 쪽 방식이다: 처음엔 fetch-decode-execute 인터프리터(RV64IMA + Zicsr, M/S/U 모드, Sv39 MMU), 이후 기본 블록 캐시로 최적화. "VM exit 처리 루프"는 **MMIO 접근을 장치 콜백으로 보내는 디스패처**로 그대로 옮긴다 |
| 3. 메모리·가상 장치 | `MemoryRegion` 트리(RAM + MMIO), goldfish MMIO(0xff001000~, IRQ 16~23, ACPI로 노출) + virtio PCI(blk·net·input·serial·vsock·rng) | `Uint8Array` RAM + "주소 범위 → {read, write}" 테이블. `virt`처럼 UART(NS16550)·CLINT·PLIC·goldfish RTC·virtio-mmio를 DTB에 적는다. 파이프 같은 호스트 전용 채널은 virtio 장치(blk, console, input)로 대체한다 |
| 4. 화면 | 게스트 GLES/Vulkan 명령을 goldfish pipe로 직렬화해 호스트 GPU가 그리고(gfxstream), 호스트 자식 창에 표시한다 | API 포워딩은 목표에서 제외한다. 게스트 프레임버퍼 메모리(simple-framebuffer 또는 virtio-gpu 2D)를 정해진 주기(`requestAnimationFrame`)에 읽어 `<canvas>`의 `ImageData`로 복사한다. 스크린샷은 `canvas`에서 바로 얻는다(안드로이드의 post 콜백 읽기에 해당) |
| 5. 입력 | Qt 이벤트 → `SkinEvent` → `EV_ABS`/`EV_KEY` → virtio-input(멀티터치·키보드)의 virtqueue + 설정 공간(축 범위 0x7FFF) | DOM `pointer`/`keyboard` 이벤트를 같은 (type, code, value) 이벤트로 만들어 virtio-input 이벤트 큐에 넣는다. 좌표는 0..0x7FFF로 스케일한다. 단순 단계는 직접 만든 MMIO 레지스터(x, y, down) 폴링도 가능하다(`browser-riscv-linux.md` 2.2) |
| 6. 호스트↔게스트 통신 | 콘솔 5554, adb 5555, gRPC 8554(TCP 서버) + goldfish pipe(`pipe:<서비스>`) + virtio-serial·virtio-vsock | 브라우저는 서버 소켓을 열 수 없다. UART는 터미널 컴포넌트에 연결한다. 제어 API(스크린샷, 입력 주입, 스냅샷)는 JS 객체 메서드나 `postMessage`로 노출한다(gRPC `EmulatorController`에 해당). 게스트 안 명령 실행은 virtio-console 멀티포트 같은 전용 채널로 한다(`browser-riscv-linux.md` 3.2). 외부 도구가 필요하면 WebSocket 릴레이를 따로 둔다 |
| 7. 스냅샷·퀵부트 | `default_boot` = QEMU savevm(CPU·장치 vmstate, 디스크는 qcow2 내부 스냅샷) + 파일 기반 RAM(`ram.img`) + GPU 텍스처 + `snapshot.pb`로 구성 호환 검사 | 모든 상태가 JS 객체·TypedArray이므로 `{레지스터, CSR, 장치 상태, RAM의 0이 아닌 페이지, 디스크 쓰기 블록}`을 직렬화해 IndexedDB(또는 OPFS)에 저장한다. 저장 때 이미지 해시·RAM 크기·장치 구성을 함께 적어 불러올 때 비교한다(`snapshot.proto`의 `images/config` 검사에 해당). 로드 지연을 줄이려면 RAM을 페이지 단위로 지연 로드한다(`RamLoader`의 방식) |
