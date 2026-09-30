import type { BuildApi } from 'azure-devops-node-api/BuildApi.js';
import { BuildApi as RealBuildApi } from 'azure-devops-node-api/BuildApi.js';
import { describe, expect, it, vi } from 'vitest';
import { SdkAdoClient } from '../../../src/ado/sdkClient.js';

/**
 * Builds a real `SdkAdoClient` whose `api.getBuildApi()` hands back a real `BuildApi`. Only
 * `vsoClient.getVersioningData` (route resolution) and `rest.del` (the actual request — the SDK's
 * `deleteRetentionLeasesById` issues a DELETE, unlike the GET `listBuildLeases` uses) are stubbed,
 * so the real `BuildApi.deleteRetentionLeasesById` routeValues/queryValues wiring runs.
 */
function stubbedSdkClient(): {
  client: SdkAdoClient;
  versioningDataSpy: ReturnType<typeof vi.spyOn>;
  restDelSpy: ReturnType<typeof vi.spyOn>;
} {
  const client = new SdkAdoClient({ baseUrl: 'https://ado.example.test/tfs/Collection', pat: 'fake-pat' });
  const build = new RealBuildApi('https://ado.example.test/tfs/Collection', []);
  const versioningDataSpy = vi.spyOn(build.vsoClient, 'getVersioningData').mockResolvedValue({
    requestUrl: 'https://ado.example.test/tfs/Collection/proj/_apis/build/leases',
    apiVersion: '7.2-preview.2',
  });
  const restDelSpy = vi.spyOn(build.rest, 'del').mockResolvedValue({
    statusCode: 200,
    result: null,
    headers: {},
  });
  (client as unknown as { api: { getBuildApi: () => Promise<BuildApi> } }).api.getBuildApi = async () => build;
  return { client, versioningDataSpy, restDelSpy };
}

describe('sdkAdoClient.deleteRetentionLeases (wire)', () => {
  it('sends project as a routeValue and a single lease id as ids=<id>', async () => {
    const { client, versioningDataSpy, restDelSpy } = stubbedSdkClient();

    await client.deleteRetentionLeases({ project: 'proj', leaseIds: [11] });

    expect(versioningDataSpy.mock.calls[0]?.[3]).toEqual({ project: 'proj' });
    expect(versioningDataSpy.mock.calls[0]?.[4]).toEqual({ ids: '11' });
    expect(restDelSpy).toHaveBeenCalledTimes(1);
  });

  it('comma-joins several lease ids into a single ids= query value', async () => {
    const { client, versioningDataSpy } = stubbedSdkClient();

    await client.deleteRetentionLeases({ project: 'proj', leaseIds: [11, 12, 13] });

    expect(versioningDataSpy.mock.calls[0]?.[4]).toEqual({ ids: '11,12,13' });
  });

  it('issues an http delete, not a get or post, against the real BuildApi', async () => {
    const { client, restDelSpy } = stubbedSdkClient();

    await client.deleteRetentionLeases({ project: 'proj', leaseIds: [11] });

    expect(restDelSpy).toHaveBeenCalledWith(
      'https://ado.example.test/tfs/Collection/proj/_apis/build/leases',
      expect.anything(),
    );
  });
});
