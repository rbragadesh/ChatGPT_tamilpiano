"""Browser smoke checks. Run after npm run build; needs Python Playwright + Chromium.

python3 tests/browser-clips-pwa.py
The dev server must be running on http://127.0.0.1:5173 (override --dev-url).
Production files are served on an ephemeral local port at a GitHub Pages subpath.
"""
import argparse
import asyncio
import math
import struct
import wave
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread

from playwright.async_api import async_playwright, expect


MOCK_YOUTUBE = """(() => {
  window.__yt = { calls: [], time: 0, state: 2, rate: 1, destroyed: 0 };
  window.YT = { Player: class {
    constructor(target, config) {
      window.__yt.config = config.playerVars;
      window.__yt.videoId = config.videoId;
      this.events = config.events;
      window.__yt.end = () => config.events.onStateChange({data:0});
      target.textContent = 'Mock YouTube player';
      setTimeout(() => config.events.onReady(), 0);
    }
    seekTo(time) { window.__yt.calls.push(['seek',time]);window.__yt.time=time; }
    playVideo() { window.__yt.calls.push(['play']);window.__yt.state=1; }
    pauseVideo() { window.__yt.calls.push(['pause']);window.__yt.state=2; }
    getCurrentTime() { return window.__yt.time; }
    getPlayerState() { return window.__yt.state; }
    setPlaybackRate(rate) { window.__yt.rate=rate; }
    getAvailablePlaybackRates() { return [.25,.5,.75,1]; }
    destroy() { window.__yt.destroyed++; }
  }};
})();"""


async def open_clips(page):
    await page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='My clips').click()
    await expect(page.get_by_role('heading', name='Make a song your own.')).to_be_visible()


async def add_clip(page):
    await page.get_by_label('YouTube video link').fill('https://youtu.be/dQw4w9WgXcQ?t=1m20s')
    await expect(page.get_by_label('Start at')).to_have_value('1:20')
    await expect(page.get_by_label('End at')).to_have_value('1:50')
    await page.get_by_label('Give it a name').fill('My melody clip')
    await page.get_by_role('button', name='Save to my clips').click()
    await expect(page.get_by_role('button', name='Open My melody clip')).to_be_visible()


async def check_clips(browser, dev_url):
    context = await browser.new_context(viewport={'width':430,'height':932})
    # A failed third-party script must not break the local library or notation.
    await context.route('https://www.youtube.com/iframe_api', lambda route: route.abort())
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.goto(dev_url)
    await open_clips(page)
    await add_clip(page)
    await page.reload()
    await open_clips(page)
    await page.get_by_role('button', name='Open My melody clip').click()
    await expect(page.get_by_text('YouTube is unavailable here.', exact=False)).to_be_visible()
    await expect(page.get_by_role('link', name='Open YouTube')).to_have_attribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=80s')
    await page.get_by_label('Your Western notation').fill('C4 D4 E4 G4')
    await page.get_by_label('Enter notes as').select_option('carnatic')
    await expect(page.get_by_label('Your Carnatic notation')).to_have_value('S R2 G3 P')
    await page.get_by_label('Your Carnatic notation').fill('Sa Ri2 Ga3 Pa')
    await page.get_by_role('checkbox', name='I have the rights or permission to save and practise this notation').check()
    await page.get_by_role('button', name='Save notation').click()
    await expect(page.get_by_text('Your notation and tempo are saved.')).to_be_visible()
    await page.get_by_role('button', name='Practise my notes').click()
    await expect(page.get_by_role('heading', name='My melody clip', exact=True)).to_be_visible()
    await expect(page.get_by_text('Phrase 1 of 4')).to_be_visible()
    await page.get_by_role('button', name='Start practice', exact=True).click()
    for pitch in (60,62,64,67):
        await page.locator(f'button[data-midi="{pitch}"]').dispatch_event('pointerdown')
        await page.wait_for_timeout(210)
    await expect(page.get_by_role('heading', name='Beautifully done.')).to_be_visible()
    await open_clips(page)
    await page.get_by_role('button', name='Open My melody clip').click()
    await expect(page.get_by_label('Your Western notation')).to_have_value('C4 D4 E4 G4')
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal mobile overflow'
    assert not errors, errors
    print('PASS Clips: timestamp import, reload persistence, blocked-player fallback, Western/Carnatic editor conversion and saved notation, custom practice completion, mobile layout; no browser errors.')
    await context.close()


async def check_youtube_controls(browser, dev_url):
    context = await browser.new_context(viewport={'width':430,'height':932})
    await context.add_init_script(MOCK_YOUTUBE)
    page = await context.new_page()
    await page.goto(dev_url)
    await open_clips(page)
    await add_clip(page)
    await page.get_by_role('button', name='Open My melody clip').click()
    await expect(page.get_by_role('button', name='Play excerpt')).to_be_enabled()
    assert await page.evaluate('window.__yt.config.start') == 80
    assert await page.evaluate('window.__yt.config.end') == 110
    await page.get_by_role('button', name='Play excerpt').click()
    assert await page.evaluate('window.__yt.time') == 80
    assert await page.evaluate('window.__yt.state') == 1
    await page.get_by_label('Playback speed', exact=True).select_option('0.5')
    assert await page.evaluate('window.__yt.rate') == .5
    await page.get_by_role('button', name='Loop off').click()
    await page.evaluate('window.__yt.time=110')
    await page.wait_for_function('window.__yt.time===80 && window.__yt.state===1')
    await page.evaluate('window.__yt.time=110;window.__yt.end()')
    assert await page.evaluate('window.__yt.time') == 80
    await page.get_by_role('button', name='Loop on').click()
    await page.evaluate('window.__yt.time=110')
    await page.wait_for_function('window.__yt.state===2')
    print('PASS mocked YouTube API: configured80–110s excerpt, replay, speed0.5×, loop boundary, end-event replay, pause at end without loop.')
    await context.close()


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def original_note_fixture(path):
    rate = 22050
    samples = [0.0] * (rate * 2)
    for frame in range(round(rate * .7)):
        time = frame / rate
        envelope = min(time / .01, 1) * math.exp(-time * 1.8)
        samples[round(rate * .5) + frame] = sum(math.sin(2 * math.pi * 261.625565 * harmonic * time) / harmonic for harmonic in range(1, 5)) * envelope * .25
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(b''.join(struct.pack('<h', round(max(-1, min(1, value)) * 32767)) for value in samples))


async def check_offline(browser, dist):
    with TemporaryDirectory(prefix='isai-pages-') as folder:
        Path(folder, 'ChatGPT_tamilpiano').symlink_to(dist, target_is_directory=True)
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=folder))
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f'http://127.0.0.1:{server.server_port}/ChatGPT_tamilpiano/'
            context = await browser.new_context(viewport={'width':430,'height':932})
            page = await context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto(url)
            await page.evaluate('navigator.serviceWorker.ready')
            await page.wait_for_function('navigator.serviceWorker.controller !== null')
            registered_scope = await page.evaluate('(async()=> (await navigator.serviceWorker.ready).scope)()')
            assert registered_scope == url, registered_scope
            cache_keys = await page.evaluate('caches.keys()')
            assert any('ChatGPT_tamilpiano' in key for key in cache_keys)
            manifest = await page.evaluate('fetch(new URL("manifest.webmanifest",location.href)).then(r=>r.json())')
            assert manifest['start_url'] == './' and manifest['scope'] == './'
            await context.set_offline(True)
            await page.reload()
            await expect(page.get_by_role('heading', name='Your next chapter starts here.')).to_be_visible()
            await open_clips(page)
            await expect(page.get_by_role('heading', name='Your first favourite belongs here.')).to_be_visible()
            # Real inference from only the static, cached Pages subpath, while
            # completely offline. No Python service or third-party model CDN.
            await page.get_by_label('YouTube video link').fill('https://youtu.be/dQw4w9WgXcQ')
            await page.get_by_label('Give it a name').fill('Original offline study')
            await page.get_by_label('End at', exact=True).fill('0:02')
            await page.get_by_role('button', name='Save to my clips').click()
            await page.get_by_role('button', name='Open Original offline study', exact=True).click()
            audio = Path(folder, 'original-note.wav')
            original_note_fixture(audio)
            await page.get_by_label('Audio recording to transcribe').set_input_files(audio)
            action = page.get_by_role('button', name='Find notes on this device', exact=True)
            await expect(action).to_be_disabled()
            await page.get_by_role('checkbox', name='I have the rights or permission needed to transcribe this recording and its music', exact=False).check()
            await action.click()
            await expect(page.locator('.transcription-result')).to_be_visible(timeout=120000)
            assert 'C4' in await page.locator('.transcription-note-table').inner_text()
            await page.get_by_role('button', name='Save draft to this clip').click()
            await expect(page.locator('.clip-saved-draft')).to_be_visible()
            await page.get_by_role('button', name='Close clip', exact=True).click()
            await page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Learn',exact=True).click()
            await page.get_by_role('button',name='Play your first notes').click()
            await expect(page.get_by_role('heading',name='Your first five notes',exact=True)).to_be_visible()
            missing = await page.evaluate('fetch("missing.js").then(r=>r.status).catch(()=>"network-error")')
            assert missing == 'network-error', f'Missing asset incorrectly masked: {missing}'
            assert not errors, errors
            print('PASS production PWA: GitHub Pages subpath, installed cache, fully offline reload and REAL local WASM transcription, rights gate, saved draft, original lesson startup, missing asset remains network error; no browser errors.')
            await context.close()
        finally:
            server.shutdown()
            server.server_close()


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dev-url', default='http://127.0.0.1:5173/')
    parser.add_argument('--dist', type=Path, default=Path(__file__).resolve().parents[1] / 'dist')
    args = parser.parse_args()
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        try:
            await check_clips(browser, args.dev_url)
            await check_youtube_controls(browser, args.dev_url)
            await check_offline(browser, args.dist.resolve())
        finally:
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
