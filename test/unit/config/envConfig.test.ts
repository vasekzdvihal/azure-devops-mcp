import { describe, expect, it } from 'vitest';
import { configFromEnv, EnvConfigError } from '../../../src/config/envConfig.js';

const FULL_ENV = {
  AZURE_DEVOPS_BASE_URL: 'https://czprgsdevops01.newtonmedia.eu/DefaultCollection',
  AZURE_DEVOPS_KIND: 'server',
  AZURE_DEVOPS_PAT: 'secret-pat',
};

describe('config/envConfig', () => {
  it('returns null when no AZURE_DEVOPS_* config vars are set', () => {
    expect(configFromEnv({})).toBeNull();
  });

  it('ignores unrelated env vars', () => {
    expect(configFromEnv({ PATH: '/usr/bin', AZURE_DEVOPS_READ_ONLY: 'true' })).toBeNull();
  });

  it('builds config and PAT from a complete env', () => {
    const resolved = configFromEnv(FULL_ENV);
    expect(resolved).toEqual({
      config: {
        baseUrl: 'https://czprgsdevops01.newtonmedia.eu/DefaultCollection',
        kind: 'server',
      },
      pat: 'secret-pat',
    });
  });

  it('includes the CA bundle path when set', () => {
    const resolved = configFromEnv({ ...FULL_ENV, AZURE_DEVOPS_CA_BUNDLE: '/etc/ssl/corp-ca.pem' });
    expect(resolved?.config.caBundlePath).toBe('/etc/ssl/corp-ca.pem');
  });

  it('throws naming the missing vars when the env config is partial', () => {
    expect(() => configFromEnv({ AZURE_DEVOPS_PAT: 'secret-pat' }))
      .toThrow(EnvConfigError);
    expect(() => configFromEnv({ AZURE_DEVOPS_PAT: 'secret-pat' }))
      .toThrow(/AZURE_DEVOPS_BASE_URL.*AZURE_DEVOPS_KIND/);
  });

  it('does not fall back silently when a required var is empty', () => {
    expect(() => configFromEnv({ ...FULL_ENV, AZURE_DEVOPS_PAT: '' }))
      .toThrow(/AZURE_DEVOPS_PAT/);
  });

  it('treats all-empty vars as unset (compose passthrough of unset host vars)', () => {
    expect(configFromEnv({
      AZURE_DEVOPS_BASE_URL: '',
      AZURE_DEVOPS_KIND: '',
      AZURE_DEVOPS_PAT: '',
      AZURE_DEVOPS_CA_BUNDLE: '',
    })).toBeNull();
  });

  it('throws when only the CA bundle var is set', () => {
    expect(() => configFromEnv({ AZURE_DEVOPS_CA_BUNDLE: '/etc/ssl/corp-ca.pem' }))
      .toThrow(EnvConfigError);
  });

  it('rejects an invalid kind', () => {
    expect(() => configFromEnv({ ...FULL_ENV, AZURE_DEVOPS_KIND: 'cloud' }))
      .toThrow(/AZURE_DEVOPS_KIND/);
  });

  it('rejects a malformed base URL', () => {
    expect(() => configFromEnv({ ...FULL_ENV, AZURE_DEVOPS_BASE_URL: 'not-a-url' }))
      .toThrow(/AZURE_DEVOPS_BASE_URL/);
  });
});
