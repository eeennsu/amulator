import type { RefObject } from 'react';

import { isProgramName, type ProgramName } from '../programs';

import './emulator.css';

import { useEmulator } from './useEmulator';

const DEFAULT_PROGRAM: ProgramName = 'paint';

type LayoutProps = {
  status: string;
  screenRef?: RefObject<HTMLDivElement | null>;
  terminalRef?: RefObject<HTMLDivElement | null>;
  onSave?: () => void;
  onReset?: () => void;
};

const Layout = ({ status, screenRef, terminalRef, onSave, onReset }: LayoutProps) => (
  <>
    <div className='toolbar'>
      <button id='save' type='button' onClick={onSave}>
        Save
      </button>
      <button id='reset' type='button' onClick={onReset}>
        Reset
      </button>
      <span id='status'>{status}</span>
    </div>
    <div ref={screenRef} />
    <div id='terminal' ref={terminalRef} />
  </>
);

type RunningProps = { program: ProgramName; token: string | null };

const RunningEmulator = ({ program, token }: RunningProps) => {
  const { screenRef, terminalRef, status, controller } = useEmulator({ program, token });
  return (
    <Layout
      status={status}
      screenRef={screenRef}
      terminalRef={terminalRef}
      onSave={() => controller?.send({ type: 'save' })}
      onReset={() => controller?.send({ type: 'reset' })}
    />
  );
};

export const EmulatorPage = () => {
  const query = new URLSearchParams(location.search);
  const requested = query.get('program') ?? DEFAULT_PROGRAM;
  if (!isProgramName(requested)) return <Layout status={`알 수 없는 프로그램: ${requested}`} />;
  return <RunningEmulator program={requested} token={query.get('token')} />;
};
