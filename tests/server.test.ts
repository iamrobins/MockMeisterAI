import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('partial TLS configuration fails before starting a server', () => {
  const result = spawnSync(process.execPath, ['server/index.ts'], {
    env: { ...process.env, OPENAI_API_KEY: '', HTTPS_CERT_FILE: 'missing.pem', HTTPS_KEY_FILE: '' },
    encoding: 'utf8', timeout: 10_000, windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Set both HTTPS_CERT_FILE and HTTPS_KEY_FILE/);
});
