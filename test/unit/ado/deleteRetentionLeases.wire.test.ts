import { describe, expect, it } from 'vitest';
import { withRealApi } from '../../helpers/sdkWire.js';

// Real `BuildApi.deleteRetentionLeasesById` via the shared harness (test/helpers/sdkWire.ts).
// The SDK issues a DELETE (`rest.del`), unlike the GET `listBuildLeases` uses; every other verb
// is stubbed by the harness so a regression fails on "not called" rather than a real request.
function stubbedSdkClient() {
  return withRealApi('build', { requestUrl: 'https://ado.example.test/tfs/Collection/proj/_apis/build/leases' });
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
