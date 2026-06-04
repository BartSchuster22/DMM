import test from 'node:test';
import assert from 'node:assert/strict';
import { localValidateCredential } from '../src/adapters/hermes/adapter.ts';

test('BYOK local validation accepts API-key providers and rejects unsupported OAuth', () => {
  assert.equal(localValidateCredential('openrouter', 'sk-or-v1-testcredential').status, 'healthy');
  assert.equal(localValidateCredential('zai', 'glm-testcredential').status, 'healthy');
  assert.equal(localValidateCredential('openai-codex', 'oauth-token-shape').status, 'unsupported');
});

test('BYOK local validation rejects short or whitespace API keys', () => {
  assert.equal(localValidateCredential('openrouter', 'short').status, 'invalid');
  assert.equal(localValidateCredential('openrouter', 'has whitespace key').status, 'invalid');
});
