import type { BuildApi } from 'azure-devops-node-api/BuildApi.js';
import { BuildApi as RealBuildApi } from 'azure-devops-node-api/BuildApi.js';
import { describe, expect, it, vi } from 'vitest';
import { SdkAdoClient } from '../../../src/ado/sdkClient.js';

/**
 * Builds a real `SdkAdoClient` whose `api.getBuildApi()` hands back a real `BuildApi`. Only
 * `vsoClient.getVersioningData` (route resolution) and `rest.get` (the actual request) are
 * stubbed, so the real `BuildApi.getRetentionLeasesForBuild` routeValues wiring runs.
 */
function stubbedSdkClient(): {
  client: SdkAdoClient;
  versioningDataSpy: ReturnType<typeof vi.spyOn>;
  restGetSpy: ReturnType<typeof vi.spyOn>;
} {
  const client = new SdkAdoClient({ baseUrl: 'https://ado.example.test/tfs/Collection', pat: 'fake-pat' });
  const build = new RealBuildApi('https://ado.example.test/tfs/Collection', []);
  const versioningDataSpy = vi.spyOn(build.vsoClient, 'getVersioningData').mockResolvedValue({
    requestUrl: 'https://ado.example.test/tfs/Collection/proj/_apis/build/42/leases',
    apiVersion: '7.2-preview.1',
  });
  const restGetSpy = vi.spyOn(build.rest, 'get');
  (client as unknown as { api: { getBuildApi: () => Promise<BuildApi> } }).api.getBuildApi = async () => build;
  return { client, versioningDataSpy, restGetSpy };
}

describe('sdkAdoClient.listBuildLeases (wire)', () => {
  it('sends project and buildId as routeValues to the real sdk', async () => {
    const { client, versioningDataSpy, restGetSpy } = stubbedSdkClient();
    restGetSpy.mockResolvedValue({
      statusCode: 200,
      result: [{ leaseId: 1, ownerId: 'RM:1:1', validUntil: '2026-01-01T00:00:00.000Z' }],
      headers: {},
    });

    const result = await client.listBuildLeases({ project: 'proj', buildId: 42 });

    expect(versioningDataSpy.mock.calls[0]?.[3]).toEqual({ project: 'proj', buildId: 42 });
    expect(result).toEqual([
      { leaseId: 1, ownerId: 'RM:1:1', validUntil: new Date('2026-01-01T00:00:00.000Z') },
    ]);
  });

  it('returns an empty list when the sdk resolves null (typed-rest-client 404)', async () => {
    const { client, restGetSpy } = stubbedSdkClient();
    restGetSpy.mockResolvedValue({ statusCode: 404, result: null, headers: {} });

    await expect(client.listBuildLeases({ project: 'proj', buildId: 42 })).resolves.toEqual([]);
  });
});
