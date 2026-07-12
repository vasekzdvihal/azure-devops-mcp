import { z } from 'zod';

const MAX_TOP = 200;

const repoCoords = {
  project: z.string().min(1).optional().describe(
    'ADO project name. If omitted, auto-detected from the current working directory\'s git remote.',
  ),
  repository: z.string().min(1).optional().describe(
    'ADO repository name. If omitted, auto-detected from the current working directory\'s git remote.',
  ),
};

export const ListBranchesInput = { ...repoCoords };

export const ListCommitsInput = {
  ...repoCoords,
  branch: z
    .string()
    .optional()
    .describe('Branch name (e.g. \'main\'). Omit to get commits across all branches.'),
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
