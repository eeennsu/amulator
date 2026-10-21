# amulator

브라우저에서 도는 RISC-V 에뮬레이터를 TypeScript로 만든다. pnpm 워크스페이스(`packages/*`, `apps/*`)다.

- 코드 컨벤션은 conventions 스킬을 따른다. 모노레포라 프리셋에서 boundaries(FSD 경계)는 뺐다.
- 설계는 `docs/superpowers/specs/2026-10-19-amulator-design.md`, 구현 계획은 `docs/superpowers/plans/`에 있다.
- `docs/learn/`은 사용자가 쓰는 학습 노트다. 에이전트는 만들거나 고치지 않는다.
- `packages/core/src`는 순수 ES2023 코드만 쓴다. tsconfig(`lib: ["ES2023"]`, `types: []`)가 DOM과 Node API를 막고, 테스트 코드만 Node API를 쓴다.
- 보조 스크립트는 node `.mjs`로 쓴다. 윈도우와 맥에서 같은 명령으로 돈다.
