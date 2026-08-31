import re

from django.utils.html import escape, linebreaks, mark_safe

from .sanitize import sanitize_article_html

HTML_HINT = re.compile(r'</?(p|div|ul|ol|li|blockquote|h[1-6]|img|strong|em|br)\b', re.I)


def looks_like_html(text):
    stripped = text.strip()
    if not stripped:
        return False
    if stripped.startswith('<'):
        return True
    return bool(HTML_HINT.search(stripped))


def format_wiki_markup(text):
    if not text:
        return ''

    escaped = escape(text)

    escaped = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', escaped, flags=re.DOTALL)
    escaped = re.sub(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)', r'<em>\1</em>', escaped, flags=re.DOTALL)
    escaped = re.sub(r'~~(.+?)~~', r'<del>\1</del>', escaped, flags=re.DOTALL)
    escaped = re.sub(r'__([^_]+)__', r'<u>\1</u>', escaped)
    escaped = re.sub(r'`([^`\n]+)`', r'<code>\1</code>', escaped)
    escaped = re.sub(
        r'\[([^\]]+)\]\((https?://[^\s)]+)\)',
        r'<a href="\2" rel="noopener noreferrer">\1</a>',
        escaped,
    )
    escaped = re.sub(
        r'^&gt; (.+)$',
        r'<blockquote>\1</blockquote>',
        escaped,
        flags=re.MULTILINE,
    )

    return mark_safe(linebreaks(escaped))


def format_article_body(text):
    if not text:
        return ''
    if looks_like_html(text):
        return mark_safe(sanitize_article_html(text))
    return format_wiki_markup(text)
