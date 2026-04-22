import type { AdoClient } from "../../ado/client.js";
import type { TeamProjectReference } from "../../ado/types.js";

export interface ProjectSummary {
  id: string;
  name: string;
  url?: string;
}

export class ProjectsService {
  constructor(private readonly client: AdoClient) {}

  async list(): Promise<ProjectSummary[]> {
    const projects = await this.client.listProjects();
    return projects.map(shape);
  }
}

function shape(p: TeamProjectReference): ProjectSummary {
  return {
    id: p.id ?? "",
    name: p.name ?? "",
    url: p.url,
  };
}
