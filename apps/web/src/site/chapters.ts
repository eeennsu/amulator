import type { ChapterContent } from '../chapter/types';

export type ChapterEntry = {
  number: number;
  title: string;
  summary: string;
  // 검수(사실 대조·사용자 읽기)를 마쳐야 reviewed다. 그 전에는 목차에 "검수 중"으로 보인다.
  status: 'soon' | 'review' | 'reviewed';
  load?: () => Promise<ChapterContent>;
};

export const CHAPTERS: readonly ChapterEntry[] = [
  {
    number: 0,
    title: '에뮬레이터란',
    summary: '큰 그림. 진짜 안드로이드 에뮬레이터와 이 에뮬레이터의 전체 구조',
    status: 'soon',
  },
  {
    number: 1,
    title: '부팅',
    summary: '프로그램(ELF)을 메모리에 올리고 시작 주소에서 실행을 시작하기',
    status: 'soon',
  },
  {
    number: 2,
    title: 'CPU',
    summary: '명령어를 꺼내 해석하고 실행하기, 트랩',
    status: 'soon',
  },
  {
    number: 3,
    title: '장치',
    summary: '메모리 주소로 장치에 말 걸기(MMIO), UART와 타이머',
    status: 'soon',
  },
  {
    number: 4,
    title: '화면',
    summary: '프레임버퍼 메모리가 canvas가 되기까지',
    status: 'soon',
  },
  {
    number: 5,
    title: '입력',
    summary: '포인터 이벤트가 터치 레지스터에 들어가기까지',
    status: 'soon',
  },
  {
    number: 6,
    title: '스냅샷',
    summary: '상태를 저장하고 복원하기. 안드로이드의 퀵부트와 비교',
    status: 'soon',
  },
  {
    number: 7,
    title: '바깥에서 조작하기',
    summary: '안드로이드의 adb·콘솔과 이 에뮬레이터의 브리지·MCP 비교, Claude 조작 기록 재생',
    status: 'soon',
  },
];
