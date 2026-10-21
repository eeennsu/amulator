import {
  parseBridgeRequest,
  type BridgeRequest,
  type BridgeResponse,
} from '@amulator/core/control/protocol';
import { FB_HEIGHT, FB_WIDTH } from '@amulator/core/memoryMap';

export type Bridge = {
  respond: (response: BridgeResponse) => void;
  respondScreenshot: (id: number, png: ArrayBuffer) => void;
  close: () => void;
};

// String.fromCharCode의 인자 수 한도를 넘지 않도록 나눠서 변환한다.
const BASE64_CHUNK = 0x8000;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK));
  }
  return btoa(binary);
};

// 로컬 서버와 WebSocket으로 이어서 요청을 검증한 뒤 worker로 넘긴다. 끊겨도 다시 잇지 않는다.
export const connectBridge = (
  token: string,
  onRequest: (request: BridgeRequest) => void,
  onStatus: (text: string) => void,
): Bridge => {
  const socket = new WebSocket(`ws://${location.host}/bridge?token=${encodeURIComponent(token)}`);
  onStatus('브리지 연결 중');
  socket.addEventListener('open', () => onStatus('브리지 연결됨'));
  socket.addEventListener('close', () => onStatus('브리지 끊김'));

  const respond = (response: BridgeResponse): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(response));
  };

  socket.addEventListener('message', (event: MessageEvent<unknown>) => {
    // 텍스트 프레임만 받는다. 그 밖의 프레임은 빈 문자열로 파싱해 거부한다.
    const parsed = parseBridgeRequest(typeof event.data === 'string' ? event.data : '');
    if ('request' in parsed) onRequest(parsed.request);
    else respond(parsed.response);
  });

  return {
    respond,
    respondScreenshot: (id, png) =>
      respond({
        jsonrpc: '2.0',
        id,
        result: { pngBase64: toBase64(new Uint8Array(png)), width: FB_WIDTH, height: FB_HEIGHT },
      }),
    close: () => socket.close(),
  };
};
