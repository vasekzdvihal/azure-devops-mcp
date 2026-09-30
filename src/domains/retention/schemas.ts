import { z } from 'zod';

export const ListBuildLeasesInput = {
  project: z.string().min(1).describe('ADO project name.'),
  buildId: z.number().int().positive().describe('The build (run) id.'),
};

export const FindBuildRetainersInput = {
  project: z.string().min(1).describe('ADO project name.'),
  buildDefinitionId: z
    .number()
    .int()
    .positive()
    .describe('The pipeline (build) definition id. Use `list_pipelines` to discover ids.'),
};
