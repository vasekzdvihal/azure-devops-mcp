import type { GitRepository } from '../../../src/ado/types.js';
import { describe, expect, it } from 'vitest';
import { findRepositoryByName } from '../../../src/ado/repositories.js';

const REPOS: GitRepository[] = [{ id: 'r1', name: 'NewtonLens' }, { id: 'r2' }, { id: 'r3', name: 'Api' }];

describe('findRepositoryByName', () => {
  it('matches case-insensitively', () => {
    expect(findRepositoryByName(REPOS, 'newtonlens')?.id).toBe('r1');
    expect(findRepositoryByName(REPOS, 'API')?.id).toBe('r3');
  });

  it('returns undefined when nothing matches, skipping unnamed repositories', () => {
    expect(findRepositoryByName(REPOS, 'nope')).toBeUndefined();
  });
});
