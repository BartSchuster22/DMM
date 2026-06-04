import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHermesCatalog } from '../src/adapters/hermes/adapter.ts';

test('normalizes Hermes canonical catalog without leaking secret values', () => {
  const normalized = normalizeHermesCatalog({
    json: {
      config: { provider: 'openai-codex', model: 'gpt-5.5', fallbacks: [{ provider: 'zai', model: 'glm-5' }] },
      providers: [
        { id: 'openai-codex', label: 'OpenAI Codex', authType: 'oauth_external', configured: true, credentialPoolCount: 1, configuredEnvVars: [], requiredEnvVars: [], baseUrl: 'https://chatgpt.com/backend-api/codex', transport: 'codex_responses' },
        { id: 'zai', label: 'Z.AI / GLM', authType: 'api_key', configured: true, credentialPoolCount: 0, configuredEnvVars: ['GLM_API_KEY'], requiredEnvVars: ['GLM_API_KEY'], baseUrl: 'https://api.z.ai/api/paas/v4', transport: 'openai_chat' },
        { id: 'openrouter', label: 'OpenRouter', authType: 'api_key', configured: true, credentialPoolCount: 0, configuredEnvVars: ['OPENROUTER_API_KEY'], requiredEnvVars: ['OPENROUTER_API_KEY'], transport: 'openai_chat', isAggregator: true }
      ],
      models: [
        { provider: 'openai-codex', id: 'gpt-5.5', source: 'hermes-config-primary', primary: true },
        { provider: 'zai', id: 'glm-5', source: 'hermes-config-fallback', fallback: true },
        { provider: 'openrouter', id: 'qwen/qwen3-coder:free', source: 'hermes-static-provider-models' }
      ]
    }
  });

  assert.deepEqual(normalized.providers.map((p) => p.id), ['openai-codex', 'openrouter', 'zai']);
  assert.equal(normalized.providers.find((p) => p.id === 'openai-codex')?.authMethod, 'oauth');
  assert.equal(normalized.providers.find((p) => p.id === 'zai')?.authMethod, 'api_key');
  assert.equal(normalized.models.find((m) => m.id === 'openai-codex:gpt-5.5')?.status, 'configured_default');
  assert.equal(normalized.models.find((m) => m.id === 'zai:glm-5')?.status, 'configured_fallback');
  assert.equal(JSON.stringify(normalized).includes('sk-'), false);
});
