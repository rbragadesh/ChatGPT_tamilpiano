"""Mobile learning-path regression using actual exercises, without fabricated scores.

Start Vite on5173, then run python3 tests/browser-progression.py.
ISAI_TEST_URL can point to another app URL.
"""
import json
import os
import re
import time

from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('ISAI_TEST_URL', 'http://127.0.0.1:5173')
observations = []
errors = []


def nav(page, name):
    page.get_by_role('navigation', name='Main navigation').get_by_role('button', name=name, exact=True).click()


def play_current_exercise(page):
    page.get_by_role('button', name='Start practice', exact=True).click()
    deadline = time.monotonic() + 25
    groups = []
    while time.monotonic() < deadline and not page.locator('.practice-complete').is_visible():
        snapshot=page.evaluate("({phrase:document.querySelector('.practice-progress')?.innerText,pitches:[...document.querySelectorAll('.piano-key.target')].map(key=>Number(key.dataset.midi))})")
        pitches=snapshot['pitches']
        if pitches:
            groups.append(pitches)
            for midi in pitches:
                key=page.locator(f'.piano-key[data-midi="{midi}"]')
                if 'white' in (key.get_attribute('class') or ''):
                    box=key.bounding_box()
                    key.tap(position={'x':box['width']/2,'y':box['height']-20})
                else:
                    key.tap()
        page.wait_for_timeout(60)
    expect(page.locator('.practice-complete')).to_be_visible()
    expect(page.locator('.practice-complete')).to_contain_text('100%')
    return groups


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':430,'height':932}, is_mobile=True, has_touch=True)
    context.route('https://www.youtube.com/iframe_api', lambda route: route.abort())
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL)
    expect(page.locator('.lesson-card').filter(has=page.get_by_role('heading', name='The major journey', exact=True))).to_be_disabled()
    expect(page.locator('.lesson-card').filter(has=page.get_by_role('heading', name='Your first chord', exact=True))).to_be_disabled()
    observations.append('Fresh level1 locks later melody and chord exercises.')

    nav(page, 'Practice')
    expect(page.locator('.level-stage.available')).to_have_count(1)
    expect(page.locator('.level-stage.locked')).to_have_count(4)
    assert int(page.locator('.library-total strong').inner_text()) >= 400
    page.get_by_role('button',name=re.compile('^Top 100 picks')).click()
    expect(page.locator('.library-results')).to_contain_text('100 songs')
    page.get_by_role('combobox',name='Composer',exact=True).select_option('Yuvan Shankar Raja')
    expect(page.locator('.library-results')).to_contain_text('25 songs')
    page.get_by_role('combobox',name='Composer',exact=True).select_option('All composers')
    page.get_by_role('button',name=re.compile('^All songs')).click()
    page.get_by_role('textbox', name='Search songs, films or composers').fill('Vaseegara')
    expect(page.locator('.song-card')).to_have_count(1)
    page.get_by_role('button', name='Explore Vaseegara', exact=True).click()
    expect(page.get_by_role('button', name=re.compile('^Create my song study'))).to_be_disabled()
    expect(page.get_by_role('dialog')).to_contain_text('verified piano arrangement and recording are not included')
    page.get_by_role('button', name='Close song details').click()
    observations.append('Practice room shows learning stages plus hundreds of song references and a balanced Top100 collection; private film studies are locked at level1.')

    for title in ['Your first five notes','Sa, Ri, Ga','Read a little music']:
        nav(page, 'Learn')
        card = page.locator('.lesson-card').filter(has=page.get_by_role('heading', name=title, exact=True))
        expect(card).to_be_enabled()
        card.click()
        play_current_exercise(page)
    stored = page.evaluate('JSON.parse(localStorage.getItem("isai-progress"))')
    assert all(stored[key]['score'] == 100 for key in ['first-notes','sa-ri-ga','staff-reading'])
    observations.append('Completed all three level1 exercises through real touch input, each100%; no score fixtures injected.')

    page.reload()
    nav(page, 'Practice')
    expect(page.locator('.level-stage.complete')).to_have_count(1)
    expect(page.locator('.level-stage.available')).to_have_count(1)
    expect(page.locator('.level-stage.locked')).to_have_count(3)
    expect(page.get_by_role('heading', name='Your song studies can begin.')).to_be_visible()
    expect(page.get_by_role('button', name='Start: The major journey', exact=True)).to_be_enabled()
    expect(page.get_by_role('button', name='Locked: Your first chord', exact=True)).to_be_disabled()
    observations.append('Level2 unlock and level3 lock persist after reload.')
    page.screenshot(path='/tmp/isai-level2-practice.png', full_page=True)

    page.get_by_role('combobox', name='Composer', exact=True).select_option('A. R. Rahman')
    page.get_by_role('combobox', name='Era', exact=True).select_option('2010')
    assert page.locator('.song-card').count() > 0
    for card in page.locator('.song-card').all():
        text = card.inner_text()
        assert 'A. R. Rahman' in text and re.search(r'201\d', text), text
    page.get_by_role('combobox', name='Composer', exact=True).select_option('All composers')
    page.get_by_role('combobox', name='Era', exact=True).select_option('All eras')
    page.get_by_role('textbox', name='Search songs, films or composers').fill('Vaseegara')
    page.get_by_role('button', name='Explore Vaseegara', exact=True).click()
    expect(page.get_by_role('button', name=re.compile('^Create my song study'))).to_be_enabled()
    page.get_by_role('button', name=re.compile('^Create my song study')).click()
    expect(page.get_by_label('Give it a name')).to_have_value('Vaseegara · Minnale')
    expect(page.get_by_label('YouTube video link')).to_have_value('')
    page.get_by_role('button', name='Save to my clips').click()
    page.get_by_role('button', name='Open Vaseegara · Minnale', exact=True).click()
    expect(page.locator('.clip-local-study')).to_be_visible()
    page.get_by_label('Your Western notation').fill('C4 D4 E4 G4')
    expect(page.get_by_role('button', name='Save notation', exact=True)).to_be_disabled()
    page.get_by_role('checkbox', name='I have the rights or permission to save and practise this notation', exact=True).check()
    page.get_by_role('button', name='Save notation', exact=True).click()
    expect(page.get_by_role('button', name='Practise my notes', exact=True)).to_be_enabled()
    page.get_by_role('button', name='Practise my notes', exact=True).click()
    groups = play_current_exercise(page)
    assert groups == [[60],[62],[64],[67]], groups
    saved = page.evaluate('JSON.parse(localStorage.getItem("isai-clips-v1"))')
    assert len(saved) == 1 and saved[0]['videoId'] == '' and saved[0]['songId'] == 'vaseegara-minnale'
    assert saved[0]['notes'] == 'C4 D4 E4 G4'
    observations.append('Created a song-linked private study withoutYouTube; rights confirmation gates saving; level2 manual study completed100%.')

    nav(page, 'Practice')
    expect(page.get_by_role('button', name='Locked: Your first chord', exact=True)).to_be_disabled()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    observations.append('Completing a personal study does not skip remaining level2 prerequisites; mobile body has no horizontal overflow.')

    # Reuse the actual saved user study in a new context with no completed
    # exercises. Its notes remain readable while practice is properly locked.
    fresh = browser.new_context(viewport={'width':430,'height':932}, is_mobile=True, has_touch=True)
    fresh.add_init_script(f'localStorage.setItem("isai-clips-v1",{json.dumps(json.dumps(saved))})')
    locked = fresh.new_page()
    locked.on('pageerror', lambda error: errors.append('fresh:' + str(error)))
    locked.goto(URL)
    nav(locked, 'My clips')
    locked.get_by_role('button', name='Open Vaseegara · Minnale', exact=True).click()
    expect(locked.get_by_label('Your Western notation')).to_have_value('C4 D4 E4 G4')
    locked.get_by_role('checkbox', name='I have the rights or permission to save and practise this notation', exact=True).check()
    expect(locked.get_by_role('button', name='Practise my notes · Level 2', exact=True)).to_be_disabled()
    expect(locked.locator('.clip-level-lock')).to_contain_text('Level 2')
    observations.append('Same saved song study is locked when opened by a level1 learner; notes remain available for review.')
    assert not errors, errors
    browser.close()
print(json.dumps({'passed':observations,'browserErrors':errors}, indent=2))
