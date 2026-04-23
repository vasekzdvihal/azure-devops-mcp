// src/domains/pullRequests/repoResolution.ts
import { detectRepo } from "../../git/detectRepo.js";
import type { ParsedRemote } from "../../git/parseRemoteUrl.js";

export class RepoContextError extends Error {
  constructor() {
    super(
      "Could not resolve project + repository. Either pass them explicitly " +
        "or run from inside an Azure DevOps git checkout (with `origin` set).",
    );
    this.name = "RepoContextError";
  }
}

export type RepoResolver = (cwd?: string) => Promise<ParsedRemote | null>;

/**
 * Resolves project + repository from explicit args, falling back to the
 * cwd-based git remote detector. Used by both the read and write PR services.
 *
 * Pure function. Does not throw on its own — only RepoContextError when both
 * sides come up empty.
 */
export async function resolveRepo(
  args: { project?: string; repository?: string },
  resolver: RepoResolver = detectRepo,
): Promise<{ project: string; repository: string }> {
  if (args.project && args.repository) {
    return { project: args.project, repository: args.repository };
  }
  const detected = await resolver();
  const project = args.project ?? detected?.project;
  const repository = args.repository ?? detected?.repo;
  if (!project || !repository) throw new RepoContextError();
  return { project, repository };
}
