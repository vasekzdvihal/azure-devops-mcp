import type { GitApi } from 'azure-devops-node-api/GitApi.js';
import { GitApi as RealGitApi } from 'azure-devops-node-api/GitApi.js';
import { describe, expect, it, vi } from 'vitest';
import { AdoNotFoundError } from '../../../src/ado/errors.js';
import { SdkAdoClient } from '../../../src/ado/sdkClient.js';

/**
 * Builds a real `SdkAdoClient` whose `api.getGitApi()` (the `azure-devops-node-api` WebApi
 * method that otherwise resolves a resource-area URL over the network) is replaced with a
 * real `GitApi` instance handed to it directly. Only that instance's
 * `vsoClient.getVersioningData` (route resolution) and `rest.update` (the actual write) are
 * stubbed — every other line `SdkAdoClient.updateRepositoryDefaultBranch` runs, including the
 * real `GitApi.updateRepository` argument wiring, executes for real.
 *
 * `GitApi.updateRepository` calls `this.rest.update(url, newRepositoryInfo, options)`, and
 * typed-rest-client's `RestClient.update()` (node_modules/.pnpm/typed-rest-client@2.1.0/.../
 * RestClient.js) issues the request via `this.client.patch(url, data, headers)` — i.e. the SDK
 * sends this write as an HTTP **PATCH**, not a PUT/POST.
 */
function stubbedSdkClient(): {
  client: SdkAdoClient;
  versioningDataSpy: ReturnType<typeof vi.spyOn>;
  restUpdateSpy: ReturnType<typeof vi.spyOn>;
} {
  const client = new SdkAdoClient({ baseUrl: 'https://ado.example.test/tfs/Collection', pat: 'fake-pat' });
  const git = new RealGitApi('https://ado.example.test/tfs/Collection', []);
  const versioningDataSpy = vi.spyOn(git.vsoClient, 'getVersioningData').mockResolvedValue({
    requestUrl: 'https://ado.example.test/tfs/Collection/proj/_apis/git/repositories/r1',
    apiVersion: '7.2-preview.2',
  });
  const restUpdateSpy = vi.spyOn(git.rest, 'update');
  (client as unknown as { api: { getGitApi: () => Promise<GitApi> } }).api.getGitApi = async () => git;
  return { client, versioningDataSpy, restUpdateSpy };
}

describe('sdkAdoClient.updateRepositoryDefaultBranch (wire)', () => {
  it('sends the repository id + project routeValues and the defaultBranch-only PATCH body the real sdk would put on the wire', async () => {
    const { client, versioningDataSpy, restUpdateSpy } = stubbedSdkClient();
    restUpdateSpy.mockResolvedValue({
      statusCode: 200,
      result: { id: 'r1', name: 'NewtonLens', defaultBranch: 'refs/heads/main' },
      headers: {},
    });

    const result = await client.updateRepositoryDefaultBranch({
      project: 'proj',
      repositoryId: 'r1',
      defaultBranch: 'refs/heads/main',
    });

    expect(versioningDataSpy.mock.calls[0]?.[3]).toEqual({ project: 'proj', repositoryId: 'r1' });
    expect(restUpdateSpy.mock.calls[0]?.[1]).toEqual({ defaultBranch: 'refs/heads/main' });
    expect(result).toEqual({ id: 'r1', name: 'NewtonLens', defaultBranch: 'refs/heads/main' });
  });

  it('throws AdoNotFoundError naming the repository when the sdk resolves null for a bad repository', async () => {
    const { client, restUpdateSpy } = stubbedSdkClient();
    // Same typed-rest-client 404 handling documented on SdkAdoClient.getBranch/updateRefs:
    // `RestClient.processResponse` resolves `{ result: null }` instead of rejecting on a 404.
    restUpdateSpy.mockResolvedValue({ statusCode: 404, result: null, headers: {} });

    await expect(
      client.updateRepositoryDefaultBranch({
        project: 'proj',
        repositoryId: 'nope',
        defaultBranch: 'refs/heads/main',
      }),
    ).rejects.toThrow(AdoNotFoundError);
    await expect(
      client.updateRepositoryDefaultBranch({
        project: 'proj',
        repositoryId: 'nope',
        defaultBranch: 'refs/heads/main',
      }),
    ).rejects.toThrow(/nope/);
  });
});
