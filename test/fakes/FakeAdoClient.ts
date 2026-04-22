import type { AdoClient } from "../../src/ado/client.js";
import type { Identity } from "../../src/ado/types.js";

export interface FakeAdoClientState {
  whoamiResult?: Identity;
  whoamiError?: Error;
}

export class FakeAdoClient implements AdoClient {
  constructor(private state: FakeAdoClientState = {}) {}

  setWhoamiResult(identity: Identity): void {
    this.state = { whoamiResult: identity };
  }

  setWhoamiError(err: Error): void {
    this.state = { whoamiError: err };
  }

  async whoami(): Promise<Identity> {
    if (this.state.whoamiError) throw this.state.whoamiError;
    if (this.state.whoamiResult) return this.state.whoamiResult;
    throw new Error("FakeAdoClient.whoami: no result configured");
  }
}
