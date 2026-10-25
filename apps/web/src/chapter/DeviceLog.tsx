import { Table, Text, type TableColumn } from '@eeennsu/web';

import type { DeviceAccess } from '@amulator/core/bus';

import { BYTE_HEX_WIDTH, formatHex } from './format';

const RECENT_COUNT = 32;
const COLUMNS: TableColumn[] = [
  { label: '장치' },
  { label: '읽기·쓰기' },
  { label: '주소' },
  { label: '폭' },
  { label: '값', align: 'end' },
];
const KIND_LABELS = { read: '읽기', write: '쓰기' } as const;

type Props = { accesses: readonly DeviceAccess[] };

export const DeviceLog = ({ accesses }: Props) => {
  if (accesses.length === 0) return <Text tone='muted'>아직 장치 접근이 없다</Text>;

  const rows = accesses.slice(-RECENT_COUNT).map(({ device, kind, address, width, value }) => ({
    cells: [
      device,
      KIND_LABELS[kind],
      formatHex(address),
      `${width}바이트`,
      formatHex(value, width * BYTE_HEX_WIDTH),
    ],
  }));

  return <Table label='장치 기록' columns={COLUMNS} rows={rows} />;
};
