# Phase 5 — Work items (design)

**Date:** 2026-05-21
**Status:** draft, pending review
**Tracks:** ZDV-177 (Phase 5)
**Prior phase:** Phase 4.2 (`docs/superpowers/specs/2026-05-19-azure-devops-mcp-phase-4-2-design.md`, shipped in v0.7.0)

## Goal

Find work items, read their full detail, link them to PRs, move them through their state graph, and append comments. Five tools — two reads, three writes — in a new `workItems` domain that mirrors the existing pipelines/releases read/write split.

This was the widest-surface phase in the roadmap (queries, fields by process template, links, comments, parent/child). The brainstorming pass (ZDV-177 Step 0) deliberately scoped it down to the small useful subset below and froze the rest as out-of-scope.

## Scope decisions (from brainstorming)

- **Commit all 5 tools** in this slice (not a read-only first slice).
- **`list_work_items` ships all 4 filters:** `myActive`, `linkedToPr`, `currentIteration`, `tag`. No raw WIQL passthrough.
- **`update_work_item_state` pre-validates** the requested state against the work-item type's allowed states; rejects locally with the list of valid states when illegal.

## Domain layout

New domain `src/domains/workItems/`, following the pipelines/releases pattern exactly:

```
src/domains/workItems/
  schemas.ts        # Zod input schemas, explicit `project` on every tool
  readService.ts    # list + get, shaping
  readTools.ts      # 2 read tool definitions (always registered)
  writeService.ts   # link + state + comment
  writeTools.ts     # 3 write tool definitions (registered only when not readOnly)
```

Read tools register unconditionally; write tools go in the write bucket in `src/mcp/registerTools.ts`, which already gates writes behind `isReadOnly()`. No per-tool readOnly guard is needed.

## SdkAdoClient methods

New methods on `SdkAdoClient` (`src/ado/sdkClient.ts`), all SDK-backed via `WorkItemTrackingApi`:

| Method | SDK call | Notes |
|---|---|---|
| `queryWorkItems(args)` | `queryByWiql` → ids, then `getWorkItems` for lightweight columns | templated WIQL string keyed by `filter` |
| `getWorkItem({ project, id })` | `getWorkItem` with `$expand: All` | returns fields + relations + comments expansion |
| `getWorkItemTypeStates({ project, type })` | `getWorkItemType` → `.states` | used by state pre-validation |
| `linkWorkItemToPr(args)` | `updateWorkItem` JSON Patch | `add /relations/-`, `rel: "ArtifactLink"`, PR `vstfs://` URI |
| `updateWorkItemState(args)` | `updateWorkItem` JSON Patch | op on `/fields/System.State` |
| `addWorkItemComment(args)` | `addComment` | newer comments API, not the legacy History field |

## Tools

### Reads (always registered)

**1. `list_work_items`**
Convenience queries, not raw WIQL.
- Inputs: `project`, `filter: "myActive" | "linkedToPr" | "currentIteration" | "tag"`, plus filter-specific args:
  - `myActive` — no extra args; resolves `@me` via the existing identity domain (`whoami`). WIQL filters `[System.AssignedTo] = @me AND [System.State] NOT IN (Closed, Done, Removed)`.
  - `linkedToPr` — `repository`, `pullRequestId`. Builds the PR `vstfs://` artifact URI and queries WIs with that link.
  - `currentIteration` — `team`. Uses the `@CurrentIteration('[team]')` WIQL macro.
  - `tag` — `tag`. `[System.Tags] CONTAINS @tag`.
- Output: trimmed rows — `id`, `workItemType`, `title`, `state`, `assignedTo`. (Full detail is `get_work_item`'s job.)

**2. `get_work_item`**
- Inputs: `project`, `workItemId`.
- Output: fields surfaced as `{ [refName]: value }` (no field names typed up front — schemas vary by Agile/Scrum/CMMI/custom), relations (parent / child / related / PR links), and recent comments.

### Writes (gated by readOnly bucket)

**3. `link_work_item_to_pr`**
- Inputs: `project`, `workItemId`, `repository`, `pullRequestId`.
- Adds a PR `ArtifactLink` relation (bidirectional in the ADO UI).

**4. `update_work_item_state`**
- Inputs: `project`, `workItemId`, `state`.
- **Pre-validation:** fetch the WI type's allowed states (`getWorkItemTypeStates`); if `state` is not among them, reject before sending the patch with an error listing the valid states. Otherwise JSON Patch `/fields/System.State`.

**5. `add_work_item_comment`**
- Inputs: `project`, `workItemId`, `text` (markdown).
- Appends a discussion comment via the comments API.

## Error handling

Reuse `src/ado/errors.ts` mapping through `src/mcp/errorBoundary.ts`, as all existing domains do. The one domain-specific case is `update_work_item_state`'s pre-validation error, which must enumerate the legal states for the work-item type.

## Testing

Unit tests per service, mocking `SdkAdoClient`, matching the existing domain test pattern. Key cases:
- WIQL template selection per `filter` value (correct macro / clause for each).
- `myActive` @me resolution path.
- State pre-validation: legal transition passes through; illegal one is rejected locally with the valid-state list and never reaches `updateWorkItem`.
- `get_work_item` field shaping into `{ [refName]: value }`.

## Out of scope (explicit)

- Raw WIQL passthrough.
- Attachments.
- Custom-field writes beyond the standard set surfaced by `get_work_item`.
- Parent/child relation mutation (reads expose them; no write tool to re-parent).
- Work-item creation and deletion.

These stay out unless a specific colleague workflow asks for one — consistent with the roadmap's "Out of scope" stance.

Ref: `docs/ROADMAP.md` → Phase 5.
