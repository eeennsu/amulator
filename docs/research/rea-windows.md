# REA로 윈도우에서 할 수 있는 일: 사실 조사

- 확인일: 2026-10-18. 아래 모든 출처의 확인일은 이 날짜다.
- 조사 대상: REA(`rea-agents`) 6.7.0. npm `latest`이고 MIT 라이선스다. 게시 시각은 2026-10-18T08:12Z다. ([npm 레지스트리](https://registry.npmjs.org/rea-agents), 2026-10-18. npm 웹 페이지는 WebFetch가 403으로 막혀 레지스트리 JSON으로 대신 읽었다.)
- 문서 기준: 이 파일이 인용하는 REA 문서(README, installation, windows-ghidra-p0, ghidra-provider, mcp-contracts, cli, reverse-engineering-tools, process-capture, frida-instrumentation, binary-diagnostics, client-configuration, adb-device-analysis, native-investigation)는 태그 `rea-agents-6.7.0`과 `main`(조사 시점 태그보다 7커밋 앞섬)에서 내용이 같음을 diff로 확인했다. 링크는 태그 기준이다. ([태그 비교](https://github.com/morluto/rea/compare/rea-agents-6.7.0...main), 2026-10-18)
- 조사 방식: 아무것도 설치하지 않았고 REA·Ghidra·npx를 실행하지 않았다. 읽기 전용으로 `gh api`, `curl`(npm 레지스트리·AOSP Gitiles), WebFetch, 로컬 파일 목록·헤더·문자열 조회, `node --version`, `java -version`만 사용했다.
- 근거를 읽지 못한 항목은 "미확인"으로 적었다. "추정"은 근거에서 내가 추론한 것이라는 뜻이다.

## 0. 핵심 결론

1. 윈도우에서 REA로 되는 것은 **Ghidra를 엔진으로 쓰는 x64 PE의 정적 분석**이다. 함수 목록, 의사코드(디컴파일), 어셈블리, 문자열, 호출 관계, 교차 참조를 읽기 전용으로 얻는다. 윈도우 지원은 "실험적 P0"라고 문서가 직접 적는다.
2. **로컬 환경은 지금 요건을 못 채운다.** Ghidra 12.1.x가 JDK 21 이상을 요구하는데 로컬은 JDK 17.0.17이고 Ghidra도 없다. REA는 Ghidra와 JDK를 설치해 주지 않는다. Node 22.23.3은 요건(22.x, 22.19 이상)을 충족한다.
3. **윈도우의 동적 분석·런타임 트레이싱은 REA에서 검증된 경로가 없다.** 프로세스 캡처는 윈도우 불가, GDB·Rizin 디버그 세션은 Linux 전용, LLDB 호출 관찰은 macOS Mach-O 전용이다. Frida 도구는 코드에 윈도우 차단이 없지만 검증은 Linux뿐이다.
4. **열람 대상은 `qemu\windows-x86_64\qemu-system-x86_64-headless.exe`(49.2 MiB)가 본체**이고, 그 전에 런처 `emulator.exe`(1.9 MiB)로 흐름을 잡는 것이 낫다. 모든 대상이 네이티브 PE32+ x64이고 COFF 심볼 테이블이 없다. 함수 이름은 복원되지 않으므로 문자열(`whpx_init_vcpu failed` 등)을 닻으로 삼아 xrefs를 따라간다.
5. **큰 PE는 느리다.** 실측 사례로, 191 MiB·약 37.9만 함수의 PE는 REA 기본 설정에서 60분 제한 안에 끝나지 않았고, 소형 1,024바이트 픽스처도 윈도우 콜드 스타트에 약 163초가 걸렸다. 세션마다 재임포트하며, 이를 없애는 기능은 아직 열린 요청(#3751)이다.
6. **알려진 윈도우 이슈 #1701(P1, 열림)이 사용자 환경과 겹칠 수 있다.** 네이티브 컨트롤 자가 점검이 일부 윈도우 10/11 호스트에서 실패해 Ghidra 공급자를 막는다. 빌드 10.0.26200(사용자 PC와 같은 빌드)에서 재현한 보고가 있다.
7. 에뮬레이터는 **QEMU 기반의 오픈소스 소스가 공개**돼 있고(AOSP `external/qemu`, GPL-2.0-only 표기), 로컬 `NOTICE.csv`가 소스 위치를 명시한다. 한편 Android SDK 라이선스 3.4는 SDK의 디컴파일·리버스 엔지니어링을 금지하되 제3자(오픈소스) 라이선스가 요구하는 범위는 예외로 두고, 3.5는 오픈소스 구성요소에 그 라이선스만 적용된다고 한다. 어느 쪽이 적용되는지는 구성요소별로 다르므로 법률 판단은 하지 않고 확인 필요로 남긴다.
8. x86_64 AVD는 Windows에서 WHPX로 가속되므로 게스트 CPU 명령 해석 루프는 이 바이너리 실행 경로에 거의 안 나온다. 미니 RISC-V 에뮬레이터의 해석기 설계에는 바이너리 분석보다 QEMU 소스(`tcg/`, `target/riscv/`)가 더 직접적인 자료다.

## 1. 설치·설정과 윈도우 지원 범위

### 1.1 `npx rea-agents setup`이 하는 일

- 명령은 `npx rea-agents setup`이다. 에이전트를 다중 선택하고, 변경될 경로·내용·백업을 미리 보여 준 뒤 승인해야 기록한다. 취소하면 변경이 없다. 비대화형은 `--client claude_code --dry-run`처럼 범위를 지정하고, `--skill=false`로 번들 스킬을 뺄 수 있다. ([installation.md "Review setup changes"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md), 2026-10-18)
- Claude Code에는 두 가지를 쓴다. 첫째, `~/.claude.json`의 `mcpServers.rea`(환경변수 `CLAUDE_CONFIG_DIR`가 있으면 `$CLAUDE_CONFIG_DIR/.claude.json`)다. 둘째, 번들 스킬 `~/.claude/skills/reverse-engineer-anything`이다. ([installation.md "Limit REA to one project or agent profile"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md), 2026-10-18)
- 등록되는 서버 명령은 설치 시점 버전으로 고정한 `npx -y rea-agents@<버전> mcp`이고, 윈도우에서는 `cmd.exe /d /c`로 감싼다. 전역 설치(`npm install --global rea-agents` 후 `rea setup`)를 하면 Node가 `scripts/rea.mjs mcp`를 직접 실행하도록 등록된다. ([installation.md "Package runners and global installation"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md), 2026-10-18)
- setup은 유효한 Ghidra·JDK 설정(`GHIDRA_INSTALL_DIR`, `JAVA_HOME`)을 등록 항목의 `env`에 보존하고 계획에 정확한 항목을 보여 준다. 문서의 윈도우 등록 예시 JSON은 `REA_ANALYSIS_PROVIDER`까지 `env`에 둔다. ([windows-ghidra-p0.md "Configuration"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/windows-ghidra-p0.md), 2026-10-18)
- setup은 Node, npm, Java, Ghidra, IDA, JADX, Kuna 등을 설치하거나 갱신하지 않는다. 별도 승인으로 설치할 수 있는 것은 Hopper뿐이고, 윈도우에서는 Hopper 설치가 불가하다. ([SKILL.md "Connect only when needed"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/.agents/skills/reverse-engineer-anything/SKILL.md), [installation.md "Ghidra"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md), 2026-10-18)
- setup은 **사용자 전역 등록**이라 모든 프로젝트에서 REA 도구가 보인다. 범위를 좁히는 방법은 두 가지다. 하나는 `CLAUDE_CONFIG_DIR`로 별도 프로필을 쓰는 것이다. 다른 하나는 setup 없이 프로젝트 디렉터리에서 `claude mcp add --scope local rea -- cmd.exe /d /c npx -y rea-agents@6.7.0 mcp`로 로컬 스코프에 등록하는 것이다. 후자는 스킬이 설치되지 않고, `rea doctor`·`rea uninstall`이 이 항목을 보지 못하며, `rea update`가 갱신하지 못한다. ([installation.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md), 2026-10-18) 로컬 스코프는 `~/.claude.json`의 해당 프로젝트 경로 아래에 저장된다. ([Claude Code MCP 문서](https://code.claude.com/docs/en/mcp), 2026-10-18)
- 도구 정의 크기: tool search가 꺼진 환경에서는 도구 172개의 정의가 매 요청에 실려 약 496 KB(약 12만 토큰)였고, `REA_MCP_INPUT_SCHEMA_PROFILE=compact`로 약 290 KB까지 줄었다는 측정이 있다(172개는 문서 기재 시점 값이다). Claude Code는 기본적으로 MCP 도구 정의를 지연 로딩하므로 first-party 모델에서는 해당되지 않는다고 문서가 설명한다. ([client-configuration.md "Claude Code"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/client-configuration.md), 2026-10-18)

### 1.2 Node 요구 버전

- `package.json` engines는 `^22.19.0 || ^24.11.0 || >=26.0.0`이다. 문서는 Node 23, 25와 프리릴리스를 미지원으로 적는다. 저장소 `.nvmrc`는 24.18.0이다. ([npm 레지스트리 engines](https://registry.npmjs.org/rea-agents), [installation.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md), 2026-10-18)
- 로컬 `node --version`은 v22.23.3이어서 충족한다. (로컬 조회, 2026-10-18)
- 패키지 의존성에 `frida@17.23.2`가 optionalDependencies로 있다. ([npm 레지스트리](https://registry.npmjs.org/rea-agents), 2026-10-18)

### 1.3 윈도우 지원 범위 요약

| 영역 | 윈도우에서 | 근거 (확인일 2026-10-18) |
| --- | --- | --- |
| 네이티브 PE 정적 분석(Ghidra) | 실험적 "P0". 읽기 전용. x86, x86-64, ARMNT(Thumb-2), ARM64 PE의 EXE·DLL. 로컬 NTFS 고정 볼륨만 | [windows-ghidra-p0.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/windows-ghidra-p0.md) |
| x64 PE / x86 PE 도입 시점 | x64 PE는 4.1.0 항목 "enable Windows x64 read-only analysis", 32비트 x86 PE는 6.0.0 항목 "support native x86 PE applications on Windows"에 기재. ARM 계열은 6.6.0(6.7.0에 포함) | [CHANGELOG](https://github.com/morluto/rea/blob/rea-agents-6.7.0/CHANGELOG.md) |
| 정적 JS/Electron, .NET, Go/Rust 메타 | 네이티브 엔진 없이 Node만으로 | [README "What you can analyze"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/README.md) |
| 프로세스 캡처(`capture_process_scenario`) | 불가. PTY 어댑터가 하위 프로세스 정리를 검증하지 못해 막혀 있다. Linux 명령은 WSL 안의 Linux REA로 | [process-capture.md "Host support"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/process-capture.md) |
| GDB 세션 | 불가(Linux 전용). Job Object 정리가 디버기를 종료시킬 수 있다는 이유 | [reverse-engineering-tools.md "GDB"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/reverse-engineering-tools.md) |
| Rizin 디버그 세션 | 불가(Linux 전용, `/proc` 의존) | [reverse-engineering-tools.md "Rizin"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/reverse-engineering-tools.md) |
| Frida | 코드에 윈도우 차단 문자열 없음(`src/frida/FridaInstrumentationManager.ts`에서 win32 등 검색 결과 0건). 실제 검증은 Linux 로컬 Node 흐름뿐이고 `verify:frida`는 Linux 호스트를 요구. 윈도우 동작은 미확인 | [frida-instrumentation.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/frida-instrumentation.md), [소스](https://github.com/morluto/rea/blob/rea-agents-6.7.0/src/frida/FridaInstrumentationManager.ts) |
| ADB 도구 | 호스트 윈도우 파일명 규칙을 문서가 다룸. 사용자가 제공하는 adb(검증 34.0.5)로 에뮬레이터·실기기 모두 대상 | [adb-device-analysis.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/adb-device-analysis.md) |
| Hopper | 윈도우 설치·실행 불가. Hopper 공식 사이트는 macOS 12.4 이상만 명시 | [installation.md "Ghidra"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md), [hopperapp.com](https://www.hopperapp.com/) |

## 2. 분석 엔진

| 엔진 | 윈도우 PE 사용 가능성 | 요구사항과 비고 |
| --- | --- | --- |
| Ghidra | 가능(실험적 P0). REA가 윈도우에서 쓸 수 있는 유일한 무료 엔진 | Ghidra 12.1.x(검증 12.1.4). 64비트 full JDK(javac 포함), Ghidra 설치가 선언한 `application.java.min`~`max` 범위 안. 12.1 현행은 JDK 21 이상, 상한 없음. 설치는 사용자가 한다 |
| Hopper | 불가 | macOS용 상용(데모 있음). REA 자동 설치기는 macOS 12+/일부 Linux만 |
| IDA | 가능하나 상용 | IDA Pro와 외부 MCP(mrexodia/ida-pro-mcp)를 사용자가 설치·라이선스. REA는 설치하지 않는다. 윈도우 실검증은 IDA Pro 9.3 |
| Kuna | 불가 | changelog가 "Windows, PE and universal Mach-O are unsupported"라고 명시 |
| objdump, Rizin | 사용자가 설치하면 정적 명령 실행(`inspect_with_objdump`, `execute_rizin_command`) | REA는 설치·갱신하지 않는다. 윈도우 검증 여부는 문서에 없다(미확인) |

출처: [README](https://github.com/morluto/rea/blob/rea-agents-6.7.0/README.md), [installation.md "Ghidra"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md), [ida-provider.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/ida-provider.md), [CHANGELOG 6.6.0](https://github.com/morluto/rea/blob/rea-agents-6.7.0/CHANGELOG.md), [reverse-engineering-tools.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/reverse-engineering-tools.md), 확인일 2026-10-18.

### 2.1 Ghidra 쪽 사실 (Ghidra 공식 자료)

- Ghidra 최신 릴리스는 12.1.4(2026-09-21)이고 그 뒤 릴리스는 목록에 없었다. 라이선스는 Apache-2.0이다. ([GitHub 릴리스 API](https://github.com/NationalSecurityAgency/ghidra/releases), 2026-10-18)
- 12.1.4의 `application.java.min=21`, `application.java.max`는 비어 있다. ([application.properties](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.1.4_build/Ghidra/application.properties), 2026-10-18)
- 최소 요건: Windows 10(빌드 1809 이상), RAM 4 GB, 설치 용량 1 GB, "Java 21 64-bit Runtime and Development Kit (JDK)". 무료 LTS JDK 21 제공처로 Adoptium Temurin과 Amazon Corretto를 든다. ([GettingStarted.md](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.1.4_build/GhidraDocs/GettingStarted.md), 2026-10-18)
- REA는 Ghidra 12.1.x만 받는다. 이후 12.2나 13 계열이 나오면 REA가 따라올 때까지 거부될 수 있다(추정, 근거는 `doctor`의 "12.1.x" 검증 문구). ([installation.md "Ghidra"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md), 2026-10-18)
- REA는 Ghidra의 `analyzeHeadless`를 Java 브리지 스크립트와 함께 쓴다. Python과 PyGhidra는 필요 없다. 사용자 프로젝트는 열지 않고 `-readOnly -deleteProject` 임시 프로젝트에 임포트한다. ([windows-ghidra-p0.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/windows-ghidra-p0.md), [installation.md "Ghidra"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md), 2026-10-18)
- 환경변수: `GHIDRA_INSTALL_DIR`, `JAVA_HOME`, `REA_ANALYSIS_PROVIDER=ghidra`. 점검은 `rea doctor --json`, `rea providers --json`이다. `GHIDRA_INSTALL_DIR`이 없으면 PATH의 `ghidra`/`ghidraRun`을 읽기 전용으로 탐색한다. ([windows-ghidra-p0.md "Configuration"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/windows-ghidra-p0.md), [installation.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md), 2026-10-18)
- REA는 `JAVA_HOME`이 고른 JDK를 다른 JDK로 자동 대체하지 않는다. 로컬 `JAVA_HOME`은 JDK 17(`C:\Program Files\Microsoft\jdk-17.0.17.10-hotspot\`)이다. REA가 요구하는 JDK 21은 MCP 등록의 `env`에만 넣을 수 있다(윈도우 등록 예시 JSON 참고). 시스템 전역 `JAVA_HOME`을 바꾸지 않아도 되므로, JDK 17을 쓰는 RN 안드로이드 빌드와 충돌을 피하는 방법으로 쓸 수 있다(적용 방안은 내 제안이고, `env` 지원 자체는 문서에 있다). ([installation.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md), [windows-ghidra-p0.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/windows-ghidra-p0.md), 2026-10-18)

## 3. MCP 도구 목록

### 3.1 정본과 이 목록의 신뢰도

- 문서가 가리키는 "generated catalog"는 저장소에 커밋돼 있지 않다. `docs/mcp-contracts.md`의 해당 절은 `npm run docs:generate`로 `docs/public/product-catalog.json`을 만들라고만 안내한다. `https://rea.tools/rea/product-catalog.json`은 조사 시점에 HTTP 404였다. ([mcp-contracts.md "Generated catalog"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/mcp-contracts.md), 2026-10-18)
- 그래서 이 절은 `src/contracts/**/*ToolContracts.ts` 소스에서 이름과 설명을 정규식으로 추출해 정리했다. 추출 결과는 196건이었고, `read_bytes`·`search_bytes`·`address_to_file_offset`·`inspect_analysis_view`처럼 다른 파일(`hopperMemoryContracts.ts`, `analysisViewToolContracts.ts`)에 있는 도구는 별도 확인으로 보충했다. 일부 누락·중복이 있을 수 있다. 문서에는 "172 tools"라는 기재가 있으나 그 시점의 커밋(`04089d5be`)이 현재와 다르다. **정확한 현재 도구 수는 미확인**이다. ([소스 목록](https://github.com/morluto/rea/tree/rea-agents-6.7.0/src/contracts), 2026-10-18)
- 실행 중 정본은 MCP `tools/list`와 `binary_session`(`result.tool_availability`)이다. 열린 타깃·공급자·호스트별 가용성, 사유, 조치가 거기에 나온다. ([mcp-contracts.md "Identity and discovery"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/mcp-contracts.md), 2026-10-18)

### 3.2 윈도우 PE 정적 분석에 쓰는 도구 (Ghidra 공급자)

Ghidra 공급자가 구현하는 연산은 소스 상수 `GHIDRA_INVENTORY_OPERATIONS`(17개)와 `GHIDRA_FUNCTION_OPERATIONS`(13개)다. 윈도우 P0는 데이터베이스를 바꾸는 3개(`annotate_native_function`, `set_address_name`, `set_addresses_names`)를 막는다. 문서는 "26개 읽기 전용 연산"이라고 적는데 소스 상수에서 변경 3개를 빼면 27개라서 1개 차이가 난다. 집계 기준은 미확인이다. ([GhidraInventoryValues.ts](https://github.com/morluto/rea/blob/rea-agents-6.7.0/src/ghidra/GhidraInventoryValues.ts), [GhidraFunctionValues.ts](https://github.com/morluto/rea/blob/rea-agents-6.7.0/src/ghidra/GhidraFunctionValues.ts), [GhidraProviderCapabilities.ts](https://github.com/morluto/rea/blob/rea-agents-6.7.0/src/ghidra/GhidraProviderCapabilities.ts), 2026-10-18)

| 도구 | 하는 일 (소스 contract 설명 요약) |
| --- | --- |
| `open_binary` | 로컬 실행 파일 등을 검증해 열고 공급자를 바인딩한다. Ghidra 임포트와 분석은 첫 분석 질의 때 시작한다 |
| `close_binary` | 세션을 닫고 임시 프로젝트를 정리한다. `snapshot_path`로 질의 결과 스냅샷을 저장할 수 있다 |
| `binary_session` | 타깃·공급자·도구별 가용성·서버 신원을 보고한다. 분석을 시작하지 않는다 |
| `binary_overview` | 문서 정보, 전체 프로시저·문자열 개수, 세그먼트 목록과 이미지 베이스 |
| `list_documents` | 임포트된 프로그램 이름. Ghidra는 항상 1개 |
| `list_procedures` | 분석된 모든 프로시저(외부 함수·썽크 구분 포함)를 주소/이름 쌍으로. 페이지 없이 전체 |
| `list_names` | 메모리·외부 심볼 전체(동적·외부 심볼 포함) |
| `list_segments` | 메모리 블록(권한, 주소 공간, 이미지 베이스, 초기화 여부) |
| `list_strings` | Ghidra가 정의한 문자열 데이터(인코딩, 바이트 길이) |
| `search_procedures`, `search_strings` | 이름·문자열 검색. 리터럴 또는 Java 정규식, 결과는 전체 반환 |
| `procedure_address`, `resolve_containing_procedure`, `address_name` | 이름↔주소 해석, 임의 주소가 속한 함수 찾기, 주소의 기본 이름 |
| `read_bytes`, `search_bytes`, `address_to_file_offset` | 메모리 바이트 읽기, `??` 와일드카드·마스크 바이트 패턴 검색(기본 100건/페이지), 주소→파일 오프셋 |
| `inspect_native_load_image` | 로드 이미지 매핑 측정. PE는 "unsupported attestation status"로 측정값만 반환 |
| `procedure_pseudo_code` | 함수 디컴파일(Ghidra 의사코드, 원본 소스 아님). 파일 오프셋 선택자 지원 |
| `procedure_assembly`, `read_function_instructions` | 함수 어셈블리(Listing), 디컴파일러 없이 명령만 빠르게 |
| `procedure_info`, `procedure_callers`, `procedure_callees` | 시그니처·로컬·크기·블록 수, 해소된 직접 호출자/피호출자 |
| `procedure_references`, `xrefs` | 함수의 들어오는/나가는 참조 간선(종류 포함), 특정 주소로의 참조 목록 |
| `analyze_function` | 한 함수의 dossier: 의사코드, 어셈블리, 호출·참조, 문자열, CFG, 제한된 p-code def-use |
| `inspect_native_instruction`, `inspect_native_data_type`, `resolve_native_call_targets` | 명령 한 개 분해, 복구된 타입 구조, 정적 호출 지점의 대상 후보 |

윈도우에서 읽기 전용 검증 범위(26개 연산)에는 아래 합성 도구가 들어 있지 않다. 이들은 위 프리미티브를 조합하는 것으로 보이나, **윈도우에서의 동작은 문서가 검증했다고 적지 않았으므로 미확인**이며 `binary_session.tool_availability`로 확인해야 한다. ([enhancedToolContracts.ts](https://github.com/morluto/rea/blob/rea-agents-6.7.0/src/contracts/enhancedToolContracts.ts), [windows-ghidra-p0.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/windows-ghidra-p0.md), 2026-10-18)

| 도구 | 하는 일 |
| --- | --- |
| `batch_decompile` | 지정한 여러 함수를 동시에 디컴파일 |
| `get_call_graph`, `trace_call_path`, `build_call_path` | 호출자/피호출자 그래프, 시작→목표 호출 경로 |
| `trace_feature`, `find_xrefs_to_name` | 문자열·프로시저 이름에서 xrefs를 거쳐 포함 함수까지 추적 |
| `trace_native_values` | 한 함수에서 시작하는 제한된 정적 값 의존 그래프 |
| `compare_functions`, `compare_bundles` 등 | 증거(Evidence) 비교 |

### 3.3 증거·세션 관리 도구

`export_evidence_bundle`, `import_evidence_bundle`, `get_evidence_bundle`(세션 증거 묶음 쓰기·읽기), `list_unknowns`, `record_unknown`, `update_unknown`, `verify_unknown_resolution`(미해결 항목 장부), `verify_reconstruction`, `correlate_static_and_runtime`, `find_changed_behavior`, `get_navigation_context`, `inspect_address_context`. ([sessionToolContracts.ts](https://github.com/morluto/rea/blob/rea-agents-6.7.0/src/contracts/sessionToolContracts.ts), 2026-10-18)

### 3.4 윈도우 Ghidra에서 쓸 수 없는 것

- 쓰기 연산: `annotate_native_function`, `set_address_name`, `set_addresses_names`는 윈도우 P0에서 `available: false`(사유 "Windows Ghidra P0 does not admit database mutation")다. ([GhidraProviderCapabilities.ts](https://github.com/morluto/rea/blob/rea-agents-6.7.0/src/ghidra/GhidraProviderCapabilities.ts), 2026-10-18)
- Hopper GUI 계열(`current_address`, `goto_address`, 북마크, 주석 쓰기 등)은 Ghidra 연산 목록에 없다. ([officialToolContracts.ts](https://github.com/morluto/rea/blob/rea-agents-6.7.0/src/contracts/officialToolContracts.ts), [ghidra-provider.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/ghidra-provider.md), 2026-10-18)
- Mach-O 전용: `inspect_macho`, `inspect_signature`, `inspect_plist`, `list_architectures`, `demangle_swift`, `observe_native_ui`, `capture_native_ui_scenario`, `observe_native_calls`(LLDB). ([nativeToolContracts.ts](https://github.com/morluto/rea/blob/rea-agents-6.7.0/src/contracts/native/nativeToolContracts.ts), 2026-10-18)
- `inspect_binary_layout`은 현재 검증 범위가 "Linux x64, ELF64 x86-64"이고 pwntools·pyelftools·Unicorn이 든 Python 환경을 요구한다. PE에는 쓰지 않는다. ([binary-diagnostics.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/binary-diagnostics.md), 2026-10-18)

### 3.5 PE에 쓸 수 있는 엔진 불필요 도구

- `inspect_pe_resources`: PE32/PE32+의 리소스 트리(타입·이름·언어, 아이콘 그룹, 페이로드별 SHA-256)를 실행 없이 읽는다. 엔진, Python, Windows SDK가 필요 없다. 기본 상한은 파일 64 MiB, 항목 16,384개다. ([binary-diagnostics.md "Portable PE resources"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/binary-diagnostics.md), 2026-10-18) 단, 로컬 `qemu-system-x86_64*.exe`는 PE 헤더의 리소스 디렉터리가 비어 있어(RVA 0, 크기 0) 얻을 것이 거의 없다. (로컬 헤더 조회, 2026-10-18)
- `inspect_go_binary`, `inspect_rust_binary`: ELF/PE/Mach-O의 임베디드 빌드 메타데이터. 해당 메타가 없으면 정보가 없다. ([README](https://github.com/morluto/rea/blob/rea-agents-6.7.0/README.md), 2026-10-18)
- `inspect_with_objdump`(`file_headers`, `section_headers`, `symbols`, `relocations`, `dwarf`, `disassemble`, `disassemble_all`), `execute_rizin_command`: 사용자가 설치한 GNU objdump·Rizin을 호출한다. ([reverse-engineering-tools.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/reverse-engineering-tools.md), 2026-10-18)

### 3.6 동적 분석 계열 도구 (이름만; 윈도우 사용성은 1.3과 4절 참고)

- Frida 9개: `list_frida_devices`, `list_frida_processes`, `start_frida_session`, `load_frida_script`, `resume_frida_session`, `unload_frida_script`, `frida_session_status`, `close_frida_session`, `instrument_with_frida`. ([fridaToolContracts.ts](https://github.com/morluto/rea/blob/rea-agents-6.7.0/src/contracts/fridaToolContracts.ts), 2026-10-18)
- GDB 4개(`start_gdb_session`, `gdb_console`, `gdb_session_status`, `close_gdb_session`), Rizin 디버그 4개(`start_rizin_debug_session`, `rizin_debug_command`, `rizin_debug_session_status`, `close_rizin_debug_session`), Cutter 2개(`list_cutter_sessions`, `cutter_command`), 프로세스 캡처(`capture_process_scenario`, `compare_process_captures`). ([해당 contracts](https://github.com/morluto/rea/tree/rea-agents-6.7.0/src/contracts), 2026-10-18)

### 3.7 이 조사의 주제 밖 도구군 (참고)

- 안드로이드 기기 관찰, adb 24개: `list_adb_devices`, `inspect_adb_device`, `list_adb_packages`, `read_adb_logcat`, `capture_adb_screen`, `list_adb_processes`, `pull_adb_file`, `push_adb_file`, `install_adb_package`, `start_adb_app` 등. ([adbToolContracts.ts](https://github.com/morluto/rea/blob/rea-agents-6.7.0/src/contracts/adb/adbToolContracts.ts), 2026-10-18) 일부는 기기 상태를 바꾼다(설치·삭제·푸시·앱 시작/중지).
- 안드로이드 APK(JADX 기반): `search_android_classes`, `inspect_android_class`, `inspect_android_method`, `trace_android_references`, `decode_android_resources` 등. 윈도우 x64에서 헤드리스 JADX와 full JDK가 필요하다. ([README 표](https://github.com/morluto/rea/blob/rea-agents-6.7.0/README.md), 2026-10-18)
- JS/Electron·웹·.NET·펌웨어·pcap·SQLite·WASM·EVM 도구군은 이 조사의 주제가 아니어서 이름만 소스에 있음을 확인했다. ([contracts 디렉터리](https://github.com/morluto/rea/tree/rea-agents-6.7.0/src/contracts), 2026-10-18)

## 4. 네이티브 PE(x64 `.exe`·`.dll`) 분석 기능 매트릭스

| 기능 | 가능 여부 (윈도우, Ghidra 공급자) | 도구와 비고 |
| --- | --- | --- |
| 함수 목록 | 가능 | `list_procedures`, `binary_overview`(개수). 외부 함수와 썽크를 구분. 페이지 인자가 없고 전체를 한 응답으로 돌려준다 |
| 디컴파일 | 가능 | `procedure_pseudo_code`, `analyze_function`. 외부 함수·본문 없는 함수는 `null`. 출력은 Ghidra 의사코드로 원본 소스가 아니다 |
| 어셈블리 | 가능 | `procedure_assembly`, `read_function_instructions` |
| 문자열 | 가능(제한) | `list_strings`, `search_strings`. **Ghidra가 정의한 문자열 데이터만** 본다. 비어 있는 결과가 부재의 증거는 아니다. 주소를 알면 `read_bytes`, `xrefs`로 보완 |
| 임포트 | 간접 | PE용 임포트 전용 도구는 목록에서 확인되지 않았다(임포트를 설명에 명시한 도구는 Mach-O용 `inspect_macho`뿐). `list_procedures`·`list_names`에 외부 함수·외부 심볼이 포함되므로 이것으로 임포트를 읽는다 |
| 익스포트 | 미확인 | 전용 도구 없음. `list_names`에 익스포트 심볼이 어떻게 나오는지는 문서에 없다 |
| 교차 참조 | 가능 | `xrefs`(주소), `procedure_references`(들어오는/나가는, 종류 보존), `procedure_callers/callees`. 해소되지 않은 계산형 호출은 "unknown"으로 남긴다 |
| 호출 그래프/경로 | 합성 도구(미확인) | `get_call_graph`, `trace_call_path` 등은 윈도우 검증 범위 밖(3.2 참고) |
| 바이트 검색, 파일 오프셋 | 가능 | `search_bytes`(마스크 지원), `address_to_file_offset` |
| 심볼·PDB | 제한 | REA는 비공개 복사본을 임포트하며 PDB를 지정해 줄 수 없고 심볼 서버도 쓰지 않는다. PDB 참조가 있는데 Ghidra가 로드하지 못하면 증거에 한계로 표시한다 |
| 리소스 | 가능 | `inspect_pe_resources` (PE 리소스가 있을 때) |
| 주석·이름 변경 | 불가 | 윈도우 P0는 읽기 전용 |
| 동적 분석/런타임 트레이싱 | **검증된 경로 없음** | 프로세스 캡처 불가, GDB·Rizin 디버그 Linux 전용, LLDB는 macOS. Frida는 윈도우 미확인. 윈도우 네이티브 프로세스 트리 캡처를 REA가 보장하지 않는다고 문서가 명시 |

출처: [ghidra-provider.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/ghidra-provider.md), [windows-ghidra-p0.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/windows-ghidra-p0.md), [process-capture.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/process-capture.md), [reverse-engineering-tools.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/reverse-engineering-tools.md), 확인일 2026-10-18.

보조 사실:

- REA는 PE 정적 분석에서 대상을 **실행하지 않고** DLL의 진입 루틴도 호출하지 않으며, 불변 스냅샷 사본을 Ghidra에 넘긴다. ([windows-ghidra-p0.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/windows-ghidra-p0.md), 2026-10-18)
- 대상은 로컬 고정 NTFS 볼륨의 경로여야 하고, 재파싱 지점(reparse point)·대체 데이터 스트림·UNC 경로는 거부한다. 로컬 대상 경로(`C:\Users\xxx99\AppData\Local\Android\Sdk\emulator\qemu\windows-x86_64\`)의 각 구성요소를 조회한 결과 reparse 속성은 없었고 C: 볼륨은 NTFS 고정 디스크다. (로컬 조회, 2026-10-18)
- `REA_GHIDRA_SEED_FILE`(자동 분석이 닿지 못하는 코드의 시작점 주입), `REA_GHIDRA_LANGUAGE_ID`/`REA_GHIDRA_COMPILER_SPEC_ID`(임포트 언어 지정), `REA_GHIDRA_DISABLED_ANALYZERS`(분석기 비활성화)를 쓸 수 있다. ([installation.md "Ghidra import language and analysis seeds"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md), 2026-10-18)

## 5. 로컬 에뮬레이터 분석: 무엇을 어떤 순서로 열 것인가

### 5.1 로컬 파일 사실 (읽기·목록 조회만 수행, 확인일 2026-10-18)

- `source.properties`: `Pkg.Revision=36.3.10`, `Pkg.BuildId=14472402`. 경로 `C:\Users\xxx99\AppData\Local\Android\Sdk\emulator`.
- 루트: `emulator.exe`(1,961,624 B), `qemu-img.exe`(1,544,344 B), `mksdcard.exe`, `emulator-check.exe`, `netsimd.exe`, `qsn.exe`, `crashreport.exe`와 `libandroid-emu-*.dll`, 루트 `LICENSE`(Apache-2.0), `NOTICE.txt`, `NOTICE.csv`, `package.xml`.
- `lib64\`: `libgfxstream_backend.dll`(22,437,016 B), `libandroid-emu-shared.dll`(2,473,624 B), `libandroid-emu-metrics.dll`(9,774,744 B), `libemugl_common.dll`(155,800 B), `libandroid-emu-agents.dll`(30,360 B) 등과 `gles_*`, `qt`, `vulkan` 하위 디렉터리.
- `qemu\windows-x86_64\`: `qemu-system-x86_64.exe`(61,264,024 B), `qemu-system-x86_64-headless.exe`(51,576,472 B), `qemu-system-i386[-headless].exe`, `qemu-system-aarch64[-headless].exe`, `qemu-system-armel[-headless].exe`와 MSVC 런타임 DLL들.
- 헤더 확인(파일을 읽어 PE 구조만 조회): 위 EXE·DLL 모두 PE32+, machine `0x8664`(x64), CLR 디렉터리 없음(네이티브), COFF 심볼 테이블 포인터 0(심볼 없음). 각 파일의 디버그 디렉터리가 `C:/buildbot/src/out/build/debug_info/<이름>.pdb`를 가리키지만 로컬에는 `.pdb`가 없다. 비-헤드리스 `qemu-system-x86_64.exe`에는 `.qtversi` 섹션이 있고 헤드리스에는 없다(Qt UI 포함 여부 차이로 보이나 추정). `SizeOfImage`는 헤드리스 64,565,248, 비-헤드리스 74,272,768이다. (로컬 PE 헤더 조회)
- 안드로이드 시스템 이미지와 AVD 설정은 이번 조사에서 열지 않았다.

### 5.2 로컬 바이너리 문자열로 확인한 구조

- `emulator.exe`에는 서식 문자열 `%s\qemu\%s-%s\qemu-system-%s%s`와 `%s\qemu\%s-%s\qemu-system-%s-headless%s`가 있고 문자열 `CreateProcessW`도 들어 있다. 즉 `emulator.exe`는 AVD의 아키텍처에 맞춰 `qemu\<OS>-<arch>\qemu-system-<arch>[-headless].exe`를 자식 프로세스로 띄우는 런처로 보인다(문자열 근거로 한 추정이고, 호출 순서는 REA로 xrefs를 따라가야 확정된다). 같은 파일에 "On Windows, it relies on WHPX or AEHD" 문구의 가속 안내문이 있다. (로컬 문자열 조회)
- `qemu-system-x86_64-headless.exe`에는 `tcg_accel_class_init`, `aehd_init_vcpu failed: %s`, `whpx_init_vcpu failed: %s`, `goldfish_tty`, `goldfish_address_space_area` 등의 문자열이 있다. 즉 WHPX·AEHD 가속 경로와 Android 전용 가상 장치(goldfish)의 코드가 이 바이너리에 들어 있다. (로컬 문자열 조회)
- 공식 문서: 윈도우에서 가속은 WHPX에 의존하고(`-accel`), 소프트웨어 에뮬레이션(`-accel off`)은 "not supported and is very slow"이며 `ANDROID_I_WANT_MY_TCG=yes`를 설정해야 시작된다. AEHD는 2026-12-31에 지원이 종료되고, 에뮬레이터 36.2.x.x부터 HAXM은 쓰지 않는다. ([emulator 명령줄 문서](https://developer.android.com/studio/run/emulator-commandline), [가속 문서](https://developer.android.com/studio/run/emulator-acceleration), 2026-10-18)

### 5.3 REA로 열 순서 (제안)

| 순서 | 대상 | 이유 |
| --- | --- | --- |
| 0 | `lib64\libandroid-emu-agents.dll`(30 KB) | 파이프라인 점검용 최소 크기 표본. 크기가 작아도 윈도우 콜드 스타트에 수 분이 걸릴 수 있음(6.1 참고) |
| 1 | `emulator.exe`(1.9 MiB) | 런처. 인자 파싱과 qemu 바이너리 선택, 가속 안내 문자열에서 시작해 `CreateProcessW` 호출부를 xrefs로 추적하기에 적당한 크기 |
| 2 | `qemu\windows-x86_64\qemu-system-x86_64-headless.exe`(49.2 MiB) | **본체**. Qt UI가 없는 변형이라 비-헤드리스(58.4 MiB)보다 작다. 시작점 문자열: `whpx_init_vcpu failed`, `aehd_init_vcpu failed`, `goldfish_tty`, `goldfish_address_space_area`, `tcg_accel_class_init` |
| 3 | `qemu-img.exe`(1.5 MiB) | QEMU의 디스크 이미지 도구. 블록 계층 학습용 작은 표본(NOTICE가 qemu 라이선스 대상으로 목록화). 내부 구성은 열어 봐야 확인 |
| 4 | `lib64\libandroid-emu-shared.dll`(2.4 MiB) 등 | 안드로이드 전용 공통 코드. 필요할 때만 |

`qemu-system-x86_64.exe`(비-헤드리스)와 i386·aarch64·armel 변형은 다른 아키텍처를 보려는 경우가 아니면 뒤로 미룬다. `libgfxstream_backend.dll`(21.4 MiB, 그래픽 스트리밍)과 `libandroid-emu-metrics.dll`(9.3 MiB)은 에뮬레이터 원리 학습 목적과 거리가 멀다(판단).

### 5.4 REA 설정값 (제안, 근거는 각 문서)

- `GHIDRA_INSTALL_DIR`, `JAVA_HOME`(JDK 21), `REA_ANALYSIS_PROVIDER=ghidra`를 MCP 등록 `env`에 둔다. ([windows-ghidra-p0.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/windows-ghidra-p0.md), 2026-10-18)
- 힙: 기본 `-Xmx`는 `GHIDRA_HEADLESS_MAXMEM` → `GHIDRA_MAXMEM` → `2G` 순으로 정한다. 49 MiB급 바이너리는 2G로 부족할 가능성이 크다(추정). 로컬 RAM은 31.5 GB, CPU는 AMD Ryzen 5 7500F(6코어 12스레드)다. (로컬 조회, [installation.md "Ghidra heap and CPU controls"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md), 2026-10-18)
- 시작 제한: 기본 330초(`REA_GHIDRA_STARTUP_TIMEOUT_MS`로 최대 2,147,483,647 ms). 큰 바이너리는 크게 늘려야 한다. ([installation.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md), 2026-10-18)
- 클라이언트 제한: Claude Code의 MCP 도구 호출 제한은 `MCP_TOOL_TIMEOUT`을 지정하지 않으면 기본 약 28시간, 서버 시작 제한은 `MCP_TIMEOUT`이다. 출력은 25,000 토큰을 넘으면 잘리므로(`MAX_MCP_OUTPUT_TOKENS`로 조정) 수만 개 함수를 한 번에 나열하는 `list_procedures`는 그대로 쓰기 어렵다(추정). ([Claude Code MCP 문서](https://code.claude.com/docs/en/mcp), 2026-10-18) REA 쪽 응답 상한은 `REA_MCP_MAX_RESPONSE_BYTES`(10,485,760 이상)로 조정한다. ([mcp-contracts.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/mcp-contracts.md), 2026-10-18)
- MCP SDK 기본 도구 호출 제한은 60초(REA 문서의 고정 SDK 기준)이고 Claude Code 쪽은 위와 같다. 문서는 첫 질의 대기가 길면 `close_binary` 후 같은 경로로 `open_binary`를 다시 호출하는 복구 절차를 제시한다. ([mcp-contracts.md "Ghidra first-query deadlines and recovery"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/mcp-contracts.md), 2026-10-18)
- 오래 걸리는 분석은 MCP 대신 CLI가 낫다. CLI는 클라이언트 요청 제한이 없고 `--snapshot <경로>`로 질의 결과를 저장·재사용한다. 단 윈도우 Ghidra는 스냅샷 재생에도 공급자를 먼저 띄울 수 있다. ([cli.md "Save and reuse analysis snapshots"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/cli.md), [mcp-contracts.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/mcp-contracts.md), 2026-10-18)
- `REA_GHIDRA_DISABLED_ANALYZERS=WindowsResourceReference`는 PE 리소스 분석기를 끄는 설정이다. 이 바이너리들은 리소스 디렉터리가 비어 있어 효과가 작을 것으로 본다(추정). 다른 분석기를 끄면 해당 분석기가 만들 사실이 사라진다. ([installation.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md), 2026-10-18)

### 5.5 소스 병행

- 로컬 `NOTICE.csv`는 `qemu`를 `GPL-2.0-only`, `gfxstream`·`swiftshader`·`netsim`을 `Apache-2.0`으로 표기하고 각 소스 위치를 AOSP로 적는다. `qemu-system-x86_64[-headless].exe`는 qemu 라이선스 대상 파일 목록에 올라 있다. (로컬 `NOTICE.csv`·`NOTICE.txt`, 2026-10-18)
- `NOTICE.csv`가 가리키는 브랜치 `emu-master-dev`의 마지막 커밋은 2025-03-27(35.6.3 Canary 병합)로 로컬 36.3.10보다 오래됐다. 더 최근인 브랜치 `emu-main-dev`의 마지막 커밋은 2026-09-15다. 루트 `QEMU_VERSION` 파일은 `2.12.0`이다. 로컬 36.3.10이 정확히 어느 브랜치·커밋에서 빌드됐는지는 **미확인**이다. ([emu-master-dev](https://android.googlesource.com/platform/external/qemu/+/refs/heads/emu-master-dev), [emu-main-dev](https://android.googlesource.com/platform/external/qemu/+/refs/heads/emu-main-dev), [QEMU_VERSION](https://android.googlesource.com/platform/external/qemu/+/refs/heads/emu-main-dev/QEMU_VERSION), 2026-10-18)
- `emu-main-dev` 트리에는 `tcg/`, `accel/`, `target/riscv`, `target/i386`, `hw/riscv`, `android/` 디렉터리가 있다. README가 링크하는 `android/docs/WINDOWS-DEV.md`는 윈도우 빌드에 Visual Studio 2022를 요구한다. ([emu-main-dev 트리](https://android.googlesource.com/platform/external/qemu/+/refs/heads/emu-main-dev/target/), [README](https://android.googlesource.com/platform/external/qemu/+/refs/heads/emu-main-dev/README.md), 2026-10-18)
- 배포 바이너리는 심볼이 없어 Ghidra 출력의 함수 이름이 `FUN_...` 형태가 된다(심볼 없음에서 오는 추정). 소스를 병행하면 문자열·구조를 근거로 이름을 대응시킬 수 있다.
- x86_64 AVD가 WHPX로 가속되는 경우 게스트 명령은 하이퍼바이저가 실행하므로 QEMU의 TCG 해석 루프는 주 경로가 아니다(위 공식 문서 근거). 따라서 이 바이너리에서 배울 수 있는 것은 vCPU 종료 이벤트 처리, MMIO·장치 모델(goldfish, virtio), 메모리 맵 구성이고, 명령 디코드·실행 루프는 소스의 `tcg/`·`target/riscv/`에서 읽는 편이 맞다(판단).

### 5.6 같이 쓸 수 있는 REA 외 관찰 수단 (참고)

- 에뮬레이터 자체의 공식 진단 옵션: `-verbose`(초기화 메시지), `-show-kernel`, `-debug <태그>`, `-accel-check`. `-qemu` 뒤에 QEMU 인자를 넘길 수 있으나 문서가 "quite advanced"라고 경고한다. ([emulator 명령줄 문서](https://developer.android.com/studio/run/emulator-commandline), 2026-10-18)
- 실행 중인 AVD의 게스트 쪽 관찰(패키지, 로그캣, 프로세스, 화면)은 REA의 adb 도구로 가능하다. 에뮬레이터 내부(qemu 프로세스)가 아니라 안드로이드 게스트를 보는 도구다. 로컬 `platform-tools\adb.exe`가 있다. ([adb-device-analysis.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/adb-device-analysis.md), 2026-10-18)

## 6. 한계와 주의점

### 6.1 대형 바이너리 처리 성능

- 실측(이슈 #3751, rea-agents 6.5.0, Ghidra 12.1.4, JDK 21, 윈도우 11 x64, RAM 63 GB): Unreal Engine 5.8 게임 실행 파일, x86-64 PE, 191 MiB, 약 379k 함수. 기본 임시 임포트(`GHIDRA_HEADLESS_MAXMEM=12G`)는 `REA_GHIDRA_STARTUP_TIMEOUT_MS` 60분에 걸려도 분석이 끝나지 않았다. Ghidra `analyzeHeadless`를 직접 영구 프로젝트로 돌리면(32G 힙) 74분 만에 끝났고, 그 프로젝트를 다시 열면 후처리 스크립트 3개(디컴파일 5회 포함)가 15초였다. 시드 파일과 분석기 9개 비활성화를 쓰면 `rea function`이 15분 40초였는데, 같은 대상을 `--snapshot`으로 다시 호출해도 15분 8초가 또 걸렸다. REA는 임포트 모드가 `ephemeral-source-immutable`이라 세션마다 비용을 다시 낸다. 기존 프로젝트를 여는 기능은 열린 요청이다. ([이슈 #3751](https://github.com/morluto/rea/issues/3751), 2026-10-18)
- 윈도우 소형 픽스처: 1,024바이트 PE의 콜드 `binary_overview`가 약 163초, 이어진 호출이 약 19 ms였다. ([mcp-contracts.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/mcp-contracts.md), 2026-10-18) 같은 회차에 클라이언트 기본 60초 제한으로 먼저 시간 초과가 났다.
- ARM 픽스처(2 논리 CPU, 512 MiB 힙, 제약 환경): 첫 함수 질의가 약 434초와 약 601초, 재시도 약 407초였고, 기본 분석기로는 900초 예산을 넘겼다. 이후 같은 세션의 반복 질의는 11~23 ms였다. ([windows-ghidra-p0.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/windows-ghidra-p0.md), 2026-10-18)
- 49.2 MiB·함수 수 미상의 `qemu-system-x86_64-headless.exe`에 대한 REA 실측은 없다. 위 사례로 보면 분 단위가 아니라 수십 분 단위를 각오하는 편이 안전하다(추정, 실측 아님).
- 인벤토리(`list_procedures` 등)는 오프셋·개수 제한 없이 전체를 한 응답으로 돌려준다고 문서에 적혀 있다. 대형 바이너리에서 Claude Code의 25,000 토큰 출력 제한과 어떻게 맞물리는지는 **미확인**이다. ([ghidra-provider.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/ghidra-provider.md), 2026-10-18)

### 6.2 알려진 윈도우 이슈

- **#1701 (열림, 라벨 bug·P1: high)**: 윈도우 11 x64에서 `rea doctor`의 `native_authority` 점검이 `Delete owned object by handle failed (Win32 5)`로 실패해 Ghidra 공급자가 `unsupported_host`로 막힌다. 실패 시 `%TEMP%`에 `rea-native-probe-<32hex>` 디렉터리가 남는다. 보고는 6.3.0, 6.4.0, 5.0.0에서 재현됐고, 윈도우 10과 11 모두에서 실패 보고와 통과 보고가 섞여 있다(실패 보고에는 빌드 10.0.26200과 26300이, 통과 보고에는 윈도우 10 19045와 26340이 있다). 보고자 한 명(빌드 10.0.26200, Windows 11 Pro)은 CLI가 `provider_unavailable`로 거부해도 MCP `open_binary`(provider ghidra)와 `binary_overview`는 32비트 PE에서 동작했다고 적었다. 메인테이너는 별도의 Win32 32 변형만 수정(커밋 `9a44fea34`, 6.7.0 태그에 포함)했고 "원래의 Win32 5 삭제 실패와 영향 호스트 원인은 확립되지 않았다"며 이슈를 열어 두었다. **사용자 PC는 Windows 11 Pro 10.0.26200이라 같은 빌드다. 재현 여부는 설치 후 `rea doctor --provider ghidra --json`으로만 알 수 있다(미확인).** ([이슈 #1701](https://github.com/morluto/rea/issues/1701), 2026-10-18)
- #3111(열림): 윈도우 11 빌드 26300에서 네이티브 컨트롤 자가 점검이 정적 안드로이드 APK 분석까지 막는다는 보고. ([이슈 #3111](https://github.com/morluto/rea/issues/3111), 2026-10-18)
- 윈도우 + IDA 헤드리스에서 분석이 몇 분간 멈추고 `cleanup_incomplete`로 끝나는 보고(#3056, 열림). ([이슈 #3056](https://github.com/morluto/rea/issues/3056), 2026-10-18)

### 6.3 윈도우 P0 경계와 구조적 한계

- 읽기 전용이며 일반 윈도우 기능 동등성을 주장하지 않는다. 관리형(.NET) PE, 적대적(hostile)·민감·변경 가능한 경로의 대상은 지원 범위 밖이다. ([windows-ghidra-p0.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/windows-ghidra-p0.md), [GhidraProviderCapabilities.ts](https://github.com/morluto/rea/blob/rea-agents-6.7.0/src/ghidra/GhidraProviderCapabilities.ts), 2026-10-18)
- 제한 환경(2 CPU·512 MiB 힙)에서 `WindowsResourceReference`를 끈 구성으로 검증됐고, "기본 분석기 구성의 완주는 확립되지 않았다"고 문서가 적는다. ([windows-ghidra-p0.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/windows-ghidra-p0.md), 2026-10-18)
- Ghidra 문자열 인벤토리는 정의된 문자열 데이터만 커버한다. 패킹·미정의 리터럴은 없을 수 있다. ([ghidra-provider.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/ghidra-provider.md), 2026-10-18)
- 이름·타입이 복원되지 않아도 자동 분석은 끝난다. 이름 검색이 비어 있어도 함수가 없다는 뜻이 아니다. ([ghidra-provider.md "PE debug-symbol coverage"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/ghidra-provider.md), 2026-10-18)
- 윈도우 Ghidra의 임시 런타임은 보호된 DACL, Job Object, 루프백 인증 소켓을 쓴다. REA 프로세스가 갑자기 죽으면 Job은 정리되나 비공개 런타임 파일이 남을 수 있다. ([windows-ghidra-p0.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/windows-ghidra-p0.md), 2026-10-18)
- 런처 경로에 `cmd.exe` 메타문자가 있으면 지원하지 않는다. ([windows-ghidra-p0.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/windows-ghidra-p0.md), 2026-10-18)
- Claude Desktop 윈도우 전용 이슈(#3408, #4081)는 Claude Code 사용과 무관하다고 보나, 이번 조사에서 원인은 읽지 않았다(미확인). ([이슈 목록](https://github.com/morluto/rea/issues), 2026-10-18)

### 6.4 라이선스와 이용 제한

- REA는 MIT, Ghidra는 Apache-2.0이다. REA는 Hopper·IDA·JEB 같은 상용 도구의 라이선스·키·활성화 권한을 제공하지 않는다. ([LICENSE·README "License"](https://github.com/morluto/rea/blob/rea-agents-6.7.0/README.md), [Ghidra 저장소](https://github.com/NationalSecurityAgency/ghidra), 2026-10-18)
- REA `DISCLAIMER.md`는 리버스 엔지니어링이 관할권이나 대상 소프트웨어의 라이선스로 제한될 수 있고 사용자가 합법성과 허가를 책임진다고 적는다. 소스 유사 출력을 얻었다고 원본 프로그램에 대한 권리가 생기지 않으므로 공유·게시 전에 권리를 확인하라고 한다. ([DISCLAIMER.md](https://github.com/morluto/rea/blob/rea-agents-6.7.0/DISCLAIMER.md), 2026-10-18)
- 로컬 `package.xml`에 실린 Android SDK 라이선스 계약 3.4: "you may not copy (except for backup purposes), modify, adapt, redistribute, decompile, reverse engineer, disassemble, or create derivative works of the SDK or any part of the SDK" 앞에 "Except to the extent required by applicable third party licenses"가 붙는다. 3.5: 오픈소스 라이선스가 적용되는 SDK 구성요소의 사용·복제·배포는 그 오픈소스 라이선스만이 규율한다. `NOTICE.csv`가 qemu를 GPL-2.0-only로 표기하므로 qemu 부분은 3.5 쪽에 해당할 가능성이 있다. 하지만 `emulator.exe`·`libandroid-emu-*.dll` 등이 어느 쪽인지는 이 조사로 판단할 수 없다. 이는 법률 자문이 아니며 **확인 필요**다. (로컬 `package.xml`·`NOTICE.csv`, 2026-10-18)
- `package.xml`에서 SDK 라이선스 3.4는 "copy (except for backup purposes)"도 제한한다. 분석 편의를 위해 SDK 파일을 다른 폴더로 복사하는 방식은 이 조항과 충돌할 수 있어 제자리 열람을 먼저 쓰는 편이 안전하다(해석은 내 판단, 법률 판단 아님). (로컬 `package.xml`, 2026-10-18)

## 7. 미확인 항목

- MCP 도구의 정확한 현재 개수와 전체 목록(generated catalog 미공개, 404). 소스 추출값은 불완전할 수 있다.
- 윈도우에서 합성 도구(`get_call_graph`, `trace_call_path`, `batch_decompile`, `trace_feature` 등)의 동작.
- 49 MiB급 x64 PE의 REA + Ghidra 윈도우 실측 시간·메모리.
- 사용자 PC(Windows 11 Pro 10.0.26200)에서 이슈 #1701 재현 여부.
- 윈도우에서 Frida 도구 동작.
- 대형 인벤토리 응답이 Claude Code 25,000 토큰 출력 제한과 맞물리는 방식.
- 로컬 36.3.10에 대응하는 AOSP 소스 브랜치·커밋.
- `list_names`에서 PE 익스포트가 표시되는 방식.
- 로컬 SDK 파일 개별(emulator.exe 등)의 라이선스 귀속.
- npm 웹 페이지(403)의 표시 내용. 레지스트리 JSON으로 대신 확인했다.

## 설계에 주는 함의

1. REA는 이 포트폴리오에서 "배포된 에뮬레이터 바이너리(PE)를 Ghidra로 정적 열람해 증거를 남기는 도구"로 한정하고, 동적 추적은 REA에 기대하지 않는다.
2. 시작 전 선결 조건: JDK 21과 Ghidra 12.1.4를 직접 설치하고, 먼저 `rea doctor --provider ghidra --json`으로 #1701 재현 여부를 확인한다. 등록은 이 프로젝트 디렉터리의 local scope로 하고 JDK 21은 MCP 등록 `env`에만 둔다.
3. 열람 순서는 `emulator.exe`(런처 흐름), `qemu-system-x86_64-headless.exe`(`whpx_init_vcpu failed` 같은 문자열 닻)다. 큰 파일은 MCP 대신 CLI + `--snapshot`/증거 JSON으로 수십 분 대기를 전제한다.
4. 에뮬레이터 원리와 미니 RISC-V 설계의 1차 자료는 AOSP `external/qemu` 소스(`emu-main-dev`의 `tcg/`, `target/riscv/`)와 공식 문서다. WHPX 가속 때문에 바이너리에서는 CPU 해석 루프 대신 장치 모델과 vCPU 종료 처리가 보이며, REA 결과는 "배포 바이너리가 소스와 대응한다"는 보조 증거로 쓴다.
5. 포트폴리오에는 분석 결론과 Evidence 요약만 싣고 디컴파일 출력과 바이너리 사본은 싣지 않는다. 게시 전에 Android SDK 라이선스 3.4와 REA DISCLAIMER를 다시 확인한다.
