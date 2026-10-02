import type { BuildDefinition } from '../../../src/ado/types.js';
import { describe, expect, it } from 'vitest';
import { AdoNotFoundError } from '../../../src/ado/errors.js';
import { withRealApi } from '../../helpers/sdkWire.js';

// Real `BuildApi.updateDefinition` via the shared harness (test/helpers/sdkWire.ts); the SDK
// sends the definition as a PUT (`rest.replace`).
function stubbedSdkClient() {
  return withRealApi('build', { requestUrl: 'https://ado.example.test/tfs/Collection/proj/_apis/build/definitions/7' });
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
