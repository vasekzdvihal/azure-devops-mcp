import { describe, expect, it } from 'vitest';
import {
  RELEASE_DEFINITIONS_API_VERSION,
  RELEASE_DEFINITIONS_LOCATION_ID,
} from '../../../src/ado/sdkClient.js';
import { ReleaseDefinitionExpands } from '../../../src/ado/types.js';
import { captureVersioningArgs, withRealApi } from '../../helpers/sdkWire.js';

// Real `ReleaseApi` instance via the shared harness (test/helpers/sdkWire.ts): everything
// `SdkAdoClient.listReleaseDefinitionsWithArtifacts` does with it (`createRequestOptions`,
// `formatResponse`, reading `res.headers`) runs for real. Response bodies use ADO's actual wire
// shape (`{ count, value }`), and the continuation token is attached the way ADO really sends
// it: as the `x-ms-continuationtoken` response header, not a body field.
function stubbedSdkClient() {
  return withRealApi('release', { requestUrl: 'https://ado.example.test/tfs/Collection/proj/_apis/release/definitions' });
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

  it('accepts an array-valued x-ms-continuationtoken header (node repeats-header shape)', async () => {
    const { client, versioningDataSpy, restGetSpy } = stubbedSdkClient();
    restGetSpy
      .mockResolvedValueOnce({
        statusCode: 200,
        result: { count: 1, value: [{ id: 50, name: 'Deploy API' }] },
        headers: { 'x-ms-continuationtoken': ['tok-1'] },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        result: { count: 1, value: [{ id: 76, name: 'Deploy Old' }] },
        headers: {},
      });

    const result = await client.listReleaseDefinitionsWithArtifacts({ project: 'proj' });

    expect(result.map(def => def.id)).toEqual([50, 76]);
    const secondPageQuery = versioningDataSpy.mock.calls[1]?.[4] as Record<string, unknown>;
    expect(secondPageQuery.continuationToken).toBe('tok-1');
  });

  it('keeps artifacts and deserializes date fields through the real formatResponse', async () => {
    const { client, restGetSpy } = stubbedSdkClient();
    restGetSpy.mockResolvedValue({
      statusCode: 200,
      result: {
        count: 1,
        value: [{
          id: 50,
          name: 'Deploy API',
          modifiedOn: '2026-09-01T10:00:00.000Z',
          artifacts: [{ alias: '_api-ci', type: 'Build', definitionReference: { definition: { id: '140' } } }],
        }],
      },
      headers: {},
    });

    const [definition] = await client.listReleaseDefinitionsWithArtifacts({ project: 'proj' });

    expect(definition?.artifacts).toEqual([
      { alias: '_api-ci', type: 'Build', definitionReference: { definition: { id: '140' } } },
    ]);
    expect(definition?.modifiedOn).toEqual(new Date('2026-09-01T10:00:00.000Z'));
  });
});

describe('release definitions sdk drift check', () => {
  it('matches the api version and location id the real ReleaseApi.getReleaseDefinitions uses', async () => {
    // If azure-devops-node-api is upgraded and these move, SdkAdoClient's hand-driven
    // listReleaseDefinitionsWithArtifacts would silently hit an old route — fail here instead.
    const args = await captureVersioningArgs('release', async release => release.getReleaseDefinitions('p'));

    expect(args[0]).toBe(RELEASE_DEFINITIONS_API_VERSION);
    expect(args[1]).toBe('Release');
    expect(args[2]).toBe(RELEASE_DEFINITIONS_LOCATION_ID);
  });
});
