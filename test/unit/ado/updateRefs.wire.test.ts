import { describe, expect, it } from 'vitest';
import { AdoError, AdoNotFoundError } from '../../../src/ado/errors.js';
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

/**
 * The error typed-rest-client rejects with when ADO Server answers HTTP 400 ArgumentException for
 * a missing branch — shaped exactly as captured live (2026-10-02).
 */
function adoServerError(message: string): Error {
  return Object.assign(new Error(message), {
    statusCode: 400,
    result: { message, typeName: 'System.ArgumentException, mscorlib', typeKey: 'ArgumentException', errorCode: 0, eventId: 0 },
  });
}

describe('sdkAdoClient.getBranch (wire)', () => {
  it('resolves null when ado server rejects a missing branch with 400 "does not exist"', async () => {
    const { client, restGetSpy } = withRealApi('git');
    restGetSpy.mockRejectedValue(
      adoServerError('Branch "mian" does not exist in the 0d02f8c9-233f-481e-9ee0-fdd40b772cf1 repository.'),
    );

    await expect(client.getBranch({ project: 'proj', repository: 'repo', branch: 'mian' })).resolves.toBeNull();
  });

  it('resolves null when the sdk resolves null (typed-rest-client 404)', async () => {
    const { client, restGetSpy } = withRealApi('git');
    restGetSpy.mockResolvedValue({ statusCode: 404, result: null, headers: {} });

    await expect(client.getBranch({ project: 'proj', repository: 'repo', branch: 'mian' })).resolves.toBeNull();
  });

  it('still rejects a 400 with an unrelated message', async () => {
    const { client, restGetSpy } = withRealApi('git');
    restGetSpy.mockRejectedValue(adoServerError('The branch name is invalid.'));

    await expect(client.getBranch({ project: 'proj', repository: 'repo', branch: 'bad..name' }))
      .rejects
      .toThrow(AdoError);
  });
});
