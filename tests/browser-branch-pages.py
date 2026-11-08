"""Reproduce main/root GitHub Pages publishing, including local model assets."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import importlib.util
import shutil
from tempfile import TemporaryDirectory
from threading import Thread

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pwa_fixtures', ROOT / 'tests/browser-clips-pwa.py')
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


with TemporaryDirectory(prefix='isai-branch-pages-') as folder, sync_playwright() as p:
    published = Path(folder, 'ChatGPT_tamilpiano')
    published.mkdir()
    shutil.copyfile(ROOT / 'index.html', published / 'index.html')
    (published / 'site').symlink_to(ROOT / 'site', target_is_directory=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=folder))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    try:
        context = browser.new_context(viewport={'width':430, 'height':932}, is_mobile=True, has_touch=True)
        page = context.new_page()
        errors = []
        writes = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: writes.append(request.url) if request.method not in ('GET','HEAD','OPTIONS') else None)
        url = f'http://127.0.0.1:{server.server_port}/ChatGPT_tamilpiano/'
        await_url = url + 'site/'
        page.goto(url)
        page.wait_for_url(await_url)
        expect(page.get_by_role('heading', name='Your next chapter starts here.')).to_be_visible()
        assert page.locator('html').get_attribute('data-isai-mode') == 'production'
        assert '/src/main.tsx' not in page.content()
        page.evaluate('navigator.serviceWorker.ready')
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        scope = page.evaluate('(async()=> (await navigator.serviceWorker.ready).scope)()')
        assert scope == await_url
        page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='Library', exact=True).click()
        page.get_by_role('button', name='Top 100 picks', exact=False).click()
        expect(page.locator('.library-results')).to_contain_text('100 songs')
        context.set_offline(True)
        page.reload()
        expect(page.get_by_role('heading', name='Your next chapter starts here.')).to_be_visible()
        page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='My clips', exact=True).click()
        page.get_by_label('Give it a name').fill('Original offline note')
        page.get_by_label('End at', exact=True).fill('0:02')
        page.get_by_role('button', name='Save to my clips').click()
        page.get_by_role('button', name='Open Original offline note', exact=True).click()
        audio = Path(folder, 'original-note.wav')
        fixtures.original_note_fixture(audio)
        page.get_by_label('Audio recording to transcribe').set_input_files(audio)
        page.get_by_role('checkbox', name='I have the rights or permission needed to transcribe this recording and its music', exact=False).check()
        page.get_by_role('button', name='Find notes on this device', exact=True).click()
        expect(page.locator('.transcription-result')).to_be_visible(timeout=120000)
        expect(page.locator('.transcription-note-table')).to_contain_text('C4')
        assert not writes, writes
        assert not errors, errors
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path='/tmp/isai-branch-fixed.png', full_page=True)
        print('PASS branch-based Pages: source root redirects once to compiled app; real rendered UI, Top100, scoped offline cache and actual WASM transcription work without a backend or network writes.')
    finally:
        browser.close()
        server.shutdown()
        server.server_close()
