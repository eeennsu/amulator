import { Badge, Card, Stack, Text } from '@eeennsu/web';

import { CHAPTERS, type ChapterEntry } from './chapters';

const ChapterItem = ({ chapter }: { chapter: ChapterEntry }) => {
  const heading = `${chapter.number}장 ${chapter.title}`;
  return (
    <Card className='p-4'>
      <Stack className='gap-2'>
        {chapter.status === 'soon' ? (
          <Text size='lg' tone='muted'>
            {heading}
          </Text>
        ) : (
          <a href={`/chapter.html?n=${chapter.number}`}>
            <Text size='lg'>{heading}</Text>
          </a>
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
  <Stack className='gap-6 p-6'>
    <Text heading='1' size='2xl'>
      amulator
    </Text>
    <Stack className='gap-4'>
      {CHAPTERS.map((chapter) => (
        <ChapterItem key={chapter.number} chapter={chapter} />
      ))}
    </Stack>
    <a href='/emulator.html'>에뮬레이터 열기</a>
  </Stack>
);
