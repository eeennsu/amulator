import { Stack, Text } from '@eeennsu/web';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import '../site/site.css';

import { CHAPTERS } from '../site/chapters';
import { ChapterPage } from './ChapterPage';
import type { ChapterContent } from './types';

type Loaded = { content: ChapterContent } | { failure: string };

// load가 있는 챕터만 글과 에뮬레이터를 불러온다.
const LoadedChapter = ({ load }: { load: () => Promise<ChapterContent> }) => {
  const [loaded, setLoaded] = useState<Loaded>();

  useEffect(() => {
    let cancelled = false;
    void load().then(
      (content) => {
        if (!cancelled) setLoaded({ content });
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoaded({ failure: error instanceof Error ? error.message : '알 수 없는 오류가 났다' });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (loaded === undefined) return <Text tone='muted'>불러오는 중</Text>;
  if ('failure' in loaded) {
    return (
      <Text tone='danger'>{`챕터를 불러오지 못했다: ${loaded.failure}. 새로 고쳐 다시 연다.`}</Text>
    );
  }
  return <ChapterPage content={loaded.content} />;
};

const ChapterRoute = () => {
  const n = new URLSearchParams(window.location.search).get('n');
  const chapter = CHAPTERS.find((entry) => String(entry.number) === n);

  return (
    <Stack className='gap-4 p-4'>
      <Text heading='1' size='xl'>
        {chapter === undefined ? '없는 챕터다' : `${chapter.number}장 ${chapter.title}`}
      </Text>
      {chapter !== undefined &&
        (chapter.load === undefined ? <Text>준비 중</Text> : <LoadedChapter load={chapter.load} />)}
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
