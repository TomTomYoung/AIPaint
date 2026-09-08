"""Local-only test/renderer server; never serves credentials or arbitrary paths."""
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import unquote, urlsplit
import os
import shutil
import time

ROOT = Path(__file__).resolve().parents[1]

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path.startswith('/AIPaint/'):
            path = path[len('/AIPaint'):]
        if path == '/':
            path = '/index.html'
        candidate = (ROOT / path.lstrip('/')).resolve()
        allowed = path in ('/index.html', '/style.css') or path.startswith(('/src/', '/examples/', '/doc/'))
        if not allowed or not candidate.is_relative_to(ROOT) or not candidate.is_file():
            self.send_error(404)
            return
        self.path = path
        super().do_GET()

    def log_message(self, *_args):
        pass

@contextmanager
def serve():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}'
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

def launch(playwright):
    executable = os.environ.get('PAINT_CHROMIUM')
    if not executable and not Path(playwright.chromium.executable_path).exists():
        executable = shutil.which('chromium') or shutil.which('google-chrome')
    return playwright.chromium.launch(headless=True, executable_path=executable)

def restrict_network(context, origin):
    def route_request(route):
        if route.request.url.startswith(origin + '/'):
            route.continue_()
        else:
            route.abort()
    context.route('**/*', route_request)

def wait_for_condition(page, predicate, timeout_ms=10000):
    """Poll through the automation protocol, without page-side eval timers.

    Playwright 1.57 string predicates can be reevaluated inside a page timer,
    where the application's strict CSP correctly rejects eval. Keep CSP intact.
    Only trusted, fixed function literals from the test/renderer call this helper.
    """
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        if page.evaluate(predicate):
            return
        page.wait_for_timeout(25)
    raise TimeoutError(f'Condition not met within {timeout_ms} ms: {predicate}')
