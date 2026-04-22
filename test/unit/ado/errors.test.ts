import { describe, it, expect } from "vitest";
import {
  AdoAuthError,
  AdoNotFoundError,
  AdoNetworkError,
  AdoTlsError,
  AdoUnknownError,
  mapSdkError,
} from "../../../src/ado/errors.js";

describe("mapSdkError", () => {
  it("maps statusCode 401 to AdoAuthError", () => {
    const err = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    const mapped = mapSdkError(err);
    expect(mapped).toBeInstanceOf(AdoAuthError);
  });

  it("maps statusCode 403 to AdoAuthError", () => {
    const err = Object.assign(new Error("Forbidden"), { statusCode: 403 });
    expect(mapSdkError(err)).toBeInstanceOf(AdoAuthError);
  });

  it("maps statusCode 404 to AdoNotFoundError", () => {
    const err = Object.assign(new Error("Not found"), { statusCode: 404 });
    expect(mapSdkError(err)).toBeInstanceOf(AdoNotFoundError);
  });

  it("maps ECONNREFUSED to AdoNetworkError", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    expect(mapSdkError(err)).toBeInstanceOf(AdoNetworkError);
  });

  it("maps ETIMEDOUT to AdoNetworkError", () => {
    const err = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    expect(mapSdkError(err)).toBeInstanceOf(AdoNetworkError);
  });

  it("maps ENOTFOUND to AdoNetworkError", () => {
    const err = Object.assign(new Error("DNS"), { code: "ENOTFOUND" });
    expect(mapSdkError(err)).toBeInstanceOf(AdoNetworkError);
  });

  it("maps UNABLE_TO_VERIFY_LEAF_SIGNATURE to AdoTlsError", () => {
    const err = Object.assign(new Error("tls"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
    expect(mapSdkError(err)).toBeInstanceOf(AdoTlsError);
  });

  it("maps SELF_SIGNED_CERT_IN_CHAIN to AdoTlsError", () => {
    const err = Object.assign(new Error("tls"), { code: "SELF_SIGNED_CERT_IN_CHAIN" });
    expect(mapSdkError(err)).toBeInstanceOf(AdoTlsError);
  });

  it("falls back to AdoUnknownError for unrecognized errors", () => {
    expect(mapSdkError(new Error("???"))).toBeInstanceOf(AdoUnknownError);
  });

  it("handles thrown non-Error values", () => {
    expect(mapSdkError("string error")).toBeInstanceOf(AdoUnknownError);
    expect(mapSdkError(undefined)).toBeInstanceOf(AdoUnknownError);
  });

  it("AdoAuthError carries a helpful message about scopes", () => {
    const mapped = mapSdkError(Object.assign(new Error("x"), { statusCode: 401 }));
    expect(mapped.message).toMatch(/PAT/i);
    expect(mapped.message).toMatch(/scope/i);
  });

  it("AdoTlsError mentions CA bundle config", () => {
    const mapped = mapSdkError(Object.assign(new Error("x"), { code: "SELF_SIGNED_CERT_IN_CHAIN" }));
    expect(mapped.message).toMatch(/CA bundle/i);
  });
});
