# amulator 학습 사이트 S1(가) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학습 사이트의 기반을 만든다. 역어셈블러, 에뮬레이터 상태를 들여다보고 조작하는 worker 메시지, 입력 기록 재생, `apps/web`의 React 전환까지다. 화면 모습은 지금과 같다.

**Architecture:** core에는 DOM 없이 도는 순수 함수(역어셈블, CPU 상태 읽기, 메모리 엿보기, 장치 접근 기록, 스냅샷 구간)를 더한다. worker는 그 함수를 메시지로 꺼내 준다. 페이지 쪽은 지금 `main.ts`의 로직을 `mountEmulator`로 옮기고 React 훅 `useEmulator`가 감싼다. 사이트와 에뮬레이터 페이지는 Vite의 HTML 진입점 두 개(`index.html`, `emulator.html`)로 나눈다.

**Tech Stack:** TypeScript, pnpm 워크스페이스, Vite 8, Vitest 5, zod 4, React 19, xterm.js. 역어셈블러 기대값은 LLVM `llvm-objdump`으로 만든다.

**Spec:** [docs/superpowers/specs/2026-10-19-amulator-learning-site-design.md](../specs/2026-10-19-amulator-learning-site-design.md) 4.1·4.2절, 5장 S1(가), 7장 S1, 9장

**범위 밖:** S1(나) DS 0.5.0은 design-system 레포의 R27 절차(`docs/plan.md`)로 따로 계획한다. design-flow 세션의 0.4.1 배포 뒤에 시작한다(설계 4.4절). 7장 재생에 쓸 기록을 실제로 남기는 도구는 S2에서 챕터 7을 만들 때 정한다. 이 계획은 기록 파일 형식과 재생까지만 만든다.

## Global Constraints

- 코드를 쓰기 전에 conventions 스킬을 읽는다(프로젝트 CLAUDE.md). 타입은 `type`, 화살표 함수, named export, enum 대신 `as const`, 매직넘버는 UPPER_SNAKE 상수다.
- `packages/core/src`는 순수 ES2023이다. DOM·Node API를 쓰지 않는다(tsconfig가 막는다).
- 보조 스크립트는 node `.mjs`로 쓰고 윈도우와 맥에서 같은 명령으로 돈다. 윈도우의 `python`은 쓰지 않는다.
- S1은 디자인 작업을 하지 않는다. 새 시각 스타일, DS(`@eeennsu/web`), Tailwind를 들이지 않는다. 에뮬레이터 페이지는 지금 `index.html`의 CSS를 그대로 옮긴다(설계 5장).
- SharedArrayBuffer(COOP/COEP)에 기대지 않는다(GitHub Pages).
- 관찰·제어 기능은 페이지와 worker 사이 메시지로만 오간다. MCP 도구를 늘리지 않는다(설계 4.2절).
- 플러그인의 MCP 모드(`?token=`), 브리지, 디스크 스냅샷 저장은 지금처럼 동작해야 한다.
- 문서·주석·커밋 메시지는 한국어 '-다'체다. 커밋 제목은 `feat:` `fix:` `refactor:` `update:` `chore:` `docs:` 접두어로 시작한다.
- 완료 조건은 `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`가 모두 통과하는 것이다. `eslint-disable`로 막지 않는다.
- 새 의존성 버전은 설치할 때 조회하고, 정확한 버전을 커밋 메시지 본문에 적는다.

## Review Focus

1. **React 개발 모드의 이중 마운트.** StrictMode는 effect를 두 번 돌린다. canvas를 한 번 넘긴 뒤 같은 요소로 `transferControlToOffscreen()`을 다시 부르면 InvalidStateError가 난다. 개발 서버에서도 오류 없이 그려져야 하고, 앞선 worker는 종료되어야 한다. → Task 5 Step 7
2. **실행 중에 단계 실행을 보낸다.** 멈추지 않은 머신에 `step`이 오면 무시하고 오류 메시지로 알린다. 루프가 두 번 돌면 안 된다. → Task 3 테스트 `실행 중의 step은 거부한다`
3. **매핑되지 않은 주소에 쓴다.** `busWrite`가 BusFault를 내도 실행 루프는 살아 있어야 하고, 다음 요청에 응답해야 한다. → Task 3 테스트 `없는 주소에 쓰면 오류를 알리고 계속 응답한다`
4. **멈춘 채로 Reset한다.** 새 머신으로 바뀌어도 멈춘 상태는 유지되고 pc는 진입 주소에 있어야 한다. 장치 접근 기록을 켜 두었다면 새 머신에도 다시 걸려야 한다. → Task 3 테스트 `멈춘 채 reset하면 멈춘 채 진입 주소에 있다`, `reset 뒤에도 기록이 이어진다`
5. **장치 접근 기록이 넘친다.** 그림판은 프레임버퍼에 수천 번 쓴다. 기록은 최근 N개만 남기고 버린 개수를 알려야 하며, 메모리가 늘면 안 된다. → Task 3 테스트 `traceBuffer는 최근 항목만 남기고 버린 수를 센다`

---

### Task 1: 역어셈블러

**Files:**
- Create: `scripts/buildDisasmFixtures.mjs`
- Create: `packages/core/test/fixtures/disasm.txt` (스크립트 출력, 커밋한다)
- Create: `packages/core/src/cpu/disassemble.ts`
- Test: `packages/core/test/disassemble.test.ts`
- Modify: `package.json` (루트 scripts에 `"disasm:fixtures": "node scripts/buildDisasmFixtures.mjs"`)

**Interfaces:**
- Consumes: `CSR`(`packages/core/src/cpu/csr.ts`), `findToolchain`(`scripts/checkToolchain.mjs`)
- Produces:
  - `disassemble(word: number, pc: number): string` — `packages/core/src/cpu/disassemble.ts`
  - `ABI_REGISTER_NAMES: readonly string[]` — 같은 파일, 길이 32(`zero, ra, sp, gp, tp, t0, t1, t2, s0, s1, a0…a7, s2…s11, t3…t6`)

- [ ] **Step 1: 기대값 스크립트를 쓴다**

`scripts/buildDisasmFixtures.mjs`는 `findToolchain()`이 찾은 clang과 같은 폴더의 `llvm-objdump`(윈도우는 `.exe`)로 다음 ELF를 `-d -M no-aliases`로 역어셈블한다.
- `guest/baremetal/out/*.elf`
- `packages/core/test/fixtures/riscv-tests/*.elf`

출력은 `packages/core/test/fixtures/disasm.txt` 한 파일이다.
- 줄 형식: `<pc 8자리 hex> <word 8자리 hex> <text>`
- `text`는 objdump의 니모닉과 피연산자를 공백 하나로 이은 것이다. 끝의 `<심볼+오프셋>`은 지운다.
- 4바이트 명령어 줄만 담는다. 2바이트(C 확장) 줄은 뺀다.
- word가 같은 줄은 처음 나온 것 하나만 남긴다. 2026-10-21 기준으로 약 2,990줄, 120 KB다.
- 맨 위에 주석 한 줄로 objdump 버전(`--version` 첫 LLVM 줄)을 적는다.

- [ ] **Step 2: 스크립트를 돌려 기대값을 만든다**

Run: `pnpm disasm:fixtures`
Expected: `packages/core/test/fixtures/disasm.txt`가 생기고, 줄 수가 2,900~3,100 사이다. `unimp`, `fence iorw, iorw`, `sfence.vma zero, zero`, `csrrw zero, mtvec, t0` 같은 줄이 들어 있다.

- [ ] **Step 3: 실패하는 테스트를 쓴다**

`packages/core/test/disassemble.test.ts`:
- `기대값 파일의 모든 명령어를 objdump와 같게 푼다`: 주석이 아닌 각 줄에 대해 `disassemble(word, pc)`가 `text`와 같다. 단, `text`의 니모닉이 `csr`로 시작하고 CSR 피연산자(두 번째)가 `CSR`의 키도 아니고 `0x` 숫자도 아니면 건너뛴다. 이 줄은 LLVM이 이 에뮬레이터에 없는 CSR(예: `mnstatus`)에 이름을 붙인 것이다. 건너뛴 줄 수를 세어 50줄 미만인지 단언한다.
- `ABI 이름은 32개이고 x8은 s0이다`: `ABI_REGISTER_NAMES.length === 32`, `[8] === 's0'`
- `알 수 없는 워드는 <unknown>이다`: `disassemble(0xffff_ffff, 0x8000_0000) === '<unknown>'`
- `분기 대상은 pc 기준 절대 주소다`: `disassemble(0x00b57863, 0x8000_0024) === 'bgeu a0, a1, 0x80000034'`

- [ ] **Step 4: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @amulator/core exec vitest run test/disassemble.test.ts`
Expected: FAIL (`disassemble` 모듈이 없다)

- [ ] **Step 5: `disassemble(word: number, pc: number): string`을 구현한다**

표기는 Step 2의 기대값을 따른다.
- 레지스터는 ABI 이름이다.
- 즉시값은 `0x..`·`-0x..` 16진수다.
- 로드·스토어·`jalr`은 `imm(reg)`이다.
- 분기·`jal`은 절대 대상 주소다.
- CSR은 `CSR` 표의 이름을 쓰고, 표에 없으면 `0x` 16진수다.
- 디코드는 `cpu.ts`의 `OPCODE`·funct3 표와 같은 구분을 쓰되, cpu.ts의 private 상수를 export하지 않고 이 파일에 둔다. 실행과 표기는 따로 바뀔 수 있기 때문이다.
- RV32I, M, Zicsr, `fence`·`fence.i`, `ecall`·`ebreak`·`mret`·`wfi`·`sret`·`sfence.vma`, `unimp`(`0xc0001073`)를 푼다. CPU가 illegal로 처리하는 명령어도 표기는 한다.

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @amulator/core exec vitest run test/disassemble.test.ts`
Expected: PASS

- [ ] **Step 7: 커밋한다**

```bash
git add scripts/buildDisasmFixtures.mjs package.json packages/core/src/cpu/disassemble.ts packages/core/test/disassemble.test.ts packages/core/test/fixtures/disasm.txt
git commit -m "feat: RV32IM 역어셈블러와 llvm-objdump 대조 기대값 추가"
```

---

### Task 2: core 관찰 함수와 장치 접근 기록

**Files:**
- Modify: `packages/core/src/bus.ts`
- Create: `packages/core/src/inspect.ts`
- Modify: `packages/core/src/snapshot.ts`
- Create: `packages/core/test/run.bench.ts`
- Modify: `packages/core/package.json` (scripts에 `"bench": "vitest bench --run"`)
- Test: `packages/core/test/bus.test.ts`, `packages/core/test/inspect.test.ts`, `packages/core/test/snapshot.test.ts`

**Interfaces:**
- Consumes: `Machine`, `Cpu`, `CSR`, `ElfImage`, `RAM_BASE`, `FB_BASE`, `SnapshotMeta`
- Produces:
  - `bus.ts`
    - `type DeviceAccess = { device: string; address: number; width: AccessWidth; kind: 'read' | 'write'; value: number }`
    - `Bus`에 `setDeviceAccessListener: (listener: ((access: DeviceAccess) => void) | undefined) => void`
  - `inspect.ts`
    - `INSPECTED_CSRS = ['mstatus', 'mtvec', 'mepc', 'mcause', 'mie', 'mip'] as const`, `type InspectedCsr`
    - `type CpuView = { pc: number; x: number[]; privilege: Privilege; idle: boolean; csr: Record<InspectedCsr, number> }`
    - `inspectCpu(cpu: Cpu): CpuView`
    - `type MemoryRegion = { name: string; base: number; size: number }`
    - `memoryRegions(machine: Machine): MemoryRegion[]` — `ram`, `uart16550`, `clint`, `framebuffer`, `touch` 순서
    - `PEEK_MAX_BYTES = 4096`
    - `peekMemory(machine: Machine, address: number, length: number): Uint8Array`
    - `type ElfSummary = { entry: number; segments: { paddr: number; filesz: number; memsz: number }[]; symbols: [string, number][] }`
    - `summarizeElf(image: ElfImage): ElfSummary`
  - `snapshot.ts`
    - `type SnapshotSection = { name: string; bytes: number }`
    - `describeSnapshot(bytes: Uint8Array): { meta: SnapshotMeta; sections: SnapshotSection[] }`

- [ ] **Step 1: 바꾸기 전 실행 속도를 잰다**

`packages/core/test/run.bench.ts`를 만든다.
- 내용: `paint.elf`를 실은 머신에서 `machine.run(1_000_000)`을 재는 `bench` 하나다.
- 시계: 고정 시계(`nowMicros: () => 0`)로 결과를 결정적으로 만든다. 그림판은 `wfi` 없이 터치 장치를 폴링하므로 장치 경로를 많이 지난다. 이번 변경이 건드리는 곳이 바로 그 경로다.
- 측정: 한 번 돌 때 `executed`가 1,000,000인지 단언한다.

`bench` 스크립트를 더한다.

Run: `pnpm --filter @amulator/core bench`
Expected: 결과 표가 나온다. hz와 mean을 이 태스크 보고에 "변경 전"으로 적는다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`bus.test.ts`:
- `장치 접근을 듣는 함수가 있으면 읽기와 쓰기를 알린다`: 가짜 장치로 write(폭 1, 값 0x1ff) → `{ device, address, width: 1, kind: 'write', value: 0xff }`(잘린 값), read → `kind: 'read'`와 돌려준 값
- `RAM 접근은 알리지 않는다`
- `듣는 함수를 지우면 더 알리지 않는다`

`inspect.test.ts`(paint.elf를 실은 머신):
- `inspectCpu는 pc, 레지스터 32개, CSR 여섯 개를 돌려준다`: `x.length === 32`, `csr.mtvec`이 `cpu.readCsr(CSR.mtvec)`과 같다
- `memoryRegions는 RAM과 장치 넷을 주소와 함께 돌려준다`: 이름 순서, `ram`의 base는 `RAM_BASE`, `framebuffer`의 base는 `FB_BASE`
- `peekMemory는 RAM을 복사해 돌려준다`: 첫 세그먼트의 처음 16바이트와 같고, 돌려준 배열을 바꿔도 RAM이 바뀌지 않는다
- `peekMemory는 프레임버퍼를 읽는다`: `FB_BASE`에서 4바이트
- `peekMemory는 구간을 넘거나 비거나 너무 길면 RangeError다`: RAM 끝 2바이트 전부터 4바이트, 주소 0, 길이 0, 길이 `PEEK_MAX_BYTES + 1`
- `summarizeElf는 진입 주소와 세그먼트 크기, 심볼을 담는다`: `entry === 0x8000_0000`, `symbols`에 `main`이 있다

`snapshot.test.ts`:
- `describeSnapshot은 메타와 구간 크기를 돌려준다`: 구간 이름이 `header, info, ram, framebuffer` 순서이고, `ram`은 `RAM_SIZE`, `framebuffer`는 `FB_STRIDE * FB_HEIGHT`, `header`는 12바이트다
- `describeSnapshot은 망가진 입력을 SnapshotMismatchError로 거부한다`

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @amulator/core exec vitest run test/bus.test.ts test/inspect.test.ts test/snapshot.test.ts`
Expected: FAIL (새 함수가 없다)

- [ ] **Step 4: 구현한다**

- `bus.ts`: 듣는 함수는 장치 경로(`deviceAt`을 지난 뒤)에서만 부른다. RAM과 fetch 경로에는 검사도 넣지 않는다. 듣는 함수가 없을 때 장치 경로의 비용은 `undefined` 비교 하나다.
- `inspect.ts`: `peekMemory`는 버스를 거치지 않고 `machine.ram`과 `machine.framebuffer.pixels`에서 복사한다. 장치 읽기의 부작용(UART FIFO 소비 등)을 피하려는 것이다. 요청 구간 전체가 둘 중 한 곳 안에 있어야 한다.
- `snapshot.ts`: `describeSnapshot`은 기존 `parseSnapshot`을 재사용한다.

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @amulator/core test`
Expected: PASS(기존 테스트 포함)

- [ ] **Step 6: 바꾼 뒤 실행 속도를 잰다**

Run: `pnpm --filter @amulator/core bench`
Expected: hz가 Step 1 값의 ±10% 안이다. 벗어나면 커밋하지 않고 장치 경로를 다시 본다. 두 값을 보고에 적는다.

- [ ] **Step 7: 커밋한다**

```bash
git add packages/core/src/bus.ts packages/core/src/inspect.ts packages/core/src/snapshot.ts packages/core/test/bus.test.ts packages/core/test/inspect.test.ts packages/core/test/snapshot.test.ts packages/core/test/run.bench.ts packages/core/package.json
git commit -m "feat: CPU 상태·메모리 엿보기·장치 접근 기록·스냅샷 구간 함수 추가"
```

---

### Task 3: worker 관찰·제어 메시지

**Files:**
- Modify: `apps/web/src/messages.ts`
- Modify: `apps/web/src/worker/emulatorWorker.ts`
- Modify: `apps/web/src/worker/session.ts`
- Create: `apps/web/src/worker/traceBuffer.ts`
- Create: `apps/web/test/helpers/workerHarness.ts`
- Test: `apps/web/test/emulatorWorker.test.ts`, `apps/web/test/traceBuffer.test.ts`, `apps/web/test/session.test.ts`

**Interfaces:**
- Consumes: Task 2의 `inspectCpu`, `peekMemory`, `memoryRegions`, `summarizeElf`, `describeSnapshot`, `DeviceAccess`, `setDeviceAccessListener`, `CpuView`, `MemoryRegion`, `ElfSummary`, `SnapshotSection`. core의 `tapEvents`, `dragEvents`, `Point`, `TouchState`, `SnapshotMeta`, `AccessWidth`
- Produces:
  - `messages.ts`
    - `type Gesture = { kind: 'tap'; at: Point } | { kind: 'drag'; from: Point; to: Point; steps: number }`
    - `type RegisterTarget = number | 'pc'`
    - `type MachineView = { paused: boolean; cpu: CpuView; touch: TouchState }`
    - `MainToWorker`에 더하는 것:
      - `{ type: 'pause' }`, `{ type: 'resume' }`
      - `{ type: 'step'; count: number }`, `{ type: 'inspect' }`
      - `{ type: 'peek'; id: number; address: number; length: number }`
      - `{ type: 'setRegister'; target: RegisterTarget; value: number }`
      - `{ type: 'busWrite'; address: number; width: AccessWidth; value: number }`
      - `{ type: 'trace'; enabled: boolean }`, `{ type: 'gesture'; gesture: Gesture }`
      - `{ type: 'describeSnapshot'; id: number }`
    - `WorkerToMain`에서 바꾸고 더하는 것:
      - `booted`에 `elf: ElfSummary`와 `regions: MemoryRegion[]`, `error`에 `id?: number`
      - `{ type: 'state'; state: MachineView }`
      - `{ type: 'memory'; id: number; address: number; bytes: Uint8Array }`
      - `{ type: 'deviceAccesses'; accesses: DeviceAccess[]; dropped: number }`
      - `{ type: 'snapshotInfo'; id: number; meta: SnapshotMeta; sections: SnapshotSection[]; gzipBytes: number }`
  - `traceBuffer.ts`: `TRACE_CAPACITY = 256`, `createTraceBuffer(capacity: number): { push: (access: DeviceAccess) => void; drain: () => { accesses: DeviceAccess[]; dropped: number } }`
  - `session.ts`: `BootResult`에 `image: ElfImage`

- [ ] **Step 1: 테스트 하네스를 만든다**

`apps/web/test/helpers/workerHarness.ts`: `startWorker(): Promise<{ send(message: MainToWorker): void; messages: WorkerToMain[]; waitFor<T extends WorkerToMain['type']>(type: T, predicate?): Promise<Extract<WorkerToMain, { type: T }>>; dispose(): void }>`

- 모듈 상태: `vi.resetModules()` 뒤 `emulatorWorker.ts`를 동적 import한다.
- `self` 스텁: `postMessage`는 기록하고, 모듈이 건 `onmessage`를 `send`가 부른다.
- `fetch` 스텁: URL의 파일 이름(`paint.elf` 등)으로 `guest/baremetal/out/`에서 읽는다.
- `ImageData` 스텁: `data`가 `Uint8ClampedArray(w * h * 4)`인 클래스다.
- 가짜 canvas: `getContext('2d')`가 `putImageData`와 `canvas.convertToBlob`만 가진 객체를 돌려준다.
- 저장소: Node에는 IndexedDB가 없어 부팅 때 저장소 읽기 실패 경고가 나오고 새로 부팅한다. 테스트는 이 경고를 허용한다.
- `dispose`: `pause`를 보내 루프를 멈춘다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`traceBuffer.test.ts`:
- `traceBuffer는 최근 항목만 남기고 버린 수를 센다`: 용량 4에 10개를 넣고 drain하면 마지막 4개와 `dropped: 6`이다. 다음 drain은 `{ accesses: [], dropped: 0 }`이다.

`session.test.ts`:
- `boot는 실은 ELF 이미지를 돌려준다`: `image.entry === 0x8000_0000`

`emulatorWorker.test.ts`(모두 `start`로 paint를 부팅한 뒤):
- `booted에 ELF 요약과 메모리 맵이 있다`: `elf.entry === 0x8000_0000`, 세그먼트가 하나 이상이다. `regions`의 이름이 `ram, uart16550, clint, framebuffer, touch`다
- `멈추고 한 단계씩 실행하면 pc가 움직인다`: pause → state.paused === true. 이어서 step 1을 두 번 보내면 두 state의 pc가 다르다
- `실행 중의 step은 거부한다`: pause 없이 step 1 → `error` 메시지가 오고 `state`는 오지 않는다
- `x0은 쓰지 않고 다른 레지스터와 pc는 쓴다`: setRegister 0, 5 → `x[0] === 0`. setRegister 5, `0xdead_beef` → `x[5] === 0xdead_beef`. setRegister 'pc', `0x8000_0010` → `pc === 0x8000_0010`
- `peek은 RAM 바이트를 돌려주고 잘못된 구간은 id를 단 오류다`: id 1, `RAM_BASE`, 16 → `memory` 메시지의 바이트가 ELF 첫 세그먼트와 같다. id 2, 주소 0 → `error.id === 2`
- `UART에 쓰면 출력으로 나온다`: busWrite `UART_BASE`, 1, `0x41` → `uartOutput`에 `0x41`이 있다
- `없는 주소에 쓰면 오류를 알리고 계속 응답한다`: busWrite 0, 4, 1 → `error`. 이어서 inspect → `state`
- `기록을 켜고 탭하면 touch 장치 읽기가 기록된다`: trace true, gesture tap (160, 240) → `deviceAccesses`에 `device === 'touch'`이고 `kind === 'read'`인 항목이 있다. trace false 뒤에는 새 `deviceAccesses`가 오지 않는다
- `멈춘 채 reset하면 멈춘 채 진입 주소에 있다`: pause → reset → `booted` 뒤 inspect → `paused === true`, `pc === 0x8000_0000`
- `reset 뒤에도 기록이 이어진다`: trace true → reset → gesture tap → `deviceAccesses`가 온다
- `describeSnapshot은 구간과 압축 크기를 돌려준다`: id 3 → `snapshotInfo.id === 3`. 구간에 `ram`이 `RAM_SIZE` 바이트로 있고, `0 < gzipBytes < RAM_SIZE`다

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @amulator/web exec vitest run test/emulatorWorker.test.ts test/traceBuffer.test.ts test/session.test.ts`
Expected: FAIL

- [ ] **Step 4: 구현한다**

- `session.ts`: `startFresh`가 `loadElf`의 결과를 남기고 `boot`가 `image`로 돌려준다.
- `emulatorWorker.ts`의 메시지별 동작:
  - `pause`·`resume`: 기존 함수를 부른 뒤 `state`를 보낸다.
  - `step`:
    - 멈춘 상태가 아니면 `error`를 보낸다.
    - `count`는 1 이상 `STEP_MAX = 10_000` 이하의 정수다. 벗어나면 `error`를 보낸다.
    - 멈춘 상태면 터치를 먹이고 `machine.run(count)`를 돌린 뒤, `settleTouch`·`draw`·`flushOutput`·기록 비우기를 하고 `state`를 보낸다.
    - 예외가 나면 `error`를 보낸다.
  - `inspect`: `state`를 보낸다.
  - `peek`: `peekMemory`의 결과를 `memory`로 보낸다(버퍼를 transfer). 예외는 그 `id`를 단 `error`다.
  - `setRegister`:
    - `target`이 0이면 무시한다.
    - 1~31은 `x[target] = value >>> 0`이다.
    - `'pc'`는 `pc = value >>> 0`으로 두고 `idle`을 끈다.
    - 그 밖의 값은 `error`다. 끝나면 `state`를 보낸다.
  - `busWrite`: `machine.bus.write`를 부른다. BusFault는 `error`로 알린다. 끝나면 `draw`·`flushOutput`·기록 비우기를 하고 `state`를 보낸다.
  - `trace`:
    - 켜기: 현재 머신의 버스에 `traceBuffer.push`를 듣는 함수로 건다.
    - 끄기: 듣는 함수를 떼고 버퍼를 비운다(보내지 않는다).
    - `start`·`reset`·`snapshot.load`로 머신이 바뀔 때마다, 켜져 있으면 새 버스에 다시 건다.
  - 기록 비우기: `runSlice` 끝과 위 동작 끝에서 `drain()`이 비어 있지 않을 때만 `deviceAccesses`를 보낸다.
  - `gesture`: `tapEvents`·`dragEvents`로 바꿔 `touchFeeder.enqueue` 후 `wake()`. 기다리는 응답은 없다.
  - `describeSnapshot`: `enqueue`로 줄 세운다. 현재 머신을 `serializeSnapshot`하고 `describeSnapshot`과 `gzip` 크기를 `snapshotInfo`로 보낸다. 이미지 해시는 부팅 결과의 `imageHash`를 쓴다.
  - `booted`: `summarizeElf(image)`와 `memoryRegions(machine)`을 싣는다. `reset`의 `booted`에도 같은 값을 싣는다.

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @amulator/web test`
Expected: PASS(기존 테스트 포함)

- [ ] **Step 6: 커밋한다**

```bash
git add apps/web/src/messages.ts apps/web/src/worker/emulatorWorker.ts apps/web/src/worker/session.ts apps/web/src/worker/traceBuffer.ts apps/web/test/helpers/workerHarness.ts apps/web/test/emulatorWorker.test.ts apps/web/test/traceBuffer.test.ts apps/web/test/session.test.ts
git commit -m "feat: worker에 단계 실행·상태 읽기·메모리 엿보기·장치 접근 기록 메시지 추가"
```

---

### Task 4: 입력 기록 재생

**Files:**
- Create: `apps/web/src/replay.ts`
- Test: `apps/web/test/replay.test.ts`

**Interfaces:**
- Consumes: Task 3의 `Gesture`. core의 `pointSchema`, `DRAG_STEPS_MAX`(`@amulator/core/control/protocol`)
- Produces:
  - `gestureRecordingSchema`(zod): `{ version: 1, events: { atMs: number(≥ 0), gesture: Gesture }[] }`. `atMs`는 오름차순이어야 한다. drag의 `steps`는 1 이상 `DRAG_STEPS_MAX` 이하의 정수다
  - `type GestureRecording`
  - `parseRecording(json: unknown): GestureRecording` — 실패하면 zod 오류를 던진다
  - `playRecording(recording: GestureRecording, send: (gesture: Gesture) => void): () => void` — 취소 함수를 돌려준다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`replay.test.ts`:
- `올바른 기록을 읽는다`: tap 하나, drag 하나
- `시간이 거꾸로 가는 기록은 거부한다`
- `화면 밖 좌표와 너무 많은 steps는 거부한다`: `x: 400`, `steps: DRAG_STEPS_MAX + 1`
- `기록된 시각에 차례대로 보낸다`: `vi.useFakeTimers()`. `atMs` 0, 100, 250인 기록에서 99 ms 뒤에는 1개, 250 ms 뒤에는 3개가 순서대로 보내져 있다
- `취소하면 남은 것을 보내지 않는다`

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter @amulator/web exec vitest run test/replay.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현한다**

`gestureRecordingSchema`는 `satisfies z.ZodType<…>`로 `messages.ts`의 `Gesture`와 모양이 같음을 타입으로 묶는다. 같은 모양을 두 번 정의하지 않기 위해서다. 재생은 이벤트마다 `setTimeout`을 걸고 취소 때 모두 지운다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter @amulator/web exec vitest run test/replay.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋한다**

```bash
git add apps/web/src/replay.ts apps/web/test/replay.test.ts
git commit -m "feat: 탭·드래그 기록 형식과 재생 추가"
```

---

### Task 5: apps/web React 전환

**Files:**
- Modify: `apps/web/package.json`(react, react-dom, @vitejs/plugin-react, @types/react, @types/react-dom)
- Modify: `package.json`(루트 devDependencies에 eslint-plugin-react-hooks, conventions 프리셋의 범위 `^7.1.1`)
- Modify: `eslint.config.mjs`(`reactHooks.configs.flat.recommended` 추가, "react-hooks는 뺐다" 주석 수정)
- Modify: `CLAUDE.md`("boundaries와 react-hooks는 뺐다" → boundaries만 뺐다)
- Modify: `apps/web/vite.config.ts`(react 플러그인, `build.rollupOptions.input`에 `index.html`과 `emulator.html`)
- Modify: `apps/web/tsconfig.app.json`(`"jsx": "react-jsx"`)
- Modify: `apps/web/index.html`(사이트 진입점: `<div id="root">`와 `/src/site/main.tsx`)
- Create: `apps/web/emulator.html`(에뮬레이터 진입점: `<div id="root">`와 `/src/emulator/main.tsx`)
- Create: `apps/web/src/site/main.tsx`, `apps/web/src/site/SiteHome.tsx`
- Create: `apps/web/src/emulator/main.tsx`, `apps/web/src/emulator/EmulatorPage.tsx`, `apps/web/src/emulator/emulator.css`
- Create: `apps/web/src/emulator/mountEmulator.ts`, `apps/web/src/emulator/useEmulator.ts`, `apps/web/src/emulator/requests.ts`
- Delete: `apps/web/src/main.ts`
- Modify: `apps/web/src/terminal.ts`(`UartTerminal`에 `dispose`), `apps/web/src/bridge.ts`(`Bridge`에 `close`)
- Modify: `packages/mcp/src/bridgeServer.ts`(`pageUrl`을 `/emulator.html?program=…&token=…`으로)
- Modify: `packages/mcp/test/bridgeServer.test.ts:293-294`
- Modify: `packages/mcp/scripts/smokePlugin.mjs`(`<canvas` 검사 교체)
- Test: `apps/web/test/requests.test.ts`

**Interfaces:**
- Consumes: Task 3의 `MainToWorker`, `WorkerToMain`, `MachineView`, `Gesture`, `RegisterTarget`, `TRACE_CAPACITY`. Task 2의 `ElfSummary`, `MemoryRegion`, `DeviceAccess`, `SnapshotSection`, `SnapshotMeta`
- Produces:
  - `requests.ts`: `createRequestTable<T>(): { open: () => { id: number; promise: Promise<T> }; resolve: (id: number, value: T) => void; reject: (id: number, error: Error) => void; rejectAll: (error: Error) => void }`
  - `mountEmulator.ts`: `mountEmulator(slots: { screen: HTMLElement; terminal: HTMLElement }, options: { program: ProgramName; token: string | null; onMessage: (message: WorkerToMain) => void; onBridgeStatus: (text: string) => void }): EmulatorController`
  - `type EmulatorController`
    - `send: (message: MainToWorker) => void`
    - `peek: (address: number, length: number) => Promise<Uint8Array>`
    - `describeSnapshot: () => Promise<{ meta: SnapshotMeta; sections: SnapshotSection[]; gzipBytes: number }>`
    - `dispose: () => void`
  - `useEmulator.ts`: `useEmulator(options: { program: ProgramName; token: string | null }): { screenRef: RefObject<HTMLDivElement | null>; terminalRef: RefObject<HTMLDivElement | null>; status: string; elf?: ElfSummary; regions?: MemoryRegion[]; state?: MachineView; accesses: DeviceAccess[]; controller?: EmulatorController }`
    - `status`는 지금 `renderStatus`와 같은 문구(메모, 브리지 상태, MIPS)다.
    - `accesses`는 최근 `TRACE_CAPACITY`개만 남긴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`requests.test.ts`:
- `열린 요청을 id로 풀고 거부한다`: 두 개를 열어 하나는 resolve, 하나는 reject하면 각 promise가 그 결과로 끝난다
- `rejectAll은 남은 요청을 모두 거부하고 표를 비운다`: 이후 같은 id를 resolve해도 아무 일도 없다
- `id는 겹치지 않는다`

Run: `pnpm --filter @amulator/web exec vitest run test/requests.test.ts`
Expected: FAIL

- [ ] **Step 2: `createRequestTable`을 구현하고 테스트를 통과시킨다**

Run: `pnpm --filter @amulator/web exec vitest run test/requests.test.ts`
Expected: PASS

- [ ] **Step 3: 의존성과 설정을 바꾼다**

- 설치: Files 목록의 의존성을 `pnpm add`로 설치한다. React는 19 계열이다(DS의 peer가 `react >=19`다).
- 설정: Files 목록의 설정 파일을 바꾼다. Vite 8과 맞는 `@vitejs/plugin-react` 버전은 설치할 때 그 패키지 문서로 확인한다.

Run: `pnpm install && pnpm typecheck`
Expected: 통과(아직 tsx 파일이 없으므로 기존 상태 그대로)

- [ ] **Step 4: 에뮬레이터 페이지를 React로 옮긴다**

`main.ts`의 로직은 동작을 바꾸지 않고 `mountEmulator`로 옮긴다. 옮기는 것은 worker 생성, 터미널, 브리지, 포인터 처리, canvas 넘기기, 메시지 분기다. 바뀌는 점은 다음과 같다.
- canvas는 HTML에 두지 않는다. `mountEmulator`가 `slots.screen` 안에 `document.createElement('canvas')`로 만든다. `width` 320, `height` 480, `id="screen"`이다.
- `peek`·`describeSnapshot`은 `createRequestTable`로 요청과 응답을 잇는다. `memory`·`snapshotInfo`·`id`가 있는 `error`를 풀어 준다.
- `dispose` 순서: `worker.terminate()` → 포인터 리스너 해제와 `canvas.remove()` → `terminal.dispose()` → `bridge?.close()` → 남은 요청 `rejectAll`

`useEmulator`는 `useEffect` 하나에서 `mountEmulator`를 부르고 cleanup에서 `dispose`한다. StrictMode의 두 번째 마운트는 새 canvas와 새 worker로 시작한다.

`EmulatorPage`는 지금 화면과 같은 구조다.
- 툴바(`Save`, `Reset`, 상태 줄), 화면 자리, 터미널 자리가 있다.
- `index.html`의 `<style>`을 `emulator.css`로 옮기고 선택자는 그대로 쓴다.
- URL의 `program`(기본 `paint`)과 `token`을 읽는다. 알 수 없는 프로그램이면 지금과 같은 문구(`알 수 없는 프로그램: …`)를 보인다.

`emulator/main.tsx`는 `StrictMode`로 `EmulatorPage`를 렌더링한다.

- [ ] **Step 5: 사이트 진입점과 MCP 쪽을 맞춘다**

- `SiteHome`: 제목 "amulator", 문장 "에뮬레이터 학습 사이트를 준비하고 있다.", `emulator.html`로 가는 링크 "에뮬레이터 열기"만 둔다. 스타일은 넣지 않는다.
- `bridgeServer.ts`의 `pageUrl`을 `http://127.0.0.1:<port>/emulator.html?program=<p>&token=<t>`로 바꾸고 테스트 기대값도 맞춘다.
- `smokePlugin.mjs`의 `<canvas` 검사를 바꾼다. 받은 HTML에 `id="root"`가 있는지 보고, `<script type="module"`의 `src`를 같은 서버에서 GET해 200과 `content-type`에 `javascript`가 있는지 확인한다.

Run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`
Expected: 모두 통과

- [ ] **Step 6: 플러그인을 빌드하고 스모크를 돌린다**

Run: `pnpm build:plugin && pnpm smoke:plugin`
Expected: 마지막 줄이 `smoke ok`다

- [ ] **Step 7: 개발 서버에서 이중 마운트를 확인한다**

`pnpm --filter @amulator/web dev`를 따로 띄운다. 로그와 PID 파일을 나란히 두고, 확인이 끝나면 그 PID만 끈다. agent-browser로 `/emulator.html`을 연다.
- 콘솔에 InvalidStateError나 다른 오류가 없다.
- 그림판 화면에 drag하면 선이 한 번 그려진다(두 worker가 겹치면 상태 줄의 MIPS 갱신이나 그림이 이상해진다).
- `Save` 뒤 새로고침하면 그림이 살아난다.
- `Reset`하면 지워진다.
- 첫 화면 `/`에 링크가 보이고 누르면 에뮬레이터가 열린다.

- [ ] **Step 8: MCP 끝에서 끝까지 확인을 돌린다**

`packages/mcp/scripts/e2e.mjs`를 따로 띄운다. 이 스크립트가 출력한 URL을 agent-browser로 열고, 스크립트가 시키는 새로고침(RELOAD NOW)과 다른 탭으로 가리기(BACKGROUND NOW)를 수행한다.
Expected: 스크립트가 성공으로 끝나고 `out/e2e/`에 스크린샷이 남는다. 실패하면 이 태스크는 끝나지 않은 것이다.

- [ ] **Step 9: 커밋한다**

커밋 직전에 `git status`로 이 태스크가 만든 변경만 있는지 확인한다.

```bash
git add apps/web package.json pnpm-lock.yaml eslint.config.mjs CLAUDE.md packages/mcp/src/bridgeServer.ts packages/mcp/test/bridgeServer.test.ts packages/mcp/scripts/smokePlugin.mjs
git commit -m "refactor: apps/web을 React로 옮기고 에뮬레이터 페이지를 emulator.html로 나눈다"
```

본문에 설치한 react, react-dom, @vitejs/plugin-react, eslint-plugin-react-hooks의 정확한 버전을 적는다.
