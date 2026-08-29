"""
Lightweight Flask compatibility layer for pure-Python execution
"""
import json
import os
import sys
import socketserver
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import urllib.parse
import re

class Response:
    def __init__(self, response="", status=200, headers=None, mimetype="text/html"):
        self.response = response
        self.status_code = status
        self.headers = headers or {}
        self.mimetype = mimetype

def jsonify(data):
    return json.dumps(data)

def render_template_string(template, **kwargs):
    rendered = template
    for k, v in kwargs.items():
        val_str = str(v) if v is not None else ""
        rendered = rendered.replace("{{ " + k + " }}", val_str)
        rendered = rendered.replace("{{" + k + "}}", val_str)
    # Jinja tag handling for {% if %} / {% endif %} / {% else %}
    for k, v in kwargs.items():
        if not v:
            pattern = re.compile(rf'\{{%\s*if\s+{k}\s*%\}}.*?(\{{%\s*else\s*%\}}(.*?))?\{{%\s*endif\s*%\}}', re.DOTALL)
            rendered = pattern.sub(r'\2', rendered)
        else:
            pattern = re.compile(rf'\{{%\s*if\s+{k}\s*%\}}(.*?)(\{{%\s*else\s*%\}}.*?)?\{{%\s*endif\s*%\}}', re.DOTALL)
            rendered = pattern.sub(r'\1', rendered)
    # Remove remaining unmatched if tags
    rendered = re.sub(r'\{{%\s*if\s+.*?\s*%\}}.*?\{{%\s*endif\s*%\}}', '', rendered, flags=re.DOTALL)
    return rendered

class CustomServer(ThreadingHTTPServer):
    allow_reuse_address = True

class Flask:
    def __init__(self, import_name):
        self.import_name = import_name
        self.routes = {}

    def route(self, rule, methods=None):
        if methods is None:
            methods = ["GET"]
        def decorator(f):
            for m in methods:
                self.routes[(rule, m.upper())] = f
            return f
        return decorator

    def run(self, host="0.0.0.0", port=10000, threaded=True):
        routes = self.routes
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                parsed = urllib.parse.urlparse(self.path)
                handler = routes.get((parsed.path, "GET"))
                if handler:
                    res = handler()
                    self.send_response(200)
                    if isinstance(res, str) and (res.startswith("{") or res.startswith("[")):
                        self.send_header("Content-Type", "application/json; charset=utf-8")
                    else:
                        self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(res.encode("utf-8") if isinstance(res, str) else res)
                else:
                    self.send_response(404)
                    self.end_headers()
                    self.wfile.write(b"Not Found")

            def do_POST(self):
                parsed = urllib.parse.urlparse(self.path)
                handler = routes.get((parsed.path, "POST"))
                if handler:
                    res = handler()
                    self.send_response(200)
                    if isinstance(res, str) and (res.startswith("{") or res.startswith("[")):
                        self.send_header("Content-Type", "application/json; charset=utf-8")
                    else:
                        self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(res.encode("utf-8") if isinstance(res, str) else res)
                else:
                    self.send_response(404)
                    self.end_headers()
                    self.wfile.write(b"Not Found")

            def log_message(self, format, *args):
                pass

        print(f" * Servidor Flask em execução na porta {port} (http://{host}:{port})")
        sys.stdout.flush()
        try:
            server = CustomServer((host, port), Handler)
            server.serve_forever()
        except OSError as e:
            # Fallback if port occupied
            fallback_port = 10000 if port != 10000 else 10001
            print(f" * Porta {port} ocupada. Iniciando em fallback {fallback_port}...")
            sys.stdout.flush()
            server = CustomServer((host, fallback_port), Handler)
            server.serve_forever()
