import type { BuildApi } from 'azure-devops-node-api/BuildApi.js';
import { BuildApi as RealBuildApi } from 'azure-devops-node-api/BuildApi.js';
import { describe, expect, it, vi } from 'vitest';
import { SdkAdoClient } from '../../../src/ado/sdkClient.js';

/**
 * Builds a real `SdkAdoClient` whose `api.getBuildApi()` hands back a real `BuildApi`. Only
 * `vsoClient.getVersioningData` (route + query resolution) and `rest.get` (the actual request)
 * are stubbed, so the real `BuildApi.getDefinitions` positional-argument → query-param wiring
 * runs. `getDefinitions` passes its `queryValues` object as the 5th argument of
 * `getVersioningData`, which is what these tests assert on.
 */
function stubbedSdkClient(): {
  client: SdkAdoClient;
  versioningDataSpy: ReturnType<typeof vi.spyOn>;
  restGetSpy: ReturnType<typeof vi.spyOn>;
} {
  const client = new SdkAdoClient({ baseUrl: 'https://ado.example.test/tfs/Collection', pat: 'fake-pat' });
  const build = new RealBuildApi('https://ado.example.test/tfs/Collection', []);
  const versioningDataSpy = vi.spyOn(build.vsoClient, 'getVersioningData').mockResolvedValue({
    requestUrl: 'https://ado.example.test/tfs/Collection/proj/_apis/build/definitions',
    apiVersion: '7.2-preview.7',
  });
  const restGetSpy = vi.spyOn(build.rest, 'get');
  (client as unknown as { api: { getBuildApi: () => Promise<BuildApi> } }).api.getBuildApi = async () => build;
  return { client, versioningDataSpy, restGetSpy };
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
