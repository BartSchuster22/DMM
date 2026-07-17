#!/usr/bin/env python3
import hmac
import json
import os
import re
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

TOKEN = os.environ.get('DMM_HOST_HELPER_TOKEN', '')
HOST = os.environ.get('DMM_HOST_HELPER_HOST', '127.0.0.1')
PORT = int(os.environ.get('DMM_HOST_HELPER_PORT', '4120'))
MAX_BODY_BYTES = 16 * 1024
HERMES_PATH = '/home/herman/.local/bin:/home/herman/.hermes/hermes-agent-live-lane-clean/venv/bin:/opt/node22/bin:/usr/local/bin:/usr/bin:/bin'


def hermes_command(*args):
    return ['sudo', '-u', 'herman', '-H', 'env', f'PATH={HERMES_PATH}', *args]


def run(command, timeout=25):
    proc = subprocess.run(command, shell=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    return {'exitCode': proc.returncode, 'stdout': proc.stdout.strip(), 'stderr': proc.stderr.strip()}


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


def safe_provider_id(value):
    provider = str(value or '').strip().lower()
    return provider if re.fullmatch(r'[a-z0-9][a-z0-9_.-]{0,63}', provider) else ''


def op_hermes_catalog_status(_body=None):
    result = run(hermes_command(
        '/home/herman/.hermes/hermes-agent-live-lane-clean/venv/bin/python',
        '/srv/dmm/scripts/hermes-catalog-status.py'
    ), 90)
    result['json'] = json_from_stdout(result)
    return result


def op_hermes_version(_body=None):
    result = run(hermes_command('hermes', '--version'), 25)
    text = result.get('stdout') or result.get('stderr') or ''
    match = re.search(r'Hermes Agent\s+(v?\d+\.\d+\.\d+)', text)
    result['currentVersion'] = match.group(1) if match else None
    result['message'] = text.splitlines()[0] if text.splitlines() else text
    return result


def op_hermes_update_status(_body=None):
    result = run(hermes_command('hermes', '--version'), 25)
    text = (result.get('stdout') or '') + '\n' + (result.get('stderr') or '')
    result['available'] = bool(re.search(r'Update available|commits behind|behind', text, re.I))
    match = re.search(r'Hermes Agent\s+(v?\d+\.\d+\.\d+)', text)
    result['currentVersion'] = match.group(1) if match else None
    lines = [line.strip() for line in text.splitlines() if re.search(r'update|behind|upgrade', line, re.I)]
    result['message'] = ' | '.join(lines[:3]) if lines else ('No update information reported' if result['exitCode'] == 0 else 'Hermes version check failed')
    return result


def validate_api_key(provider, secret):
    provider = safe_provider_id(provider)
    key = str(secret or '').strip()
    if not provider:
        return {'status': 'invalid', 'message': 'Provider id is invalid'}
    if len(key) < 8:
        return {'status': 'invalid', 'message': 'Credential is too short'}
    if re.search(r'\s', key):
        return {'status': 'invalid', 'message': 'API keys must not contain whitespace'}
    if provider == 'openai-codex':
        return {'status': 'unsupported', 'message': 'OpenAI Codex uses OAuth/device credentials, not API-key activation'}
    return {'status': 'healthy', 'message': 'Credential passed local API-key format validation'}


def op_hermes_validate_credential(body=None):
    body = body or {}
    return validate_api_key(body.get('providerId'), body.get('secret'))


def op_hermes_install_credential(body=None):
    body = body or {}
    provider = safe_provider_id(body.get('providerId'))
    secret = str(body.get('secret') or '').strip()
    label = str(body.get('label') or ('DMM API key ' + provider))[:128]
    validation = validate_api_key(provider, secret)
    if validation.get('status') != 'healthy':
        return validation
    result = run(hermes_command(
        'hermes', 'auth', 'add', provider,
        '--type', 'api-key', '--label', label, '--api-key', secret
    ), 30)
    if result.get('exitCode') == 0:
        return {'status': 'installed', 'message': 'Credential installed into Hermes auth pool'}
    return {'status': 'error', 'message': 'Hermes credential installation failed'}


OPS = {
    'hermes.version': op_hermes_version,
    'hermes.updateStatus': op_hermes_update_status,
    'hermes.catalogStatus': op_hermes_catalog_status,
    'hermes.validateCredential': op_hermes_validate_credential,
    'hermes.installCredential': op_hermes_install_credential,
}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            return self._send(200, {'ok': True, 'service': 'dmm-host-helper'})
        return self._send(404, {'ok': False, 'error': {'code': 'not_found', 'message': 'Not found'}})

    def do_POST(self):
        supplied = self.headers.get('x-dmm-helper-token') or ''
        if not TOKEN or not hmac.compare_digest(supplied, TOKEN):
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
            if length < 0 or length > MAX_BODY_BYTES:
                return self._send(413, {'ok': False, 'error': {'code': 'payload_too_large', 'message': 'Payload too large'}})
            body = json.loads(self.rfile.read(length).decode() or '{}') if length else {}
            data = OPS[operation](body)
            if data.get('exitCode') not in (0, None):
                return self._send(502, {'ok': False, 'operation': operation, 'error': {'code': 'command_failed', 'message': 'Framework command failed'}})
            return self._send(200, {'ok': True, 'operation': operation, 'data': data})
        except json.JSONDecodeError:
            return self._send(400, {'ok': False, 'error': {'code': 'invalid_json', 'message': 'Invalid JSON'}})
        except Exception:
            return self._send(500, {'ok': False, 'operation': operation, 'error': {'code': 'helper_error', 'message': 'Host helper operation failed'}})

    def log_message(self, format, *args):
        return


if __name__ == '__main__':
    if not TOKEN:
        raise SystemExit('DMM_HOST_HELPER_TOKEN is required')
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
