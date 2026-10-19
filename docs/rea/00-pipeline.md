# REA 파이프라인 확인: qemu-img.exe

REA(`rea-agents` 6.7.0) CLI와 Ghidra 12.1.4로 GPL 대상 중 가장 작은 `qemu-img.exe`를 열어, 함수 수, 진입점, 문자열, 호출 관계를 얻는 데까지 확인한 기록이다. 설치와 라이선스 확인은 [README.md](README.md)에 있다. 디컴파일 원문, 어셈블리, 바이너리 조각은 싣지 않았고, 주소, 문자열, 함수 이름, 호출 관계만 요약했다.

- 확인일: 2026-10-19. 이 PC: Windows 11 Pro 10.0.26200, Ryzen 5 7500F, RAM 31.5 GB.
- 대상: `C:\Users\xxx99\AppData\Local\Android\Sdk\emulator\qemu-img.exe`. 1,544,344 B, SHA-256 `849f113aaa95835d1ec310e3e790ae7e06396a40e8d71e231e8a0a9e4e169335`. NOTICE.csv의 qemu(GPL-2.0-only) 줄에 있는 파일이다. 제자리에서 열었다.
- 설정: `JAVA_HOME`(JDK 21.0.12.1), `GHIDRA_INSTALL_DIR`(12.1.4), `REA_ANALYSIS_PROVIDER=ghidra`, `REA_GHIDRA_STARTUP_TIMEOUT_MS=1500000`, `GHIDRA_HEADLESS_MAXMEM=4G`. 나머지는 기본값이다.
- 방식: 모든 명령을 `npx -y rea-agents@6.7.0 <명령> <대상> --provider ghidra --json`으로 실행했다. 첫 `analyze`만 `--snapshot`을 썼다. 결과 JSON은 세션 임시 폴더에 두었고 레포에는 넣지 않았다.

## 1. 걸린 시간

| 명령 | 얻은 것 | 걸린 시간 |
|---|---|---|
| `analyze` | 개요: 세그먼트, 함수 수, 문자열 수 | 81초 (백그라운드 실행, 시작과 결과 파일 기록 시각의 차) |
| `inspect-native-load-image` | 진입점, 로드 매핑 | 74초 |
| `search` "qemu-img version" | 문자열 주소 | 72초 |
| `search` "qcow2" | 문자열 64건 | 73초 |
| `xrefs` 0x14012ffa7 | 문자열을 참조하는 주소 15개 | 69초 |
| `function` 0x14006f4a1 | 그 주소를 포함한 함수의 호출자·피호출자·참조 문자열 | 65초 |

- 30분 제한(작업 계획의 시간 상자)에는 닿지 않았다. 모든 호출이 정상 종료(종료 코드 0)했고 남은 프로세스는 없었다.
- 호출마다 65~81초인 것은 CLI 호출 하나가 Ghidra 세션 하나이기 때문이다. 같은 대상도 질의가 다르면 임포트와 자동 분석을 다시 한다(rea-windows.md 6.1절의 #3751과 같은 구조). 소형 픽스처의 콜드 스타트가 163초라는 문서값보다 짧았다.
- 4,967개 함수, 1.5 MiB 기준의 숫자다. 49 MiB급 `qemu-system-x86_64-headless.exe`의 시간은 아직 실측이 없다.

## 2. 얻은 사실

### 개요 (`analyze`)

| 항목 | 값 |
|---|---|
| 형식 | PE32+, x86-64. Ghidra 언어 `x86:LE:64:default`, 컴파일러 사양 `clangwindows` |
| 이미지 베이스 | `0x140000000` |
| 함수 수 | 4,967 (`procedure_count`) |
| 정의된 문자열 수 | 4,044 (`string_count`. Ghidra가 정의한 문자열만 센다) |
| 세그먼트 | `.text` `0x140001000`~`0x140118a00`(1,145,344 B), `.rdata` `0x140119000`~`0x140161600`(296,448 B), `.data` `0x140162000`~`0x14056f210`(4,248,080 B), `.pdata`, `.tls`, `.reloc`, 그리고 PE 섹션이 아닌 `tdb` 블록(`0xff00000000`, 6,224 B. Ghidra가 더한 블록으로 추정) |
| 심볼 | 없음. 함수 이름은 `FUN_<주소>` 형태다. PDB 참조 `qemu-img.pdb`가 있으나 REA가 PDB를 지정하거나 불러오지 못한다(Ghidra의 로드 상태는 unknown) |

### 진입점 (`inspect-native-load-image`)

- REA가 돌려준 진입점은 둘이다: `0x1401166a8`, `0x1401161a0`.
- PE 헤더를 직접 읽어 대조했다(2026-10-19, 읽기 전용 node 스크립트). `0x1401166a8`은 `AddressOfEntryPoint`(RVA `0x1166a8`)이고 서브시스템은 3(콘솔)이다. `0x1401161a0`은 TLS 콜백이다.
- `inspect-native-load-image`의 `status`는 `unsupported`다. PE는 로드 이미지 독립 검증 대상이 아니어서 측정값(매핑 9개, 재배치 2,408건, 진입점)만 돌려준다. rea-windows.md 3.2절의 설명과 같다.

### 문자열 (`search`)

- `qemu-img version 2.12.0(v2.12.0-19097-g85fa07f04ef)`로 시작하는 문자열이 `0x14012fdb0`에 있다. `0x14012ffa7`에는 같은 버전 줄 뒤에 사용법 문구가 이어진 긴 문자열이 있다. 버전은 [android-emulator-internals.md](../research/android-emulator-internals.md) 0절이 본체 `qemu-system-x86_64-headless.exe`에서 확인한 QEMU 2.12.0과 같다.
- `qcow2`를 포함한 문자열이 64건이다. 예: `qcow2_snapshot_delete`(`0x14011f1fb`), `qcow2_do_open`(`0x14011fec4`), `Image is not in qcow2 format`(`0x14011fed2`), `Unsupported qcow2 version %u`(`0x14011feef`). 함수 이름이 문자열로 남아 있으나 Ghidra 함수 이름으로는 복원되지 않는다.
- **빌드 경로 문자열.** 같은 검색 결과에 `C:/buildbot/src/googleplex-android/emu-36-3-release/external/qemu/block/qcow2.c`(`qcow2-bitmap.c`, `qcow2-refcount.c`, `qcow2-snapshot.c`도 같은 모양)가 있다. 이 바이너리가 `emu-36-3-release`라는 이름의 소스 트리에서 빌드됐다는 뜻으로 읽는다. AOSP `platform/external/qemu`의 공개 브랜치 목록(`+refs/heads`, 확인일 2026-10-19)에는 `emu-36-3-release`가 없고 가까운 것은 `emu-36-1-release`, `emu-main-dev`(HEAD `f0c183f1…`, 2026-09-15), `emu-main-next`다. 따라서 소스와 바이너리는 같은 커밋이 아니다. 로컬 36.3.10의 소스 브랜치가 미확인이던 점(rea-windows.md 5.5절)에 대한 부분 답이고, 노트에서 소스와 바이너리가 어긋나는 곳을 적을 때 쓴다.

### 호출 관계 (`xrefs`, `function`)

- `0x14012ffa7`(사용법 문구) 문자열을 참조하는 주소가 15개다: `0x14006f4a1`~`0x140074df7` 사이.
- 첫 참조 `0x14006f4a1`을 포함한 함수는 `FUN_14006f140`이다. 본체 956바이트(두 구간, 기본 블록 49개)이고 호출자 2개, 피호출자 34개다.
  - 호출자: `FUN_1401164e0`(54 B), `FUN_140116518`(346 B).
  - 피호출자: 외부 함수 `g_free`(`libglib2`), `exit`, `puts`, `strcmp`와 내부 `FUN_…` 30개(예: `FUN_14006f510`, `FUN_14006fa00`).
  - 이 함수가 참조하는 문자열 21개 안에 옵션 문자열 `+:hVT:`, `Command not found: %s`, `Not enough arguments`, 명령 이름 `amend`, `bench`, `check`, `commit`, `compare`, `convert`, `create`, `measure`, `rebase`, `resize`, `snapshot`이 있다. 이름과 문자열로 보면 qemu-img의 명령 분기(`main`)다. 이는 문자열과 호출 관계에서 낸 추정이고, 의사코드는 읽지 않았다.
- 이 흐름(문자열 → `xrefs` → 포함 함수 → 호출자·피호출자)이 이 PC에서 동작한다. Task 16에서 본체의 `whpx_init_vcpu failed`, `goldfish_tty` 같은 문자열을 닻으로 쓸 때 같은 순서를 쓴다.

## 3. 결론과 다음 단계

- REA + Ghidra 파이프라인은 이 PC에서 끝까지 동작한다. 이슈 #1701도 재현되지 않았다([README.md](README.md) 2절).
- MCP 경로는 이 세션에서 쓰지 않았다. 등록은 끝났고 다음 세션부터 `open_binary`(provider `ghidra`) 등으로 쓸 수 있다.
- Task 16은 `qemu-system-x86_64-headless.exe`를 CLI로 열 때 시작 제한과 힙을 더 크게 잡고, 백그라운드 실행과 로그, PID 파일을 쓰며, 결과 JSON을 파일에 저장해 두고 필요한 필드만 읽는다.
