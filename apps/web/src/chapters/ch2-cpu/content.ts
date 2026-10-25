import type { MDXContent } from 'mdx/types';

import type { ChapterContent } from '../../chapter/types';
import Fetch from './1-fetch.mdx';
import Execute from './2-execute.mdx';
import Loop from './3-loop.mdx';
import Edit from './4-edit.mdx';
import Trap from './5-trap.mdx';
import Android from './android.mdx';
import { CH2_STEPS } from './steps';

// CH2_STEPS와 같은 순서다.
const BODIES: readonly MDXContent[] = [Fetch, Execute, Loop, Edit, Trap];

export const CH2_CONTENT: ChapterContent = {
  steps: CH2_STEPS.map((plan, index) => {
    const Body = BODIES[index];
    if (Body === undefined) throw new Error(`${index + 1}단계의 본문이 없다`);
    return { ...plan, Body };
  }),
  Android,
};
