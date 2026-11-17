// Guards drift between Prisma enums and packages/shared/src/enums.ts (SRS Table 31, FR-5.17).
import { readFileSync } from 'node:fs';
import { ENUMS } from '@athleteverse/shared';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

function prismaEnums(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of schema.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)) {
    out[m[1]!] = m[2]!
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('@@') && !l.startsWith('//'));
  }
  return out;
}

describe('Prisma enums match the shared enums', () => {
  const fromSchema = prismaEnums();

  it('define the same set of enum names', () => {
    expect(Object.keys(fromSchema).sort()).toEqual(Object.keys(ENUMS).sort());
  });

  for (const [name, values] of Object.entries(ENUMS)) {
    it(`${name} has identical values in the same order`, () => {
      expect(fromSchema[name]).toEqual([...values]);
    });
  }
});
