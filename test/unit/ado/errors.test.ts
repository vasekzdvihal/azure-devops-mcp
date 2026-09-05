import { describe, expect, it } from 'vitest';
import {
  AdoAuthError,
  AdoConflictError,
  AdoNetworkError,
  AdoNotFoundError,
  AdoScopeError,
  AdoTlsError,
  AdoUnknownError,
  mapSdkError,
} from '../../../src/ado/errors.js';

describe('mapSdkError', () => {
  it('maps statusCode 401 to AdoAuthError', () => {
    const err = Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    const mapped = mapSdkError(err);
    expect(mapped).toBeInstanceOf(AdoAuthError);
  });

  it('maps statusCode 403 to AdoAuthError', () => {
    const err = Object.assign(new Error('Forbidden'), { statusCode: 403 });
    expect(mapSdkError(err)).toBeInstanceOf(AdoAuthError);
  });

  it('maps statusCode 404 to AdoNotFoundError', () => {
    const err = Object.assign(new Error('Not found'), { statusCode: 404 });
    expect(mapSdkError(err)).toBeInstanceOf(AdoNotFoundError);
  });

  it('maps ECONNREFUSED to AdoNetworkError', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(mapSdkError(err)).toBeInstanceOf(AdoNetworkError);
  });

  it('maps ETIMEDOUT to AdoNetworkError', () => {
    const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    expect(mapSdkError(err)).toBeInstanceOf(AdoNetworkError);
  });

  it('maps ENOTFOUND to AdoNetworkError', () => {
    const err = Object.assign(new Error('DNS'), { code: 'ENOTFOUND' });
    expect(mapSdkError(err)).toBeInstanceOf(AdoNetworkError);
  });

  it('maps UNABLE_TO_VERIFY_LEAF_SIGNATURE to AdoTlsError', () => {
    const err = Object.assign(new Error('tls'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });
    expect(mapSdkError(err)).toBeInstanceOf(AdoTlsError);
  });

  it('maps SELF_SIGNED_CERT_IN_CHAIN to AdoTlsError', () => {
    const err = Object.assign(new Error('tls'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    expect(mapSdkError(err)).toBeInstanceOf(AdoTlsError);
  });

  it('falls back to AdoUnknownError for unrecognized errors', () => {
    expect(mapSdkError(new Error('???'))).toBeInstanceOf(AdoUnknownError);
  });

  it('handles thrown non-Error values', () => {
    expect(mapSdkError('string error')).toBeInstanceOf(AdoUnknownError);
    expect(mapSdkError(undefined)).toBeInstanceOf(AdoUnknownError);
  });

  it('adoAuthError mentions both read and write scopes', () => {
    const mapped = mapSdkError(Object.assign(new Error('x'), { statusCode: 401 }));
    expect(mapped.message).toMatch(/PAT/i);
    expect(mapped.message).toMatch(/Code \(read\)/);
    expect(mapped.message).toMatch(/Code \(write\)/);
    expect(mapped.message).toMatch(/Pull Request \(write\)/);
  });

  it('adoTlsError mentions CA bundle config', () => {
    const mapped = mapSdkError(Object.assign(new Error('x'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }));
    expect(mapped.message).toMatch(/CA bundle/i);
  });

  it('maps statusCode 409 to AdoConflictError', () => {
    const err = Object.assign(new Error('Conflict'), { statusCode: 409 });
    expect(mapSdkError(err)).toBeInstanceOf(AdoConflictError);
  });

  it('adoConflictError carries a message about the conflict', () => {
    const mapped = mapSdkError(Object.assign(new Error('Thread is closed'), { statusCode: 409 }));
    expect(mapped.message).toMatch(/conflict/i);
    expect(mapped.message).toMatch(/Thread is closed/);
  });
});

describe('adoScopeError', () => {
  it('extends AdoError with the scope name on the message', () => {
    const err = new AdoScopeError('Build (read & execute)', 'underlying detail');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AdoScopeError');
    expect(err.scope).toBe('Build (read & execute)');
    expect(err.message).toContain('Build (read & execute)');
    expect(err.message).toContain('rerun');
  });
});

describe('mapSdkError — scope hint branch', () => {
  it('403 with body mentioning Release scope → AdoScopeError naming the right scope', () => {
    // The SDK surfaces the HTTP body message as the error's `message` property.
    const err = Object.assign(new Error('TF400813: Resource not available for anonymous access. The user requires the \'Release\' permission with \'Manage\' scope.'), {
      statusCode: 403,
    });
    const mapped = mapSdkError(err);
    expect(mapped).toBeInstanceOf(AdoScopeError);
    expect((mapped as AdoScopeError).scope).toMatch(/Release/);
    expect((mapped as AdoScopeError).scope).toMatch(/manage/);
  });

  it('403 without scope hint → falls through to AdoAuthError', () => {
    const err = Object.assign(new Error('Forbidden'), { statusCode: 403 });
    const mapped = mapSdkError(err);
    expect(mapped).toBeInstanceOf(AdoAuthError);
    expect(mapped).not.toBeInstanceOf(AdoScopeError);
  });

  it('401 with scope hint → AdoScopeError', () => {
    const err = Object.assign(new Error('Token does not have required scope: vso.build_execute'), {
      statusCode: 401,
    });
    const mapped = mapSdkError(err);
    expect(mapped).toBeInstanceOf(AdoScopeError);
    expect((mapped as AdoScopeError).scope).toMatch(/Build/);
  });

  it('403 mentioning \'Release\' as an identifier (not a scope hint) does NOT produce AdoScopeError', () => {
    const err = Object.assign(new Error('The stage \'Release\' is not in a deployable state.'), {
      statusCode: 403,
    });
    const mapped = mapSdkError(err);
    expect(mapped).toBeInstanceOf(AdoAuthError);
    expect(mapped).not.toBeInstanceOf(AdoScopeError);
  });

  it('403 with body mentioning vso.release_manage → AdoScopeError naming the manage tier', () => {
    const err = Object.assign(new Error('The token lacks scope vso.release_manage'), {
      statusCode: 403,
    });
    const mapped = mapSdkError(err);
    expect(mapped).toBeInstanceOf(AdoScopeError);
    expect((mapped as AdoScopeError).scope).toBe('Release (read, write, execute, & manage)');
  });
});
