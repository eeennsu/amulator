import { Table, type TableColumn, type TableRow } from '@eeennsu/web';
import type { ReactNode } from 'react';

import { ABI_REGISTER_NAMES } from '@amulator/core/cpu/disassemble';
import { INSPECTED_CSRS, type CpuView } from '@amulator/core/inspect';

import { Emphasis } from './Emphasis';
import { formatHex } from './format';

// 한 줄에 레지스터 둘을 놓아 표 높이를 반으로 줄인다. 한 열로 두면 39줄이라 pc·CSR이 화면 밖으로 밀린다.
const COLUMNS: TableColumn[] = [
  { label: '이름' },
  { label: '값', align: 'end' },
  { label: '이름' },
  { label: '값', align: 'end' },
];
const PER_ROW = 2;

type Register = { key: string; name: string; value: number };

type Props = { cpu: CpuView; changed: ReadonlySet<string> };

export const RegisterTable = ({ cpu, changed }: Props) => {
  // 짝이 없는 마지막 칸은 비운다.
  const cells = (register: Register | undefined): ReactNode[] =>
    register === undefined
      ? ['', '']
      : [
          register.name,
          <Emphasis key={register.key} on={changed.has(register.key)} hint='바뀜'>
            {formatHex(register.value)}
          </Emphasis>,
        ];
  const pair = (left: Register | undefined, right: Register | undefined): TableRow => ({
    cells: [...cells(left), ...cells(right)],
  });

  // pc와 CSR은 차례로 둘씩, x 레지스터는 x0~x15 옆에 x16~x31을 놓는다.
  const control: Register[] = [
    { key: 'pc', name: 'pc', value: cpu.pc },
    ...INSPECTED_CSRS.map((name) => ({ key: name, name, value: cpu.csr[name] })),
  ];
  const x: Register[] = cpu.x.map((value, index) => ({
    key: `x${index}`,
    name: `x${index} ${ABI_REGISTER_NAMES[index] ?? ''}`,
    value,
  }));
  const half = x.length / PER_ROW;

  const rows = [
    ...Array.from({ length: Math.ceil(control.length / PER_ROW) }, (_, row) =>
      pair(control[row * PER_ROW], control[row * PER_ROW + 1]),
    ),
    ...x.slice(0, half).map((left, index) => pair(left, x[half + index])),
  ];

  return <Table label='레지스터' columns={COLUMNS} rows={rows} />;
};
