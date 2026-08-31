import re
import time
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from django.conf import settings
from django.contrib.sessions.backends.base import UpdateError
from django.contrib.sessions.exceptions import SessionInterrupted
from django.contrib.sessions.middleware import SessionMiddleware
from django.utils.cache import patch_vary_headers
from django.utils.http import http_date

TAB_ID_RE = re.compile(r'^[a-zA-Z0-9_-]{8,64}$')
TAB_QUERY_KEY = '__tab'
TAB_POST_KEY = '_tab'
TAB_HEADER = 'HTTP_X_BIKIBEDIA_TAB'


def get_tab_id(request):
    tab_id = (
        request.META.get(TAB_HEADER) or
        request.GET.get(TAB_QUERY_KEY) or
        request.POST.get(TAB_POST_KEY)
    )
    if tab_id and TAB_ID_RE.match(tab_id):
        return tab_id
    return None


def session_cookie_name(tab_id):
    if tab_id:
        return f'{settings.SESSION_COOKIE_NAME}_{tab_id}'
    return f'{settings.SESSION_COOKIE_NAME}_anonymous'


def append_tab_query(url, tab_id):
    if not tab_id or not url:
        return url

    parsed = urlparse(url)
    if parsed.scheme and parsed.scheme not in ('http', 'https'):
        return url
    if parsed.netloc and parsed.hostname not in (None, ''):
        allowed = {host.split(':')[0] for host in settings.ALLOWED_HOSTS if host != '*'}
        if parsed.hostname not in allowed:
            return url

    query = parse_qs(parsed.query, keep_blank_values=True)
    query[TAB_QUERY_KEY] = [tab_id]
    return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))


class TabSessionMiddleware(SessionMiddleware):
    def process_request(self, request):
        tab_id = get_tab_id(request)
        cookie_name = session_cookie_name(tab_id)
        request.bikibedia_tab_id = tab_id
        request.session_cookie_name = cookie_name
        session_key = request.COOKIES.get(cookie_name)

        # Clients that do not run our JavaScript (API tools, the Django test
        # client, curl) only ever send the plain session cookie. Fall back to
        # it for the anonymous bucket; tab-scoped buckets stay isolated.
        if session_key is None and tab_id is None:
            session_key = request.COOKIES.get(settings.SESSION_COOKIE_NAME)

        request.session = self.SessionStore(session_key)

    def process_response(self, request, response):
        cookie_name = getattr(request, 'session_cookie_name', settings.SESSION_COOKIE_NAME)

        try:
            accessed = request.session.accessed
            modified = request.session.modified
            empty = request.session.is_empty()
        except AttributeError:
            return response

        if cookie_name in request.COOKIES and empty:
            response.delete_cookie(
                cookie_name,
                path=settings.SESSION_COOKIE_PATH,
                domain=settings.SESSION_COOKIE_DOMAIN,
                samesite=settings.SESSION_COOKIE_SAMESITE,
            )
            patch_vary_headers(response, ('Cookie',))
        else:
            if accessed:
                patch_vary_headers(response, ('Cookie',))
            if (modified or settings.SESSION_SAVE_EVERY_REQUEST) and not empty:
                if request.session.get_expire_at_browser_close():
                    max_age = None
                    expires = None
                else:
                    max_age = request.session.get_expiry_age()
                    expires_time = time.time() + max_age
                    expires = http_date(expires_time)
                if response.status_code < 500:
                    try:
                        request.session.save()
                    except UpdateError:
                        raise SessionInterrupted(
                            "The request's session was deleted before the "
                            "request completed. The user may have logged "
                            "out in a concurrent request, for example."
                        )
                    response.set_cookie(
                        cookie_name,
                        request.session.session_key,
                        max_age=max_age,
                        expires=expires,
                        domain=settings.SESSION_COOKIE_DOMAIN,
                        path=settings.SESSION_COOKIE_PATH,
                        secure=settings.SESSION_COOKIE_SECURE or None,
                        httponly=settings.SESSION_COOKIE_HTTPONLY or None,
                        samesite=settings.SESSION_COOKIE_SAMESITE,
                    )

        if request.bikibedia_tab_id and settings.SESSION_COOKIE_NAME in request.COOKIES:
            response.delete_cookie(
                settings.SESSION_COOKIE_NAME,
                path=settings.SESSION_COOKIE_PATH,
                domain=settings.SESSION_COOKIE_DOMAIN,
                samesite=settings.SESSION_COOKIE_SAMESITE,
            )

        return response


class LastSeenMiddleware:
    THROTTLE_SECONDS = 60
    SKIP_PREFIXES = ('/static/', '/media/', '/accounts/presence/')

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.user.is_authenticated and not self._should_skip(request.path):
            self._maybe_touch(request)
        return response

    def _should_skip(self, path):
        return any(path.startswith(prefix) for prefix in self.SKIP_PREFIXES)

    def _maybe_touch(self, request):
        now_ts = time.time()
        last_ts = request.session.get('_last_seen_ts')
        if last_ts and now_ts - last_ts < self.THROTTLE_SECONDS:
            return

        from accounts.presence import touch_profile_last_seen

        touch_profile_last_seen(request.user)
        request.session['_last_seen_ts'] = now_ts


class TabRedirectMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        tab_id = getattr(request, 'bikibedia_tab_id', None)
        if not tab_id or response.status_code not in (301, 302, 303, 307, 308):
            return response

        location = response.get('Location')
        if not location:
            return response

        if location.startswith('/'):
            response['Location'] = append_tab_query(location, tab_id)
        elif location.startswith(('http://', 'https://')):
            response['Location'] = append_tab_query(location, tab_id)

        return response
