import type { AdoClient } from '../../ado/client.js';
import type { JsonPatchOperation } from '../../ado/types.js';
import { Operation } from '../../ado/types.js';

export interface LinkResult {
  workItemId: number;
  pullRequestId: number;
  linked: true;
}

export interface UpdateStateResult {
  workItemId: number;
  state: string;
}

export interface AddCommentResult {
  workItemId: number;
  commentId?: number;
}

// vstfs artifact URI for a PR. Project + repo are GUIDs; the three segments are
// joined by URL-encoded slashes (%2F), per the ADO artifact-link format.
export function buildPrArtifactUri(projectId: string, repoId: string, prId: number): string {
  return `vstfs:///Git/PullRequestId/${projectId}%2F${repoId}%2F${prId}`;
}

export class WorkItemsWriteService {
  constructor(private readonly client: AdoClient) {}

  async linkToPr(args: {
    project: string;
    workItemId: number;
    repository: string;
    pullRequestId: number;
  }): Promise<LinkResult> {
    // Resolve PR + repo GUIDs from the existing PR read path.
    const pr = await this.client.getPullRequest({
      project: args.project,
      repository: args.repository,
      pullRequestId: args.pullRequestId,
    });
    const repoId = pr.repository?.id;
    const projectId = pr.repository?.project?.id;
    if (!repoId || !projectId) {
      throw new Error(
        `linkToPr: could not resolve repository/project id for PR ${args.pullRequestId}`,
      );
    }
    const url = buildPrArtifactUri(projectId, repoId, args.pullRequestId);
    const patch: JsonPatchOperation[] = [
      {
        op: Operation.Add,
        path: '/relations/-',
        value: { rel: 'ArtifactLink', url, attributes: { name: 'Pull Request' } },
      },
    ];
    await this.client.updateWorkItem({ project: args.project, id: args.workItemId, patch });
    return { workItemId: args.workItemId, pullRequestId: args.pullRequestId, linked: true };
  }

  async updateState(args: {
    project: string;
    workItemId: number;
    state: string;
  }): Promise<UpdateStateResult> {
    // Resolve the work item's type so we can validate the target state.
    const item = await this.client.getWorkItem({ project: args.project, id: args.workItemId });
    const type = ((item.fields ?? {})['System.WorkItemType'] as string | undefined) ?? '';
    const allowed = await this.client.getWorkItemTypeStates({ project: args.project, type });
    if (!allowed.includes(args.state)) {
      throw new Error(
        `Invalid state '${args.state}' for work-item type '${type}'. Valid states: ${allowed.join(', ')}.`,
      );
    }
    const patch: JsonPatchOperation[] = [
      { op: Operation.Add, path: '/fields/System.State', value: args.state },
    ];
    await this.client.updateWorkItem({ project: args.project, id: args.workItemId, patch });
    return { workItemId: args.workItemId, state: args.state };
  }

  async addComment(args: {
    project: string;
    workItemId: number;
    text: string;
  }): Promise<AddCommentResult> {
    const comment = await this.client.addWorkItemComment({
      project: args.project,
      id: args.workItemId,
      text: args.text,
    });
    return { workItemId: args.workItemId, commentId: (comment as { id?: number }).id };
  }
}
