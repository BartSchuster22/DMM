#!/usr/bin/env python3
import json, os, re, subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, unquote

TOKEN = os.environ.get('DMM_HOST_HELPER_TOKEN', '')
HOST = os.environ.get('DMM_HOST_HELPER_HOST', '127.0.0.1')
PORT = int(os.environ.get('DMM_HOST_HELPER_PORT', '4120'))

def run(cmd, timeout=25):
    proc = subprocess.run(cmd, shell=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, executable='/bin/bash')
    out = proc.stdout.strip()
    err = proc.stderr.strip()
    return {'exitCode': proc.returncode, 'stdout': out, 'stderr': err}

def openclaw_env(command):
    return "sudo -u alice -H env PATH='/home/alice/.npm-global/bin:/home/alice/.nvm/versions/node/v22.22.2/bin:/opt/node22/bin:/usr/local/bin:/usr/bin:/bin' " + command

def hermes_env(command):
    return "sudo -u herman -H env PATH='/home/herman/.local/bin:/home/herman/.hermes/hermes-agent-live-lane-clean/venv/bin:/opt/node22/bin:/usr/local/bin:/usr/bin:/bin' " + command

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

OPS = {
    'openclaw.version': op_openclaw_version,
    'openclaw.updateStatus': op_openclaw_update_status,
    'hermes.version': op_hermes_version,
    'hermes.updateStatus': op_hermes_update_status,
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
            data = OPS[operation]()
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
