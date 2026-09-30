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
  restGetSpy: ReturnType<typeof vi.spyOn>;
  restCreateSpy: ReturnType<typeof vi.spyOn>;
  restUpdateSpy: ReturnType<typeof vi.spyOn>;
  restReplaceSpy: ReturnType<typeof vi.spyOn>;
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
  // These must never be called by deleteRetentionLeasesById — only `del` is the real verb. Spied
  // (and stubbed, in case a regression does call one) so a regression fails on "not called"
  // rather than on a hung/rejected real HTTP call.
  const restGetSpy = vi.spyOn(build.rest, 'get').mockResolvedValue({ statusCode: 200, result: null, headers: {} });
  const restCreateSpy = vi.spyOn(build.rest, 'create').mockResolvedValue({ statusCode: 200, result: null, headers: {} });
  const restUpdateSpy = vi.spyOn(build.rest, 'update').mockResolvedValue({ statusCode: 200, result: null, headers: {} });
  const restReplaceSpy = vi.spyOn(build.rest, 'replace').mockResolvedValue({ statusCode: 200, result: null, headers: {} });
  (client as unknown as { api: { getBuildApi: () => Promise<BuildApi> } }).api.getBuildApi = async () => build;
  return { client, versioningDataSpy, restDelSpy, restGetSpy, restCreateSpy, restUpdateSpy, restReplaceSpy };
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
    const { client, restDelSpy, restGetSpy, restCreateSpy, restUpdateSpy, restReplaceSpy } = stubbedSdkClient();

    await client.deleteRetentionLeases({ project: 'proj', leaseIds: [11] });

    expect(restDelSpy).toHaveBeenCalledWith(
      'https://ado.example.test/tfs/Collection/proj/_apis/build/leases',
      expect.anything(),
    );
    expect(restGetSpy).not.toHaveBeenCalled();
    expect(restCreateSpy).not.toHaveBeenCalled();
    expect(restUpdateSpy).not.toHaveBeenCalled();
    expect(restReplaceSpy).not.toHaveBeenCalled();
  });
});
