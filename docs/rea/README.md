# REA 설치와 준비 기록

윈도우 PC에서 REA(`rea-agents` 6.7.0)로 안드로이드 에뮬레이터 바이너리를 정적 분석할 준비를 한 기록이다. 결론은 **REA가 동작한다**는 것이다. `qemu-img.exe`로 파이프라인을 끝까지 확인했고, 결과는 [00-pipeline.md](00-pipeline.md)에 있다.

- 작성일과 확인일: 2026-10-19. 아래 모든 확인은 이 날짜에 이 PC(Windows 11 Pro 10.0.26200, AMD Ryzen 5 7500F, RAM 31.5 GB)에서 했다.
- 근거 조사: [rea-windows.md](../research/rea-windows.md). 그 문서가 "미확인"으로 남긴 두 가지, 곧 이슈 #1701 재현 여부와 이 PC에서의 파이프라인 동작을 이 기록이 확인한다.
- M1(Task 16)의 본체 분석 기록과 증거 문서 목록은 [7절](#7-m1-본체-분석-기록-task-16)에 있다.
- 이 문서의 경로와 명령은 윈도우 PC 기준이다. 맥에서 같은 분석을 하려면 JDK 21과 Ghidra 12.1.x 경로를 맞춰 같은 환경변수를 지정하면 되지만, 맥에서는 시험하지 않았다(미확인).

## 1. 설치

관리자 권한 요청(UAC)이 뜨는 설치 방법은 쓰지 않았다. 계획서의 `winget install --id Microsoft.OpenJDK.21`은 MSI라 UAC를 부르므로, 같은 배포판의 zip을 받아 `C:\tools\`에 풀었다. 시스템 PATH와 사용자 PATH, 영구 환경변수는 바꾸지 않았다. 환경변수는 명령을 돌리는 셸 프로세스에만 지정한다.

| 항목 | 버전 | 설치 경로 | 크기 |
|---|---|---|---|
| JDK 21 (Microsoft Build of OpenJDK) | 21.0.12.1+1 LTS (빌드 날짜 2026-08-18) | `C:\tools\jdk-21.0.12.1+1` | 328 MB |
| Ghidra | 12.1.4 PUBLIC (20260921) | `C:\tools\ghidra_12.1.4_PUBLIC` | 876 MB |
| REA | 6.7.0 | 설치하지 않음. `npx -y rea-agents@6.7.0`으로 실행한다 | - |

체크섬은 둘 다 게시처의 값과 일치했다.

| 파일 | 크기 | SHA-256 | 대조 대상 |
|---|---|---|---|
| `microsoft-jdk-21.0.12.1-windows-x64.zip` | 201,096,952 B | `192441a9d27da813bada974bb88b4cf64d37a9589ed37f204374d411ca5ce07f` | 같은 주소에서 받은 `.sha256sum.txt`의 값 |
| `ghidra_12.1.4_PUBLIC_20260921.zip` | 569,649,598 B | `ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db` | GitHub 릴리스 `Ghidra_12.1.4_build`의 자산 digest와 릴리스 본문의 SHA-256 |

- 받은 곳: JDK는 `https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip`(위 파일로 연결됨), Ghidra는 `gh release download Ghidra_12.1.4_build -R NationalSecurityAgency/ghidra -p "*.zip"`. 둘 다 2026-10-19에 받았다.
- 설치 확인:
  - `C:\tools\jdk-21.0.12.1+1\bin\javac.exe -version`이 `javac 21.0.12.1`을 출력한다. `java -version`은 64-bit Server VM이다.
  - `C:\tools\ghidra_12.1.4_PUBLIC\support\analyzeHeadless.bat`이 있다. `Ghidra\application.properties`는 `application.version=12.1.4`, `application.java.min=21`이고 `application.java.max`는 비어 있다.
- 로컬의 기존 JDK 17(`JAVA_HOME`)은 그대로 둔다. JDK 21은 REA를 실행하는 셸과 MCP 등록의 `env`에서만 쓴다.

## 2. doctor 결과

PowerShell에서 JDK와 Ghidra 경로를 지정하고 실행했다.

```powershell
$env:JAVA_HOME = 'C:\tools\jdk-21.0.12.1+1'
$env:GHIDRA_INSTALL_DIR = 'C:\tools\ghidra_12.1.4_PUBLIC'
$env:REA_ANALYSIS_PROVIDER = 'ghidra'
npx -y rea-agents@6.7.0 doctor --provider ghidra --json
```

종료 코드는 0, 걸린 시간은 약 25초다(npx가 패키지를 처음 받는 시간 포함). 결과 JSON의 요지는 다음과 같다.

| 항목 | 값 |
|---|---|
| 최상위 `healthy` | `true` (범위: provider `ghidra`) |
| 최상위 `environment_healthy` | `false` (아래 설명) |
| `ghidra-version` | 12.1.4 |
| `ghidra-java` | `21.0.12.1; 64-bit; JDK; C:\tools\jdk-21.0.12.1+1; accepted a 64-bit full JDK 21 or newer` |
| `ghidra-headless` | `analyzeHeadless.bat` 확인 |
| `ghidra-native_decompiler` | `decompile.exe reports pe x86_64, which matches win32/x64` |
| `ghidra-native_authority` | `ok: true`. "Verified Windows native Job Object, private DACL, and reparse-safe handle controls; local NTFS only." |
| `ghidra-platform`, `ghidra-architecture`, `node` | win32, x64, Node 22.23.3 |
| providerInspections `ghidra` | `configured: true`, `available: true`, 점검 9개 모두 `ok` |

- **이슈 #1701은 이 PC에서 재현되지 않았다.** #1701은 `native_authority` 점검이 `Delete owned object by handle failed (Win32 5)`로 실패하는 문제이고, 이 PC와 같은 빌드(10.0.26200)의 실패 보고가 있었다. 이번에는 같은 점검이 통과했다. 그래서 rea-windows.md 6.2절의 우회(MCP `open_binary` 경로)는 쓸 필요가 없었다.
- `environment_healthy: false`는 이번 작업과 무관한 선택 항목 때문이다. Hopper, IDA, JADX, Kuna가 설정되지 않았고(`missing_analysis_engine`), `rea setup`으로 만든 사용자 전역 등록과 번들 스킬이 없다(`config_drift`). 이 프로젝트는 `rea setup`을 쓰지 않고 local scope로 등록하므로 `doctor`가 그 항목을 보지 못하는 것이 정상이다(rea-windows.md 1.1절).

## 3. 이 프로젝트에 등록

사용자의 이후 세션이 여는 메인 레포 루트(`C:\Users\xxx99\Documents\GitHub\portfolio\amulator`)를 작업 폴더로 해서 등록했다. 워크트리가 아니다.

```powershell
claude mcp add --scope local rea `
  --env 'JAVA_HOME=C:\tools\jdk-21.0.12.1+1' `
  --env 'GHIDRA_INSTALL_DIR=C:\tools\ghidra_12.1.4_PUBLIC' `
  --env 'REA_ANALYSIS_PROVIDER=ghidra' `
  -- cmd.exe /d /c npx -y rea-agents@6.7.0 mcp
```

- 결과: `Added stdio MCP server rea ... to local config`, 수정된 파일은 `C:\Users\xxx99\.claude.json`의 프로젝트 `C:\Users\xxx99\Documents\GitHub\portfolio\amulator` 항목이다.
- 확인: 같은 폴더에서 `claude mcp get rea`가 `Scope: Local config`, `Status: √ Connected`, 위 세 환경변수를 보여 준다.
- **프로젝트 키가 드라이브 문자 대소문자로 둘로 갈린다.** `.claude.json`의 `projects`에는 같은 폴더가 `C:/Users/xxx99/Documents/GitHub/portfolio/amulator`와 `c:/Users/xxx99/Documents/GitHub/portfolio/amulator` 두 키로 있다. 소문자 키는 폴더를 소문자 드라이브 문자로 연 쪽(예: VS Code 확장)이 쓰는 것으로 보인다(추정). 처음에는 대문자 키에만 `rea`가 있었다. 소문자 드라이브 문자를 작업 폴더로 한 `claude mcp add --scope local`을 한 번 더 실행해(2026-10-19, CLI로만 했고 `.claude.json`을 손으로 고치지 않았다) **두 키 모두 `mcpServers`에 `rea`가 들어 있다**. 두 항목의 command, args, env는 같다. 소문자 폴더에서 `claude mcp get rea`도 `Status: ✔ Connected`를 보였다.
- 세션에서 `rea` 도구가 실제로 보이는지는 **아직 확인하지 않았다**. 이 세션의 분석은 REA CLI로 했다. 새 세션을 열어 `/mcp` 목록에 `rea`가 있는지 본다. 없으면 그 세션이 연 폴더의 철자로 아래 명령을 실행한다.
  - 소문자 드라이브 문자로 연 세션: PowerShell은 경로 철자를 대문자로 바꾸므로, 소문자 철자의 폴더에서 CLI를 직접 띄워야 한다. 예를 들어 Node의 `child_process.spawnSync('C:\\Users\\xxx99\\.local\\bin\\claude.exe', ['mcp','add','--scope','local','rea', …], { cwd: 'c:\\Users\\xxx99\\Documents\\GitHub\\portfolio\\amulator' })`로 3절 위 명령의 인자를 그대로 넘긴다. VS Code 통합 터미널처럼 작업 폴더가 소문자로 열려 있으면 3절 위 명령을 그대로 쓰면 된다(미시험).
  - `.claude\worktrees\...` 아래 워크트리에서 연 세션: 프로젝트 키가 달라서 안 보일 수 있다(미확인). 그 폴더에서 3절 위 명령을 한 번 더 실행한다.
- 제거: 메인 레포 루트에서 `claude mcp remove rea -s local`. 두 키에 모두 넣었으므로 소문자 철자의 폴더에서도 한 번 더 실행해야 지워진다.

## 4. 분석 대상의 라이선스 확인

REA로 열 수 있는 바이너리는 로컬 `NOTICE.csv`가 qemu(GPL-2.0-only) 대상으로 적은 것뿐이다. 분석 전에 확인했다.

- 파일: `C:\Users\xxx99\AppData\Local\Android\Sdk\emulator\NOTICE.csv`(40,821 B, 수정일 2026-01-12). 헤더는 `External Library Name, Link to License, License Name, Binaries using the license, URL`이다.
- 2행(`qemu`)을 그대로 옮긴다.

```
qemu, https://android.googlesource.com/platform/external/qemu/+/refs/heads/emu-master-dev/LICENSE, GPL-2.0-only, ./qemu/windows-x86_64/qemu-system-x86_64-headless.exe ./qemu/windows-x86_64/qemu-system-i386-headless.exe ./qemu/windows-x86_64/qemu-system-aarch64-headless.exe ./qemu/windows-x86_64/qemu-system-x86_64.exe ./qemu/windows-x86_64/qemu-system-i386.exe ./qemu/windows-x86_64/qemu-system-armel-headless.exe ./qemu/windows-x86_64/qemu-system-aarch64.exe ./qemu/windows-x86_64/qemu-system-armel.exe ./qemu-img.exe, https://android.googlesource.com/platform/external/qemu/+/refs/heads/emu-master-dev
```

| 바이너리 | qemu 줄(GPL-2.0-only)에 있는가 | REA 사용 |
|---|---|---|
| `qemu-img.exe` | 있음 (`./qemu-img.exe`) | 허용. 파이프라인 확인에 썼다 |
| `qemu\windows-x86_64\qemu-system-x86_64.exe` | 있음 | 허용 |
| `qemu\windows-x86_64\qemu-system-x86_64-headless.exe` | 있음 | 허용. Task 16의 본체 분석 대상이다 |
| `emulator.exe`, `lib64\libandroid-emu-*.dll`, `lib64\libgfxstream_backend.dll` | 없음 | **열지 않는다.** AOSP 소스로 대신한다 |

- `emulator.exe`와 `gfxstream_backend.dll`은 NOTICE.csv의 다른 줄(protobuf, ext4_utils, lz4, gfxstream 등 다른 라이선스)에는 나오지만 qemu 줄에는 없다. 이 프로젝트의 규칙(설계 3장)은 qemu 줄에 있는 것만 REA로 열도록 한다. 위 표에 없는 바이너리는 이후 어느 태스크에서도 REA나 Ghidra로 열지 않는다.
- 이 표는 라이선스 문구가 아니라 파일 목록을 확인한 것이다. SDK 라이선스 3.4·3.5와의 관계는 rea-windows.md 6.4절대로 법률 판단 없이 "확인 필요"로 남긴다. REA가 분석 중 내부적으로 불변 사본을 만든다는 점(같은 문서 4절 보조 사실)도 있어, 분석 대상은 GPL 줄에 있는 것으로만 제한한다.
- 대상 `qemu-img.exe`는 제자리에서 열었다. 사본을 만들거나 옮기지 않았다.

## 5. 파이프라인 확인

`qemu-img.exe`(GPL 대상 중 가장 작은 1.5 MiB)를 REA CLI + Ghidra로 열어 함수 수, 진입점, 문자열, 호출 관계까지 얻었다. 한 번의 호출은 65~81초가 걸렸다. 자세한 결과와 시간은 [00-pipeline.md](00-pipeline.md)에 있다. 30분 제한에는 닿지 않았다.

## 6. 막힌 점과 주의

막힌 점은 없다. 다음 태스크가 알아 둘 주의점은 다음과 같다.

- **호출마다 Ghidra 세션을 새로 연다.** CLI 호출 하나가 별도 프로세스라 임포트와 자동 분석을 매번 다시 한다(작은 `qemu-img.exe`도 65~81초). 49 MiB급 `qemu-system-x86_64-headless.exe`는 분 단위가 아니라 수십 분을 각오한다(rea-windows.md 6.1절의 추정이었고, 실측은 7절에 있다. 호출 하나가 약 63~67분이었다). 한 번 얻은 결과는 파일로 저장해 두고 그 파일을 읽는다. 같은 질의를 되풀이할 때만 `--snapshot`이 효과가 있다.
- **출력이 크다.** `rea function`의 JSON이 840 KB였다(의사코드와 어셈블리 포함). MCP로 쓸 때는 Claude Code의 도구 출력 한도(25,000 토큰)에 걸릴 수 있으니 큰 함수는 CLI로 파일에 저장하고 필요한 필드만 읽는다. 의사코드 원문은 레포에 넣지 않는다.
- **분석 중 임시 자원.** 이번 실행 뒤 남은 `java` 프로세스와 `%TEMP%`의 임시 디렉터리는 없었다. 호출이 비정상 종료되면 REA 문서대로 비공개 런타임 파일이 남을 수 있다.
- **JDK 경로의 `+`.** 폴더 이름 `jdk-21.0.12.1+1`의 `+`는 doctor, CLI, MCP 등록 모두에서 문제가 없었다.
- **긴 실행은 따로 띄운다.** 수십 분 걸리는 분석은 세션과 함께 죽지 않게 백그라운드로 띄우고 로그와 PID 파일을 나란히 둔다. Git Bash로 띄웠으면 Git Bash의 `kill`로 끈다.

### 다음에 같은 환경을 쓰는 법

PowerShell:

```powershell
$env:JAVA_HOME = 'C:\tools\jdk-21.0.12.1+1'
$env:GHIDRA_INSTALL_DIR = 'C:\tools\ghidra_12.1.4_PUBLIC'
$env:REA_ANALYSIS_PROVIDER = 'ghidra'
$env:REA_GHIDRA_STARTUP_TIMEOUT_MS = '7200000'   # 기본 330초. 49 MiB 본체는 호출당 63~67분이 걸렸다(7.2절 실측)
$env:GHIDRA_HEADLESS_MAXMEM = '4G'               # 기본 2G. 49 MiB 본체는 4G로 끝났다(7.1절 실측)
npx -y rea-agents@6.7.0 analyze '<대상 경로>' --provider ghidra --json > out.json
```

Git Bash는 `export JAVA_HOME='C:\tools\jdk-21.0.12.1+1'`처럼 같은 변수를 `export`하고 같은 `npx` 명령을 쓴다. 명령 목록은 `npx -y rea-agents@6.7.0 --help`, 사용법은 [cli.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/cli.md)(태그 `rea-agents-6.7.0`, 확인일 2026-10-19)에 있다.

## 7. M1 본체 분석 기록 (Task 16)

2026-10-19에 `qemu-system-x86_64-headless.exe`를 REA CLI의 `trace`로 열어 CPU·장치·입력 단계의 닻 문자열을 따라갔다. 결과 요약은 [02-cpu.md](02-cpu.md), [03-devices.md](03-devices.md), [05-input.md](05-input.md)에 있다. 화면(gfxstream)은 REA 대상이 아니라서 `04-display.md`는 만들지 않았다(4절). 이 절은 분석에 쓴 조건과 시간, 못 한 것을 적는다.

### 7.1 대상과 설정

| 항목 | 값 |
|---|---|
| 대상 | `C:\Users\xxx99\AppData\Local\Android\Sdk\emulator\qemu\windows-x86_64\qemu-system-x86_64-headless.exe`. NOTICE.csv의 qemu(GPL-2.0-only) 줄에 있다(4절). 제자리에서 열었다. REA가 분석 중 만든 임시 사본으로 분석한다 |
| 크기, 해시 | 51,576,472 B, SHA-256 `d80d316cbb120d09fd589203b5117a8d95d00f11b55c254d9b09cc7bda884528`, 수정일 2026-01-12. 에뮬레이터 36.3.10(`source.properties`) |
| 형식 | PE32+ x86-64. 이미지 베이스 `0x140000000`, `.text`는 `0x140001000`부터, `.rdata`는 `0x14227b000`부터(PE 헤더를 읽어 확인). 이 문서들의 주소는 모두 이 베이스 기준이다 |
| 도구 | rea-agents 6.7.0, Ghidra 12.1.4, JDK 21.0.12.1, provider `ghidra`, 분석기는 기본값(`ghidra-default`) |
| 설정 | `REA_GHIDRA_STARTUP_TIMEOUT_MS=7200000`(120분, 기본은 330초), `GHIDRA_HEADLESS_MAXMEM`은 5G(처음 셋)와 4G, 3G. REA가 띄운 Ghidra의 JVM 인자는 `-Xmx<값> -XX:ParallelGCThreads=2 -XX:CICompilerCount=2`였다 |

### 7.2 실행 기록

모든 호출은 Git Bash에서 `nohup`으로 따로 띄우고, 결과 JSON과 로그, PID 파일을 세션 임시 폴더에 나란히 두었다. 시간 상자는 16:25(첫 호출 시작)부터 120분이다.

| 질의(`trace`) | 증거 문서 | 시작 | 끝 | 걸린 시간 | 힙 |
|---|---|---|---|---|---|
| `whpx_init_vcpu failed` | 02 | 16:25:32 | 17:32:46 | 67분 14초 | 5G |
| `goldfish_tty` | 03 | 16:25:32 | 17:32:22 | 66분 50초 | 5G |
| `virtio_input_multi_touch_pci_1` | 05 | 16:34:00 | 17:39:19 | 65분 19초 | 5G. 16:25에 시작한 첫 호출은 16:30에 중단 |
| `Unexpected MTS pointer update` | 05 | 16:42:33 | 17:47:24 | 64분 51초 | 4G |
| `WHPX: Failed to exec a virtual processor` | 02 | 16:54:12 | 17:57:42 | 63분 30초 | 4G |
| `WHPX: Failed to parse MMIO access` | 없음 | 17:14:45 | 17:25 중단 | - | 3G |
| `goldfish` | 없음 | 17:33:30 | 18:25 중단 | 51분 45초 경과 | 4G |

- 호출마다 Ghidra 세션을 새로 열어 임포트와 자동 분석을 처음부터 한다. 끝난 다섯 호출이 모두 63~67분이었고, 질의 내용은 시간에 영향이 없었다. 결과 JSON은 7~16 KB였다. 기본 시작 제한(330초)으로는 첫 호출이 끝날 수 없는 시간이라 제한을 늘린 설정이 필수였다.
- 서로 다른 질의를 동시에 최대 6개 돌렸다. 단독 실행 시간은 재지 않았다. 그래서 63~67분은 동시에 여러 개를 돌린 상태의 값이다.
- 메모리: 이 PC는 RAM 31.5 GB이고, 시작할 때 가용 메모리가 14.5 GB였다. Ghidra 프로세스 하나가 시작 직후 약 4.5 GB(비공개 메모리)까지 올랐다가 분석 중에는 2.1~4 GB를 썼다. 5G 힙 셋을 동시에 시작했을 때 시스템 가용 메모리가 1.7 GB, 커밋 메모리가 한도 근처(41.6 GB / 42.5 GB, 이후 페이지 파일이 늘어 43 GB)까지 올라서 셋째 호출을 16:30에 중단하고 16:34에 다시 시작했다. 그 뒤 `java` 프로세스 5~6개를 동시에 돌린 동안 내가 본 표본에서 가용 메모리는 2.4 GB 아래로 내려가지 않았다. 힙을 4G로 낮춘 호출도 메모리 부족 오류 없이 끝났다.
- 분석 단계는 `jstack`으로 표본을 떠서 봤다. 처음 두 호출(16:25 시작)에서 약 19분 뒤(ConstantPropagationAnalyzer), 약 29분 뒤(RttiAnalyzer), 약 39분 뒤(FidAnalyzer), 약 49~67분 뒤(StackVariableAnalyzer)에 각각 그 분석기가 돌고 있었다. 표본이라 경계는 대략이고, 가장 긴 구간은 마지막 스택 변수 분석이었다. RTTI 분석 때 Ghidra 로그에 C++ 타입 이름이 나왔다(예: `android::control::interceptor::InvocationRecord`). 이 이름들이 함수 이름 복원에 쓰이지는 않았고 결과의 함수 이름은 모두 `FUN_<주소>`였다.
- 정리: 정상 종료한 호출은 REA가 임시 폴더(`%TEMP%\rea-ghidra-<id>`, 대상 사본 51 MB 포함)를 지웠다. PID로 중단한 세 호출의 폴더는 남았고(각 약 590~810 MB, 분석이 진행될수록 커진다) 이 작업에서 확인하고 지웠다. 중단할 때는 그 호출의 명령줄에 있는 질의 문자열로 `java.exe`와 부모 `node.exe`를 확인한 뒤 해당 Windows PID만 끈 것이다(`java.exe` 이름만으로 고르지 않았다).
- 마지막 호출(`goldfish`)은 시간 상자가 끝난 18:25에 중단했다. 그때 Ghidra는 마지막 단계인 스택 변수 분석(StackVariableAnalyzer)에 들어가 있었다. 뒤의 호출일수록 동시에 도는 호출이 적어서 분석이 빨랐다(RTTI 분석까지 시작 후 약 25분, 앞선 호출은 약 29분). 단독 실행 시간은 재지 않았다.

### 7.3 못 한 것

- 콜 그래프(호출자·피호출자)는 얻지 못했다. `rea function`과 `xrefs`는 함수마다 새 세션(약 65분)이라 시간 상자 안에서는 `trace`로 닻 문자열을 따라가는 데까지만 갔다. 증거 문서는 "문자열 → 참조하는 함수(주소, 크기)"와 소스 대응까지다.
- WHPX의 MMIO exit 처리(`whpx_handle_mmio`)와 goldfish 장치 전체, 비-헤드리스 `qemu-system-x86_64.exe`(Qt → SkinEvent 경로)는 시간 안에 끝나지 않거나 열지 않았다(05-input.md 0절).
- 단독 실행 시간, 영구 Ghidra 프로젝트를 쓰는 방식은 이번에 재거나 시험하지 않았다.

### 7.4 이어 갈 때

- 닻을 넓게 잡는다. 질의 하나(`goldfish`, `WHPX:` 같은 부분 문자열)가 문자열 수십 개와 그것을 참조하는 함수를 한 번에 돌려주므로 호출 수 대비 정보가 가장 많다. 이번 `goldfish_tty`, `pci_1` 질의는 너무 좁았다.
- 함수 본체와 콜 그래프가 필요하면 `rea function <대상> <주소>`를 주소마다 병렬로 돌린다. 호출 하나가 약 65분이고 힙은 4G면 되었다. 의사코드는 레포에 넣지 않는다.
- 호출을 병렬로 4개 넘게 돌리기 전에 가용 메모리를 본다(위 메모리 항목).
- 길게 돌리는 호출은 이번처럼 Git Bash에서 `nohup`으로 따로 띄우고, 결과와 PID를 파일로 남긴다. 띄운 프로세스의 PID를 로그 옆 파일에 적어 두고, 중단할 때는 그 PID만 끈다. 같은 PC에서 다른 세션의 Java(IDE, 다른 Ghidra)가 돌 수 있으므로 `java.exe` 이름만 보고 끄지 않는다. Git Bash의 `$!`는 MSYS PID라서 Git Bash의 `kill`로 끈다(`Stop-Process`로 끄면 엉뚱한 프로세스가 죽을 수 있다). 자식 `java.exe`의 Windows PID를 꼭 찾아야 하면 명령줄에 그 호출의 임시 폴더(`rea-ghidra-<id>`) 경로가 들어 있는지로 확인한 프로세스만 끄고, 부모 `node.exe`는 그 `java.exe`의 부모 PID로 찾는다. 질의 문자열은 기준으로 쓰지 않는다. `goldfish`가 `goldfish_tty` 호출의 명령줄에도 걸리듯 동시에 도는 다른 호출과 겹칠 수 있다.
