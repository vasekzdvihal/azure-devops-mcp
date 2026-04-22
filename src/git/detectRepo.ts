import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseRemoteUrl, type ParsedRemote } from "./parseRemoteUrl.js";

const execFileAsync = promisify(execFile);

/**
 * Reads the current working directory's git remote.origin.url and parses
 * it as an ADO URL. Returns null when:
 *  - cwd is not inside a git repo
 *  - the repo has no `origin` remote
 *  - the origin URL is not an ADO URL (e.g. github.com)
 *  - git is not installed
 *
 * Used by the pull-request domain to auto-resolve `{project, repo}` so
 * tools "just work" when called from a checkout.
 */
export async function detectRepo(cwd: string = process.cwd()): Promise<ParsedRemote | null> {
  let url: string;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd, encoding: "utf8" },
    );
    url = stdout.trim();
  } catch {
    return null;
  }
  return parseRemoteUrl(url);
}
