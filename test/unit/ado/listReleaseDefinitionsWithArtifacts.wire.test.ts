import type { ReleaseApi } from 'azure-devops-node-api/ReleaseApi.js';
import { ReleaseApi as RealReleaseApi } from 'azure-devops-node-api/ReleaseApi.js';
import { describe, expect, it, vi } from 'vitest';
import { SdkAdoClient } from '../../../src/ado/sdkClient.js';
import { ReleaseDefinitionExpands } from '../../../src/ado/types.js';

/**
 * Builds a real `SdkAdoClient` whose `api.getReleaseApi()` hands back a real `ReleaseApi`. Only
 * `vsoClient.getVersioningData` (route/query resolution) and `rest.get` (the actual request) are
 * stubbed, so the real `ReleaseApi.getReleaseDefinitions` positional-argument → query-param
 * wiring runs, including its `ContractSerializer` response deserialization.
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
  it('sends $expand=Artifacts on every page request', async () => {
    const { client, versioningDataSpy, restGetSpy } = stubbedSdkClient();
    restGetSpy.mockResolvedValue({ statusCode: 200, result: [{ id: 50, name: 'Deploy API' }], headers: {} });

    await client.listReleaseDefinitionsWithArtifacts({ project: 'proj' });

    const query = versioningDataSpy.mock.calls[0]?.[4] as Record<string, unknown>;
    expect(query.$expand).toBe(ReleaseDefinitionExpands.Artifacts);
  });

  /**
   * FINDING: `ReleaseApi.getReleaseDefinitions` (node_modules/azure-devops-node-api/ReleaseApi.js)
   * never surfaces the real `x-ms-continuationtoken` response header — `formatResponse` only
   * deserializes `res.result` (the JSON body) and never touches `res.headers`, and
   * `ContractSerializer.deserialize`'s "unwrap wrapped collections" step replaces the body
   * object with just its inner `.value` array, dropping any sibling property. Against a real
   * ADO server this SDK version's `page.continuationToken` is therefore always `undefined` and
   * our do-while loop runs exactly once. This test proves the *pagination mechanics* are
   * correct by attaching `continuationToken` directly to the bare-array stub response (skipping
   * the `{ value: [...] }` wrapping, which is what `deserialize` unwraps) — a shape the real
   * server does not produce, but the only way to observe the loop's token-chaining behavior
   * through the unmodified SDK code path.
   */
  it('concatenates pages and forwards the previous page\'s continuation token', async () => {
    const { client, versioningDataSpy, restGetSpy } = stubbedSdkClient();
    const page1 = Object.assign(
      [{ id: 50, name: 'Deploy API' }],
      { continuationToken: 'tok-1' },
    );
    const page2 = [{ id: 76, name: 'Deploy Old' }];
    restGetSpy
      .mockResolvedValueOnce({ statusCode: 200, result: page1, headers: {} })
      .mockResolvedValueOnce({ statusCode: 200, result: page2, headers: {} });

    const result = await client.listReleaseDefinitionsWithArtifacts({ project: 'proj' });

    expect(result).toEqual([
      { id: 50, name: 'Deploy API' },
      { id: 76, name: 'Deploy Old' },
    ]);
    expect(versioningDataSpy.mock.calls).toHaveLength(2);
    const secondPageQuery = versioningDataSpy.mock.calls[1]?.[4] as Record<string, unknown>;
    expect(secondPageQuery.continuationToken).toBe('tok-1');
  });

  it('returns an empty list when the first page resolves null (typed-rest-client 404)', async () => {
    const { client, restGetSpy } = stubbedSdkClient();
    restGetSpy.mockResolvedValue({ statusCode: 404, result: null, headers: {} });

    await expect(client.listReleaseDefinitionsWithArtifacts({ project: 'proj' })).resolves.toEqual([]);
  });
});
