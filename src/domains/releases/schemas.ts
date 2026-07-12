import { z } from 'zod';

const MAX_TOP = 200;

export const ProjectOnly = {
  project: z.string().min(1).describe('ADO project name.'),
};

export const ListReleasesInput = {
  project: z.string().min(1).describe('ADO project name.'),
  definitionId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Filter to releases of this release-definition id.'),
  status: z
    .enum(['active', 'abandoned', 'draft'])
    .optional()
    .describe('Filter by release status. Default: no filter (all).'),
  top: z.number().int().positive().max(MAX_TOP).optional().describe('Max results (default 25).'),
};

export const ReleaseId = {
  project: z.string().min(1).describe('ADO project name.'),
  releaseId: z.number().int().positive().describe('The release id (integer).'),
};

export const ReleaseDefinitionId = {
  project: z.string().min(1).describe('ADO project name.'),
  definitionId: z
    .number()
    .int()
    .positive()
    .describe(
      'The release-definition id (integer). Use `list_release_definitions` to discover ids.',
    ),
  verbose: z
    .boolean()
    .optional()
    .describe(
      'When true, includes the full task list (display name + ref name + enabled flag) for '
      + 'each environment\'s deploy phases. When false (default), only the per-stage task count '
      + 'is returned, which keeps the payload small for definitions with dozens of tasks.',
    ),
};

export const ListDeploymentsInput = {
  project: z.string().min(1).describe('ADO project name.'),
  definitionId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Filter to this release-definition id.'),
  environmentName: z
    .string()
    .optional()
    .describe(
      'Filter to deployments whose target environment name matches (case-insensitive exact '
      + 'match). Applied client-side after fetch because the SDK only takes numeric environment '
      + 'ids — so combine with a tight `top` to keep the server-side fetch small.',
    ),
  status: z
    .enum([
      'notDeployed',
      'inProgress',
      'succeeded',
      'partiallySucceeded',
      'failed',
      'all',
    ])
    .optional()
    .describe('Filter by deployment status. \'all\' returns every status.'),
  top: z.number().int().positive().max(MAX_TOP).optional().describe('Max results (default 25).'),
};

export const CreateReleaseInput = {
  project: z.string().min(1).describe('ADO project name.'),
  definitionId: z.number().int().positive().describe('Release definition id'),
  description: z.string().optional(),
  artifacts: z
    .array(
      z.object({
        alias: z.string().min(1).describe('Artifact alias from the release definition'),
        buildId: z.number().int().positive().describe('Build id to bind to the alias'),
      }),
    )
    .optional()
    .describe('Artifact bindings. Omit to use the definition\'s default artifact resolution.'),
  variables: z
    .record(z.string(), z.object({ value: z.string(), isSecret: z.boolean().optional() }))
    .optional()
    .describe('Release-scoped variable overrides'),
  autoDeploy: z
    .boolean()
    .optional()
    .describe(
      'When false or omitted (the DEFAULT), the release is created with every stage held as '
      + 'manual, so creation ships nothing — you then deploy explicitly with `deploy_release_stage`. '
      + 'Set true to honor the definition\'s own triggers (e.g. auto-deploy the first stage on '
      + 'creation). Only set true when the user explicitly wants creation to auto-deploy.',
    ),
};

export const DeployReleaseStageInput = {
  project: z.string().min(1).describe('ADO project name.'),
  releaseId: z.number().int().positive(),
  environmentName: z.string().min(1).describe('Stage name (e.g. \'Production\')'),
  comment: z.string().optional(),
};

export const ApproveReleaseGateInput = {
  project: z.string().min(1).describe('ADO project name.'),
  approvalId: z.number().int().positive(),
  status: z.enum(['approved', 'rejected']),
  comment: z.string().optional(),
};

export const CancelReleaseInput = {
  project: z.string().min(1).describe('ADO project name.'),
  releaseId: z.number().int().positive(),
  comment: z.string().optional(),
};

export const ListPendingApprovalsInput = {
  project: z.string().min(1).describe('ADO project name.'),
  releaseId: z.number().int().positive().optional(),
  assignedTo: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Identity descriptor or display name. Omit for all pending approvals in the project.',
    ),
};

// Same shape as the pipeline variant — kept local to avoid cross-domain coupling.
const VariableSetEntry = z.object({
  value: z.string().describe('New value. For secrets, this is the secret to store.'),
  isSecret: z
    .boolean()
    .optional()
    .describe(
      'Mark as secret. If omitted on a variable that was already a secret, '
      + 'the existing isSecret:true is preserved.',
    ),
  allowOverride: z
    .boolean()
    .optional()
    .describe('Whether this variable can be overridden at queue time.'),
});

export const UpdateReleaseVariablesInput = {
  project: z.string().min(1),
  definitionId: z.number().int().positive().describe('Release definition id'),
  set: z.record(z.string().min(1), VariableSetEntry).optional(),
  remove: z.array(z.string().min(1)).optional(),
};

export const UpdateReleaseEnvironmentVariablesInput = {
  project: z.string().min(1),
  definitionId: z.number().int().positive().describe('Release definition id'),
  environmentName: z
    .string()
    .min(1)
    .describe('Environment name on the release definition (case-insensitive match).'),
  set: z.record(z.string().min(1), VariableSetEntry).optional(),
  remove: z.array(z.string().min(1)).optional(),
};
