/**
 * generate-config-ownership.test.ts: the generator carries the SDK's ownership
 * lists into the emitted module, renders the same data the same way every time,
 * and writes the artifact only when its content changes. The artifact itself is
 * regenerated at the version bump (scripts/release-prepare.ts), so nothing here
 * compares it with the checked-in file.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makeProjectTempDir } from './helpers/project-temp';
import { loadOwnershipSnapshot, renderTs, writeIfChanged } from './generate-config-ownership';

describe('generate-config-ownership', () => {
  test('every prefix and non-schema path in the snapshot lands in the emitted module', () => {
    const snapshot = {
      ...loadOwnershipSnapshot(),
      prefixes: ['alpha.', 'beta.'],
      nonSchemaPaths: ['gamma.secretRef'],
    };
    const out = renderTs(snapshot);
    expect(out).toContain('"alpha."');
    expect(out).toContain('"beta."');
    expect(out).toContain('"gamma.secretRef"');
  });

  test('two independent loads of the installed SDK render byte-identical output', () => {
    expect(renderTs(loadOwnershipSnapshot())).toBe(renderTs(loadOwnershipSnapshot()));
  });

  test('writeIfChanged writes new content and leaves identical content untouched', () => {
    const dir = makeProjectTempDir('webui-gen-ownership-');
    try {
      const path = join(dir, 'out', 'config-ownership.ts');
      expect(writeIfChanged(path, 'one')).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe('one');
      const mtime = statSync(path).mtimeMs;
      expect(writeIfChanged(path, 'one')).toBe(false);
      expect(statSync(path).mtimeMs).toBe(mtime);
      expect(writeIfChanged(path, 'two')).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe('two');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
