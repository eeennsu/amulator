import { connectBridge } from './bridge';
import type { MainToWorker, WorkerToMain } from './messages';
import { toFramebufferPoint } from './pointer';
import { isProgramName, type ProgramName } from './programs';
import { createTerminal } from './terminal';

const DEFAULT_PROGRAM: ProgramName = 'paint';
const MEGA = 1_000_000;

const byId = <T extends HTMLElement>(id: string, type: new () => T): T => {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`#${id} 요소를 찾을 수 없다`);
  return element;
};

const canvas = byId('screen', HTMLCanvasElement);
const saveButton = byId('save', HTMLButtonElement);
const resetButton = byId('reset', HTMLButtonElement);
const statusLine = byId('status', HTMLSpanElement);

let note = '';
let bridgeNote = '';
let ips = 0;

const renderStatus = (): void => {
  const label = bridgeNote === '' ? note : `${note} · ${bridgeNote}`;
  statusLine.textContent = ips > 0 ? `${label} · ${(ips / MEGA).toFixed(1)} MIPS` : label;
};

const setNote = (text: string): void => {
  note = text;
  renderStatus();
};

const setBridgeNote = (text: string): void => {
  bridgeNote = text;
  renderStatus();
};

const run = (program: ProgramName, token: string | null): void => {
  const worker = new Worker(new URL('./worker/emulatorWorker.ts', import.meta.url), {
    type: 'module',
  });
  const send = (message: MainToWorker, transfer: Transferable[] = []): void =>
    worker.postMessage(message, transfer);

  const terminal = createTerminal(byId('terminal', HTMLDivElement), (bytes) =>
    send({ type: 'uartInput', bytes }),
  );

  // MCP 모드(URL에 token이 있을 때)에서만 로컬 서버와 잇는다.
  const bridge =
    token === null
      ? undefined
      : connectBridge(token, (request) => send({ type: 'bridge', request }), setBridgeNote);

  worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
    const message = event.data;
    switch (message.type) {
      case 'uartOutput':
        terminal.write(message.bytes);
        break;
      case 'booted':
        terminal.clear(); // 새로 부팅한 게스트는 처음부터 다시 출력한다
        setNote(message.warning ?? (message.restored ? '스냅샷에서 복원했다' : '새로 부팅했다'));
        break;
      case 'saved':
        setNote(`저장했다 (${message.bytes} B)`);
        break;
      case 'error':
        setNote(`오류: ${message.message}`);
        break;
      case 'status':
        ips = message.ips;
        renderStatus();
        break;
      case 'bridgeResponse':
        bridge?.respond(message.response);
        break;
      case 'bridgeScreenshot':
        bridge?.respondScreenshot(message.id, message.png);
        break;
    }
  };
  worker.onerror = (event) => setNote(`worker 오류: ${event.message}`);

  saveButton.addEventListener('click', () => send({ type: 'save' }));
  resetButton.addEventListener('click', () => send({ type: 'reset' }));

  // 눌린 상태에서만 움직임을 보낸다. 포인터 캡처가 canvas 밖에서 뗀 것도 잡아 준다.
  let pressed = false;
  let lastPoint = { x: 0, y: 0 };
  const pointOf = (event: PointerEvent): { x: number; y: number } =>
    toFramebufferPoint(event.clientX, event.clientY, canvas.getBoundingClientRect());
  const sendTouch = (point: { x: number; y: number }, down: boolean): void => {
    lastPoint = point;
    send({ type: 'touch', event: { ...point, down } });
  };

  canvas.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary) return;
    pressed = true;
    canvas.setPointerCapture(event.pointerId);
    sendTouch(pointOf(event), true);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (pressed && event.isPrimary) sendTouch(pointOf(event), true);
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!pressed || !event.isPrimary) return;
    pressed = false;
    sendTouch(pointOf(event), false);
  });
  // 취소된 포인터의 좌표는 믿을 수 없어서 마지막 점에서 뗀다.
  canvas.addEventListener('pointercancel', (event) => {
    if (!pressed || !event.isPrimary) return;
    pressed = false;
    sendTouch(lastPoint, false);
  });

  const offscreen = canvas.transferControlToOffscreen();
  send({ type: 'start', program, canvas: offscreen, token: token ?? undefined }, [offscreen]);
};

const query = new URLSearchParams(location.search);
const requested = query.get('program') ?? DEFAULT_PROGRAM;
if (isProgramName(requested)) run(requested, query.get('token'));
else setNote(`알 수 없는 프로그램: ${requested}`);
