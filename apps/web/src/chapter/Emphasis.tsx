type Props = {
  on: boolean;
  // 화면 낭독기가 강조된 이유를 읽는다. 예: 바뀜. 이어진 강조에서는 첫 칸에만 준다.
  hint?: string;
  children: string;
};

export const Emphasis = ({ on, hint, children }: Props) =>
  on ? (
    <span className='font-semibold text-fg-brand'>
      {children}
      {hint !== undefined && <span className='sr-only'>{`(${hint})`}</span>}
    </span>
  ) : (
    <>{children}</>
  );
