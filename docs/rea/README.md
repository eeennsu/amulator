# REA 설치와 준비 기록

윈도우 PC에서 REA(`rea-agents` 6.7.0)로 안드로이드 에뮬레이터 바이너리를 정적 분석할 준비를 한 기록이다. 결론은 **REA가 동작한다**는 것이다. `qemu-img.exe`로 파이프라인을 끝까지 확인했고, 결과는 [00-pipeline.md](00-pipeline.md)에 있다.

- 작성일과 확인일: 2026-10-19. 아래 모든 확인은 이 날짜에 이 PC(Windows 11 Pro 10.0.26200, AMD Ryzen 5 7500F, RAM 31.5 GB)에서 했다.
- 근거 조사: [rea-windows.md](../research/rea-windows.md). 그 문서가 "미확인"으로 남긴 두 가지, 곧 이슈 #1701 재현 여부와 이 PC에서의 파이프라인 동작을 이 기록이 확인한다.
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
- 등록한 MCP는 **다음 세션부터** 도구로 보인다. 이 세션의 분석은 REA CLI로 했다.
- 제거: 메인 레포 루트에서 `claude mcp remove rea -s local`.
- 주의: local scope는 등록한 폴더에 묶인다. `.claude\worktrees\...` 아래 워크트리에서 연 세션이 이 등록을 보는지는 확인하지 않았다(미확인). 안 보이면 그 폴더에서 같은 명령을 한 번 더 실행한다.

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

- **호출마다 Ghidra 세션을 새로 연다.** CLI 호출 하나가 별도 프로세스라 임포트와 자동 분석을 매번 다시 한다(작은 `qemu-img.exe`도 65~81초). 49 MiB급 `qemu-system-x86_64-headless.exe`는 분 단위가 아니라 수십 분을 각오한다(rea-windows.md 6.1절의 추정이고 실측은 아직 없다). 한 번 얻은 결과는 파일로 저장해 두고 그 파일을 읽는다. 같은 질의를 되풀이할 때만 `--snapshot`이 효과가 있다.
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
$env:REA_GHIDRA_STARTUP_TIMEOUT_MS = '1500000'   # 기본 330초. 큰 바이너리는 늘린다
$env:GHIDRA_HEADLESS_MAXMEM = '4G'               # 기본 2G. 49 MiB급에 얼마가 맞는지는 미확인
npx -y rea-agents@6.7.0 analyze '<대상 경로>' --provider ghidra --json > out.json
```

Git Bash는 `export JAVA_HOME='C:\tools\jdk-21.0.12.1+1'`처럼 같은 변수를 `export`하고 같은 `npx` 명령을 쓴다. 명령 목록은 `npx -y rea-agents@6.7.0 --help`, 사용법은 [cli.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/cli.md)(태그 `rea-agents-6.7.0`, 확인일 2026-10-19)에 있다.
