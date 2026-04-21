// src/ado/sdkClient.ts
import * as azdev from "azure-devops-node-api";
import https from "node:https";
import type { AdoClient } from "./client.js";
import type { Identity } from "./types.js";
import { mapSdkError, AdoUnknownError } from "./errors.js";
import { buildHttpsAgent } from "./tlsAgent.js";

export interface SdkAdoClientOptions {
  baseUrl: string;
  pat: string;
  caBundlePath?: string;
}

export class SdkAdoClient implements AdoClient {
  private readonly api: azdev.WebApi;

  constructor(opts: SdkAdoClientOptions) {
    const handler = azdev.getPersonalAccessTokenHandler(opts.pat);

    // azure-devops-node-api uses Node's http(s) module under the hood. There is
    // no per-request hook to inject an extra CA, so when one is configured we
    // swap Node's global https agent. Both the setup wizard and the server only
    // talk to one ADO instance per process, so this is safe.
    const agent = buildHttpsAgent(opts.caBundlePath);
    if (agent) https.globalAgent = agent;

    // Default socket timeout in typed-rest-client is 3 minutes — way too long
    // for a CLI tool when a firewall silently drops packets. 15s is plenty for
    // any ADO API we call and surfaces a useful error fast.
    this.api = new azdev.WebApi(opts.baseUrl, handler, { socketTimeout: 15_000 });
  }

  async whoami(): Promise<Identity> {
    try {
      const conn = await this.api.connect();
      const user = conn.authenticatedUser;
      if (!user) throw new AdoUnknownError("connect() returned no authenticatedUser");
      return user;
    } catch (err) {
      // Re-throw our own errors (already mapped) instead of double-wrapping.
      if (err instanceof AdoUnknownError) throw err;
      throw mapSdkError(err);
    }
  }
}
