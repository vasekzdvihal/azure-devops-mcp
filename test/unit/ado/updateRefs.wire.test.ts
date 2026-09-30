import { GitApi } from 'azure-devops-node-api/GitApi.js';
import { describe, expect, it, vi } from 'vitest';

const STOP = 'captured';
const ZERO = '0'.repeat(40);
const SHA = 'a'.repeat(40);

/**
 * `GitApi.updateRefs` sends its ref-update array as the raw request body via
 * `rest.create(url, refUpdates, options)` — the array is never routed through
 * `vsoClient.getVersioningData`'s query values like the read-side methods in
 * queryShapes.test.ts, so this stubs `rest.create` instead to capture the exact body
 * `SdkAdoClient.updateRefs` would put on the wire.
 */
async function captureUpdateRefsBody(refUpdates: Parameters<GitApi['updateRefs']>[0]): Promise<unknown> {
  const git = new GitApi('https://ado.example.test/tfs/Collection', []);
  // getVersioningData resolves the request URL/apiVersion before the SDK ever calls
  // rest.create — stub it with a fake location so no network call happens, then stop
  // execution at rest.create to capture the exact body it was about to send.
  vi.spyOn(git.vsoClient, 'getVersioningData').mockResolvedValue({
    requestUrl: 'https://ado.example.test/tfs/Collection/proj/_apis/git/repositories/repo/refs',
    apiVersion: '7.2-preview.2',
  });
  const spy = vi.spyOn(git.rest, 'create').mockRejectedValue(new Error(STOP));
  await expect(git.updateRefs(refUpdates, 'repo', 'proj')).rejects.toThrow(STOP);
  return spy.mock.calls[0]?.[1];
}

describe('sdkAdoClient.updateRefs wire shape', () => {
  it('sends the ref update array with a 40-zero oldObjectId, unchanged, to the wire', async () => {
    const body = await captureUpdateRefsBody([
      { name: 'refs/heads/main', oldObjectId: ZERO, newObjectId: SHA },
    ]);
    expect(body).toEqual([{ name: 'refs/heads/main', oldObjectId: ZERO, newObjectId: SHA }]);
  });
});
