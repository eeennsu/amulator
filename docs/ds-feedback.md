# DS 피드백

- 2026-11-08 · 목차·챕터 · 링크(`a`) 스타일이 Prose 안에만 있다. 목차 제목 링크와 "← 목차" 같은 내비 링크를 Prose로 감싸 빌려 썼다. 링크 컴포넌트나 링크 클래스가 있으면 좋겠다. Prose의 `a`에는 DS 컴포넌트가 쓰는 `focus-visible` 외곽선도 없다. · design-flow
- 2026-11-08 · 챕터 · Collapsible에 `disabled`가 없다. 접힌 ✓ 단계 카드를 Collapsible 대신 ghost Button으로 바꿔 비활성을 표현했다. · design-flow
- 2026-11-08 · 챕터 · Collapsible 트리거·패널의 `px-3`이 같은 카드의 문단보다 12px 들여써진다. 소비 쪽에서 `-mx-3`으로 당겨 맞췄다. · design-flow
- 2026-11-08 · 챕터 · 96px 넘는 높이 유틸리티가 없어 긴 Table(레지스터 39줄)을 스크롤 영역으로 가둘 수 없다. 표를 한 줄에 두 항목씩 놓아 높이를 줄이는 것으로 대신했다. · design-flow
- 2026-11-08 · 챕터 · 굵기 유틸리티가 없다. 토큰이 `--font-weight-*`를 비워 `font-semibold`·`font-bold` 클래스가 만들어지지 않는다(굵기는 `text-lg` 이상에 묶여 있다). 바뀐 값 강조를 `<strong>`의 기본 굵기(`bolder`)로 대신했다. · design-flow
- 2026-11-08 · 챕터 · 단계 진행 표시(Stepper)가 없다. 지난·지금·남은 단계를 `size-6 rounded-full` Box에 Text·Icon을 넣은 번호 원과 ghost Button으로 직접 그렸다. · design-flow
- 2026-11-08 · 챕터 · Prose가 한국어 줄바꿈(`word-break: keep-all`)을 기본으로 주지 않아 줄이 음절 중간에서 끊긴다. 소비 쪽에서 `break-keep wrap-break-word`를 걸었다. · impeccable critique
- 2026-11-08 · 챕터 · Collapsible 모양이 평문 줄 하나뿐이라 "더 읽기"와 확인 질문이 같은 모양이다. 구역 제목과 구분선으로 갈랐다. Button은 `label`이 곧 접근성 이름이라 "완료" 같은 상태 글을 숨겨 넣을 통로가 없어, sr-only 글을 버튼 밖 h2 안에 두었다. · impeccable critique
