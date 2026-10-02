import { BuildApi } from 'azure-devops-node-api/BuildApi.js';
import { GitApi } from 'azure-devops-node-api/GitApi.js';
import { ReleaseApi } from 'azure-devops-node-api/ReleaseApi.js';
import { expect, vi } from 'vitest';
import { SdkAdoClient } from '../../src/ado/sdkClient.js';

/**
 * Shared harness for the `test/unit/ado/*.wire.test.ts` suites.
 *
 * `withRealApi(kind)` builds a real `SdkAdoClient` whose `api.get{Git,Build,Release}Api()` (the
 * `azure-devops-node-api` WebApi method that otherwise resolves a resource-area URL over the
 * network) hands back a real SDK API instance. Only that instance's transport is stubbed:
 * `vsoClient.getVersioningData` (route + query resolution) and every `rest` verb — `get`,
 * `create` (POST), `update` (PATCH), `replace` (PUT), `del` (DELETE). Everything else, including
 * the real SDK method's positional-argument → routeValues/queryValues wiring and
 * `formatResponse` deserialization, runs for real. That is what lets a wire test catch an
 * argument-order or body-shape mistake that `FakeAdoClient` never could.
 *
 * Every rest verb defaults to `{ statusCode: 200, result: null, headers: {} }` so a regression
 * that calls the wrong verb fails on an assertion, not on a real HTTP request. Tests override
 * the verb they care about with `mockResolvedValue(...)`.
 */

const BASE_URL = 'https://ado.example.test/tfs/Collection';

interface ApiByKind {
  git: GitApi;
  build: BuildApi;
  release: ReleaseApi;
}

export type WireApiKind = keyof ApiByKind;

const FACTORIES: { [K in WireApiKind]: { getter: string; create: () => ApiByKind[K] } } = {
  git: { getter: 'getGitApi', create: () => new GitApi(BASE_URL, []) },
  build: { getter: 'getBuildApi', create: () => new BuildApi(BASE_URL, []) },
  release: { getter: 'getReleaseApi', create: () => new ReleaseApi(BASE_URL, []) },
};

type Spy = ReturnType<typeof vi.spyOn>;

export interface WireHarness<K extends WireApiKind> {
  client: SdkAdoClient;
  api: ApiByKind[K];
  versioningDataSpy: Spy;
  restGetSpy: Spy;
  restCreateSpy: Spy;
  restUpdateSpy: Spy;
  restReplaceSpy: Spy;
  restDelSpy: Spy;
}

export interface WireOptions {
  /** URL `getVersioningData` resolves to — what the stubbed rest verb is called with. */
  requestUrl?: string;
  apiVersion?: string;
}

const EMPTY_RESPONSE = { statusCode: 200, result: null, headers: {} };

export function withRealApi<K extends WireApiKind>(kind: K, options: WireOptions = {}): WireHarness<K> {
  const client = new SdkAdoClient({ baseUrl: BASE_URL, pat: 'fake-pat' });
  const factory = FACTORIES[kind];
  const api = factory.create();
  const versioningDataSpy = vi.spyOn(api.vsoClient, 'getVersioningData').mockResolvedValue({
    requestUrl: options.requestUrl ?? `${BASE_URL}/proj/_apis/${kind}`,
    apiVersion: options.apiVersion ?? '7.2-preview.1',
  });
  const restGetSpy = vi.spyOn(api.rest, 'get').mockResolvedValue(EMPTY_RESPONSE);
  const restCreateSpy = vi.spyOn(api.rest, 'create').mockResolvedValue(EMPTY_RESPONSE);
  const restUpdateSpy = vi.spyOn(api.rest, 'update').mockResolvedValue(EMPTY_RESPONSE);
  const restReplaceSpy = vi.spyOn(api.rest, 'replace').mockResolvedValue(EMPTY_RESPONSE);
  const restDelSpy = vi.spyOn(api.rest, 'del').mockResolvedValue(EMPTY_RESPONSE);
  (client as unknown as { api: Record<string, () => Promise<unknown>> }).api[factory.getter] = async () => api;
  return { client, api, versioningDataSpy, restGetSpy, restCreateSpy, restUpdateSpy, restReplaceSpy, restDelSpy };
}

const STOP = 'captured';

/**
 * Runs a real SDK method with `getVersioningData` rejecting, so it stops right after the SDK
 * has computed its `getVersioningData(apiVersion, area, locationId, routeValues, queryValues)`
 * arguments — no rest verb and no network is touched. Returns those arguments.
 */
export async function captureVersioningArgs<K extends WireApiKind>(
  kind: K,
  invoke: (api: ApiByKind[K]) => Promise<unknown>,
): Promise<readonly unknown[]> {
  const { api, versioningDataSpy } = withRealApi(kind);
  versioningDataSpy.mockRejectedValue(new Error(STOP));
  await expect(invoke(api)).rejects.toThrow(STOP);
  const args: unknown = versioningDataSpy.mock.calls[0];
  if (!Array.isArray(args)) {
    throw new TypeError('getVersioningData was not called');
  }
  return args;
}
