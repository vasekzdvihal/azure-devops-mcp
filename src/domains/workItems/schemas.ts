import { z } from 'zod';

export const ListWorkItemsInput = {
  project: z.string().min(1).describe('ADO project name.'),
  filter: z
    .enum(['myActive', 'linkedToPr', 'currentIteration', 'tag'])
    .describe(
      'Which canned query to run. \'myActive\' = open items assigned to the PAT\'s user; '
      + '\'linkedToPr\' = items linked to a PR (needs repository + pullRequestId); '
      + '\'currentIteration\' = open items in the team\'s current sprint (needs team); '
      + '\'tag\' = items carrying a tag (needs tag).',
    ),
  repository: z.string().min(1).optional().describe('Repository name. Required when filter=\'linkedToPr\'.'),
  pullRequestId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('PR id. Required when filter=\'linkedToPr\'.'),
  team: z.string().min(1).optional().describe('Team name. Required when filter=\'currentIteration\'.'),
  tag: z.string().min(1).optional().describe('Tag value. Required when filter=\'tag\'.'),
};

export const GetWorkItemInput = {
  project: z.string().min(1).describe('ADO project name.'),
  workItemId: z.number().int().positive().describe('Work item id (integer).'),
};

export const LinkWorkItemToPrInput = {
  project: z.string().min(1).describe('ADO project name (work item and PR assumed in the same project).'),
  workItemId: z.number().int().positive().describe('Work item id to link.'),
  repository: z.string().min(1).describe('Repository name containing the PR.'),
  pullRequestId: z.number().int().positive().describe('Pull request id to link to the work item.'),
};

export const UpdateWorkItemStateInput = {
  project: z.string().min(1).describe('ADO project name.'),
  workItemId: z.number().int().positive().describe('Work item id.'),
  state: z
    .string()
    .min(1)
    .describe(
      'Target state name (e.g. \'Active\', \'Resolved\', \'Closed\'). Validated against the work-item '
      + 'type\'s allowed states before submitting; an invalid state returns the list of valid ones.',
    ),
};

export const AddWorkItemCommentInput = {
  project: z.string().min(1).describe('ADO project name.'),
  workItemId: z.number().int().positive().describe('Work item id.'),
  text: z.string().min(1).describe('Comment body (markdown supported by ADO).'),
};
