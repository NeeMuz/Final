"""Browser check for article form focus (runserver must be on 127.0.0.1:8000)."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Bikibedia.settings')

import django

django.setup()

from django.contrib.auth.models import User
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BIKIBEDIA_TEST_URL', 'http://127.0.0.1:8000')
USERNAME = 'browser-editor'
PASSWORD = 'sup3r-Secret!1'


def ensure_user():
    user, _ = User.objects.get_or_create(
        username=USERNAME,
        defaults={'email': 'browser-editor@example.com'},
    )
    user.set_password(PASSWORD)
    user.save()


def scroll_y(page):
    return page.evaluate('() => window.scrollY')


def main():
    ensure_user()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 720})
        page.goto(f'{BASE}/login/', wait_until='domcontentloaded', timeout=20000)
        page.fill('#id_username', USERNAME)
        page.fill('#id_password', PASSWORD)
        page.locator('#id_password').press('Enter')
        page.wait_for_load_state('networkidle', timeout=20000)
        tab_id = page.evaluate(
            "() => new URL(window.location.href).searchParams.get('__tab') || window.BIKIBEDIA_TAB_ID || ''"
        )
        create_url = f'{BASE}/articles/new/'
        if tab_id:
            create_url += f'?__tab={tab_id}'
        page.goto(create_url, wait_until='domcontentloaded', timeout=20000)
        page.wait_for_selector('.ql-editor', timeout=20000)
        page.wait_for_function('() => document.documentElement.dataset.bikibediaTabReady === "1"')

        title = page.locator('#id_title')
        intro = page.locator('#id_introduction')
        editor = page.locator('.ql-editor')

        page.evaluate('() => window.scrollTo(0, 0)')
        page.wait_for_timeout(100)
        top_scroll = scroll_y(page)
        initial_drift = abs(top_scroll)
        if initial_drift > 80:
            errors.append('Page load scrolled away from top: ' + str(top_scroll))

        title.click()
        after_title_click = scroll_y(page)
        if after_title_click > top_scroll + 80:
            errors.append('Title click scrolled page: ' + str(after_title_click))

        page.keyboard.type('My Test Title')
        if title.input_value() != 'My Test Title':
            errors.append('Title: ' + repr(title.input_value()))
        if 'My Test Title' in editor.inner_text():
            errors.append('Title leaked into Quill')

        after_title_type = scroll_y(page)
        if after_title_type > top_scroll + 80:
            errors.append('Title typing scrolled page: ' + str(after_title_type))

        intro.click()
        after_intro_click = scroll_y(page)
        if after_intro_click > top_scroll + 80:
            errors.append('Introduction click scrolled page: ' + str(after_intro_click))

        page.keyboard.type('Introduction long enough for validation rules here.')
        if 'Introduction long' not in intro.input_value():
            errors.append('Introduction: ' + repr(intro.input_value()))

        after_intro_type = scroll_y(page)
        if after_intro_type > top_scroll + 80:
            errors.append('Introduction typing scrolled page: ' + str(after_intro_type))

        page.locator('.form-section-title', has_text='Basics').click()
        after_basics_click = scroll_y(page)
        if after_basics_click > top_scroll + 80:
            errors.append('Basics heading click scrolled page: ' + str(after_basics_click))

        active_id = page.evaluate("() => (document.activeElement && document.activeElement.id) || ''")
        if active_id in ('id_title', 'id_introduction'):
            errors.append('Basics click did not blur field: ' + active_id)

        editor.click()
        page.keyboard.type('Body paragraph one.')
        if 'Body paragraph' not in editor.inner_text():
            errors.append('Editor: ' + repr(editor.inner_text()))

        page.evaluate('() => window.scrollTo(0, 0)')
        page.locator('.author-bar-text').click()
        after_author_click = scroll_y(page)
        if after_author_click > top_scroll + 80:
            errors.append('Empty form click scrolled page: ' + str(after_author_click))

        browser.close()

    if errors:
        print('FAIL:', '; '.join(errors), file=sys.stderr)
        return 1

    print('OK: title, introduction, editor, blur, no scroll jumps')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
