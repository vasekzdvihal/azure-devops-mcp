import { describe, expect, it } from 'vitest';
import { AdoNotFoundError } from '../../../src/ado/errors.js';
import { withRealApi } from '../../helpers/sdkWire.js';

const ZERO = '0'.repeat(40);
const SHA = 'a'.repeat(40);

// Real `GitApi.updateRefs` argument wiring via the shared harness (test/helpers/sdkWire.ts); the
// request is a POST (`rest.create`). Going through `SdkAdoClient` (not `GitApi.updateRefs`
// directly) is what catches an argument-order mistake such as swapping `repository`/`project`.
function stubbedSdkClient() {
  return withRealApi('git', { requestUrl: 'https://ado.example.test/tfs/Collection/proj/_apis/git/repositories/repo/refs' });
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
