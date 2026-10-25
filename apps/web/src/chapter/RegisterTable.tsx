import { Table, type TableColumn, type TableRow } from '@eeennsu/web';

import { ABI_REGISTER_NAMES } from '@amulator/core/cpu/disassemble';
import { INSPECTED_CSRS, type CpuView } from '@amulator/core/inspect';

import { Emphasis } from './Emphasis';
import { formatHex } from './format';

const COLUMNS: TableColumn[] = [{ label: '이름' }, { label: '값', align: 'end' }];

type Props = { cpu: CpuView; changed: ReadonlySet<string> };

export const RegisterTable = ({ cpu, changed }: Props) => {
  const row = (key: string, name: string, value: number): TableRow => ({
    cells: [
      name,
      <Emphasis key={key} on={changed.has(key)} hint='바뀜'>
        {formatHex(value)}
      </Emphasis>,
    ],
  });

  const rows = [
    row('pc', 'pc', cpu.pc),
    ...cpu.x.map((value, index) =>
      row(`x${index}`, `x${index} ${ABI_REGISTER_NAMES[index] ?? ''}`, value),
    ),
    ...INSPECTED_CSRS.map((name) => row(name, name, cpu.csr[name])),
  ];

  return <Table label='레지스터' columns={COLUMNS} rows={rows} />;
};
