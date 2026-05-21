// src/setup.ts
import { input, password } from "@inquirer/prompts";
import { writeConfig } from "./config/configFile.js";
import { setPat, accountFromBaseUrl } from "./config/keyring.js";
import { SdkAdoClient } from "./ado/sdkClient.js";
import { configFilePath } from "./config/paths.js";
import type { Config } from "./config/schema.js";

export async function runSetup(): Promise<void> {
  process.stdout.write("\nAzure DevOps MCP — setup\n\n");
  process.stdout.write(
    "Required PAT scopes:\n" +
      "  Read access:   Code (read), Identity (read), Build (read), Release (read), Work Items (read)\n" +
      "  Write access:  also add Code (write), Pull Request (write), Build (read & execute), Release (read, write, & execute), Work Items (read & write)\n" +
      "If you only want read tools, use a read-only PAT or set AZURE_DEVOPS_READ_ONLY=true.\n\n",
  );

  // Loop: collect inputs, test connection, only write on success.
  for (;;) {
    const baseUrl = await input({
      message:
        "ADO base URL (e.g. https://dev.azure.com/myorg or https://tfs.company.com/tfs/DefaultCollection):",
      validate: (v) => {
        try {
          new URL(v);
          return true;
        } catch {
          return "Must be a valid URL";
        }
      },
    });

    const pat = await password({
      message: "Personal Access Token (input hidden):",
      mask: "*",
      validate: (v) => v.length > 0 || "PAT cannot be empty",
    });

    const caBundlePath = await input({
      message: "Path to extra CA bundle (PEM file) — leave blank if not needed:",
      default: "",
    });

    const kind: Config["kind"] = detectKind(baseUrl);

    process.stdout.write("\nTesting connection...\n");
    try {
      const client = new SdkAdoClient({
        baseUrl,
        pat,
        caBundlePath: caBundlePath || undefined,
      });
      const me = await client.whoami();
      process.stdout.write(`  ✓ Connected as: ${me.providerDisplayName ?? me.id}\n\n`);

      const config: Config = {
        baseUrl,
        kind,
        ...(caBundlePath ? { caBundlePath } : {}),
      };
      await writeConfig(config);
      setPat(accountFromBaseUrl(baseUrl), pat);

      process.stdout.write(`Config saved: ${configFilePath()}\n`);
      process.stdout.write(
        `PAT stored in OS keyring (service: azure-devops-mcp, account: ${accountFromBaseUrl(baseUrl)})\n\n`,
      );
      printClaudeCodeSnippet();
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`\n  ✗ ${message}\n\n`);
      process.stdout.write("Let's try again.\n\n");
      // loop back
    }
  }
}

function detectKind(baseUrl: string): Config["kind"] {
  const host = new URL(baseUrl).host.toLowerCase();
  if (host === "dev.azure.com" || host.endsWith(".visualstudio.com")) return "services";
  return "server";
}

function printClaudeCodeSnippet(): void {
  const snippet = {
    mcpServers: {
      "azure-devops": {
        command: "npx",
        args: ["-y", "@vasekzdvihal/azure-devops-mcp"],
      },
    },
  };
  process.stdout.write("Add this to your Claude Code MCP config:\n\n");
  process.stdout.write(JSON.stringify(snippet, null, 2));
  process.stdout.write("\n\n");
}
