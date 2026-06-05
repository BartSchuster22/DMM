#!/usr/bin/env python3
import json, os, re, shlex, shutil, subprocess, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, unquote

TOKEN = os.environ.get('DMM_HOST_HELPER_TOKEN', '')
HOST = os.environ.get('DMM_HOST_HELPER_HOST', '127.0.0.1')
PORT = int(os.environ.get('DMM_HOST_HELPER_PORT', '4120'))

def run(cmd, timeout=25, input_text=None):
    proc = subprocess.run(cmd, shell=True, text=True, input=input_text, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, executable='/bin/bash')
    out = proc.stdout.strip()
    err = proc.stderr.strip()
    return {'exitCode': proc.returncode, 'stdout': out, 'stderr': err}

def run_partial(cmd, timeout=25):
    try:
        return run(cmd, timeout)
    except subprocess.TimeoutExpired as exc:
        out = exc.stdout or ''
        err = exc.stderr or ''
        if isinstance(out, bytes):
            out = out.decode(errors='replace')
        if isinstance(err, bytes):
            err = err.decode(errors='replace')
        return {'exitCode': 124, 'stdout': out.strip(), 'stderr': err.strip(), 'timedOut': True}

def json_from_stdout(result):
    text = result.get('stdout') or ''
    try:
        return json.loads(text or '{}')
    except Exception:
        start = min([i for i in [text.find('{'), text.find('[')] if i >= 0], default=-1)
        if start < 0:
            return {}
        for end in range(len(text), start, -1):
            try:
                return json.loads(text[start:end])
            except Exception:
                pass
        return {}

def openclaw_env(command):
    return "sudo -u alice -H env PATH='/home/alice/.npm-global/bin:/home/alice/.nvm/versions/node/v22.22.2/bin:/opt/node22/bin:/usr/local/bin:/usr/bin:/bin' " + command

def hermes_env(command):
    return "sudo -u herman -H env PATH='/home/herman/.local/bin:/home/herman/.hermes/hermes-agent-live-lane-clean/venv/bin:/opt/node22/bin:/usr/local/bin:/usr/bin:/bin' " + command


OPENCLAW_HOME = Path(os.environ.get('DMM_OPENCLAW_HOME', '/home/alice/.openclaw'))
OPENCLAW_AGENT_ID = os.environ.get('DMM_OPENCLAW_AGENT_ID', 'main')
OPENCLAW_ALLOWED_API_KEY_PROVIDERS = {'anthropic','openai','openrouter','zai','google','mistral','groq','xai','together','deepseek','perplexity','cohere'}


def safe_provider_id(value):
    provider = str(value or '').strip().lower()
    if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{0,63}', provider):
        return ''
    return provider


def openclaw_paths():
    config = OPENCLAW_HOME / 'openclaw.json'
    auth_profiles = OPENCLAW_HOME / 'agents' / OPENCLAW_AGENT_ID / 'agent' / 'auth-profiles.json'
    return config, auth_profiles


def read_json_file(path, default):
    try:
        if not path.exists():
            return default
        with path.open('r', encoding='utf-8') as fh:
            data = json.load(fh)
        return data if isinstance(data, type(default)) else default
    except Exception as exc:
        raise RuntimeError(f'Failed to read {path.name}: {exc}')


def atomic_write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp-dmm')
    with tmp.open('w', encoding='utf-8') as fh:
        json.dump(data, fh, indent=2, sort_keys=True)
        fh.write('\n')
    os.replace(tmp, path)
    try:
        shutil.chown(path, user='alice', group='alice')
    except Exception:
        pass


def backup_file(path):
    if not path.exists():
        return None
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    backup = path.with_name(path.name + f'.dmm-backup-{stamp}')
    shutil.copy2(path, backup)
    try:
        shutil.chown(backup, user='alice', group='alice')
    except Exception:
        pass
    return str(backup)


def validate_openclaw_api_key(provider, secret):
    provider = safe_provider_id(provider)
    key = str(secret or '').strip()
    if not provider:
        return {'status': 'invalid', 'message': 'Provider id is invalid'}
    if provider == 'openai-codex':
        return {'status': 'unsupported', 'message': 'OpenAI Codex uses OAuth/device credentials, not BYOK API-key install'}
    if provider not in OPENCLAW_ALLOWED_API_KEY_PROVIDERS:
        return {'status': 'unsupported', 'message': 'No OpenClaw BYOK API-key install mapping exists for provider'}
    if len(key) < 8:
        return {'status': 'invalid', 'message': 'Credential is too short'}
    if re.search(r'\s', key):
        return {'status': 'invalid', 'message': 'API keys must not contain whitespace'}
    return {'status': 'healthy', 'message': 'Credential passed OpenClaw local BYOK format validation'}


def op_openclaw_validate_credential(body=None):
    body = body or {}
    return validate_openclaw_api_key(body.get('providerId'), body.get('secret'))


def op_openclaw_install_credential(body=None):
    body = body or {}
    provider = safe_provider_id(body.get('providerId'))
    secret = str(body.get('secret') or '').strip()
    validation = validate_openclaw_api_key(provider, secret)
    if validation.get('status') != 'healthy':
        return {'status': validation.get('status'), 'message': validation.get('message')}

    config_path, profiles_path = openclaw_paths()
    config = read_json_file(config_path, {})
    profiles_doc = read_json_file(profiles_path, {'version': 1, 'profiles': {}})
    if not isinstance(config, dict):
        return {'status': 'error', 'message': 'OpenClaw config is not a JSON object'}
    if not isinstance(profiles_doc, dict):
        return {'status': 'error', 'message': 'OpenClaw auth profiles file is not a JSON object'}
    profiles = profiles_doc.setdefault('profiles', {})
    if not isinstance(profiles, dict):
        return {'status': 'error', 'message': 'OpenClaw auth profiles shape is invalid'}

    profile_id = provider + ':default'
    backups = [b for b in [backup_file(config_path), backup_file(profiles_path)] if b]

    profiles[profile_id] = {'type': 'api_key', 'provider': provider, 'key': secret}
    profiles_doc['version'] = int(profiles_doc.get('version') or 1)

    auth = config.setdefault('auth', {})
    if not isinstance(auth, dict):
        config['auth'] = auth = {}
    auth_profiles = auth.setdefault('profiles', {})
    if not isinstance(auth_profiles, dict):
        auth['profiles'] = auth_profiles = {}
    auth_profiles[profile_id] = {'mode': 'api_key', 'provider': provider}

    try:
        atomic_write_json(profiles_path, profiles_doc)
        atomic_write_json(config_path, config)
    except Exception as exc:
        return {'status': 'error', 'message': 'OpenClaw credential install failed while writing config files'}

    verify_doc = read_json_file(profiles_path, {'profiles': {}})
    installed = isinstance(verify_doc.get('profiles'), dict) and verify_doc['profiles'].get(profile_id, {}).get('provider') == provider
    if not installed:
        return {'status': 'error', 'message': 'OpenClaw credential install verification failed'}
    return {'status': 'installed', 'message': 'Credential installed into OpenClaw auth profile', 'profileId': profile_id, 'backupsCreated': len(backups)}

def op_openclaw_version():
    r = run(openclaw_env('openclaw --version'), 20)
    text = r.get('stdout') or r.get('stderr') or ''
    m = re.search(r'(\d{4}\.\d+\.\d+)', text)
    commit = re.search(r'\(([0-9a-f]{6,40})\)', text)
    r['currentVersion'] = m.group(1) if m else None
    r['commit'] = commit.group(1) if commit else None
    return r

def op_openclaw_update_status():
    r = run(openclaw_env('openclaw update status --json'), 30)
    try:
        j = json.loads(r.get('stdout') or '{}')
    except Exception:
        j = {}
    r['json'] = j
    r['available'] = bool(j.get('availability', {}).get('available'))
    r['latestVersion'] = j.get('availability', {}).get('latestVersion') or j.get('update', {}).get('registry', {}).get('latestVersion')
    r['channel'] = j.get('channel', {}).get('value')
    return r

def op_openclaw_models_status():
    r = run_partial(openclaw_env('openclaw models status --json'), 35)
    r['json'] = json_from_stdout(r)
    return r

def op_openclaw_models_list():
    # This OpenClaw install can print valid JSON and keep the event loop alive.
    # Capture partial stdout under timeout; the adapter consumes JSON if present.
    r = run_partial(openclaw_env('openclaw models list --json'), 35)
    r['json'] = json_from_stdout(r)
    return r

def op_openclaw_catalog_status():
    status = op_openclaw_models_status()
    models = op_openclaw_models_list()
    return {'status': status, 'modelsList': models}

def op_hermes_catalog_status():
    r = run(hermes_env('/home/herman/.hermes/hermes-agent-live-lane-clean/venv/bin/python /srv/dmm/scripts/hermes-catalog-status.py'), 90)
    r['json'] = json_from_stdout(r)
    return r

def op_hermes_version():
    r = run(hermes_env('hermes --version'), 25)
    text = r.get('stdout') or r.get('stderr') or ''
    m = re.search(r'Hermes Agent\s+(v?\d+\.\d+\.\d+)', text)
    r['currentVersion'] = m.group(1) if m else None
    r['message'] = text.splitlines()[0] if text.splitlines() else text
    return r

def op_hermes_update_status():
    r = run(hermes_env('hermes --version'), 25)
    text = (r.get('stdout') or '') + '\n' + (r.get('stderr') or '')
    r['available'] = bool(re.search(r'Update available|commits behind|behind', text, re.I))
    m = re.search(r'Hermes Agent\s+(v?\d+\.\d+\.\d+)', text)
    r['currentVersion'] = m.group(1) if m else None
    lines = [line.strip() for line in text.splitlines() if re.search(r'update|behind|upgrade', line, re.I)]
    r['message'] = ' | '.join(lines[:3]) if lines else ('No update information reported' if r['exitCode'] == 0 else text.strip())
    return r


def validate_api_key(provider, secret):
    key = (secret or '').strip()
    if len(key) < 8:
        return {'status': 'invalid', 'message': 'Credential is too short'}
    if re.search(r'\s', key):
        return {'status': 'invalid', 'message': 'API keys must not contain whitespace'}
    if provider == 'openai-codex':
        return {'status': 'unsupported', 'message': 'OpenAI Codex uses OAuth/device credentials, not BYOK API-key install'}
    api_key_providers = {'anthropic','openai','openrouter','zai','google','mistral','groq','xai','together','deepseek','perplexity','cohere'}
    if provider not in api_key_providers:
        return {'status': 'unsupported', 'message': 'No BYOK API-key validation is mapped for provider'}
    return {'status': 'healthy', 'message': 'Credential passed local BYOK format validation'}



def op_fmr_v2_repo_status(body=None):
    body = body or {}
    requested = str(body.get('repoPath') or '').strip()
    repo = Path(requested or os.environ.get('DMM_FMR_V2_REPO', '/home/herman/freemodelrouterv2'))
    allowed = Path(os.environ.get('DMM_FMR_V2_REPO', '/home/herman/freemodelrouterv2')).resolve()
    try:
        repo_resolved = repo.resolve()
    except Exception:
        repo_resolved = repo
    if repo_resolved != allowed:
        return {'repoPath': str(repo), 'exists': False, 'error': 'repo path is not allowlisted'}
    if not repo.exists():
        return {'repoPath': str(repo), 'exists': False}
    def git(args, timeout=15):
        return run('git -C ' + shlex.quote(str(repo)) + ' ' + args, timeout)
    branch = git('branch --show-current')
    status = git('status --short')
    log = git("log -1 --format='commit=%H%nshort=%h%nauthorDate=%aI%ncommitterDate=%cI%nsubject=%s'")
    remote = git('remote get-url origin')
    data = {'repoPath': str(repo), 'exists': True, 'clean': (status.get('stdout') or '') == '', 'branch': branch.get('stdout') or None, 'remote': remote.get('stdout') or None}
    for line in (log.get('stdout') or '').splitlines():
        if '=' in line:
            k, v = line.split('=', 1)
            data[k] = v
    pyproject = repo / 'pyproject.toml'
    if pyproject.exists():
        text = pyproject.read_text(encoding='utf-8', errors='replace')
        m = re.search(r'^version\s*=\s*["\']([^"\']+)["\']', text, re.M)
        if m:
            data['packageVersion'] = m.group(1)
    return data

def op_hermes_validate_credential(body=None):
    body = body or {}
    return validate_api_key(str(body.get('providerId') or ''), str(body.get('secret') or ''))

def op_hermes_install_credential(body=None):
    body = body or {}
    provider = str(body.get('providerId') or '').strip()
    secret = str(body.get('secret') or '').strip()
    label = str(body.get('label') or ('DMM BYOK ' + provider))
    validation = validate_api_key(provider, secret)
    if validation.get('status') != 'healthy':
        return {'status': validation.get('status'), 'message': validation.get('message')}
    cmd = hermes_env('hermes auth add ' + shlex.quote(provider) + ' --type api-key --label ' + shlex.quote(label) + ' --api-key ' + shlex.quote(secret))
    r = run(cmd, 30)
    if r.get('exitCode') == 0:
        return {'status': 'installed', 'message': 'Credential installed into Hermes auth pool'}
    return {'status': 'error', 'message': r.get('stderr') or r.get('stdout') or 'Hermes credential install failed'}

OPS = {
    'openclaw.version': op_openclaw_version,
    'openclaw.updateStatus': op_openclaw_update_status,
    'openclaw.modelsStatus': op_openclaw_models_status,
    'openclaw.modelsList': op_openclaw_models_list,
    'openclaw.catalogStatus': op_openclaw_catalog_status,
    'openclaw.validateCredential': op_openclaw_validate_credential,
    'openclaw.installCredential': op_openclaw_install_credential,
    'hermes.version': op_hermes_version,
    'hermes.updateStatus': op_hermes_update_status,
    'hermes.catalogStatus': op_hermes_catalog_status,
    'hermes.validateCredential': op_hermes_validate_credential,
    'hermes.installCredential': op_hermes_install_credential,
    'fmr.v2RepoStatus': op_fmr_v2_repo_status,
}

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.path == '/health':
            return self._send(200, {'ok': True, 'service': 'dmm-host-helper'})
        return self._send(404, {'ok': False, 'error': {'code': 'not_found', 'message': 'Not found'}})
    def do_POST(self):
        if TOKEN and self.headers.get('x-dmm-helper-token') != TOKEN:
            return self._send(401, {'ok': False, 'error': {'code': 'unauthorized', 'message': 'Invalid helper token'}})
        path = urlparse(self.path).path
        prefix = '/v1/operations/'
        if not path.startswith(prefix):
            return self._send(404, {'ok': False, 'error': {'code': 'not_found', 'message': 'Not found'}})
        operation = unquote(path[len(prefix):])
        if operation not in OPS:
            return self._send(403, {'ok': False, 'operation': operation, 'error': {'code': 'operation_not_allowed', 'message': 'Operation is not allowlisted'}})
        try:
            length = int(self.headers.get('content-length') or 0)
            body = {}
            if length:
                try:
                    body = json.loads(self.rfile.read(length).decode() or '{}')
                except Exception:
                    body = {}
            fn = OPS[operation]
            try:
                data = fn(body)
            except TypeError:
                data = fn()
            if data.get('exitCode') not in (0, None):
                return self._send(502, {'ok': False, 'operation': operation, 'error': {'code': 'command_failed', 'message': data.get('stderr') or data.get('stdout') or 'command failed'}, 'data': data})
            return self._send(200, {'ok': True, 'operation': operation, 'data': data})
        except Exception as exc:
            return self._send(500, {'ok': False, 'operation': operation, 'error': {'code': 'helper_error', 'message': str(exc)}})
    def log_message(self, fmt, *args):
        return

if __name__ == '__main__':
    if not TOKEN:
        raise SystemExit('DMM_HOST_HELPER_TOKEN is required')
    HTTPServer((HOST, PORT), Handler).serve_forever()
