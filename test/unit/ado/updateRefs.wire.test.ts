import type { GitApi } from 'azure-devops-node-api/GitApi.js';
import { GitApi as RealGitApi } from 'azure-devops-node-api/GitApi.js';
import { describe, expect, it, vi } from 'vitest';
import { AdoNotFoundError } from '../../../src/ado/errors.js';
import { SdkAdoClient } from '../../../src/ado/sdkClient.js';

const ZERO = '0'.repeat(40);
const SHA = 'a'.repeat(40);

/**
 * Builds a real `SdkAdoClient` whose `api.getGitApi()` (the `azure-devops-node-api` WebApi
 * method that otherwise resolves a resource-area URL over the network) is replaced with a
 * real `GitApi` instance handed to it directly. Only that instance's
 * `vsoClient.getVersioningData` (route/query resolution) and `rest.create` (the actual POST)
 * are stubbed — every other line `SdkAdoClient.updateRefs` runs, including the real
 * `GitApi.updateRefs` argument wiring, executes for real. This is what lets the test catch an
 * argument-order mistake in `SdkAdoClient.updateRefs` (e.g. swapping `repository`/`project`),
 * unlike calling `GitApi.updateRefs` directly.
 */
function stubbedSdkClient(): {
  client: SdkAdoClient;
  versioningDataSpy: ReturnType<typeof vi.spyOn>;
  restCreateSpy: ReturnType<typeof vi.spyOn>;
} {
  const client = new SdkAdoClient({ baseUrl: 'https://ado.example.test/tfs/Collection', pat: 'fake-pat' });
  const git = new RealGitApi('https://ado.example.test/tfs/Collection', []);
  const versioningDataSpy = vi.spyOn(git.vsoClient, 'getVersioningData').mockResolvedValue({
    requestUrl: 'https://ado.example.test/tfs/Collection/proj/_apis/git/repositories/repo/refs',
    apiVersion: '7.2-preview.2',
  });
  const restCreateSpy = vi.spyOn(git.rest, 'create');
  (client as unknown as { api: { getGitApi: () => Promise<GitApi> } }).api.getGitApi = async () => git;
  return { client, versioningDataSpy, restCreateSpy };
}

describe('sdkAdoClient.updateRefs (wire)', () => {
  it('sends the routeValues and the ref-update array body the real sdk would put on the wire', async () => {
    const { client, versioningDataSpy, restCreateSpy } = stubbedSdkClient();
    restCreateSpy.mockResolvedValue({
      statusCode: 200,
      result: [{ name: 'refs/heads/main', success: true, updateStatus: 0, newObjectId: SHA }],
      headers: {},
    });

    const result = await client.updateRefs({
      project: 'proj',
      repository: 'repo',
      updates: [{ name: 'refs/heads/main', oldObjectId: ZERO, newObjectId: SHA }],
    });

    expect(versioningDataSpy.mock.calls[0]?.[3]).toEqual({ project: 'proj', repositoryId: 'repo' });
    expect(restCreateSpy.mock.calls[0]?.[1]).toEqual([{ name: 'refs/heads/main', oldObjectId: ZERO, newObjectId: SHA }]);
    expect(result).toEqual([{ name: 'refs/heads/main', success: true, updateStatus: 0, newObjectId: SHA }]);
  });

  it('throws AdoNotFoundError naming the repository when the sdk resolves null for a bad repository/project', async () => {
    const { client, restCreateSpy } = stubbedSdkClient();
    // typed-rest-client's RestClient.processResponse resolves `{ result: null }` instead of
    // rejecting on HTTP 404 (e.g. TF401019 for a wrong project/repository) — the same finding
    // documented on SdkAdoClient.getBranch. `git.updateRefs` then resolves `null` despite its
    // `GitRefUpdateResult[]` return type.
    restCreateSpy.mockResolvedValue({ statusCode: 404, result: null, headers: {} });

    await expect(
      client.updateRefs({
        project: 'proj',
        repository: 'nope',
        updates: [{ name: 'refs/heads/main', oldObjectId: ZERO, newObjectId: SHA }],
      }),
    ).rejects.toThrow(AdoNotFoundError);
    await expect(
      client.updateRefs({
        project: 'proj',
        repository: 'nope',
        updates: [{ name: 'refs/heads/main', oldObjectId: ZERO, newObjectId: SHA }],
      }),
    ).rejects.toThrow(/nope/);
  });
});
