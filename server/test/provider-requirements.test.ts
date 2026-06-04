import test from 'node:test';
import assert from 'node:assert/strict';
import { credentialStatusFromDiscoveredProvider } from '../src/catalog/catalog.ts';

test('derives credential status from discovered provider metadata without secrets', () => {
  assert.equal(credentialStatusFromDiscoveredProvider({ id: 'openrouter', label: 'OpenRouter', harnessProviderId: 'openrouter', authMethod: 'api_key', status: 'available', metadata: { configuredEnvVars: ['OPENROUTER_API_KEY'] } }), 'saved');
  assert.equal(credentialStatusFromDiscoveredProvider({ id: 'openai-codex', label: 'OpenAI Codex', harnessProviderId: 'openai-codex', authMethod: 'oauth', status: 'configured', metadata: { credentialPoolCount: 1 } }), 'saved');
  assert.equal(credentialStatusFromDiscoveredProvider({ id: 'anthropic', label: 'Anthropic', harnessProviderId: 'anthropic', authMethod: 'api_key', status: 'available', metadata: { requiredEnvVars: ['ANTHROPIC_API_KEY'] } }), 'missing');
});
