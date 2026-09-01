from django.contrib.auth.models import User
from django.test import Client, TestCase
from django.urls import reverse

from accounts.forms import ProfileForm, RegisterForm
from accounts.models import Profile

from .forms import ArticleForm
from .moderation import approve_article, reject_article
from .models import Article, ModerationLogEntry
from .sanitize import sanitize_article_html


def article_payload(**overrides):
    data = {
        'title': 'Easter Island statues',
        'introduction': 'A short but sufficiently long introduction for testing.',
        'body_text': '<p>' + ('Body text that is long enough to pass. ' * 3) + '</p>',
    }
    data.update(overrides)
    return data


class SanitizerTests(TestCase):
    def test_keeps_palette_classes(self):
        html = '<p><span class="ql-color-accent ql-bg-warning">x</span></p>'
        self.assertEqual(sanitize_article_html(html), html)

    def test_strips_inline_styles_and_unknown_classes(self):
        html = '<p><span style="color:red" class="evil">x</span></p>'
        self.assertEqual(sanitize_article_html(html), '<p><span>x</span></p>')

    def test_strips_scripts_and_js_urls(self):
        out = sanitize_article_html('<script>alert(1)</script><a href="javascript:x()">a</a>')
        self.assertNotIn('<script', out)
        self.assertNotIn('javascript:', out)

    def test_keeps_thumbnail_markup(self):
        html = '<div class="wiki-thumb wiki-thumb--center"><img src="/media/a.png"></div>'
        self.assertIn('wiki-thumb--center', sanitize_article_html(html))

    def test_keeps_size_classes(self):
        html = '<p><span class="ql-size-huge">big</span></p>'
        self.assertEqual(sanitize_article_html(html), html)

    def test_keeps_http_links(self):
        html = '<p><a href="https://example.com">Example</a></p>'
        out = sanitize_article_html(html)
        self.assertIn('href="https://example.com"', out)
        self.assertIn('Example', out)


class RegisterFormTests(TestCase):
    def setUp(self):
        self.existing = User.objects.create_user(
            username='Existing', email='taken@example.com', password='sup3r-Secret!1',
        )

    def build(self, **overrides):
        data = {
            'username': 'newcomer',
            'email': 'new@example.com',
            'password1': 'sup3r-Secret!1',
            'password2': 'sup3r-Secret!1',
        }
        data.update(overrides)
        return RegisterForm(data)

    def test_valid_signup(self):
        self.assertTrue(self.build().is_valid())

    def test_rejects_case_insensitive_duplicate_username(self):
        form = self.build(username='EXISTING')
        self.assertFalse(form.is_valid())
        self.assertIn('username', form.errors)

    def test_rejects_duplicate_email(self):
        form = self.build(email='TAKEN@example.com')
        self.assertFalse(form.is_valid())
        self.assertIn('email', form.errors)

    def test_rejects_reserved_username(self):
        form = self.build(username='admin')
        self.assertFalse(form.is_valid())

    def test_rejects_short_username(self):
        form = self.build(username='ab')
        self.assertFalse(form.is_valid())

    def test_enforces_password_validators(self):
        form = self.build(password1='12345678', password2='12345678')
        self.assertFalse(form.is_valid())
        self.assertIn('password2', form.errors)

    def test_rejects_password_similar_to_username(self):
        form = self.build(username='alexander', password1='alexander1', password2='alexander1')
        self.assertFalse(form.is_valid())


class ArticleFormTests(TestCase):
    def test_valid_article(self):
        self.assertTrue(ArticleForm(article_payload()).is_valid())

    def test_rejects_short_title(self):
        form = ArticleForm(article_payload(title='Hi'))
        self.assertFalse(form.is_valid())
        self.assertIn('title', form.errors)

    def test_rejects_title_without_letters(self):
        form = ArticleForm(article_payload(title='12345'))
        self.assertFalse(form.is_valid())

    def test_rejects_duplicate_title(self):
        Article.objects.create(
            title='Easter Island statues',
            introduction='x' * 30,
            body_text='<p>body</p>',
        )
        form = ArticleForm(article_payload())
        self.assertFalse(form.is_valid())
        self.assertIn('title', form.errors)

    def test_rejects_short_introduction(self):
        form = ArticleForm(article_payload(introduction='Too short'))
        self.assertFalse(form.is_valid())
        self.assertIn('introduction', form.errors)

    def test_rejects_short_body_without_image(self):
        form = ArticleForm(article_payload(body_text='<p>tiny</p>'))
        self.assertFalse(form.is_valid())
        self.assertIn('body_text', form.errors)

    def test_allows_short_body_when_it_has_an_image(self):
        form = ArticleForm(article_payload(
            body_text='<div class="wiki-thumb"><img src="/media/a.png"></div>',
        ))
        self.assertTrue(form.is_valid(), form.errors)

    def test_collapses_whitespace_in_title(self):
        form = ArticleForm(article_payload(title='  Spaced   out  title  '))
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(form.cleaned_data['title'], 'Spaced out title')


class ModerationLogTests(TestCase):
    def setUp(self):
        self.author = User.objects.create_user(username='author', password='sup3r-Secret!1')
        self.moderator = User.objects.create_user(
            username='mod', password='sup3r-Secret!1', is_staff=True,
        )
        self.article = Article.objects.create(
            title='Logged article',
            introduction='x' * 30,
            body_text='<p>body</p>',
            author=self.author,
        )

    def test_approve_writes_log_entry(self):
        approve_article(self.article, self.moderator, 'Looks good')
        entry = ModerationLogEntry.objects.first()
        self.assertEqual(entry.action, ModerationLogEntry.ACTION_APPROVED)
        self.assertEqual(entry.actor, self.moderator)
        self.assertEqual(entry.target_title, 'Logged article')
        self.assertEqual(entry.tone, 'approved')

    def test_reject_writes_log_entry(self):
        reject_article(self.article, self.moderator, 'Needs sources')
        entry = ModerationLogEntry.objects.first()
        self.assertEqual(entry.action, ModerationLogEntry.ACTION_REJECTED)
        self.assertEqual(entry.comment, 'Needs sources')

    def test_log_survives_article_deletion(self):
        approve_article(self.article, self.moderator)
        self.article.delete()
        entry = ModerationLogEntry.objects.first()
        self.assertIsNone(entry.article)
        self.assertEqual(entry.target_title, 'Logged article')

    def test_log_page_redirects_non_staff(self):
        # A fresh client per user: the tab-scoped session cookie survives
        # force_login, so reusing one client would keep the first identity.
        client = Client()
        client.force_login(self.author)
        self.assertEqual(client.get(reverse('moderation_log')).status_code, 302)

    def test_log_page_allows_staff(self):
        client = Client()
        client.force_login(self.moderator)
        self.assertEqual(client.get(reverse('moderation_log')).status_code, 200)

    def test_log_page_redirects_anonymous(self):
        self.assertEqual(Client().get(reverse('moderation_log')).status_code, 302)

    def test_log_filters_by_action(self):
        approve_article(self.article, self.moderator)
        self.client.force_login(self.moderator)
        response = self.client.get(reverse('moderation_log'), {'action': 'rejected'})
        self.assertEqual(len(response.context['entries']), 0)

        response = self.client.get(reverse('moderation_log'), {'action': 'approved'})
        self.assertEqual(len(response.context['entries']), 1)


class LiveStateTests(TestCase):
    def setUp(self):
        self.moderator = User.objects.create_user(
            username='mod', password='sup3r-Secret!1', is_staff=True,
        )
        self.published = Article.objects.create(
            title='Published one',
            introduction='x' * 30,
            body_text='<p>body</p>',
            status=Article.STATUS_PUBLISHED,
        )
        Article.objects.create(
            title='Pending one',
            introduction='x' * 30,
            body_text='<p>body</p>',
            status=Article.STATUS_PENDING,
        )

    def test_anonymous_sees_only_published(self):
        data = self.client.get(reverse('live_state')).json()
        self.assertEqual(data['articles']['count'], 1)
        titles = [a['title'] for a in data['articles']['latest']]
        self.assertEqual(titles, ['Published one'])
        self.assertEqual(data['moderation']['pending'], 0)
        self.assertEqual(data['moderation']['log'], [])

    def test_since_filter_returns_only_newer_articles(self):
        first = self.client.get(reverse('live_state')).json()
        self.assertEqual(first['articles']['new'], [])

        fresh = Article.objects.create(
            title='Brand new',
            introduction='x' * 30,
            body_text='<p>body</p>',
            status=Article.STATUS_PUBLISHED,
        )
        data = self.client.get(
            reverse('live_state'), {'since': first['server_time']},
        ).json()
        self.assertEqual([a['slug'] for a in data['articles']['new']], [fresh.slug])

    def test_staff_sees_moderation_counters_and_log(self):
        approve_article(self.published, self.moderator)
        self.client.force_login(self.moderator)
        data = self.client.get(reverse('live_state')).json()
        self.assertEqual(data['moderation']['pending'], 1)
        self.assertEqual(len(data['moderation']['log']), 1)

    def test_rejects_post(self):
        self.assertEqual(self.client.post(reverse('live_state')).status_code, 405)


class AuthFieldCheckTests(TestCase):
    def setUp(self):
        User.objects.create_user(username='taken', password='sup3r-Secret!1')

    def check(self, **params):
        return self.client.get(reverse('auth_field_check'), params).json()

    def test_username_available(self):
        self.assertEqual(self.check(field='username', value='freshname')['state'], 'ok')

    def test_username_taken(self):
        self.assertEqual(self.check(field='username', value='TAKEN')['state'], 'error')

    def test_username_reserved(self):
        self.assertEqual(self.check(field='username', value='root')['state'], 'error')

    def test_invalid_email(self):
        self.assertEqual(self.check(field='email', value='nope')['state'], 'error')

    def test_email_does_not_leak_existing_accounts(self):
        User.objects.create_user(
            username='other', email='known@example.com', password='sup3r-Secret!1',
        )
        self.assertEqual(self.check(field='email', value='known@example.com')['state'], 'ok')

    def test_weak_password_reports_error(self):
        self.assertEqual(self.check(field='password', value='12345678')['state'], 'error')

    def test_strong_password_scores_high(self):
        report = self.check(field='password', value='Correct-Horse-9-Battery')
        self.assertEqual(report['state'], 'ok')
        self.assertGreaterEqual(report['score'], 3)


class ProfileFormTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='admin',
            email='admin@example.com',
            password='sup3r-Secret!1',
        )
        self.profile = Profile.objects.get(user=self.user)

    def test_can_update_birth_date_with_grandfathered_reserved_username(self):
        form = ProfileForm(
            {
                'username': 'admin',
                'email': 'admin@example.com',
                'birth_date': '15.03.1990',
            },
            instance=self.profile,
            user=self.user,
        )
        self.assertTrue(form.is_valid(), form.errors)
        form.save()
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.birth_date.isoformat(), '1990-03-15')

    def test_cannot_rename_to_reserved_username(self):
        form = ProfileForm(
            {
                'username': 'root',
                'email': 'admin@example.com',
                'birth_date': '',
            },
            instance=self.profile,
            user=self.user,
        )
        self.assertFalse(form.is_valid())
        self.assertIn('username', form.errors)


class ChromeLayoutTests(TestCase):
    def test_guest_home_has_logo_and_header_theme_dock(self):
        html = self.client.get(reverse('home')).content.decode()
        self.assertIn('logo-image-box', html)
        self.assertIn('Bikibedia', html)
        self.assertIn('data-theme-toggle', html)

    def test_signed_in_theme_dock_lives_in_profile_not_header_nav(self):
        user = User.objects.create_user(username='reader', password='sup3r-Secret!1')
        client = Client()
        client.force_login(user)
        home = client.get(reverse('home')).content.decode()
        profile = client.get(reverse('profile')).content.decode()
        self.assertIn('header-profile-trigger', home)
        self.assertIn('profile-card-theme', home)
        self.assertIn('profile-theme-setting', profile)
        self.assertIn('data-theme-toggle', profile)

    def test_article_form_loads_current_editor_assets(self):
        user = User.objects.create_user(username='writer', password='sup3r-Secret!1')
        client = Client()
        client.force_login(user)
        html = client.get(reverse('article_create')).content.decode()
        self.assertIn('wysiwyg-editor.js?v=33', html)
        self.assertIn('quill-theme.css?v=7', html)

    def test_admin_index_shows_standard_app_panels(self):
        admin_user = User.objects.create_superuser(
            username='siteadmin', email='a@example.com', password='sup3r-Secret!1',
        )
        client = Client()
        client.force_login(admin_user)
        html = client.get('/admin/').content.decode()
        self.assertIn('Wiki articles', html)
        self.assertIn('Article revisions', html)
        self.assertIn('Notifications', html)
        self.assertNotIn('bikibedia-admin-dashboard', html)
        self.assertNotIn('Article votes', html)
        self.assertNotIn('At a glance', html)


EASTER_ISLAND_BODY = (
    '<p>Easter Island is an island and special territory of Chile in the '
    'southeastern Pacific Ocean, at the southeasternmost point of the '
    'Polynesian Triangle in Oceania.</p>'
    '<div class="wiki-thumb wiki-thumb--center">'
    '<img src="/media/articles/inline/moai.png" alt="Moai">'
    '<p class="wiki-thumb-caption">Moai on the slopes of Rano Raraku.</p>'
    '</div>'
    '<p>The island is renowned for its nearly 1,000 extant monumental statues, '
    'called moai, which were created by the early Rapa Nui people. In 1995, '
    'UNESCO named Easter Island a World Heritage Site, with much of the island '
    'protected within Rapa Nui National Park.</p>'
)


class EasterIslandArticleTests(TestCase):
    def setUp(self):
        self.author = User.objects.create_user(
            username='easter-author', password='sup3r-Secret!1',
        )
        self.moderator = User.objects.create_user(
            username='easter-mod', password='sup3r-Secret!1', is_staff=True,
        )

    def test_sanitizer_keeps_photo_caption_and_text_after(self):
        out = sanitize_article_html(EASTER_ISLAND_BODY)
        self.assertIn('wiki-thumb--center', out)
        self.assertIn('wiki-thumb-caption', out)
        self.assertIn('Moai on the slopes of Rano Raraku.', out)
        self.assertIn('UNESCO named Easter Island', out)
        thumb_start = out.find('wiki-thumb')
        thumb_end = out.find('</div>', thumb_start)
        caption_pos = out.find('Moai on the slopes of Rano Raraku.', thumb_start)
        self.assertGreater(caption_pos, thumb_start)
        self.assertLess(caption_pos, thumb_end)
        self.assertGreater(out.find('UNESCO named Easter Island'), thumb_end)

    def test_form_accepts_article_with_photo_and_following_text(self):
        form = ArticleForm(article_payload(
            title='Easter Island',
            introduction='An island in the southeastern Pacific Ocean, famous for moai.',
            body_text=EASTER_ISLAND_BODY,
        ))
        self.assertTrue(form.is_valid(), form.errors)

    def test_submit_and_publish_renders_text_under_the_photo(self):
        client = Client()
        client.force_login(self.author)
        response = client.post(reverse('article_create'), {
            'title': 'Easter Island',
            'introduction': 'An island in the southeastern Pacific Ocean, famous for moai.',
            'body_text': EASTER_ISLAND_BODY,
        })
        self.assertEqual(response.status_code, 302)
        article = Article.objects.get(title='Easter Island')
        self.assertEqual(article.status, Article.STATUS_PENDING)

        approve_article(article, self.moderator)
        article.refresh_from_db()
        html = Client().get(reverse('article', args=[article.slug])).content.decode()
        self.assertIn('wiki-thumb', html)
        self.assertIn('Moai on the slopes of Rano Raraku.', html)
        self.assertIn('UNESCO named Easter Island', html)
        self.assertGreater(html.find('UNESCO named Easter Island'), html.find('wiki-thumb'))

    def test_editor_script_keeps_native_selection_and_caret_after_photos(self):
        from pathlib import Path
        source = (Path(__file__).resolve().parent.parent / 'static' / 'wiki' / 'js' / 'wysiwyg-editor.js').read_text(encoding='utf-8')
        self.assertIn('function focusAfterThumb', source)
        self.assertIn('function applyLinkFromPrompt', source)
        self.assertIn('function setBasicsFocus', source)
        self.assertIn('article-form--basics-focus', source)
        self.assertNotIn('function setEditorActive', source)
        self.assertNotIn('editorLock', source)
        self.assertNotIn('captionEditor', source)
        self.assertNotIn('data-action="caption"', source)
        self.assertNotIn("document.addEventListener('keydown'", source)
        self.assertNotIn('quill.focus()', source)
        self.assertNotIn('quill.blur()', source)
        self.assertNotIn('quill.enable(false)', source)
