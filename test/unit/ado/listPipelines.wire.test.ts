import { describe, expect, it } from 'vitest';
import { withRealApi } from '../../helpers/sdkWire.js';

// Real `BuildApi.getDefinitions` positional-argument → query-param wiring via the shared harness
// (test/helpers/sdkWire.ts). `getDefinitions` passes its `queryValues` object as the 5th argument
// of `getVersioningData`, which is what these tests assert on.
function stubbedSdkClient() {
  return withRealApi('build', { requestUrl: 'https://ado.example.test/tfs/Collection/proj/_apis/build/definitions' });
}

describe('sdkAdoClient.listPipelines (wire)', () => {
  it('sends repositoryId, repositoryType and includeAllProperties in the right query params', async () => {
    const { client, versioningDataSpy, restGetSpy } = stubbedSdkClient();
    restGetSpy.mockResolvedValue({ statusCode: 200, result: [{ id: 1, name: 'api-ci' }], headers: {} });

    const result = await client.listPipelines({ project: 'proj', repositoryId: 'rid', repositoryType: 'TfsGit' });

    expect(versioningDataSpy.mock.calls[0]?.[3]).toEqual({ project: 'proj' });
    const query = versioningDataSpy.mock.calls[0]?.[4] as Record<string, unknown>;
    expect(query.repositoryId).toBe('rid');
    expect(query.repositoryType).toBe('TfsGit');
    expect(query.includeAllProperties).toBe(true);
    expect(query.name).toBeUndefined();
    expect(query.queryOrder).toBeUndefined();
    expect(result).toEqual([{ id: 1, name: 'api-ci' }]);
  });

  it('leaves repositoryType unset when the caller does not pass it', async () => {
    const { client, versioningDataSpy, restGetSpy } = stubbedSdkClient();
    restGetSpy.mockResolvedValue({ statusCode: 200, result: [], headers: {} });

    await client.listPipelines({ project: 'proj' });

    const query = versioningDataSpy.mock.calls[0]?.[4] as Record<string, unknown>;
    expect(query.repositoryId).toBeUndefined();
    expect(query.repositoryType).toBeUndefined();
    expect(query.includeAllProperties).toBe(true);
  });

  it('returns an empty list when the sdk resolves null (typed-rest-client 404)', async () => {
    const { client, restGetSpy } = stubbedSdkClient();
    restGetSpy.mockResolvedValue({ statusCode: 404, result: null, headers: {} });

    await expect(client.listPipelines({ project: 'proj', repositoryId: 'gone' })).resolves.toEqual([]);
  });
});
