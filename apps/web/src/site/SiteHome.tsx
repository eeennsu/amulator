import { Badge, Card, Prose, Stack, Text } from '@eeennsu/web';

import { CHAPTERS, type ChapterEntry } from './chapters';

// DS에 링크 컴포넌트가 없어 링크는 Prose의 a 스타일을 빌린다. 제목 크기는 Prose의 h2(xl)보다 작게 lg로 둔다.
// 링크는 상대경로다. Pages 하위 경로에서도 깨지지 않는다.
const ChapterItem = ({ chapter }: { chapter: ChapterEntry }) => {
  const heading = `${chapter.number}장 ${chapter.title}`;
  return (
    <Card className='p-4'>
      <Stack className='gap-2'>
        {chapter.status === 'soon' ? (
          <Text heading='2' size='lg' tone='muted'>
            {heading}
          </Text>
        ) : (
          <Prose>
            <h2 className='text-lg'>
              <a href={`chapter.html?n=${chapter.number}`}>{heading}</a>
            </h2>
          </Prose>
        )}
        <Text size='sm'>{chapter.summary}</Text>
        {chapter.status === 'soon' && (
          <Text size='sm' tone='muted'>
            준비 중
          </Text>
        )}
        {chapter.status === 'review' && <Badge variant='secondary'>검수 중</Badge>}
      </Stack>
    </Card>
  );
};

export const SiteHome = () => (
  <Stack className='mx-auto max-w-3xl gap-6 p-4 lg:p-8'>
    <Text heading='1' size='2xl'>
      amulator
    </Text>
    <Stack className='gap-4'>
      {CHAPTERS.map((chapter) => (
        <ChapterItem key={chapter.number} chapter={chapter} />
      ))}
    </Stack>
    <Prose>
      <a href='emulator.html'>에뮬레이터 열기</a>
    </Prose>
  </Stack>
);
