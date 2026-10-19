// Tailwind 플러그인은 여기에 없다. setup 6단계가 plugins 맨 끝에 더한다.
/** @type {import('prettier').Config} */
export default {
  semi: true,
  singleQuote: true,
  jsxSingleQuote: true,
  tabWidth: 2,
  printWidth: 100,
  trailingComma: 'all',
  arrowParens: 'always',
  quoteProps: 'consistent',
  plugins: ['@ianvs/prettier-plugin-sort-imports'],
  // 외부 패키지(Node 내장 포함) → @amulator 워크스페이스 패키지 → 상대경로
  importOrder: ['<BUILTIN_MODULES>', '<THIRD_PARTY_MODULES>', '', '^@amulator/', '', '^[./]'],
  importOrderTypeScriptVersion: '5.0.0',
};
