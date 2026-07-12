import { createPatch } from 'diff';

export interface ShapeDiffArgs {
  path: string;
  base: string | null; // null when file didn't exist at base (added)
  target: string | null; // null when file no longer exists (deleted)
  maxLines?: number; // default 1000
}

const DEFAULT_MAX_LINES = 1000;
const BINARY_SNIFF_CHARS = 8192;

function diffWithoutContent(path: string, base: string | null, target: string | null): string | null {
  if (base === null && target === null) {
    return `Index: ${path}\n(no textual changes — file did not exist at either side)`;
  }
  if (isBinary(base) || isBinary(target)) {
    return `Index: ${path}\n(binary file — diff suppressed)`;
  }
  if (base === target) {
    return `Index: ${path}\n(no textual changes)`;
  }
  return null;
}

function addedOrDeletedMarker(base: string | null, target: string | null): string {
  if (base === null) {
    return `(file added)\n`;
  }
  if (target === null) {
    return `(file deleted)\n`;
  }
  return '';
}

/**
 * Produces a single file's unified diff as a string, with truncation,
 * binary-file detection, and clear markers for added/deleted/unchanged cases.
 *
 * Pure function. No I/O. Used by PullRequestsReadService.getDiff.
 */
export function shapeDiff(args: ShapeDiffArgs): string {
  const max = args.maxLines ?? DEFAULT_MAX_LINES;
  const base = args.base;
  const target = args.target;

  const shortCircuit = diffWithoutContent(args.path, base, target);
  if (shortCircuit !== null) {
    return shortCircuit;
  }

  // Synthesize a diff. createPatch wants strings (not null); represent missing
  // sides as empty strings and prepend a marker for clarity.
  const baseStr = base ?? '';
  const targetStr = target ?? '';
  const patch = createPatch(args.path, baseStr, targetStr, '', '');

  const prefix = addedOrDeletedMarker(base, target);

  const full = prefix + patch;
  const lines = full.split('\n');
  if (lines.length <= max) {
    return full;
  }

  const truncated = lines.slice(0, max).join('\n');
  const omitted = lines.length - max;
  return `${truncated}\n... (diff truncated; ${omitted} more lines omitted)`;
}

function isBinary(content: string | null): boolean {
  if (content === null) {
    return false;
  }
  // Heuristic: any NUL byte in the first 8 KB → treat as binary. Real text
  // files essentially never contain raw NULs; binary formats almost always do.
  const sample = content.length > BINARY_SNIFF_CHARS ? content.slice(0, BINARY_SNIFF_CHARS) : content;
  return sample.includes('\u0000');
}
