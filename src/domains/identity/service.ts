import type { AdoClient } from '../../ado/client.js';
import type { Identity } from '../../ado/types.js';

export interface WhoamiResponse {
  id: string;
  displayName?: string;
  account?: string;
}

export class IdentityService {
  constructor(private readonly client: AdoClient) {}

  async whoami(): Promise<WhoamiResponse> {
    const identity = await this.client.whoami();
    return shape(identity);
  }
}

function shape(identity: Identity): WhoamiResponse {
  const accountProp = identity.properties?.Account as { $value?: string } | undefined;
  return {
    id: identity.id ?? '',
    displayName: identity.providerDisplayName,
    account: accountProp?.$value,
  };
}
