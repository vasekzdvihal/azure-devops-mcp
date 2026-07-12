import { describe, expect, it } from 'vitest';
import { shapeDiff } from '../../../../src/domains/pullRequests/diffShaper.js';

describe('shapeDiff', () => {
  it('produces a unified diff for a modified file', () => {
    const out = shapeDiff({
      path: 'src/foo.ts',
      base: 'line one\nline two\nline three\n',
      target: 'line one\nline TWO\nline three\n',
    });
    expect(out).toMatch(/^Index: src\/foo\.ts/m);
    expect(out).toMatch(/-line two/);
    expect(out).toMatch(/\+line TWO/);
  });

  it('returns an \'added\' marker when base is null', () => {
    const out = shapeDiff({ path: 'new.ts', base: null, target: 'hello\n' });
    expect(out).toMatch(/file added/i);
    expect(out).toMatch(/\+hello/);
  });

  it('returns a \'deleted\' marker when target is null', () => {
    const out = shapeDiff({ path: 'gone.ts', base: 'bye\n', target: null });
    expect(out).toMatch(/file deleted/i);
    expect(out).toMatch(/-bye/);
  });

  it('returns a no-changes marker when base and target are identical', () => {
    const out = shapeDiff({ path: 'same.ts', base: 'x\n', target: 'x\n' });
    expect(out).toMatch(/no textual changes/i);
  });

  it('returns a binary marker when content has null bytes', () => {
    const out = shapeDiff({
      path: 'img.png',
      // \u0000 is the TS escape for a NUL byte. At runtime these strings
      // contain three printable chars + a NUL + three printable chars.
      base: 'abc\u0000def',
      target: 'abc\u0000xyz',
    });
    expect(out).toMatch(/binary file/i);
    expect(out).not.toMatch(/^[+-]/m);
  });

  it('truncates large diffs and adds a truncation marker', () => {
    const baseLines = Array.from({ length: 2000 }, (_, i) => `base ${i}`).join('\n');
    const targetLines = Array.from({ length: 2000 }, (_, i) => `target ${i}`).join('\n');
    const out = shapeDiff({ path: 'big.ts', base: baseLines, target: targetLines, maxLines: 50 });
    const lineCount = out.split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(55); // 50 + a few marker lines
    expect(out).toMatch(/diff truncated/i);
  });

  it('handles both null (file untracked at both versions) as no-changes', () => {
    const out = shapeDiff({ path: 'phantom.ts', base: null, target: null });
    expect(out).toMatch(/no textual changes/i);
  });
});
