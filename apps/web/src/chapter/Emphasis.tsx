type Props = {
  on: boolean;
  // 화면 낭독기가 강조된 이유를 읽는다. 예: 바뀜. 이어진 강조에서는 첫 칸에만 준다.
  hint?: string;
  children: string;
};

// DS 토큰이 font-weight 스케일을 비워 font-semibold가 생성되지 않는다. strong의 기본 굵기(bolder)로 굵게 한다.
export const Emphasis = ({ on, hint, children }: Props) =>
  on ? (
    <strong className='text-fg-brand'>
      {children}
      {hint !== undefined && <span className='sr-only'>{`(${hint})`}</span>}
    </strong>
  ) : (
    <>{children}</>
  );
