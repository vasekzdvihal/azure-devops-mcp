import { describe, expect, it } from 'vitest';
import { AdoNotFoundError } from '../../../src/ado/errors.js';
import { withRealApi } from '../../helpers/sdkWire.js';

// Real `GitApi.updateRepository` argument wiring via the shared harness (test/helpers/sdkWire.ts).
// `GitApi.updateRepository` calls `this.rest.update(url, newRepositoryInfo, options)`, and
// typed-rest-client's `RestClient.update()` issues it via `this.client.patch(...)` — i.e. the
// SDK sends this write as an HTTP **PATCH**, not a PUT/POST.
function stubbedSdkClient() {
  return withRealApi('git', { requestUrl: 'https://ado.example.test/tfs/Collection/proj/_apis/git/repositories/r1' });
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
