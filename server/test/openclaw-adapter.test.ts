import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOpenClawCatalog } from '../src/adapters/openclaw/adapter.ts';

test('normalizes OpenClaw models status into providers and models without leaking credential labels', () => {
  const normalized = normalizeOpenClawCatalog({
    status: {
      json: {
        defaultModel: 'openai-codex/gpt-5.4',
        resolvedDefault: 'openai-codex/gpt-5.4',
        fallbacks: ['openrouter/qwen/qwen3-coder:free', 'openrouter/auto'],
        allowed: ['openai-codex/gpt-5.4'],
        auth: {
          providers: [
            { provider: 'anthropic', effective: { kind: 'profiles', detail: 'auth-profiles.json' }, profiles: { count: 1, oauth: 0, token: 0, apiKey: 1, labels: ['anthropic:default=sk...AA'] } },
            { provider: 'openai-codex', effective: { kind: 'profiles', detail: 'auth-profiles.json' }, profiles: { count: 1, oauth: 1, token: 0, apiKey: 0, labels: ['openai-codex:user=OAuth'] } },
            { provider: 'openrouter', effective: { kind: 'profiles', detail: 'auth-profiles.json' }, profiles: { count: 1, oauth: 0, token: 0, apiKey: 1, labels: ['openrouter:default=sk-or...'] } }
          ],
          missingProvidersInUse: []
        }
      }
    },
    modelsList: { json: { count: 1, models: [{ key: 'openai-codex/gpt-5.4', name: 'gpt-5.4', input: 'text+image', contextWindow: 1050000, local: false, available: true, tags: ['default', 'configured'], missing: false }] } }
  });

  assert.deepEqual(normalized.providers.map((p) => p.id), ['anthropic', 'openai-codex', 'openrouter']);
  assert.equal(normalized.providers.find((p) => p.id === 'openai-codex')?.authMethod, 'oauth');
  assert.equal(normalized.providers.find((p) => p.id === 'openrouter')?.authMethod, 'api_key');
  assert.equal(normalized.models.length, 3);
  assert.equal(normalized.models.find((m) => m.id === 'openai-codex:gpt-5.4')?.contextWindow, 1050000);
  assert.equal(normalized.models.find((m) => m.id === 'openai-codex:gpt-5.4')?.modality, 'text+image');
  assert.equal(JSON.stringify(normalized), JSON.stringify(normalized).includes('sk-or') ? 'secret leaked' : JSON.stringify(normalized));
});
