import { z } from 'zod';

const MAX_TOP = 200;
const MAX_BRANCH_NAMES = 50;

const repoCoords = {
  project: z.string().min(1).optional().describe(
    'ADO project name. If omitted, auto-detected from the current working directory\'s git remote.',
  ),
  repository: z.string().min(1).optional().describe(
    'ADO repository name. If omitted, auto-detected from the current working directory\'s git remote.',
  ),
};

export const ListBranchesInput = {
  ...repoCoords,
  baseBranch: z.string().min(1).optional().describe(
    'Measure aheadCount/behindCount against this branch instead of the repository default branch.',
  ),
  names: z.array(z.string().min(1)).min(1).max(MAX_BRANCH_NAMES).optional().describe(
    'Return only these branches (exact short names). The result becomes { branches, missing } — '
    + '`missing` lists requested names that do not exist.',
  ),
  nameContains: z.string().min(1).optional().describe('Case-insensitive substring filter on branch name.'),
};

export const ListCommitsInput = {
  ...repoCoords,
  branch: z
    .string()
    .optional()
    .describe('Branch name (e.g. \'main\'). Omit to get commits across all branches.'),
  notInBranch: z.string().min(1).optional().describe(
    'Only commits in `branch` that are NOT reachable from this branch (e.g. branch=staging, '
    + 'notInBranch=develop → what a staging→develop merge would bring). Requires `branch`.',
  ),
  fromDate: z
    .string()
    .optional()
    .describe('ISO-8601 date/datetime lower bound for commit time (inclusive).'),
  toDate: z
    .string()
    .optional()
    .describe('ISO-8601 date/datetime upper bound for commit time (inclusive).'),
  author: z
    .string()
    .optional()
    .describe('Filter to commits by this author (name or email as appearing in git metadata).'),
  top: z.number().int().positive().max(MAX_TOP).optional().describe('Max results (default 25).'),
};
