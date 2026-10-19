import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// 라우팅 폴더(app/)에는 라우트 파일만 두므로 Next·Expo Router 모두 이 기본값을 쓴다.
// page·layout·route로 좁히면 not-found·error·sitemap 같은 라우트 파일의 default export가 막힌다.
const ROUTE_FILES = ['app/**/*.{ts,tsx}'];
// 생성기 산출물(shadcn은 function 선언을 쓴다), 빌드 결과, 테스트·스토리북·Expo 웹 산출물.
// `eslint .`가 이런 폴더까지 린트하면 커버리지를 한 번 돌린 뒤 `pnpm lint`가 실패한다.
// 새로 더한 것은 루트 기준이라 src 안의 같은 이름 폴더는 린트한다.
// dist·build는 android/app/build 같은 하위 산출물까지 빼되, src 안의 같은 이름 폴더(features/build 등)는 되살린다.
// plugin/server·plugin/web은 빌드로 만든 플러그인 번들이고, third_party는 남의 코드다.
const GENERATED = [
  'src/shared/shadcn-ui/**',
  '**/dist/**',
  '**/build/**',
  '!src/**/dist/**',
  '!src/**/build/**',
  '**/.next/**',
  '**/.expo/**',
  'coverage/**',
  'storybook-static/**',
  'out/**',
  'web-build/**',
  'plugin/server/**',
  'plugin/web/**',
  'third_party/**',
];

// no-restricted-syntax는 override에서 옵션을 주면 배열이 통째로 바뀐다. 그래서 selector를 묶음별로 두고
// override마다 풀 묶음만 뺀 배열로 다시 건다(restrict). 한 파일에 override가 둘 겹치면 마지막 것만 이기므로
// 겹치는 조합은 아래에서 따로 건다.
const SYNTAX = {
  functionExpression: [
    {
      selector: 'VariableDeclarator > FunctionExpression',
      message: '함수 선언 금지: `const f = function`이 아니라 화살표 함수를 쓴다.',
    },
    {
      selector: 'ExportDefaultDeclaration > FunctionDeclaration',
      message: '함수 선언 금지: `export default function`이 아니라 화살표 함수를 쓴다.',
    },
  ],
  defaultExport: [
    {
      selector: 'ExportDefaultDeclaration',
      message:
        'default export 금지: named export를 쓴다. 라우트 파일, *.config.*, *.d.ts, *.stories.*만 예외다.',
    },
    {
      selector: "ExportSpecifier[exported.name='default']",
      message:
        'default export 금지: named export를 쓴다. 라우트 파일, *.config.*, *.d.ts, *.stories.*만 예외다.',
    },
  ],
  enum: [
    {
      selector: 'TSEnumDeclaration',
      message: 'enum 금지: `as const` 객체에서 유니온을 뽑는다.',
    },
  ],
  asUnknownAs: [
    {
      // `as never as`도 같은 우회다. `as any as`는 no-explicit-any가 잡는다.
      selector:
        "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type=/^TS(Unknown|Never)Keyword$/]",
      message: '`as unknown as`·`as never as` 금지: 타입을 맞추거나 경계에서 zod로 파싱한다.',
    },
  ],
  env: [
    {
      selector: "MemberExpression[object.name='process'][property.name='env']",
      message: 'process.env 직접 접근 금지: shared/config의 env 모듈에서만 읽는다.',
    },
    {
      selector: "MemberExpression[object.name='process'][computed=true][property.value='env']",
      message: "process['env'] 직접 접근 금지: shared/config의 env 모듈에서만 읽는다.",
    },
    {
      selector:
        "VariableDeclarator[init.name='process'] > ObjectPattern > Property[key.name='env']",
      message: 'process에서 env 구조 분해 금지: shared/config의 env 모듈에서만 읽는다.',
    },
    {
      selector: "MemberExpression[object.type='MetaProperty'][property.name='env']",
      message: 'import.meta.env 직접 접근 금지: shared/config의 env 모듈에서만 읽는다.',
    },
  ],
};

const restrict = (...lifted) => [
  'error',
  ...Object.entries(SYNTAX)
    .filter(([group]) => !lifted.includes(group))
    .flatMap(([, selectors]) => selectors),
];

// 설정 파일 안에 두는 인라인 규칙: `TODO(태그):` 형식이 아닌 것을 잡는다.
// no-warning-comments는 `TODO(verify):`까지 잡아서 쓰지 못한다.
const local = {
  rules: {
    'todo-format': {
      meta: { type: 'problem', schema: [] },
      create: (context) => ({
        Program: () => {
          for (const comment of context.sourceCode.getAllComments()) {
            // `TODO.md` 같은 파일 이름은 표식이 아니다
            if (/\bTODO\b(?!\.\w|\([^)\s]+\):)/.test(comment.value)) {
              context.report({ loc: comment.loc, message: 'TODO는 `TODO(태그):` 형식으로 쓴다.' });
            }
          }
        },
      }),
    },
  },
};

// 모노레포라 FSD 경계(boundaries)와 react-hooks는 뺐다.
export default defineConfig(
  { ignores: GENERATED },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { local },
    rules: {
      'func-style': ['error', 'expression'],
      'prefer-arrow-callback': 'error',
      'no-restricted-syntax': restrict(),
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'local/todo-format': 'error',
    },
  },
  // override: 파일 범위별로 푸는 것
  { files: ROUTE_FILES, rules: { 'no-restricted-syntax': restrict('defaultExport') } },
  { files: ['**/*.stories.*'], rules: { 'no-restricted-syntax': restrict('defaultExport') } },
  {
    files: ['**/*.d.ts'],
    rules: {
      'no-restricted-syntax': restrict('defaultExport'),
      '@typescript-eslint/consistent-type-definitions': 'off',
    },
  },
  { files: ['src/shared/config/**'], rules: { 'no-restricted-syntax': restrict('env') } },
  // 겹치는 조합: 위의 shared/config(env만 품)가 d.ts·stories의 default export 허용을 되돌리지 않게 한다
  {
    files: [
      ['src/shared/config/**', '**/*.d.ts'],
      ['src/shared/config/**', '**/*.stories.*'],
    ],
    rules: { 'no-restricted-syntax': restrict('defaultExport', 'env') },
  },
  { files: ['**/*.config.*'], rules: { 'no-restricted-syntax': restrict('defaultExport', 'env') } },
  // 설정·스크립트 파일은 tsconfig에 없어서 projectService가 파싱 에러를 낸다
  {
    files: ['**/*.{js,cjs,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  // 패키지 안의 설정 파일(vitest.config.ts)은 가장 가까운 tsconfig.json(src만 담당)에 안 들어 있어서
  // projectService가 못 찾는다. 설정 파일이라 타입 검사 린트는 끈다.
  { files: ['**/*.config.ts'], extends: [tseslint.configs.disableTypeChecked] },
  // .jsx는 기본 files(js·cjs·mjs)에도 typescript-eslint(ts 계열)에도 없어 아무 설정 없이 무시된다.
  // allowJs가 없으면 tsconfig에도 없으므로 타입 검사는 끈다.
  { files: ['**/*.jsx'], extends: [tseslint.configs.disableTypeChecked] },
  // metro.config.js·tailwind.config.js 같은 CommonJS 설정은 require()로 프리셋을 읽는다
  { files: ['**/*.{js,cjs}'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  prettier,
);
