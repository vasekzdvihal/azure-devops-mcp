import type { ToolDefinition } from '../identity/tools.js';
import type { WorkItemsWriteService } from './writeService.js';
import {
  AddWorkItemCommentInput,
  DeleteWorkItemCommentInput,
  LinkWorkItemToPrInput,
  UpdateWorkItemStateInput,
} from './schemas.js';

export function buildWorkItemsWriteTools(svc: WorkItemsWriteService): ToolDefinition[] {
  return [
    {
      name: 'link_work_item_to_pr',
      config: {
        title: 'Link a work item to a pull request',
        description:
          'Adds a bidirectional artifact link between a work item and a PR (visible in both the WI '
          + 'and the PR in the ADO UI). The work item and PR are assumed to be in the same project. '
          + 'ADO does not deduplicate — calling this twice for the same WI+PR adds the link twice.',
        inputSchema: LinkWorkItemToPrInput,
      },
      handler: async args => svc.linkToPr(args as Parameters<typeof svc.linkToPr>[0]),
    },
    {
      name: 'update_work_item_state',
      config: {
        title: 'Move a work item to a new state',
        description:
          'Sets System.State. The target is validated against the work-item type\'s allowed states '
          + 'first; an invalid state returns the list of valid ones without changing anything.',
        inputSchema: UpdateWorkItemStateInput,
      },
      handler: async args => svc.updateState(args as Parameters<typeof svc.updateState>[0]),
    },
    {
      name: 'add_work_item_comment',
      config: {
        title: 'Add a comment to a work item',
        description:
          'Appends a discussion comment to a work item (markdown supported). Uses the work-item '
          + 'comments API, not the legacy History field.',
        inputSchema: AddWorkItemCommentInput,
      },
      handler: async args => svc.addComment(args as Parameters<typeof svc.addComment>[0]),
    },
    {
      name: 'delete_work_item_comment',
      config: {
        title: 'Delete a work item comment',
        description:
          'Permanently deletes one discussion comment (by `commentId`) from a work item. This '
          + 'cannot be undone — always confirm with the user before calling.',
        inputSchema: DeleteWorkItemCommentInput,
      },
      handler: async args => svc.deleteComment(args as Parameters<typeof svc.deleteComment>[0]),
    },
  ];
}
