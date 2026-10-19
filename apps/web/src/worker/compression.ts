// 스트림은 ArrayBuffer 기반 배열만 받는다. 보통은 복사 없이 같은 메모리를 가리킨다.
const toBufferSource = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : Uint8Array.from(bytes);

const run = async (
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> => {
  const writer = stream.writable.getWriter();
  // 쓰기와 읽기를 함께 기다려야 어느 쪽 오류도 놓치지 않는다.
  const [, result] = await Promise.all([
    writer.write(toBufferSource(bytes)).then(() => writer.close()),
    new Response(stream.readable).arrayBuffer(),
  ]);
  return new Uint8Array(result);
};

export const gzip = (bytes: Uint8Array): Promise<Uint8Array> =>
  run(bytes, new CompressionStream('gzip'));

export const gunzip = (bytes: Uint8Array): Promise<Uint8Array> =>
  run(bytes, new DecompressionStream('gzip'));
