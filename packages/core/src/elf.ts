import { RAM_BASE } from './memoryMap';

export type ElfSegment = { paddr: number; data: Uint8Array; memsz: number };
export type ElfImage = {
  entry: number;
  segments: ElfSegment[];
  symbols: ReadonlyMap<string, number>;
};

export class ElfError extends Error {
  override name = 'ElfError';
}

const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46] as const; // \x7fELF
const ELFCLASS32 = 1;
const ELFDATA2LSB = 1;
const EM_RISCV = 243;
const PT_LOAD = 1;
const SHT_SYMTAB = 2;
const SHT_STRTAB = 3;

const EI_CLASS = 4;
const EI_DATA = 5;
const EHDR_SIZE = 52;
const PHDR_SIZE = 32;
const SHDR_SIZE = 40;
const SYM_SIZE = 16;

// 필드 오프셋. 모두 리틀엔디언이다.
const EHDR = {
  machine: 18,
  entry: 24,
  phoff: 28,
  shoff: 32,
  phentsize: 42,
  phnum: 44,
  shentsize: 46,
  shnum: 48,
} as const;
const PHDR = { type: 0, offset: 4, paddr: 12, filesz: 16, memsz: 20 } as const;
const SHDR = { type: 4, offset: 16, size: 20, link: 24, entsize: 36 } as const;
const SYM = { name: 0, value: 4 } as const;

const checkRange = (fileSize: number, offset: number, length: number, what: string): void => {
  if (offset + length > fileSize) throw new ElfError(`${what}이(가) 파일 범위를 벗어난다`);
};

// 헤더 테이블의 각 항목이 시작하는 파일 오프셋을 돌려준다.
const tableOffsets = (
  fileSize: number,
  offset: number,
  count: number,
  entsize: number,
  minEntsize: number,
  what: string,
): number[] => {
  if (count === 0) return [];
  if (entsize < minEntsize) throw new ElfError(`${what} 항목 크기가 너무 작다`);
  checkRange(fileSize, offset, count * entsize, what);
  return Array.from({ length: count }, (_, index) => offset + index * entsize);
};

// shortcut: 심볼 이름을 Latin-1로 읽는다(TextDecoder가 core의 lib에 없다), ASCII가 아닌 이름이 필요해지면 UTF-8 디코더를 넣는다
const readString = (strtab: Uint8Array, offset: number): string => {
  const end = offset < strtab.length ? strtab.indexOf(0, offset) : -1;
  if (end === -1) throw new ElfError('문자열 테이블 항목이 범위를 벗어난다');
  return Array.from(strtab.subarray(offset, end), (code) => String.fromCharCode(code)).join('');
};

const readSymbols = (
  bytes: Uint8Array,
  view: DataView,
  sections: readonly number[],
): Map<string, number> => {
  const symbols = new Map<string, number>();
  const symtab = sections.find(
    (section) => view.getUint32(section + SHDR.type, true) === SHT_SYMTAB,
  );
  if (symtab === undefined) return symbols;

  const strtabHeader = sections[view.getUint32(symtab + SHDR.link, true)];
  if (strtabHeader === undefined || view.getUint32(strtabHeader + SHDR.type, true) !== SHT_STRTAB) {
    throw new ElfError('.symtab이 가리키는 문자열 테이블이 없다');
  }
  const strtabOffset = view.getUint32(strtabHeader + SHDR.offset, true);
  const strtabSize = view.getUint32(strtabHeader + SHDR.size, true);
  checkRange(bytes.length, strtabOffset, strtabSize, '.strtab');
  const strtab = bytes.subarray(strtabOffset, strtabOffset + strtabSize);

  const symtabSize = view.getUint32(symtab + SHDR.size, true);
  const entsize = view.getUint32(symtab + SHDR.entsize, true);
  const entries = tableOffsets(
    bytes.length,
    view.getUint32(symtab + SHDR.offset, true),
    entsize === 0 ? 0 : Math.floor(symtabSize / entsize),
    entsize,
    SYM_SIZE,
    '.symtab',
  );
  for (const entry of entries) {
    const nameOffset = view.getUint32(entry + SYM.name, true);
    if (nameOffset === 0) continue; // 이름 없는 심볼(널, 섹션)
    // 로컬 심볼이 먼저 오므로 같은 이름이면 글로벌이 이긴다.
    symbols.set(readString(strtab, nameOffset), view.getUint32(entry + SYM.value, true));
  }
  return symbols;
};

export const parseElf32 = (bytes: Uint8Array): ElfImage => {
  if (bytes.length < EHDR_SIZE) throw new ElfError('ELF 헤더보다 짧다');
  if (!ELF_MAGIC.every((byte, index) => bytes[index] === byte))
    throw new ElfError('ELF 매직이 아니다');
  if (bytes[EI_CLASS] !== ELFCLASS32) throw new ElfError('32비트 ELF가 아니다');
  if (bytes[EI_DATA] !== ELFDATA2LSB) throw new ElfError('리틀엔디언 ELF가 아니다');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(EHDR.machine, true) !== EM_RISCV) throw new ElfError('RISC-V ELF가 아니다');

  const programHeaders = tableOffsets(
    bytes.length,
    view.getUint32(EHDR.phoff, true),
    view.getUint16(EHDR.phnum, true),
    view.getUint16(EHDR.phentsize, true),
    PHDR_SIZE,
    '프로그램 헤더',
  );
  const segments: ElfSegment[] = [];
  for (const header of programHeaders) {
    if (view.getUint32(header + PHDR.type, true) !== PT_LOAD) continue;
    const offset = view.getUint32(header + PHDR.offset, true);
    const filesz = view.getUint32(header + PHDR.filesz, true);
    const memsz = view.getUint32(header + PHDR.memsz, true);
    if (filesz > memsz) throw new ElfError('세그먼트의 filesz가 memsz보다 크다');
    checkRange(bytes.length, offset, filesz, '세그먼트 데이터');
    segments.push({
      paddr: view.getUint32(header + PHDR.paddr, true),
      data: bytes.subarray(offset, offset + filesz),
      memsz,
    });
  }

  const sections = tableOffsets(
    bytes.length,
    view.getUint32(EHDR.shoff, true),
    view.getUint16(EHDR.shnum, true),
    view.getUint16(EHDR.shentsize, true),
    SHDR_SIZE,
    '섹션 헤더',
  );
  return {
    entry: view.getUint32(EHDR.entry, true),
    segments,
    symbols: readSymbols(bytes, view, sections),
  };
};

export const loadElfIntoRam = (ram: Uint8Array, image: ElfImage): void => {
  // 일부만 올라간 채로 실패하지 않도록 먼저 모두 검사한다.
  for (const { paddr, data, memsz } of image.segments) {
    if (paddr < RAM_BASE || paddr + memsz > RAM_BASE + ram.length) {
      throw new ElfError(`세그먼트 0x${paddr.toString(16)}가 RAM 밖이다`);
    }
    if (data.length > memsz) throw new ElfError('세그먼트 데이터가 memsz보다 크다');
  }
  for (const { paddr, data, memsz } of image.segments) {
    const offset = paddr - RAM_BASE;
    ram.set(data, offset);
    ram.fill(0, offset + data.length, offset + memsz);
  }
};
