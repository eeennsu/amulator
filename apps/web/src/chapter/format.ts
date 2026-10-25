const HEX_RADIX = 16;
export const ADDRESS_HEX_WIDTH = 8;
export const BYTE_HEX_WIDTH = 2;

// 값은 부호 없는 수다. 레지스터·주소·CSR 모두 이 모양으로 보인다.
export const formatHex = (value: number, width = ADDRESS_HEX_WIDTH): string =>
  value.toString(HEX_RADIX).padStart(width, '0');
