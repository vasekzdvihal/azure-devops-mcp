import type { BuildApi } from 'azure-devops-node-api/BuildApi.js';
import type { BuildDefinition } from '../../../src/ado/types.js';
import { BuildApi as RealBuildApi } from 'azure-devops-node-api/BuildApi.js';
import { describe, expect, it, vi } from 'vitest';
import { AdoNotFoundError } from '../../../src/ado/errors.js';
import { SdkAdoClient } from '../../../src/ado/sdkClient.js';

/**
 * Builds a real `SdkAdoClient` whose `api.getBuildApi()` hands back a real `BuildApi`. Only
 * `vsoClient.getVersioningData` (route resolution) and `rest.replace` (the PUT the real
 * `BuildApi.updateDefinition` issues) are stubbed.
 */
function stubbedSdkClient(): {
  client: SdkAdoClient;
  versioningDataSpy: ReturnType<typeof vi.spyOn>;
  restReplaceSpy: ReturnType<typeof vi.spyOn>;
} {
  const client = new SdkAdoClient({ baseUrl: 'https://ado.example.test/tfs/Collection', pat: 'fake-pat' });
  const build = new RealBuildApi('https://ado.example.test/tfs/Collection', []);
  const versioningDataSpy = vi.spyOn(build.vsoClient, 'getVersioningData').mockResolvedValue({
    requestUrl: 'https://ado.example.test/tfs/Collection/proj/_apis/build/definitions/7',
    apiVersion: '7.2-preview.7',
  });
  const restReplaceSpy = vi.spyOn(build.rest, 'replace');
  (client as unknown as { api: { getBuildApi: () => Promise<BuildApi> } }).api.getBuildApi = async () => build;
  return { client, versioningDataSpy, restReplaceSpy };
}

const DEFINITION = { id: 7, name: 'api-ci', revision: 3 } as BuildDefinition;

describe('sdkAdoClient.updatePipelineDefinition (wire)', () => {
  it('puts the definition body with project + definitionId routeValues', async () => {
    const { client, versioningDataSpy, restReplaceSpy } = stubbedSdkClient();
    restReplaceSpy.mockResolvedValue({ statusCode: 200, result: { ...DEFINITION, revision: 4 }, headers: {} });

    const result = await client.updatePipelineDefinition({ project: 'proj', definitionId: 7, definition: DEFINITION });

    expect(versioningDataSpy.mock.calls[0]?.[3]).toEqual({ project: 'proj', definitionId: 7 });
    expect(restReplaceSpy.mock.calls[0]?.[1]).toEqual(DEFINITION);
    expect(result).toEqual({ ...DEFINITION, revision: 4 });
  });

  it('throws AdoNotFoundError naming the definition when the sdk resolves null (typed-rest-client 404)', async () => {
    const { client, restReplaceSpy } = stubbedSdkClient();
    restReplaceSpy.mockResolvedValue({ statusCode: 404, result: null, headers: {} });

    const attempt = client.updatePipelineDefinition({ project: 'proj', definitionId: 7, definition: DEFINITION });

    await expect(attempt).rejects.toThrow(AdoNotFoundError);
    await expect(attempt).rejects.toThrow(/7/);
  });
});
