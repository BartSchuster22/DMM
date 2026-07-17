export type ProviderManifest = { id: string; label: string; authMethod: 'api_key' | 'oauth' | 'none' | 'unknown'; docsUrl?: string; metadata?: Record<string, unknown> };
export const providerManifests: ProviderManifest[] = [
  { id: 'openrouter', label: 'OpenRouter', authMethod: 'api_key', docsUrl: 'https://openrouter.ai/keys' },
  { id: 'openai', label: 'OpenAI', authMethod: 'api_key', docsUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic', authMethod: 'api_key', docsUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'deepseek', label: 'DeepSeek', authMethod: 'api_key', docsUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'groq', label: 'Groq', authMethod: 'api_key', docsUrl: 'https://console.groq.com/keys' },
  { id: 'zai', label: 'Z.ai', authMethod: 'api_key', docsUrl: 'https://z.ai' },
  { id: 'custom-openai-compatible', label: 'Custom OpenAI-compatible', authMethod: 'api_key' }
];

export function providerManifest(id: string): ProviderManifest | undefined {
  return providerManifests.find((provider) => provider.id === id);
}
