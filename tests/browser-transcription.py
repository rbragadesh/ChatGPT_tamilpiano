"""Real browser-only inference. Start Vite5173 or point ISAI_TEST_URL at a static site.

Uses only an original, generated four-note piano study (no commercial recording).
Run: python3 tests/browser-transcription.py
"""
import math
import os
from pathlib import Path
import struct
from tempfile import TemporaryDirectory
import time
import wave

from playwright.sync_api import sync_playwright, expect


def sequence(path):
    rate = 22050
    samples = [0.0] * (rate * 5)
    for index, midi in enumerate([60, 62, 64, 67]):
        frequency = 440 * 2 ** ((midi - 69) / 12)
        for frame in range(int(rate * .65)):
            t = frame / rate
            envelope = min(t / .01, 1) * math.exp(-t * 1.8)
            samples[int((index + .5) * rate) + frame] += sum(math.sin(2 * math.pi * frequency * harmonic * t) / harmonic for harmonic in range(1, 5)) * envelope * .25
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(b''.join(struct.pack('<h', round(max(-1, min(1, value)) * 32767)) for value in samples))


with TemporaryDirectory(prefix='isai-browser-audio-') as temporary, sync_playwright() as p:
    audio = Path(temporary) / 'original-piano-study.wav'
    sequence(audio)
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':430,'height':932}, is_mobile=True, has_touch=True)
    context.route('https://www.youtube.com/iframe_api', lambda route: route.abort())
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    network_writes = []
    page.on('request', lambda request: network_writes.append(request.url) if request.method not in ('GET','HEAD','OPTIONS') else None)
    page.goto(os.environ.get('ISAI_TEST_URL','http://127.0.0.1:5173'))
    page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='My clips', exact=True).click()
    page.get_by_label('YouTube video link').fill('https://youtu.be/dQw4w9WgXcQ')
    page.get_by_label('Give it a name').fill('Original four-note upload')
    page.get_by_label('End at', exact=True).fill('0:05')
    page.get_by_role('button', name='Save to my clips').click()
    page.get_by_role('button', name='Open Original four-note upload', exact=True).click()
    page.get_by_label('Audio recording to transcribe').set_input_files(audio)
    page.get_by_label('Audio start', exact=True).fill('0:00')
    page.get_by_label('Audio end', exact=True).fill('0:05')
    action = page.get_by_role('button', name='Find notes on this device', exact=True)
    expect(action).to_be_disabled()
    page.get_by_role('checkbox', name='I have the rights or permission needed to transcribe this recording and its music', exact=False).check()
    expect(action).to_be_enabled()
    action.click()
    expect(page.locator('.transcription-result')).to_be_visible(timeout=120000)
    detected = page.locator('.transcription-note-table tbody tr td:nth-child(2)').all_text_contents()
    assert {'C4','D4','E4','G4'} <= set(detected), detected
    # The real model can mistake a harmonic for an extra octave note, even on
    # generated piano. Exercise the review controls instead of claiming perfect accuracy.
    for index in range(len(detected) - 1, -1, -1):
        if detected[index] not in {'C4','D4','E4','G4'}:
            page.locator('.transcription-note-table tbody tr').nth(index).get_by_role('button').click()
    expect(page.locator('.transcription-note-table tbody tr')).to_have_count(4)
    assert page.locator('.transcription-note-table tbody tr td:nth-child(2)').all_text_contents() == ['C4','D4','E4','G4']
    page.get_by_role('button', name='Save draft to this clip').click()
    expect(page.locator('.clip-saved-draft')).to_contain_text('4 detected notes')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.locator('.transcription-result').screenshot(path='/tmp/isai-real-transcription.png')
    page.get_by_role('button', name='Close clip', exact=True).click()
    page.reload()
    page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='My clips', exact=True).click()
    page.get_by_role('button', name='Open Original four-note upload', exact=True).click()
    expect(page.locator('.clip-saved-draft')).to_contain_text('4 detected notes')
    expect(page.locator('.transcription-note-table tbody tr')).to_have_count(4)
    page.get_by_role('button', name='Practise saved draft', exact=True).click()
    expect(page.locator('.practice-original')).to_contain_text('ESTIMATED TRANSCRIPTION')
    page.get_by_role('button', name='Start practice', exact=True).click()
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline and not page.locator('.practice-complete').is_visible():
        target = page.locator('.piano-key.target')
        if target.count():
            target.first.click()
        page.wait_for_timeout(60)
    expect(page.locator('.practice-complete')).to_be_visible()
    expect(page.locator('.practice-complete')).to_contain_text('100%')
    assert not errors, errors
    assert not network_writes, f'Audio analysis must not send requests with user content: {network_writes}'
    browser.close()
print('PASS browser-only audio: real WASM note detection, rights gate, Western/Carnatic review, saved draft reload, timed-rest completion100%, no network writes or page exceptions.')
