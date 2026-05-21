import type { AdoClient } from "../../ado/client.js";
import type { WorkItem, WorkItemComment } from "../../ado/types.js";

export interface WorkItemSummary {
  id: number;
  workItemType: string;
  title: string;
  state: string;
  assignedTo?: string;
}

export interface WorkItemRelationInfo {
  rel: string;
  url: string;
  name?: string;
}

export interface WorkItemCommentInfo {
  id?: number;
  text?: string;
  createdBy?: string;
  createdDate?: string;
}

export interface WorkItemDetail {
  id: number;
  /** Raw field map keyed by reference name (e.g. "System.Title"). Schema varies by template. */
  fields: Record<string, unknown>;
  relations: WorkItemRelationInfo[];
  comments: WorkItemCommentInfo[];
}

// Build the WIQL string for the non-PR filters. Single quotes in `tag` are
// escaped per WIQL rules (double them).
export function buildWiql(args: {
  filter: "myActive" | "currentIteration" | "tag";
  tag?: string;
}): string {
  const base = "SELECT [System.Id] FROM WorkItems WHERE ";
  const open = "[System.State] NOT IN ('Closed','Removed','Done')";
  switch (args.filter) {
    case "myActive":
      return `${base}[System.AssignedTo] = @me AND ${open}`;
    case "currentIteration":
      return `${base}[System.IterationPath] = @CurrentIteration AND ${open}`;
    case "tag": {
      const safe = (args.tag ?? "").replace(/'/g, "''");
      return `${base}[System.Tags] CONTAINS '${safe}'`;
    }
  }
}

function fieldString(item: WorkItem, ref: string): string {
  const v = (item.fields ?? {})[ref];
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function shapeSummary(item: WorkItem): WorkItemSummary {
  const assigned = (item.fields ?? {})["System.AssignedTo"] as
    | { displayName?: string }
    | string
    | undefined;
  return {
    id: (item as { id?: number }).id ?? 0,
    workItemType: fieldString(item, "System.WorkItemType"),
    title: fieldString(item, "System.Title"),
    state: fieldString(item, "System.State"),
    assignedTo:
      typeof assigned === "object" ? assigned?.displayName : (assigned as string | undefined),
  };
}

function shapeComment(c: WorkItemComment): WorkItemCommentInfo {
  const createdBy = (c as { createdBy?: { displayName?: string } }).createdBy?.displayName;
  const createdDate = (c as { createdDate?: Date }).createdDate;
  return {
    id: (c as { id?: number }).id,
    text: (c as { text?: string }).text,
    createdBy,
    createdDate: createdDate instanceof Date ? createdDate.toISOString() : undefined,
  };
}

export class WorkItemsReadService {
  constructor(private readonly client: AdoClient) {}

  async list(args: {
    project: string;
    filter: "myActive" | "linkedToPr" | "currentIteration" | "tag";
    repository?: string;
    pullRequestId?: number;
    team?: string;
    tag?: string;
  }): Promise<WorkItemSummary[]> {
    let ids: number[];
    if (args.filter === "linkedToPr") {
      if (!args.repository || !args.pullRequestId) {
        throw new Error("list_work_items: filter 'linkedToPr' requires repository and pullRequestId");
      }
      ids = await this.client.getPullRequestWorkItemRefs({
        project: args.project,
        repository: args.repository,
        pullRequestId: args.pullRequestId,
      });
    } else {
      if (args.filter === "currentIteration" && !args.team) {
        throw new Error("list_work_items: filter 'currentIteration' requires team");
      }
      if (args.filter === "tag" && !args.tag) {
        throw new Error("list_work_items: filter 'tag' requires tag");
      }
      const wiql = buildWiql({ filter: args.filter, tag: args.tag });
      ids = await this.client.queryWorkItemIds({ project: args.project, wiql, team: args.team });
    }
    if (ids.length === 0) return [];
    const items = await this.client.getWorkItemsSummary({ project: args.project, ids });
    return items.map(shapeSummary);
  }

  async get(args: { project: string; workItemId: number }): Promise<WorkItemDetail> {
    const item = await this.client.getWorkItem({ project: args.project, id: args.workItemId });
    const comments = await this.client.getWorkItemComments({
      project: args.project,
      id: args.workItemId,
    });
    const relations: WorkItemRelationInfo[] = ((item as { relations?: unknown[] }).relations ?? []).map(
      (r) => {
        const rel = r as { rel?: string; url?: string; attributes?: { name?: string } };
        return { rel: rel.rel ?? "", url: rel.url ?? "", name: rel.attributes?.name };
      },
    );
    return {
      id: (item as { id?: number }).id ?? args.workItemId,
      fields: (item.fields ?? {}) as Record<string, unknown>,
      relations,
      comments: comments.map(shapeComment),
    };
  }
}
