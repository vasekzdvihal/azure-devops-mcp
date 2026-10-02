import type { GitRepository } from './types.js';

/**
 * Finds a repository by name, case-insensitively — ADO repository names are case-insensitive,
 * and tool callers (LLMs) rarely match the exact casing. Returns undefined when nothing matches.
 */
export function findRepositoryByName(repos: readonly GitRepository[], name: string): GitRepository | undefined {
  const wanted = name.toLowerCase();
  return repos.find(candidate => candidate.name?.toLowerCase() === wanted);
}
