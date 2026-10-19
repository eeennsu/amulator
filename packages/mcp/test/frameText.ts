import type { RawData } from 'ws';

// ws hands text frames over as Buffers (its default binaryType).
export const frameText = (data: RawData): string =>
  Buffer.isBuffer(data) ? data.toString('utf8') : '';
