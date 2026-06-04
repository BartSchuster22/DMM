import test from 'node:test';
import assert from 'node:assert/strict';
import { constantTimeEqual, safePublicMessage, sanitizeIdentifier, sanitizeSecret, securityHeaders } from '../src/security.ts';
import { sign, unsign } from '../src/auth/sessions.ts';
import { redactAdapterResult } from '../src/api.ts';

test('security headers include browser hardening and restrictive CSP', () => {
  assert.equal(securityHeaders['x-frame-options'], 'DENY');
  assert.equal(securityHeaders['x-content-type-options'], 'nosniff');
  assert.match(securityHeaders['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(securityHeaders['content-security-policy'], /script-src 'self'/);
});

test('signed session cookies verify using the expected secret and reject tampering', () => {
  const signed = sign('session-id', 'a'.repeat(40));
  assert.equal(unsign(signed, 'a'.repeat(40)), 'session-id');
  assert.equal(unsign(signed.replace('session-id', 'other-id'), 'a'.repeat(40)), null);
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
});

test('request input sanitizers reject unsafe identifiers and invalid secrets', () => {
  assert.equal(sanitizeIdentifier('openrouter/model-1', 'provider_id'), 'openrouter/model-1');
  assert.throws(() => sanitizeIdentifier('../etc/passwd', 'provider_id'), /provider_id_invalid/);
  assert.equal(sanitizeSecret('  sk-1234567890  '), 'sk-1234567890');
  assert.throws(() => sanitizeSecret('short'), /secret_invalid/);
  assert.throws(() => sanitizeSecret('abc\n12345678'), /secret_invalid/);
});

test('public errors and adapter results do not leak secret-bearing values', () => {
  assert.equal(safePublicMessage('bad token abc123'), 'Request failed');
  assert.equal(safePublicMessage('plain validation failed'), 'plain validation failed');
  const redacted = redactAdapterResult({ aggregateStatus: 'saved', detail: { apiKey: 'sk-live', nested: { token: 'tok' }, ok: 'yes' } });
  assert.deepEqual(redacted, { aggregateStatus: 'saved', detail: { apiKey: '[redacted]', nested: { token: '[redacted]' }, ok: 'yes' } });
});
