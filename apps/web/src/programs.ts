import clockUrl from '../../../guest/baremetal/out/clock.elf?url';
import helloUrl from '../../../guest/baremetal/out/hello.elf?url';
import paintUrl from '../../../guest/baremetal/out/paint.elf?url';

export const PROGRAMS = { hello: helloUrl, clock: clockUrl, paint: paintUrl } as const;

export type ProgramName = keyof typeof PROGRAMS;

export const isProgramName = (name: string): name is ProgramName => Object.hasOwn(PROGRAMS, name);
