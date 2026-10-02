import { describe, expect, it } from 'vitest';
import { withRealApi } from '../../helpers/sdkWire.js';

// Real `BuildApi.getRetentionLeasesForBuild` routeValues wiring via the shared harness
// (test/helpers/sdkWire.ts); the request is a `rest.get`.
function stubbedSdkClient() {
  return withRealApi('build', { requestUrl: 'https://ado.example.test/tfs/Collection/proj/_apis/build/42/leases' });
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
