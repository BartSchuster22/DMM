#!/usr/bin/env python3
import json
import os
import sys

sys.path.insert(0, '/home/herman/.hermes/hermes-agent-live-lane-clean')

from hermes_cli.config import get_env_value, load_config
from hermes_cli.models import CANONICAL_PROVIDERS, _PROVIDER_MODELS
from hermes_cli.providers import HERMES_OVERLAYS
from hermes_cli.auth import PROVIDER_REGISTRY, read_credential_pool


def main():
    cfg = load_config()
    model_cfg = cfg.get('model') if isinstance(cfg, dict) else {}
    if isinstance(model_cfg, str):
        primary_model = model_cfg.strip()
        primary_provider = ''
    elif isinstance(model_cfg, dict):
        primary_model = str(model_cfg.get('default') or model_cfg.get('model') or '').strip()
        primary_provider = str(model_cfg.get('provider') or '').strip()
    else:
        primary_model = ''
        primary_provider = ''

    fallbacks = []
    for item in (cfg.get('fallback_providers') or []) if isinstance(cfg, dict) else []:
        if isinstance(item, dict):
            provider = str(item.get('provider') or '').strip()
            model = str(item.get('model') or '').strip()
            if provider or model:
                fallbacks.append({'provider': provider, 'model': model})

    manual_env = {
        'openrouter': ('OPENROUTER_API_KEY',),
        'custom': ('CUSTOM_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY'),
    }

    def auth_info(pid):
        pconfig = PROVIDER_REGISTRY.get(pid)
        overlay = HERMES_OVERLAYS.get(pid)
        auth_type = getattr(pconfig, 'auth_type', '') or getattr(overlay, 'auth_type', '') or 'api_key'
        env_vars = []
        if pconfig:
            env_vars.extend(list(getattr(pconfig, 'api_key_env_vars', ()) or ()))
        if overlay:
            env_vars.extend(list(getattr(overlay, 'extra_env_vars', ()) or ()))
        env_vars.extend(manual_env.get(pid, ()))
        seen = set()
        env_vars = [e for e in env_vars if e and not (e in seen or seen.add(e))]
        configured_env = [e for e in env_vars if (get_env_value(e) or os.getenv(e, '')).strip()]
        try:
            pool_count = len([x for x in read_credential_pool(pid) if isinstance(x, dict)])
        except Exception:
            pool_count = 0
        return {
            'authType': auth_type,
            'envVars': env_vars,
            'configuredEnvVars': configured_env,
            'credentialPoolCount': pool_count,
            'configured': bool(configured_env or pool_count),
        }

    providers = []
    for entry in CANONICAL_PROVIDERS:
        pid = entry.slug
        info = auth_info(pid)
        pconfig = PROVIDER_REGISTRY.get(pid)
        overlay = HERMES_OVERLAYS.get(pid)
        providers.append({
            'id': pid,
            'label': entry.label,
            'description': entry.tui_desc,
            'authType': info['authType'],
            'configured': info['configured'],
            'credentialPoolCount': info['credentialPoolCount'],
            'configuredEnvVars': info['configuredEnvVars'],
            'requiredEnvVars': info['envVars'],
            'baseUrl': (getattr(overlay, 'base_url_override', '') if overlay else '') or (getattr(pconfig, 'inference_base_url', '') if pconfig else ''),
            'transport': getattr(overlay, 'transport', '') if overlay else '',
            'isAggregator': bool(getattr(overlay, 'is_aggregator', False)) if overlay else False,
        })

    models = []
    for pid, ids in _PROVIDER_MODELS.items():
        if not isinstance(ids, list):
            continue
        for mid in ids:
            if isinstance(mid, str) and mid:
                models.append({'provider': pid, 'id': mid, 'source': 'hermes-static-provider-models'})

    if primary_provider and primary_model:
        models.append({'provider': primary_provider, 'id': primary_model, 'source': 'hermes-config-primary', 'primary': True})
    for fb in fallbacks:
        if fb.get('provider') and fb.get('model'):
            models.append({'provider': fb['provider'], 'id': fb['model'], 'source': 'hermes-config-fallback', 'fallback': True})

    print(json.dumps({
        'config': {'provider': primary_provider, 'model': primary_model, 'fallbacks': fallbacks},
        'providers': providers,
        'models': models,
    }, separators=(',', ':')))


if __name__ == '__main__':
    main()
