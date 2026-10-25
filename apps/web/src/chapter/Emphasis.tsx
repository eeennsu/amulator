type Props = {
  on: boolean;
  // 화면 낭독기가 강조된 이유를 읽는다. 예: 바뀜
  hint: string;
  children: string;
};

export const Emphasis = ({ on, hint, children }: Props) =>
  on ? (
    <span className='font-semibold text-fg-brand'>
      {children}
      <span className='sr-only'>{`(${hint})`}</span>
    </span>
  ) : (
    <>{children}</>
  );
