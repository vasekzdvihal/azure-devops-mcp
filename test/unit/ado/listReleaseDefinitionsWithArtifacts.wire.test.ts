import type { ReleaseApi } from 'azure-devops-node-api/ReleaseApi.js';
import { ReleaseApi as RealReleaseApi } from 'azure-devops-node-api/ReleaseApi.js';
import { describe, expect, it, vi } from 'vitest';
import { SdkAdoClient } from '../../../src/ado/sdkClient.js';
import { ReleaseDefinitionExpands } from '../../../src/ado/types.js';

// Copied from azure-devops-node-api/ReleaseApi.js's getReleaseDefinitions (~line 671):
// `this.vsoClient.getVersioningData("7.2-preview.4", "Release", "d8f96f24-…", routeValues,
// queryValues)`. SdkAdoClient.listReleaseDefinitionsWithArtifacts must pass this exact
// locationId to look up the right resource — a typo here would silently 404 or hit the wrong
// endpoint. Re-check against that line if azure-devops-node-api is ever upgraded.
const RELEASE_DEFINITIONS_LOCATION_ID = 'd8f96f24-8ea7-4cb6-baab-2df8fc515665';

/**
 * Builds a real `SdkAdoClient` whose `api.getReleaseApi()` hands back a real `ReleaseApi`. Only
 * `vsoClient.getVersioningData` (route/query resolution) and `rest.get` (the actual request) are
 * stubbed — everything `SdkAdoClient.listReleaseDefinitionsWithArtifacts` does with the real
 * `ReleaseApi` instance (`createRequestOptions`, `formatResponse`, reading `res.headers`) runs
 * for real. Response bodies here use ADO's actual wire shape (`{ count, value }`), and the
 * continuation token is attached the way ADO really sends it: as the `x-ms-continuationtoken`
 * response header, not a body field.
 */
function stubbedSdkClient(): {
  client: SdkAdoClient;
  versioningDataSpy: ReturnType<typeof vi.spyOn>;
  restGetSpy: ReturnType<typeof vi.spyOn>;
} {
  const client = new SdkAdoClient({ baseUrl: 'https://ado.example.test/tfs/Collection', pat: 'fake-pat' });
  const release = new RealReleaseApi('https://ado.example.test/tfs/Collection', []);
  const versioningDataSpy = vi.spyOn(release.vsoClient, 'getVersioningData').mockResolvedValue({
    requestUrl: 'https://ado.example.test/tfs/Collection/proj/_apis/release/definitions',
    apiVersion: '7.2-preview.4',
  });
  const restGetSpy = vi.spyOn(release.rest, 'get');
  (client as unknown as { api: { getReleaseApi: () => Promise<ReleaseApi> } }).api.getReleaseApi
    = async () => release;
  return { client, versioningDataSpy, restGetSpy };
}

describe('sdkAdoClient.listReleaseDefinitionsWithArtifacts (wire)', () => {
  it('pages through the real x-ms-continuationtoken response header', async () => {
    const { client, versioningDataSpy, restGetSpy } = stubbedSdkClient();
    restGetSpy
      .mockResolvedValueOnce({
        statusCode: 200,
        result: { count: 1, value: [{ id: 50, name: 'Deploy API' }] },
        headers: { 'x-ms-continuationtoken': 'tok-1' },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        result: { count: 1, value: [{ id: 76, name: 'Deploy Old' }] },
        headers: {},
      });

    const result = await client.listReleaseDefinitionsWithArtifacts({ project: 'proj' });

    expect(result).toEqual([
      { id: 50, name: 'Deploy API' },
      { id: 76, name: 'Deploy Old' },
    ]);
    expect(versioningDataSpy.mock.calls).toHaveLength(2);

    const firstCallLocationId = versioningDataSpy.mock.calls[0]?.[2];
    expect(firstCallLocationId).toBe(RELEASE_DEFINITIONS_LOCATION_ID);

    const firstPageQuery = versioningDataSpy.mock.calls[0]?.[4] as Record<string, unknown>;
    expect(firstPageQuery.$expand).toBe(ReleaseDefinitionExpands.Artifacts);
    expect(firstPageQuery.continuationToken).toBeUndefined();

    const secondPageQuery = versioningDataSpy.mock.calls[1]?.[4] as Record<string, unknown>;
    expect(secondPageQuery.$expand).toBe(ReleaseDefinitionExpands.Artifacts);
    expect(secondPageQuery.continuationToken).toBe('tok-1');
  });

  it('returns an empty list when the first page resolves null (typed-rest-client 404)', async () => {
    const { client, restGetSpy } = stubbedSdkClient();
    restGetSpy.mockResolvedValue({ statusCode: 404, result: null, headers: {} });

    await expect(client.listReleaseDefinitionsWithArtifacts({ project: 'proj' })).resolves.toEqual([]);
  });

  it('throws rather than looping forever when the continuation token never stops', async () => {
    const { client, restGetSpy } = stubbedSdkClient();
    restGetSpy.mockResolvedValue({
      statusCode: 200,
      result: { count: 1, value: [{ id: 1, name: 'Loops forever' }] },
      headers: { 'x-ms-continuationtoken': 'always-more' },
    });

    await expect(client.listReleaseDefinitionsWithArtifacts({ project: 'proj' }))
      .rejects
      .toThrow(/exceeded/i);
  });
});
