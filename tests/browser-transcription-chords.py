"""End-to-end real-model chord check using generated audio only.

Run with the Vite dev server or a static build already running:
    python3 tests/browser-transcription-chords.py

Defaults target Vite5173; --dev-url accepts a production static subpath.
Requires the environment's Python Playwright and /usr/bin/chromium. The test
never loads YouTube media. It creates an isolated mobile browser context,
uploads a generated C-major triad, saves the detected chord study, and plays
its highlighted keys with touch input. No commercial recording is used.
"""
import argparse
from pathlib import Path
from tempfile import TemporaryDirectory
import math
import struct
import wave
import re
import json
from playwright.sync_api import sync_playwright, expect

def make_triad(path):
    rate=22050
    frames=[]
    for i in range(rate*3):
        t=i/rate-.5
        value=0
        if 0 <= t < 1.8:
            envelope=min(t/.01,1)*math.exp(-t*1.8)
            for midi in [60,64,67]:
                hz=440*2**((midi-69)/12)
                value += sum(math.sin(2*math.pi*hz*h*t)/h for h in range(1,5))*envelope*.25*.45
        frames.append(struct.pack('<h',round(max(-1,min(1,value))*32767)))
    with wave.open(str(path),'wb') as file:
        file.setnchannels(1);file.setsampwidth(2);file.setframerate(rate);file.writeframes(b''.join(frames))

parser=argparse.ArgumentParser()
parser.add_argument('--dev-url',default='http://127.0.0.1:5173')
args=parser.parse_args()
with TemporaryDirectory(prefix='isai-chord-smoke-') as directory, sync_playwright() as p:
    path=Path(directory)/'generated-c-major.wav';make_triad(path)
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':430,'height':932},is_mobile=True,has_touch=True)
    context.route('https://www.youtube.com/iframe_api',lambda route:route.abort())
    context.add_init_script("localStorage.setItem('isai-progress',JSON.stringify(Object.fromEntries(['first-notes','sa-ri-ga','staff-reading','major-journey','minor-mood','five-note-bloom','call-response'].map(id=>[id,{score:100,date:new Date().toISOString(),attempts:1}]))))")
    page=context.new_page();errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(args.dev_url)
    page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='My clips').click()
    page.get_by_label('YouTube video link').fill('https://youtu.be/dQw4w9WgXcQ')
    page.get_by_label('Give it a name').fill('Generated C major')
    page.get_by_label('Start at').fill('0:00');page.get_by_label('End at').fill('0:03')
    page.get_by_role('button',name='Save to my clips').click()
    page.get_by_role('button',name='Open Generated C major',exact=True).click()
    page.get_by_label('Audio recording to transcribe').set_input_files(str(path))
    page.get_by_role('checkbox',name='I have the rights or permission needed to transcribe this recording and its music',exact=False).check()
    page.get_by_role('button',name='Find notes on this device',exact=True).click()
    expect(page.locator('.transcription-result')).to_be_visible(timeout=90000)
    expect(page.locator('.transcription-chords')).to_contain_text('C')
    chord_radio=page.get_by_role('radio',name=re.compile('^Chord suggestions'))
    expect(chord_radio).to_be_enabled();chord_radio.check()
    page.get_by_role('button',name='Save draft to this clip',exact=True).click()
    expect(page.locator('.clip-saved-draft')).to_contain_text('Chord suggestions')
    page.get_by_role('button',name='Practise saved draft',exact=True).click()
    expect(page.get_by_text('ESTIMATED TRANSCRIPTION',exact=True)).to_be_visible()
    expect(page.locator('.practice-heading')).to_contain_text('Chord suggestions')
    page.get_by_role('button',name='Start practice',exact=True).click()
    groups=[]
    for attempt in range(50):
        if page.locator('.practice-complete').is_visible():break
        targets=page.locator('.piano-key.target').evaluate_all('(buttons)=>buttons.map(b=>Number(b.dataset.midi))')
        if not targets:
            page.wait_for_timeout(100);continue
        phrase=page.locator('.practice-progress').inner_text()
        groups.append(targets)
        for midi in targets:
            page.locator(f'.piano-key[data-midi="{midi}"]').tap(timeout=1000)
        page.wait_for_function("previous=>document.querySelector('.practice-complete')||document.querySelector('.practice-progress').innerText!==previous",arg=phrase,timeout=5000)
    expect(page.locator('.practice-complete')).to_be_visible()
    expect(page.locator('.practice-complete')).to_contain_text('100%')
    assert [60,64,67] in groups,groups
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    print(json.dumps({'passed':'Real browser ONNX C-major audio -> chord suggestion -> saved clip -> mobile touch practice100%', 'playedGroups':groups,'browserErrors':errors}))
    browser.close()
