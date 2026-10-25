import { Stack, Text } from '@eeennsu/web';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../site/site.css';

import { CHAPTERS } from '../site/chapters';

// 챕터 화면 자체는 Task 6이 이 파일에 만든다. 지금은 번호 확인과 안내만 한다.
const ChapterRoute = () => {
  const n = new URLSearchParams(window.location.search).get('n');
  const chapter = CHAPTERS.find((entry) => String(entry.number) === n);

  return (
    <Stack className='gap-4 p-6'>
      <Text heading='1' size='xl'>
        {chapter === undefined ? '없는 챕터다' : `${chapter.number}장 ${chapter.title}`}
      </Text>
      {chapter !== undefined && chapter.load === undefined && <Text>준비 중</Text>}
      <a href='/'>목차로 돌아가기</a>
    </Stack>
  );
};

const root = document.getElementById('root');
if (root === null) throw new Error('#root 요소를 찾을 수 없다');

createRoot(root).render(
  <StrictMode>
    <ChapterRoute />
  </StrictMode>,
);
