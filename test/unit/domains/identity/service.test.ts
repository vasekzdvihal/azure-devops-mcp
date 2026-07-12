import type { Identity } from '../../../../src/ado/types.js';
import type { WhoamiResponse } from '../../../../src/domains/identity/service.js';
import { describe, expect, it } from 'vitest';
import { IdentityService } from '../../../../src/domains/identity/service.js';
import { FakeAdoClient } from '../../../fakes/FakeAdoClient.js';

describe('identityService.whoami', () => {
  it('returns a shaped response with id, displayName, and uniqueName', async () => {
    const fake = new FakeAdoClient();
    const identity: Partial<Identity> = {
      id: 'abc-123',
      providerDisplayName: 'Vasek Z.',
      properties: { Account: { $value: 'vasek@example.com' } },
    };
    fake.setWhoamiResult(identity as Identity);

    const svc = new IdentityService(fake);
    const result: WhoamiResponse = await svc.whoami();

    expect(result.id).toBe('abc-123');
    expect(result.displayName).toBe('Vasek Z.');
    expect(result.account).toBe('vasek@example.com');
  });

  it('propagates errors from the AdoClient untouched', async () => {
    const fake = new FakeAdoClient();
    const err = new Error('boom');
    fake.setWhoamiError(err);

    const svc = new IdentityService(fake);
    await expect(svc.whoami()).rejects.toBe(err);
  });

  it('handles missing Account property gracefully', async () => {
    const fake = new FakeAdoClient();
    fake.setWhoamiResult({ id: 'x', providerDisplayName: 'Y' } as Identity);

    const svc = new IdentityService(fake);
    const result = await svc.whoami();
    expect(result.account).toBeUndefined();
  });
});
