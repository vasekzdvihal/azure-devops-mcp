export abstract class AdoError extends Error {
  abstract readonly kind: string;
}

export class AdoAuthError extends AdoError {
  readonly kind = "auth";
  constructor(detail?: string) {
    super(
      "Authentication failed against Azure DevOps. " +
        "The PAT may be expired, revoked, or missing required scopes. " +
        "For read access (PRs, comments, commits): Code (read), Identity (read). " +
        "For pipelines: add Build (read). For releases: add Release (read). " +
        "For write access (post comment, vote, update PR): also add Code (write) and Pull Request (write). " +
        "Re-run setup with a new PAT." +
        (detail ? ` Details: ${detail}` : ""),
    );
    this.name = "AdoAuthError";
  }
}

export class AdoNotFoundError extends AdoError {
  readonly kind = "not_found";
  constructor(detail?: string) {
    super("The requested Azure DevOps resource was not found." + (detail ? ` Details: ${detail}` : ""));
    this.name = "AdoNotFoundError";
  }
}

export class AdoNetworkError extends AdoError {
  readonly kind = "network";
  constructor(detail?: string) {
    super(
      "Could not reach Azure DevOps. Check the configured baseUrl and your network connectivity." +
        (detail ? ` Details: ${detail}` : ""),
    );
    this.name = "AdoNetworkError";
  }
}

export class AdoTlsError extends AdoError {
  readonly kind = "tls";
  constructor(detail?: string) {
    super(
      "TLS verification failed against Azure DevOps. " +
        "If your server uses an internal CA, set the CA bundle path in the config (re-run setup)." +
        (detail ? ` Details: ${detail}` : ""),
    );
    this.name = "AdoTlsError";
  }
}

export class AdoConflictError extends AdoError {
  readonly kind = "conflict";
  constructor(detail?: string) {
    super(
      "Conflict from Azure DevOps. The resource state changed between your read and write " +
        "(PR may have been abandoned/completed, comment thread closed, or a concurrent edit " +
        "raced you). Re-fetch the resource and try again." +
        (detail ? ` Details: ${detail}` : ""),
    );
    this.name = "AdoConflictError";
  }
}

export class AdoUnknownError extends AdoError {
  readonly kind = "unknown";
  constructor(detail?: string) {
    super("Unexpected error from Azure DevOps." + (detail ? ` Details: ${detail}` : ""));
    this.name = "AdoUnknownError";
  }
}

export class AdoScopeError extends AdoError {
  readonly kind = "scope";
  readonly scope: string;
  constructor(scope: string, detail?: string) {
    super(
      `This call needs the '${scope}' PAT scope. Update your PAT in Azure DevOps ` +
        `(https://dev.azure.com/_usersSettings/tokens) and rerun ` +
        `\`npx -y @vasekzdvihal/azure-devops-mcp setup\`.` +
        (detail ? ` Underlying detail: ${detail}` : ""),
    );
    this.name = "AdoScopeError";
    this.scope = scope;
  }
}

interface SdkErrorShape {
  message?: string;
  statusCode?: number;
  code?: string;
}

function asSdkErrorShape(err: unknown): SdkErrorShape {
  if (err && typeof err === "object") return err as SdkErrorShape;
  return {};
}

function detectMissingScope(message: string): string | null {
  const lower = message.toLowerCase();
  if (lower.includes("vso.build_execute") || lower.includes("'build'")) {
    return "Build (read & execute)";
  }
  if (lower.includes("vso.release_execute") || lower.includes("'release'")) {
    return "Release (read, write, & execute)";
  }
  return null;
}

export function mapSdkError(err: unknown): AdoError {
  const shape = asSdkErrorShape(err);
  const detail = shape.message;

  if (shape.statusCode === 401 || shape.statusCode === 403) {
    const scope = detectMissingScope(detail ?? "");
    if (scope) {
      return new AdoScopeError(scope, detail);
    }
    return new AdoAuthError(detail);
  }
  if (shape.statusCode === 404) {
    return new AdoNotFoundError(detail);
  }
  if (shape.statusCode === 409) {
    return new AdoConflictError(detail);
  }

  switch (shape.code) {
    case "ECONNREFUSED":
    case "ETIMEDOUT":
    case "ENOTFOUND":
    case "EHOSTUNREACH":
      return new AdoNetworkError(detail);
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
      return new AdoTlsError(detail);
  }

  return new AdoUnknownError(detail);
}
